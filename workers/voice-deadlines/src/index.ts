import { DurableObject } from 'cloudflare:workers';
import { closeManagedVoiceCall, voiceProviderKeyIdentity } from '../../../app/functions/_lib/voice-provider-calls.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RETRY_MS = 60_000;
const REVIEW_MS = 5 * 60_000;
type Deadline = {sessionId: string; deadlineMs: number; status: 'armed' | 'waiting' | 'review'};
type ArmRequest = {uid: string; sessionId: string; providerKeySha256: string};

/** One SQLite-backed object per interview. Only server bindings can call arm.
 * D1 owns the deadline/owner/call identity. Object storage retains no key,
 * provider ID, UID, transcript, SDP, audio, email or report. */
export class VoiceDeadline extends DurableObject<Env> {
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
    const control = await this.env.DB.prepare(`SELECT deadline_at,closed_at FROM voice_interview_controls
      WHERE session_id=? AND auth_id=? AND legacy_unverified=0
        AND NOT EXISTS(SELECT 1 FROM account_deletion_admissions WHERE auth_id=?)
        AND NOT EXISTS(SELECT 1 FROM voice_closure_reconciliations WHERE session_id=?)`)
      .bind(sessionId,uid,uid,sessionId).first<{deadline_at: string; closed_at: string | null}>();
    if (!control || control.closed_at) throw Error('voice_deadline_not_open');
    const deadlineMs = Date.parse(control.deadline_at.replace(' ','T') + (/Z|[+-]\d\d:\d\d$/.test(control.deadline_at) ? '' : 'Z'));
    if (!Number.isFinite(deadlineMs) || deadlineMs <= Date.now() || deadlineMs > Date.now() + 20 * 60_000) {
      throw Error('voice_deadline_invalid');
    }
    // Atomic local state+alarm. Repeated RPCs can neither extend the first
    // deadline nor erase an unresolved alarm result.
    await this.ctx.storage.transaction(async storage => {
      const previous = await storage.get<Deadline>('deadline');
      if (previous && (previous.sessionId !== sessionId || previous.deadlineMs !== deadlineMs || previous.status !== 'armed')) {
        throw Error('voice_deadline_conflict');
      }
      await storage.put<Deadline>('deadline',{sessionId,deadlineMs,status:'armed'});
      await storage.setAlarm(deadlineMs);
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
      await this.ctx.storage.setAlarm(saved.deadlineMs);
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
        WHERE session_id=?`).bind(saved.sessionId).run();
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
