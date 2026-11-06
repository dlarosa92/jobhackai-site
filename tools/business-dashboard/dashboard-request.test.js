import test from 'node:test';
import assert from 'node:assert/strict';
import {dashboardRequestUrl} from './scripts/dashboard-request.mjs';

const machine={role:'machine',capabilities:['read','prepare']};
test('read pagination preserves query without widening machine operation or origin',()=>{
 const url=dashboardRequestUrl(machine,'GET','/api/work-items/lessons?limit=2&cursor=7');
 assert.equal(url.href,'https://dashboard.jobhackai.io/api/work-items/lessons?limit=2&cursor=7');
 assert.equal(dashboardRequestUrl(machine,'POST','/api/work-items/prepare').pathname,'/api/work-items/prepare');
 for(const [method,path] of [
  ['GET','https://evil.example/api/work-items/lessons?cursor=7'],
  ['GET','//evil.example/api/work-items'],['GET','/api/overview'],
  ['GET','https://user:secret@dashboard.jobhackai.io/api/work-items'],
  ['GET','/api/work-items#hidden'],['POST','/api/work-items/prepare?override=true'],
  ['POST','/api/work-items/feedback'],['DELETE','/api/work-items/one'],
 ])assert.throws(()=>dashboardRequestUrl(machine,method,path),/Unsupported/);
 assert.throws(()=>dashboardRequestUrl({role:'machine',capabilities:['prepare']},'GET','/api/work-items/lessons'),/Unsupported/);
});
