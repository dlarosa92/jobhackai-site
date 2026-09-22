// Reuse the repository's native Workers/D1 test harness. No live calls or email.
import {env} from 'cloudflare:workers';
import {applyD1Migrations} from 'cloudflare:test';
import {beforeAll,beforeEach,afterEach,it,expect,vi} from 'vitest';
import {onRequest} from '../../../app/functions/api/directory-requests.js';
import {onRequest as recovery} from '../../../app/functions/api/admin/directory-notifications.js';
const settings={...env,ENVIRONMENT:'dev',FRONTEND_URL:'https://dev.jobhackai.io',ADMIN_API_KEY:'fixture-admin',RESEND_API_KEY:'fixture-email'};
const fixture=()=>({submission_key:crypto.randomUUID(),business_name:'DEV Synthetic',website:'https://example.com',service_area:'Covington',service_details:'Test only',contact_email:'owner@example.com'});
const request=(body:unknown)=>new Request('https://dev.jobhackai.io/api/directory-requests',{method:'POST',headers:{Origin:'https://dev0.jobhackai-app-marketing-seo.pages.dev','Content-Type':'application/json','CF-Connecting-IP':'192.0.2.1'},body:JSON.stringify(body)});
beforeAll(()=>applyD1Migrations(env.DB,env.TEST_MIGRATIONS));
beforeEach(async()=>{await env.DB.prepare('DELETE FROM directory_requests').run();});
afterEach(()=>vi.restoreAllMocks());
it('actual D1 concurrent admission and native email request save once',async()=>{
 const calls:string[]=[];
 vi.spyOn(globalThis,'fetch').mockImplementation(async(input,init)=>{const req=new Request(input,init);expect(req.redirect).toBe('manual');calls.push(await req.text());return Response.json({id:'native-fixture'});});
 const pending:Promise<unknown>[]=[];const data=fixture();
 const responses=await Promise.all([1,2,3].map(()=>onRequest({request:request(data),env:settings,waitUntil:(p:Promise<unknown>)=>pending.push(p)})));
 await Promise.all(pending);expect(responses.map(r=>r.status).sort()).toEqual([200,200,201]);
 expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM directory_requests').first())?.n).toBe(1);expect(calls).toHaveLength(1);
 expect(await env.DB.prepare('SELECT review_status,notification_status FROM directory_requests').first()).toMatchObject({review_status:'pending',notification_status:'accepted'});
});
it('private recovery rejects unauthenticated reads and recovers a due failed notification',async()=>{
 const bodies:string[]=[];let fail=true;
 vi.spyOn(globalThis,'fetch').mockImplementation(async(input,init)=>{const req=new Request(input,init);bodies.push(await req.text());return fail?Response.json({error:'temporary'},{status:503}):Response.json({id:'recovered'});});
 const pending:Promise<unknown>[]=[];
 const response=await onRequest({request:request(fixture()),env:settings,waitUntil:(p:Promise<unknown>)=>pending.push(p)});expect(response.status).toBe(201);await Promise.all(pending);
 const url='https://dev.jobhackai.io/api/admin/directory-notifications';
 expect((await recovery({request:new Request(url),env:settings})).status).toBe(401);
 expect((await recovery({request:new Request(url,{headers:{'X-Admin-Key':'wrong'}}),env:settings})).status).toBe(401);
 await env.DB.prepare("UPDATE directory_requests SET notification_next_attempt_at=datetime('now','-1 minute')").run();fail=false;
 const retried=await recovery({request:new Request(url,{method:'POST',headers:{'X-Admin-Key':'fixture-admin'}}),env:settings});expect(retried.status).toBe(200);
 expect(await retried.json()).toEqual({notifications:[{notification_status:'accepted',count:1}]});expect(bodies[0]).toBe(bodies[1]);
});
