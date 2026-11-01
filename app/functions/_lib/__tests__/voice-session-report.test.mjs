// Retention contract for the report route on the QA/production feature baseline.
// Optional source override also verifies the accepted development route without
// promoting unrelated voice retry/report UX features.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import * as scorecard from '../voice-scorecard.js';
import { isSessionExpired, hasActiveVoicePlan } from '../voice-history.js';
const route = readFileSync(process.env.RETENTION_REPORT_ROUTE || new URL('../../api/voice/session/[id].js', import.meta.url), 'utf8');
async function report({days=100, owner=1, entitled=true}={}) {
  const row={id:'synthetic-report',user_id:owner,role:'Private target role',seniority:'Private seniority',
    status:'completed',entitlement_mode:entitled?'subscription':'free',
    started_at:new Date(Date.now()-days*86400000).toISOString(),duration_seconds:60,
    transcript_json:JSON.stringify([{speaker:'user',text:'Private answer'}]),
    scorecard_json:JSON.stringify({overall:70,topStrength:'Private strength',topImprovement:'Private improvement'})};
  const db={prepare:()=>({bind:()=>({first:async()=>row})})};
  const context={Request,Response,console,...scorecard,isSessionExpired,hasActiveVoicePlan,
    getBearer:()=> 'synthetic-token',verifyFirebaseIdToken:async()=>({uid:'synthetic-owner'}),
    getOrCreateUserByAuthId:async()=>({id:1}),getDb:()=>db,voiceFeatureEnabled:()=>true,
    getVoiceEntitlement:async()=>({unlimited:entitled,sessionsRemaining:0,hasEverPaid:entitled,mode:entitled?'subscription':null}),
    voiceRetryEnabled:()=>false,retryEligibility:()=>({eligible:false}),retryClaimed:async()=>false,
    interviewerQuestionCount:()=>0,deleteVoiceSession:async()=>false,generateRequestId:()=> 'synthetic-request',
    successResponse:(body,status)=>Response.json(body,{status}),errorResponse:(error,status)=>Response.json({error},{status})};
  vm.createContext(context);
  vm.runInContext(route.replace(/^import .*;\n/gm,'').replace('export async function onRequest','async function onRequest')+'\nglobalThis.handler=onRequest',context);
  const response=await context.handler({request:new Request('https://example.invalid/api/voice/session/synthetic-report'),env:{},params:{id:row.id}});
  return {status:response.status,body:await response.json()};
}
test('expired paid and free reports disclose no role, transcript or feedback before cleanup',async()=>{
  for(const entitled of [true,false]){
    const {status,body}=await report({entitled}); assert.equal(status,200); assert.equal(body.expired,true);
    for(const field of ['role','seniority','transcript','scorecard'])assert.equal(body[field],null,field);
    assert.equal(body.fullAccess,false);assert.ok(!JSON.stringify(body).includes('Private'));
  }
});
test('recent entitled reports still return retained content',async()=>{
  const {status,body}=await report({days:2});assert.equal(status,200);
  assert.equal(body.role,'Private target role');assert.equal(body.transcript[0].text,'Private answer');
});
test('another owner cannot read even expired metadata',async()=>{
  assert.equal((await report({owner:2})).status,404);
});
