import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
if (!globalThis.crypto) globalThis.crypto = webcrypto;
import { readFileSync } from 'node:fs';
import { createVoiceUsage, normalizeVoiceUsage, responseTokenTotals } from '../../../../js/voice-usage.js';
import { scorecardUsageEvidence } from '../voice-usage.js';
import { sqliteD1 } from './sqlite-d1-helper.mjs';
const usage = { input_tokens: 132, output_tokens: 121, total_tokens: 253,
  input_token_details: { text_tokens:119, audio_tokens:13, image_tokens:0, cached_tokens:64, cached_tokens_details:{text_tokens:64,audio_tokens:0,image_tokens:0} },
  output_token_details:{text_tokens:30,audio_tokens:91} };
test('provider example retains modality/cache distinctions and deduplicates by response ID', () => {
  const c=createVoiceUsage(); c.add('response','resp-1',usage); c.add('response','resp-1',usage);
  c.add('transcription','item-1',{type:'tokens',input_tokens:17,output_tokens:9});
  const s=c.snapshot(); assert.equal(s.events.length,2);
  assert.deepEqual(responseTokenTotals(s),{input:132,output:121});
  assert.equal(s.events[0].usage.input_token_details.cached_tokens_details.text_tokens,64);
  assert.equal(s.events[0].usage.output_token_details.audio_tokens,91);
});
test('absence, invalid values and missing events never become verified zero cost', () => {
  assert.equal(normalizeVoiceUsage(null).available,false);
  const c=createVoiceUsage(); c.add('response','a',{input_tokens:'100',output_tokens:-1});
  assert.deepEqual(responseTokenTotals(c.snapshot()),{input:null,output:null});
  c.add('response','b',null); assert.equal(c.snapshot().events[1].usage,null);
});
test('payload is bounded and strips transcript, secret and caller-supplied provenance', () => {
  const events=Array.from({length:520},(_,i)=>({kind:'response',id:'r'+i,usage:{...usage,secret:'private',transcript:'private'}}));
  const s=normalizeVoiceUsage({version:1,events,source:'verified_bill',secret:'private'});
  assert.equal(s.events.length,512); assert.equal(s.dropped,8); assert.equal(s.source,'client_reported');
  assert.ok(!JSON.stringify(s).includes('private'));
});
test('transcription seconds and missing token details remain distinguishable',()=>{
  const c=createVoiceUsage();c.add('transcription','u1',{type:'duration',seconds:1.25});
  const s=c.snapshot().events[0].usage;assert.equal(s.seconds,1.25);assert.equal(s.input_tokens,null);
});
test('report cache is not attributed as a fresh provider call; invalid counts are unknown',()=>{
  const s=scorecardUsageEvidence('gpt-4.1-mini',{promptTokens:100,cachedTokens:20},true);
  assert.equal(s.source,'application_cache');assert.equal(s.completionTokens,null);assert.equal(s.providerTotalVerified,false);
});
const route=readFileSync(new URL('../../api/voice/session/[id]/complete.js',import.meta.url),'utf8');
function setup(t){
 const db=sqliteD1();t.after(()=>db.close());
 db.exec('CREATE TABLE users(id INTEGER PRIMARY KEY, auth_id TEXT); INSERT INTO users VALUES(1,\'owner\'),(2,\'other\');');
 for(const f of ['020_add_voice_entitlements.sql','021_add_voice_end_reason.sql','029_voice_usage_evidence.sql']) db.exec(readFileSync(new URL('../../../db/migrations/'+f,import.meta.url),'utf8'));
 db.exec("INSERT INTO voice_sessions(id,user_id,status,entitlement_mode) VALUES('own',1,'active','free'),('other',2,'active','free')");
 const ctx={Request,Response,console:{log(){},error(){},warn(){}},normalizeVoiceUsage,responseTokenTotals,
 getBearer:r=>r.headers.get('Authorization'),verifyFirebaseIdToken:async()=>({uid:'owner'}),getDb:()=>db,getOrCreateUserByAuthId:async()=>({id:1}),voiceFeatureEnabled:()=>true,
 generateRequestId:()=> 'id', normalizeEndReason:()=> 'user_ended',shouldGenerateScorecard:()=>false,
 successResponse:(body,status)=>Response.json(body,{status}),errorResponse:(error,status)=>Response.json({error},{status})};
 vm.createContext(ctx);vm.runInContext(route.replace(/^import .*;\n/gm,'').replace('export async function onRequest','async function onRequest')+'\nglobalThis.handler=onRequest',ctx);
 return {db,request:(payload,id='own')=>ctx.handler({env:{},params:{id},waitUntil(){},request:new Request('https://qa.jobhackai.io/api/voice/session/'+id+'/complete',{method:'POST',headers:{Authorization:'valid'},body:JSON.stringify(payload)})})};
}
test('real completion persists bounded evidence, null cost, and keeps first completion on retry',async t=>{
 const h=setup(t),c=createVoiceUsage();c.add('response','r1',usage);
 assert.equal((await h.request({transcript:[],usageEvidence:c.snapshot()})).status,200);
 let row=await h.db.prepare("SELECT * FROM voice_sessions WHERE id='own'").first();
 assert.equal(row.input_tokens,132);assert.equal(row.cost_usd,null);assert.equal(JSON.parse(row.usage_details_json).realtime.events.length,1);
 await h.request({usageEvidence:null});let after=await h.db.prepare("SELECT usage_details_json FROM voice_sessions WHERE id='own'").first();assert.equal(after.usage_details_json,row.usage_details_json);
 await h.db.prepare('DELETE FROM users WHERE id=1').run();assert.equal(await h.db.prepare("SELECT id FROM voice_sessions WHERE id='own'").first(),null);
});
test('old client totals cannot produce a fabricated cost and another owner cannot write usage',async t=>{
 const h=setup(t);assert.equal((await h.request({inputTokens:500,outputTokens:100})).status,200);
 const row=await h.db.prepare("SELECT * FROM voice_sessions WHERE id='own'").first();assert.equal(row.cost_usd,null);assert.equal(row.input_tokens,null);assert.equal(JSON.parse(row.usage_details_json).realtime.available,false);
 assert.equal((await h.request({},'other')).status,404);
 assert.equal(await h.db.prepare("SELECT usage_details_json FROM voice_sessions WHERE id='other'").first('usage_details_json'),null);
});

