import test from 'node:test';
import assert from 'node:assert/strict';
import { inactiveAccountEligibility } from '../account-inactivity-policy.js';
const now=Date.parse('2026-09-20T12:00:00Z');
const user={auth_id:'owner',email:'owner@example.test',plan:'free',subscription_status:null,scheduled_plan:null,
  voice_sessions_remaining:0,pack_expires_at:null,last_login_at:'2023-09-20 12:00:00',last_activity_at:null,
  deletion_warning_sent_at:'2026-08-20 12:00:00'};
const warning={auth_id:'owner',email:user.email,state:'sent',provider_id:'mail_fixture',sent_at:user.deletion_warning_sent_at};
const activity={lastLoginAt:Date.parse(user.last_login_at.replace(' ','T')+'Z'),lastRefreshAt:null};
const eligibility=(u={},w={},a={})=>inactiveAccountEligibility({...user,...u},{...warning,...w},{...activity,...a},now);
test('known dormant free account requires a matching accepted warning at least thirty days old',()=>{
  assert.equal(eligibility().eligible,true);
  assert.equal(eligibility({deletion_warning_sent_at:'2026-08-21T12:00:00Z'},{sent_at:'2026-08-21T12:00:00Z'}).eligible,true);
  assert.equal(eligibility({deletion_warning_sent_at:'2026-08-21T12:00:01Z'},{sent_at:'2026-08-21T12:00:01Z'}).eligible,false);
});
test('missing, ambiguous, stale-address or unsent warnings never authorize deletion',()=>{
  for(const w of [{state:'pending'},{state:'sending'},{state:'needs_review'},{state:'canceled'},
    {email:'old@example.test'},{auth_id:'other'},{provider_id:null},{sent_at:null}]) assert.equal(eligibility({},w).eligible,false);
  assert.equal(eligibility({deletion_warning_sent_at:null}).eligible,false);
  assert.equal(eligibility({email:''}).eligible,false);
  assert.equal(inactiveAccountEligibility(user,null,activity,now).eligible,false);
});
test('recent login, tool usage or provider refresh prevents automatic deletion',()=>{
  for(const field of ['last_login_at','last_activity_at']) assert.equal(eligibility({[field]:'2026-09-20T11:59:00Z'}).reason,'recent_activity');
  for(const field of ['lastLoginAt','lastRefreshAt']) assert.equal(eligibility({},{},{[field]:now-60000}).reason,'recent_activity');
  assert.equal(eligibility({},{},{lastRefreshAt:now+60000}).eligible,false);
});
test('missing or malformed activity is not proof of inactivity',()=>{
  assert.equal(eligibility({last_login_at:null,last_activity_at:null}).eligible,false);
  for(const value of ['2023-02-30T12:00:00Z','2023-09-20','bad',undefined]) assert.equal(eligibility({last_login_at:value}).eligible,false);
  assert.equal(eligibility({},{},{lastLoginAt:null,lastRefreshAt:null}).eligible,false);
  for(const value of [undefined,NaN,'1690000000000',-1]) assert.equal(eligibility({},{},{lastLoginAt:value}).eligible,false);
  assert.equal(inactiveAccountEligibility(user,warning,null,now).eligible,false);
});
test('subscription states, scheduled plans and valid paid pack credits prevent inactivity deletion',()=>{
  for(const plan of ['weekly','monthly','pro','unknown']) assert.equal(eligibility({plan}).eligible,false);
  for(const subscription_status of ['active','trialing','past_due','unpaid','paused','incomplete','unknown',undefined]) assert.equal(eligibility({subscription_status}).eligible,false);
  assert.equal(eligibility({scheduled_plan:'monthly'}).eligible,false);
  for(const pack_expires_at of [null,'bad','2026-12-20T12:00:00Z']) assert.equal(eligibility({voice_sessions_remaining:3,pack_expires_at}).eligible,false);
  for(const voice_sessions_remaining of [-1,NaN,undefined,'0']) assert.equal(eligibility({voice_sessions_remaining}).eligible,false);
  assert.equal(eligibility({plan:'pack',voice_sessions_remaining:3,pack_expires_at:'2025-12-20T12:00:00Z'}).eligible,true);
});
test('a login after an old warning requires a new notice even years later',()=>{
  assert.equal(eligibility({deletion_warning_sent_at:'2022-01-01T00:00:00Z'},{sent_at:'2022-01-01T00:00:00Z'}).reason,'notice_invalidated');
});
