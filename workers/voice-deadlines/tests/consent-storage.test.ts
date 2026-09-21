import {env} from 'cloudflare:workers';
import {applyD1Migrations} from 'cloudflare:test';
import {beforeAll,it,expect} from 'vitest';
import {upsertCookieConsent,getCookieConsent} from '../../../app/functions/_lib/db.js';
import {upsertCookieConsent as rootSave,getCookieConsent as rootRead} from '../../../functions/_lib/db.js';

beforeAll(()=>applyD1Migrations(env.DB,env.TEST_MIGRATIONS));
const decision=(analytics:boolean)=>({version:1,analytics,updatedAt:new Date().toISOString()});
async function owner(){const uid=crypto.randomUUID();const row=await env.DB.prepare('INSERT INTO users(auth_id,email) VALUES(?,?) RETURNING id').bind(uid,uid+'@example.test').first<{id:number}>();return row!.id;}
for(const [name,save,read] of [['app',upsertCookieConsent,getCookieConsent],['root',rootSave,rootRead]] as const){
  it(`${name}: anonymous marketing withdrawal overrides an older account grant`,async()=>{
    const userId=await owner(),clientId=crypto.randomUUID();
    expect(await save(env,{userId,clientId,consent:decision(true)})).toBe(true);
    expect(await save(env,{clientId,consent:decision(false)})).toBe(true);
    expect(await read(env,userId,clientId)).toMatchObject({analytics:false});
    expect(await read(env,userId,null)).toMatchObject({analytics:true});
    expect(await save(env,{userId,clientId,consent:decision(true)})).toBe(true);
    expect(await read(env,userId,clientId)).toMatchObject({analytics:true});
    expect(await save(env,{userId,consent:decision(false)})).toBe(true);
    expect(await read(env,userId,clientId)).toMatchObject({analytics:false});
  });
  it(`${name}: account withdrawal remains readable by anonymous marketing on the same browser`,async()=>{
    const userId=await owner(),clientId=crypto.randomUUID();
    expect(await save(env,{clientId,consent:decision(true)})).toBe(true);
    expect(await save(env,{userId,clientId,consent:decision(false)})).toBe(true);
    expect(await read(env,userId,clientId)).toMatchObject({analytics:false});
    expect(await read(env,null,clientId)).toMatchObject({analytics:false});
    expect(await save(env,{userId,clientId,consent:decision(true)})).toBe(true);
    expect(await read(env,null,clientId)).toMatchObject({analytics:true});
  });
}
it('an old account-linked browser record is separated without changing that account decision',async()=>{
  const userId=await owner(),clientId=crypto.randomUUID();
  await env.DB.prepare('INSERT INTO cookie_consents(user_id,client_id,consent_json) VALUES(?,?,?)').bind(userId,clientId,JSON.stringify(decision(true))).run();
  expect(await upsertCookieConsent(env,{clientId,consent:decision(false)})).toBe(true);
  expect(await getCookieConsent(env,userId,null)).toMatchObject({analytics:true});
  expect(await getCookieConsent(env,null,clientId)).toMatchObject({analytics:false});
});
it('a failed browser receipt rolls back the account write as well',async()=>{
  const userId=await owner(),clientId='rollback-'+crypto.randomUUID();
  await env.DB.prepare('INSERT INTO cookie_consents(user_id,consent_json) VALUES(?,?)').bind(userId,JSON.stringify(decision(true))).run();
  await env.DB.prepare('INSERT INTO cookie_consents(client_id,consent_json) VALUES(?,?)').bind(clientId,JSON.stringify(decision(true))).run();
  await env.DB.prepare(`CREATE TRIGGER reject_browser_withdrawal BEFORE UPDATE ON cookie_consents WHEN NEW.client_id LIKE 'rollback-%' AND json_extract(NEW.consent_json,'$.analytics')=0 BEGIN SELECT RAISE(ABORT,'fixture browser write failure'); END`).run();
  try{
    expect(await upsertCookieConsent(env,{userId,clientId,consent:decision(false)})).toBe(false);
    expect(await getCookieConsent(env,userId,null)).toMatchObject({analytics:true});
    expect(await getCookieConsent(env,null,clientId)).toMatchObject({analytics:true});
  }finally{await env.DB.prepare('DROP TRIGGER reject_browser_withdrawal').run();}
});
