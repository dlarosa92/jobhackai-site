import { env, exports } from 'cloudflare:workers';
import { applyD1Migrations, runInDurableObject, runDurableObjectAlarm } from 'cloudflare:test';
import { beforeAll, beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { voiceProviderKeyIdentity } from '../../../app/functions/_lib/voice-provider-calls.js';
import { openManagedInterview, closeManagedInterview } from '../../../app/functions/_lib/voice-managed-interview.js';
import {calls as reconcileCalls,legacy as reconcileLegacy} from '../../../app/scripts/lib/voice-closure-reconcile-core.mjs';

let sessionId: string;
let stub: DurableObjectStub<import('../src/index').VoiceDeadline>;
let requests: string[];
let keySha: string;
const appEnv = {...env,VOICE_INTERVIEW_ENABLED:'true',VOICE_MANAGED_CALLS_ENABLED:'true'};
const open = (extra={}) => openManagedInterview(appEnv,{uid:'owner',sessionId,sdp:'v=0 offer',role:'Engineer',...extra});
const control = () => env.DB.prepare('SELECT * FROM voice_interview_controls WHERE session_id=?').bind(sessionId).first();
const call = () => env.DB.prepare("SELECT * FROM voice_provider_calls WHERE session_id=? ORDER BY rowid DESC LIMIT 1").bind(sessionId).first();
const arm = async (request: Parameters<typeof stub.arm>[0]) => await stub.arm(request);
const deferred = () => {let resolve!: () => void;const promise=new Promise<void>(r=>{resolve=r;});return {promise,resolve};};
const state = () => runInDurableObject(stub,async(_instance,ctx)=>({saved:await ctx.storage.get('deadline'),alarm:await ctx.storage.getAlarm()}));
const due = () => runInDurableObject(stub,async(_instance,ctx)=>{
  const saved=await ctx.storage.get<{sessionId:string;deadlineMs:number;status:string}>('deadline');
  if(!saved) throw Error('fixture missing alarm');
  await ctx.storage.put('deadline',{...saved,deadlineMs:Date.now()-1});
  // runDurableObjectAlarm executes the actual handler without a 20-minute wait.
});
async function reconcile(old=false) {
  const core=old?reconcileLegacy:reconcileCalls,current=await call(),id=old?sessionId:String(current!.id);
  const row=await env.DB.prepare(core.inspectionSql(id)).first();
  const now=Date.now()+1000,at=new Date(now).toISOString();
  const report=core.inspectReport('qa',row,now);
  report.resolution=old?'legacy_drained':'closed';
  report.evidence={operatorRef:'fixture/operator',
    invocation:{status:'terminated',executionToken:old?sessionId:row!.execution_token || row!.id,observedAt:at,reference:'fixture/invocation'},
    providers:{status:report.resolution,pendingRequests:false,environment:'qa',projectRef:'fixture/project',observedAt:at,reference:'fixture/provider',
      ...(old?{scope:'environment_legacy_calls',issuersDisabled:true,credentialsDrained:true,allInvocationsTerminal:true}:
        {scope:'one_create_attempt',attemptId:id,providerKeySha256:row!.provider_key_sha256,providerCallId:row!.provider_call_id})}};
  const plan=core.planReconciliation(report,row,'qa',now);await env.DB.prepare(plan.sql).run();return plan;
}
beforeAll(async()=>{
  await applyD1Migrations(env.DB,env.TEST_MIGRATIONS);
  keySha=await voiceProviderKeyIdentity(env);
});
beforeEach(async()=>{
  sessionId=crypto.randomUUID();stub=env.VOICE_DEADLINES.getByName(sessionId);requests=[];
  await env.DB.prepare("INSERT INTO users(auth_id,email) VALUES('owner','owner@example.test') ON CONFLICT(auth_id) DO UPDATE SET free_session_used=0,voice_sessions_remaining=0").run();
  vi.spyOn(globalThis,'fetch').mockImplementation(async(input)=>{
    const url=String(input instanceof Request?input.url:input);requests.push(url);
    if(url.endsWith('/hangup'))return new Response(null,{status:200});
    if(url==='https://api.openai.com/v1/realtime/calls')return new Response('v=0 answer',{status:201,headers:{Location:'/v1/realtime/calls/rtc_'+crypto.randomUUID()}});
    throw Error('Unexpected external request: '+url);
  });
});
afterEach(async()=>{
  vi.restoreAllMocks();
  await runInDurableObject(stub,async(_instance,ctx)=>{await ctx.storage.deleteAlarm();await ctx.storage.deleteAll();});
  await env.DB.prepare("DELETE FROM account_deletion_admissions WHERE auth_id='owner'").run();
});

describe('durable interview deadlines in the actual Workers runtime',()=>{
  it('opens only after a real RPC persists the original alarm, then closes without browser End',async()=>{
    const result=await open();
    const armed=await state();expect(armed.alarm).toBe(Date.parse(result.deadlineAt.replace(' ','T')+'Z'));
    expect(armed.saved).toEqual({sessionId,deadlineMs:armed.alarm,status:'armed'});
    expect(JSON.stringify(armed)).not.toContain('sk_');expect(JSON.stringify(armed)).not.toContain('owner');
    await due();expect(await runDurableObjectAlarm(stub)).toBe(true);
    expect((await call())?.state).toBe('closed');expect((await control())?.closed_at).toBeTruthy();
    expect(requests.filter(x=>x.endsWith('/hangup'))).toHaveLength(1);
    expect(await state()).toEqual({saved:undefined,alarm:null});
    expect(await runDurableObjectAlarm(stub)).toBe(false);
  });
  it('a reconnect preserves the original alarm and deadline and only the replacement closes at expiry',async()=>{
    const first=await open(),initial=await state();
    const second=await open({replacesAttemptId:first.attemptId});expect(second.deadlineAt).toBe(first.deadlineAt);
    expect(await state()).toEqual(initial);await due();await runDurableObjectAlarm(stub);
    expect(requests.filter(x=>x.endsWith('/hangup'))).toHaveLength(2);
    expect((await env.DB.prepare("SELECT free_session_used FROM users WHERE auth_id='owner'").first())?.free_session_used).toBe(1);
  });
  it('early alarm delivery re-arms the same time without contacting the provider',async()=>{
    await open();const first=await state();await runDurableObjectAlarm(stub);
    expect((await state()).alarm).toBe(first.alarm);expect(requests).toHaveLength(1);expect((await control())?.closed_at).toBeNull();
  });
  it('browser End and the later alarm do not send duplicate hangups',async()=>{
    await open();await closeManagedInterview(appEnv,{uid:'owner',sessionId});await due();await runDurableObjectAlarm(stub);
    expect(requests.filter(x=>x.endsWith('/hangup'))).toHaveLength(1);expect((await state()).saved).toBeUndefined();
  });
  it('a provider 404 retains uncertainty and alarm redelivery cannot repeat hangup',async()=>{
    await open();vi.mocked(fetch).mockImplementation(async(input)=>{requests.push(String(input));return new Response(null,{status:404});});
    await due();await runDurableObjectAlarm(stub);expect((await call())?.state).toBe('uncertain');
    expect((await state()).saved).toMatchObject({status:'review'});expect((await state()).alarm).toBeGreaterThan(Date.now());
    await runInDurableObject(stub,(instance)=>instance.alarm());expect(requests.filter(x=>x.endsWith('/hangup'))).toHaveLength(1);
  });
  it('a provider timeout is retained for review without automatic retry',async()=>{
    await open();vi.mocked(fetch).mockImplementation(async(input)=>{requests.push(String(input));throw Error('private provider body');});
    await due();await runDurableObjectAlarm(stub);expect((await call())?.state).toBe('uncertain');
    expect((await state()).saved).toMatchObject({status:'review'});expect(JSON.stringify(await state())).not.toContain('private');
  });
  it('review alarms observe a verified closure receipt and clean up without another provider request',async()=>{
    await open();vi.mocked(fetch).mockImplementation(async(input)=>{requests.push(String(input));return new Response(null,{status:404});});
    await due();await runDurableObjectAlarm(stub);expect((await state()).saved).toMatchObject({status:'review'});
    await runDurableObjectAlarm(stub);expect((await state()).saved).toMatchObject({status:'review'});
    const count=requests.length;await reconcile();await runDurableObjectAlarm(stub);
    expect(requests).toHaveLength(count);expect(await state()).toEqual({saved:undefined,alarm:null});
    await expect(open()).rejects.toThrow('voice_connection_ended');expect(requests).toHaveLength(count);
  });
  it('a call receipt cannot clear a separate legacy hold or its alarm until that hold is reviewed',async()=>{
    await open();vi.mocked(fetch).mockImplementation(async(input)=>{requests.push(String(input));throw Error('fixture lost hangup');});
    await env.DB.prepare('UPDATE voice_interview_controls SET legacy_unverified=1 WHERE session_id=?').bind(sessionId).run();
    await due();await runDurableObjectAlarm(stub);await reconcile();await runDurableObjectAlarm(stub);
    expect((await state()).saved).toMatchObject({status:'review'});expect((await control())?.legacy_unverified).toBe(1);
    const count=requests.length;await reconcile(true);await runDurableObjectAlarm(stub);
    expect(requests).toHaveLength(count);expect(await state()).toEqual({saved:undefined,alarm:null});
  });
  it('review cleanup still works after account cleanup removes the closed call and control rows',async()=>{
    await open();vi.mocked(fetch).mockImplementation(async(input)=>{requests.push(String(input));throw Error('fixture lost hangup');});
    await due();await runDurableObjectAlarm(stub);await reconcile();
    await env.DB.prepare('DELETE FROM voice_provider_calls WHERE session_id=?').bind(sessionId).run();
    await env.DB.prepare('DELETE FROM voice_interview_controls WHERE session_id=?').bind(sessionId).run();
    const count=requests.length;await runDurableObjectAlarm(stub);expect(await state()).toEqual({saved:undefined,alarm:null});
    await expect(open()).rejects.toThrow('voice_connection_ended');expect(requests).toHaveLength(count);
  });
  it('disabling new schedules does not disable an already armed hangup',async()=>{
    await open();await due();
    await runInDurableObject(stub,async(instance)=>{
      // Changing the object environment emulates a rollback deployment.
      const original=env.VOICE_DEADLINES_ENABLED;env.VOICE_DEADLINES_ENABLED='false';
      try {
        await expect(instance.arm({uid:'owner',sessionId,providerKeySha256:keySha})).rejects.toThrow('voice_deadline_disabled');
        await instance.alarm();
      } finally {env.VOICE_DEADLINES_ENABLED=original;}
    });
    expect((await call())?.state).toBe('closed');
  });
  it('rejects another owner, namespace, key or altered deadline before changing the alarm',async()=>{
    await open();const initial=await state();
    await expect(arm({uid:'other',sessionId,providerKeySha256:keySha})).rejects.toThrow();
    await expect(arm({uid:'owner',sessionId:crypto.randomUUID(),providerKeySha256:keySha})).rejects.toThrow();
    await expect(arm({uid:'owner',sessionId,providerKeySha256:'0'.repeat(64)})).rejects.toThrow();
    await env.DB.prepare("UPDATE voice_interview_controls SET deadline_at=datetime(deadline_at,'-1 second') WHERE session_id=?").bind(sessionId).run();
    await expect(arm({uid:'owner',sessionId,providerKeySha256:keySha})).rejects.toThrow();
    expect(await state()).toEqual(initial);expect(requests).toHaveLength(1);
  });
  it('refuses to re-arm a closed interview',async()=>{
    await open();await closeManagedInterview(appEnv,{uid:'owner',sessionId});
    await expect(arm({uid:'owner',sessionId,providerKeySha256:keySha})).rejects.toThrow();
    expect(requests.filter(x=>x.endsWith('/hangup'))).toHaveLength(1);
  });
  it('waits for an in-flight creation, then closes its recorded late call',async()=>{
    await open();const current=await call();
    await env.DB.prepare("UPDATE voice_provider_calls SET state='creating',execution_token='fixture_inflight' WHERE id=?").bind(current!.id).run();
    await due();await runDurableObjectAlarm(stub);expect((await state()).saved).toMatchObject({status:'waiting'});
    expect((await state()).alarm).toBeGreaterThan(Date.now());expect(requests).toHaveLength(1);
    await env.DB.prepare("UPDATE voice_provider_calls SET state='active',execution_token=NULL WHERE id=?").bind(current!.id).run();
    await runDurableObjectAlarm(stub);expect((await call())?.state).toBe('closed');
  });
  it('expiry during actual delayed creation withholds the answer and never spends the free interview',async()=>{
    const entered=deferred(),release=deferred();
    vi.mocked(fetch).mockImplementation(async(input)=>{
      const url=String(input);requests.push(url);
      if(url.endsWith('/hangup'))return new Response(null,{status:200});
      entered.resolve();await release.promise;
      return new Response('v=0 late answer',{status:201,headers:{Location:'/v1/realtime/calls/rtc_late_alarm'}});
    });
    const starting=open();await entered.promise;
    try {
      await due();await runDurableObjectAlarm(stub);
      expect((await state()).saved).toMatchObject({status:'waiting'});expect((await control())?.closed_at).toBeTruthy();
    } finally {release.resolve();}
    await expect(starting).rejects.toThrow('voice_connection_reservation_unavailable');
    expect((await call())?.state).toBe('closed');
    expect((await env.DB.prepare("SELECT free_session_used FROM users WHERE auth_id='owner'").first())?.free_session_used).toBe(0);
    expect(requests.filter(x=>x.endsWith('/hangup'))).toHaveLength(1);
    await runDurableObjectAlarm(stub);expect((await state()).saved).toBeUndefined();
  });
  it('alarm overlapping browser End observes the exclusive closing claim without sending another hangup',async()=>{
    await open();const entered=deferred(),release=deferred();
    vi.mocked(fetch).mockImplementation(async(input)=>{
      requests.push(String(input));entered.resolve();await release.promise;return new Response(null,{status:200});
    });
    const ending=closeManagedInterview(appEnv,{uid:'owner',sessionId});await entered.promise;
    try {
      await due();await runDurableObjectAlarm(stub);
      expect((await state()).saved).toMatchObject({status:'waiting'});
      expect(requests.filter(x=>x.endsWith('/hangup'))).toHaveLength(1);
    } finally {release.resolve();}
    expect(await ending).toEqual({closed:true});await runDurableObjectAlarm(stub);
    expect((await state()).saved).toBeUndefined();
  });
  it('key mismatch cannot dispatch hangup; restoring the issuing key identity permits the existing alarm to close',async()=>{
    await open();const current=await call();
    await env.DB.prepare("UPDATE voice_provider_calls SET provider_key_sha256=? WHERE id=?").bind('0'.repeat(64),current!.id).run();
    await due();await runDurableObjectAlarm(stub);
    expect((await call())?.state).toBe('active');expect(requests).toHaveLength(1);expect((await state()).alarm).toBeGreaterThan(Date.now());
    await env.DB.prepare("UPDATE voice_provider_calls SET provider_key_sha256=? WHERE id=?").bind(keySha,current!.id).run();
    await runDurableObjectAlarm(stub);expect((await call())?.state).toBe('closed');
  });
  it('a deletion admission prevents new scheduling without changing an existing alarm',async()=>{
    await open();const initial=await state();
    await env.DB.prepare("INSERT INTO account_deletion_admissions(id,auth_id,origin) VALUES(?,'owner','user_request')").bind(crypto.randomUUID()).run();
    await expect(arm({uid:'owner',sessionId,providerKeySha256:keySha})).rejects.toThrow();
    expect(await state()).toEqual(initial);await due();await runDurableObjectAlarm(stub);
    expect((await call())?.state).toBe('closed');
  });
  it('keeps a retry alarm across D1 failure without marking the call closed',async()=>{
    await open();await due();
    await env.DB.prepare("CREATE TRIGGER fixture_d1_failure BEFORE UPDATE ON voice_interview_controls BEGIN SELECT RAISE(ABORT,'fixture write failure'); END").run();
    try {
      await runDurableObjectAlarm(stub);expect((await state()).alarm).toBeGreaterThan(Date.now());
      expect((await call())?.state).toBe('active');expect(requests).toHaveLength(1);
    } finally {await env.DB.prepare('DROP TRIGGER fixture_d1_failure').run();}
    await runDurableObjectAlarm(stub);expect((await call())?.state).toBe('closed');
  });
  it('provides no public scheduling or inspection endpoint',async()=>{
    expect((await exports.default.fetch('https://fixture.test/arm',{method:'POST',body:'{}'})).status).toBe(404);
  });
});
