import { DurableObject } from 'cloudflare:workers';
import { closeManagedVoiceCall, voiceProviderKeyIdentity } from '../../../app/functions/_lib/voice-provider-calls.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RETRY_MS = 60_000;
const REVIEW_MS = 5 * 60_000;
const CONNECTION_LEASE_MS = 25_000;
const CONNECTION_START_MS = 35_000;
type Deadline = {sessionId: string; deadlineMs: number; status: 'armed' | 'waiting' | 'review'};
type ArmRequest = {uid: string; sessionId: string; providerKeySha256: string};
type ConnectionWatch = {attemptId:string; expiresAt:number; status:'watching'|'closing'};
type PulseRequest = {uid:string; sessionId:string; attemptId:string};

/** One SQLite-backed object per interview. Only server bindings can call arm.
 * D1 owns the deadline/owner/call identity. Object storage retains no key,
 * provider ID, UID, transcript, SDP, audio, email or report. */
export class VoiceDeadline extends DurableObject<Env> {
  #validPulse(request: PulseRequest) {
    return UUID.test(request.sessionId || '') && UUID.test(request.attemptId || '') &&
      typeof request.uid==='string' && !!request.uid && request.uid.length<=128 &&
      this.ctx.id.equals(this.env.VOICE_DEADLINES.idFromName(request.sessionId));
  }

  async #activeConnection(request: PulseRequest) {
    if (!this.#validPulse(request)) return null;
    return this.env.DB.prepare(`SELECT p.auth_id,p.rowid AS generation FROM voice_interview_controls c
      JOIN voice_provider_calls p ON p.id=c.current_attempt_id AND p.session_id=c.session_id AND p.auth_id=c.auth_id
      WHERE c.session_id=? AND c.auth_id=? AND p.id=? AND p.state='active'
        AND c.closed_at IS NULL AND julianday(c.deadline_at)>julianday('now')
        AND NOT EXISTS(SELECT 1 FROM account_deletion_admissions WHERE auth_id=c.auth_id)`)
      .bind(request.sessionId,request.uid,request.attemptId).first<{auth_id:string;generation:number}>();
  }

  // Opted-in clients must have this durable watch before receiving their SDP.
  // Legacy clients keep their original server deadline during a staged rollout.
  async watchConnection(request: PulseRequest) {
    try {
      if (this.env.VOICE_DEADLINES_ENABLED!=='true') return {watching:false};
      const active=await this.#activeConnection(request);
      if (!active) return {watching:false};
      return await this.ctx.storage.transaction(async storage=>{
        const deadline=await storage.get<Deadline>('deadline');
        const previous=await storage.get<ConnectionWatch>('connection');
        const generation=await storage.get<number>('connection-generation') || 0;
        if (!deadline || deadline.sessionId!==request.sessionId || deadline.status!=='armed' || deadline.deadlineMs<=Date.now()) return {watching:false};
        // D1 reads can finish out of order. Retain the greatest admitted row
        // generation even after closure so a stale RPC cannot replace/revive it.
        if (active.generation<generation || (active.generation===generation && previous?.attemptId!==request.attemptId)) return {watching:false};
        // A retry cannot extend the initial lease or undo a closure already claimed.
        if (previous?.attemptId===request.attemptId) return {watching:previous.status==='watching'};
        const watch:ConnectionWatch={attemptId:request.attemptId,expiresAt:Date.now()+CONNECTION_START_MS,status:'watching'};
        await storage.put('connection-generation',active.generation);
        await storage.put('connection',watch);
        await storage.setAlarm(Math.min(deadline.deadlineMs,watch.expiresAt));
        return {watching:true};
      });
    } catch { throw Error('voice_deadline_unavailable'); }
  }

  async pulseConnection(request: PulseRequest) {
    try {
      if (!await this.#activeConnection(request)) return {alive:false};
      return await this.ctx.storage.transaction(async storage=>{
        const deadline=await storage.get<Deadline>('deadline');
        const watch=await storage.get<ConnectionWatch>('connection');
        if (!deadline || deadline.status!=='armed' || deadline.deadlineMs<=Date.now() ||
            !watch || watch.attemptId!==request.attemptId || watch.status!=='watching') return {alive:false};
        const expiresAt=Date.now()+CONNECTION_LEASE_MS;
        await storage.put('connection',{...watch,expiresAt});
        await storage.setAlarm(Math.min(deadline.deadlineMs,expiresAt));
        return {alive:true};
      });
    } catch { throw Error('voice_deadline_unavailable'); }
  }

  async #connectionAlarm(saved: Deadline) {
    // A durable claim, separate from the provider's exclusive close claim.
    // No storage transaction or concurrency gate spans network I/O.
    const claimed=await this.ctx.storage.transaction(async storage=>{
      const watch=await storage.get<ConnectionWatch>('connection');
      if (!watch) {
        await storage.setAlarm(saved.deadlineMs); return null;
      }
      if (watch.status==='watching' && watch.expiresAt>Date.now()) {
        await storage.setAlarm(Math.min(saved.deadlineMs,watch.expiresAt)); return null;
      }
      await storage.put('connection',{...watch,status:'closing'});
      await storage.setAlarm(Math.min(saved.deadlineMs,Date.now()+5_000));
      return watch;
    });
    if (!claimed) return;
    let observed=false;
    try {
      const call=await this.env.DB.prepare(`SELECT p.auth_id FROM voice_provider_calls p
        JOIN voice_interview_controls c ON c.session_id=p.session_id AND c.auth_id=p.auth_id AND c.current_attempt_id=p.id
        WHERE p.id=? AND p.session_id=? AND p.state='active'`).bind(claimed.attemptId,saved.sessionId).first<{auth_id:string}>();
      if (call) await closeManagedVoiceCall(this.env,{uid:call.auth_id,attemptId:claimed.attemptId});
      observed=true;
      console.log('[voice-connection-watch]',{session:saved.sessionId,attempt:claimed.attemptId,outcome:'close_checked'});
    } catch {
      // Never repeat an uncertain provider operation. The original interview
      // deadline and existing ledger/reconciliation path remain authoritative.
      console.log('[voice-connection-watch]',{session:saved.sessionId,attempt:claimed.attemptId,outcome:'closure_unconfirmed'});
    } finally {
      await this.ctx.storage.transaction(async storage=>{
        const watch=await storage.get<ConnectionWatch>('connection');
        if (observed && watch?.attemptId===claimed.attemptId) await storage.delete('connection');
        const current=await storage.get<ConnectionWatch>('connection');
        const deadline=await storage.get<Deadline>('deadline');
        if (deadline?.status==='armed') await storage.setAlarm(current
          ? Math.min(deadline.deadlineMs,current.status==='watching'?current.expiresAt:Date.now()+5_000) : deadline.deadlineMs);
      });
    }
  }

  async arm(request: ArmRequest) {
    try { return await this.#arm(request); }
    catch (error) {
      // Runtime RPC failures are logged by Cloudflare too. Expose only our
      // fixed codes; never let a D1/binding diagnostic escape this boundary.
      const code = error instanceof Error && /^voice_deadline_(disabled|invalid|provider_mismatch|not_open|conflict)$/.test(error.message)
        ? error.message : 'voice_deadline_unavailable';
      throw Error(code);
    }
  }

  async #arm(request: ArmRequest) {
    if (this.env.VOICE_DEADLINES_ENABLED !== 'true') throw Error('voice_deadline_disabled');
    const {uid, sessionId, providerKeySha256} = request;
    if (!UUID.test(sessionId || '') || typeof uid !== 'string' || !uid || uid.length > 128 ||
        !this.ctx.id.equals(this.env.VOICE_DEADLINES.idFromName(sessionId))) throw Error('voice_deadline_invalid');
    if (!/^[a-f0-9]{64}$/.test(providerKeySha256 || '') ||
        await voiceProviderKeyIdentity(this.env) !== providerKeySha256) throw Error('voice_deadline_provider_mismatch');
    const control = await this.env.DB.prepare(`SELECT deadline_at,closed_at,audio_check_deadline_at,audio_ready_at FROM voice_interview_controls
      WHERE session_id=? AND auth_id=? AND legacy_unverified=0
        AND NOT EXISTS(SELECT 1 FROM account_deletion_admissions WHERE auth_id=?)
        AND NOT EXISTS(SELECT 1 FROM voice_closure_reconciliations WHERE session_id=?)`)
      .bind(sessionId,uid,uid,sessionId).first<{deadline_at: string; closed_at: string | null; audio_check_deadline_at: string | null; audio_ready_at: string | null}>();
    if (!control || control.closed_at) throw Error('voice_deadline_not_open');
    const deadlineMs = Date.parse(control.deadline_at.replace(' ','T') + (/Z|[+-]\d\d:\d\d$/.test(control.deadline_at) ? '' : 'Z'));
    if (!Number.isFinite(deadlineMs) || deadlineMs <= Date.now() || deadlineMs > Date.now() + 20 * 60_000) {
      throw Error('voice_deadline_invalid');
    }
    const setupMs = control.audio_check_deadline_at ? Date.parse(control.audio_check_deadline_at.replace(' ','T')+'Z') : NaN;
    const readyMs = control.audio_ready_at ? Date.parse(control.audio_ready_at.replace(' ','T')+'Z') : NaN;
    // A server-recorded readiness intent permits exactly one transition from
    // the original setup deadline to 20 minutes from readiness. Retries cannot
    // move either timestamp or erase an unresolved closure result.
    await this.ctx.storage.transaction(async storage => {
      const previous = await storage.get<Deadline>('deadline');
      const activation = previous && previous.deadlineMs === setupMs && Number.isFinite(readyMs) &&
        readyMs < setupMs && deadlineMs === readyMs + 20 * 60_000;
      if (previous && (previous.sessionId !== sessionId || (previous.deadlineMs !== deadlineMs && !activation) || previous.status !== 'armed')) {
        throw Error('voice_deadline_conflict');
      }
      await storage.put<Deadline>('deadline',{sessionId,deadlineMs,status:'armed'});
      const watch=await storage.get<ConnectionWatch>('connection');
      await storage.setAlarm(watch ? Math.min(deadlineMs,watch.status==='watching'?watch.expiresAt:Date.now()+5_000) : deadlineMs);
    });
    return {armed:true, sessionId, deadlineAt:control.deadline_at};
  }

  async alarm() {
    const saved = await this.ctx.storage.get<Deadline>('deadline');
    if (!saved) return;
    if (saved.status === 'review') {
      // Observe only: an unknown provider mutation must never be replayed by
      // an alarm. The private operator command records verified closure in D1.
      await this.ctx.storage.setAlarm(Date.now() + REVIEW_MS);
      try {
        const reconciled = await this.env.DB.prepare(`SELECT 1 FROM voice_closure_reconciliations r
          WHERE r.session_id=?
            AND NOT EXISTS(SELECT 1 FROM voice_provider_calls p WHERE p.session_id=r.session_id AND p.state<>'closed')
            AND NOT EXISTS(SELECT 1 FROM voice_interview_controls c WHERE c.session_id=r.session_id
              AND (c.closed_at IS NULL OR c.legacy_unverified=1 OR c.auth_id<>r.auth_id)) LIMIT 1`)
          .bind(saved.sessionId).first();
        if (reconciled) {
          await this.ctx.storage.deleteAlarm();
          await this.ctx.storage.deleteAll();
          console.log('[voice-deadline]',{session:saved.sessionId,outcome:'reconciled'});
        }
      } catch { console.log('[voice-deadline]',{session:saved.sessionId,outcome:'retry_review_observation'}); }
      return;
    }
    if (Date.now() < saved.deadlineMs) {
      await this.#connectionAlarm(saved);
      return;
    }
    // Arm a durable retry BEFORE external I/O. Cloudflare's limited automatic
    // exception retries alone cannot cover a prolonged D1/provider outage.
    // This retries observation and active-call claiming; never an uncertain
    // provider mutation. Disabling new scheduling does not disable old alarms.
    await this.ctx.storage.setAlarm(Date.now() + RETRY_MS);
    try {
      await this.env.DB.prepare(`UPDATE voice_interview_controls
        SET closed_at=COALESCE(closed_at,datetime('now')),updated_at=datetime('now')
        WHERE session_id=? AND NOT (audio_ready_at IS NOT NULL AND
          deadline_at=datetime(audio_ready_at,'+20 minutes') AND julianday(deadline_at)>julianday('now'))`)
        .bind(saved.sessionId).run();
      // Activation can race the original setup alarm. D1's conditional End
      // wins or the confirmed readiness wins; a stale alarm cannot hang up an
      // activated call. Re-arm from the authoritative row, never browser time.
      const extended = await this.env.DB.prepare(`SELECT auth_id,closed_at FROM voice_interview_controls
        WHERE session_id=? AND closed_at IS NULL`).bind(saved.sessionId).first<{auth_id:string;closed_at:string|null}>();
      if (extended) {
        await this.#arm({uid:extended.auth_id,sessionId:saved.sessionId,providerKeySha256:await voiceProviderKeyIdentity(this.env)});
        return;
      }
      const active = await this.env.DB.prepare(`SELECT id,auth_id FROM voice_provider_calls
        WHERE session_id=? AND state='active' LIMIT 1`).bind(saved.sessionId).first<{id:string;auth_id:string}>();
      if (active) await closeManagedVoiceCall(this.env,{uid:active.auth_id,attemptId:active.id}).catch(()=>{});
      const pending = await this.env.DB.prepare(`SELECT state FROM voice_provider_calls
        WHERE session_id=? AND state<>'closed' LIMIT 1`).bind(saved.sessionId).first<{state:string}>();
      const legacy = await this.env.DB.prepare(`SELECT 1 FROM voice_interview_controls
        WHERE session_id=? AND legacy_unverified=1`).bind(saved.sessionId).first();
      if (pending?.state === 'uncertain' || legacy) {
        await this.ctx.storage.put<Deadline>('deadline',{...saved,status:'review'});
        await this.ctx.storage.setAlarm(Date.now() + REVIEW_MS);
        console.log('[voice-deadline]',{session:saved.sessionId,outcome:'needs_review'});
      } else if (pending) {
        await this.ctx.storage.put<Deadline>('deadline',{...saved,status:'waiting'});
        if (saved.status !== 'waiting') console.log('[voice-deadline]',{session:saved.sessionId,outcome:'waiting'});
      } else {
        await this.ctx.storage.deleteAlarm();
        await this.ctx.storage.deleteAll();
        console.log('[voice-deadline]',{session:saved.sessionId,outcome:'closed'});
      }
    } catch {
      // Leave the persisted alarm and call ledger untouched. Never log provider
      // bodies, SQL diagnostics or credentials from an exception.
      console.log('[voice-deadline]',{session:saved.sessionId,outcome:'retry_observation'});
    }
  }
}

// There is no public scheduling, hangup, introspection or operator endpoint.
export default {fetch() { return new Response('Not found',{status:404}); }} satisfies ExportedHandler<Env>;