test('real scorecard generator persists returned usage without replacing realtime evidence', async t => {
 const h=setup(t);
 await h.db.prepare("UPDATE voice_sessions SET transcript_json=?, usage_details_json=? WHERE id='own'").bind(JSON.stringify([{speaker:'user',text:'I led a checkout improvement project and reduced abandoned purchases by eighteen percent in one quarter. We tested three changes with customers and retained the best performing version. I coordinated the rollout across three teams and measured retention for six weeks afterward.'}]), JSON.stringify({version:1,realtime:{source:'client_reported'}})).run();
 const source=readFileSync(new URL('../voice-scorecard.js',import.meta.url),'utf8');
 const ctx={console:{log(){},warn(){},error(){}},getDb:()=>h.db,scorecardUsageEvidence,callOpenAI:async()=>({content:JSON.stringify({overall:70,moments:[]}),model:'gpt-4.1-mini',fromCache:true,usage:{promptTokens:500,completionTokens:100,cachedTokens:250,totalTokens:600}})};
 vm.createContext(ctx);vm.runInContext(source.replace(/^import .*;\n/gm,'').replace(/^export /gm,'')+'\nglobalThis.generate=generateAndStoreScorecard;',ctx);
 assert.equal((await ctx.generate({},'own')).overall,70);
 const saved=JSON.parse(await h.db.prepare("SELECT usage_details_json FROM voice_sessions WHERE id='own'").first('usage_details_json'));
 assert.equal(saved.realtime.source,'client_reported');assert.equal(saved.scorecard.promptTokens,500);assert.equal(saved.scorecard.source,'application_cache');
});

test('OpenAI client reads native cached-token detail and labels application cache hits',async t=>{
 const {callOpenAI}=await import('../openai-client.js');
 const previous=globalThis.fetch;t.after(()=>{globalThis.fetch=previous;});
 globalThis.fetch=async()=>new Response(JSON.stringify({model:'gpt-4.1-mini',choices:[{message:{content:'ok'},finish_reason:'stop'}],usage:{prompt_tokens:100,completion_tokens:20,total_tokens:120,prompt_tokens_details:{cached_tokens:70}}}),{status:200});
 const fresh=await callOpenAI({messages:[],maxRetries:1},{OPENAI_API_KEY:'test-fixture'});
 assert.equal(fresh.fromCache,false);assert.equal(fresh.usage.cachedTokens,70);
 globalThis.fetch=async()=>{throw Error('cache must not call provider');};
 const cached=await callOpenAI({systemPrompt:'test',messages:[]},{OPENAI_API_KEY:'test-fixture',JOBHACKAI_KV:{get:async()=>JSON.stringify(fresh)}});
 assert.equal(cached.fromCache,true);assert.equal(cached.usage.cachedTokens,70);
});
