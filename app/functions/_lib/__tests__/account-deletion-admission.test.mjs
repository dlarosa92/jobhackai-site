import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { sqliteD1 } from './sqlite-d1-helper.mjs';
import { admitAccountOperation, settleAccountOperation, beginDeletionAdmission, assertDeletionQuiescent } from '../account-deletion-admission.js';
if (!globalThis.crypto) globalThis.crypto = webcrypto;
function setup(t) {
 const db=sqliteD1();t.after(()=>db.close());
 db.exec(readFileSync(new URL('../../../db/migrations/028_account_deletion_recovery.sql',import.meta.url),'utf8'));
 return {db,env:{JOBHACKAI_DB:db}};
}
test('intent blocks new writes while waiting for previously admitted work',async t=>{
 const {env}=setup(t),claim=await admitAccountOperation(env,'owner','billing');
 await beginDeletionAdmission(env,{uid:'owner'});
 await assert.rejects(admitAccountOperation(env,'owner','account'),/deletion_pending/);
 await assert.rejects(assertDeletionQuiescent(env,'owner'),/operations_pending/);
 await settleAccountOperation(env,claim,'finished');
 assert.ok(await assertDeletionQuiescent(env,'owner'));
});
test('the opposite ordering never admits an operation after deletion intent',async t=>{
 const {env}=setup(t);await beginDeletionAdmission(env,{uid:'owner'});
 await assert.rejects(admitAccountOperation(env,'owner','billing'),/deletion_pending/);
 assert.ok(await assertDeletionQuiescent(env,'owner'));
});
test('a crash or uncertain external call does not expire into deletion readiness',async t=>{
 const {env,db}=setup(t),claim=await admitAccountOperation(env,'owner','billing');
 await beginDeletionAdmission(env,{uid:'owner'});
 db.exec("UPDATE account_operation_claims SET created_at='2000-01-01',updated_at='2000-01-01'");
 await assert.rejects(assertDeletionQuiescent(env,'owner'),/operations_pending/);
 await settleAccountOperation(env,claim,'uncertain');
 await assert.rejects(settleAccountOperation(env,claim,'finished'),/operation_conflict/);
 await assert.rejects(assertDeletionQuiescent(env,'owner'),/operations_pending/);
});
test('admissions are isolated by verified UID and retries preserve the original intent',async t=>{
 const {env}=setup(t),claim=await admitAccountOperation(env,'owner');
 const original=await beginDeletionAdmission(env,{uid:'owner',email:'first@example.test'});
 const retry=await beginDeletionAdmission(env,{uid:'owner',email:'replacement@example.test'});
 assert.equal(retry.id,original.id);assert.equal(retry.email,'first@example.test');
 await assert.rejects(settleAccountOperation(env,{...claim,uid:'other'},'finished'),/operation_conflict/);
 const other=await admitAccountOperation(env,'other');assert.ok(other.id);
 await assert.rejects(assertDeletionQuiescent(env,'other'),/admission_required/);
});
test('both simultaneous admission orderings are safe under the actual database statements',async t=>{
 const {env}=setup(t);
 for(const uid of ['first','second']) {
  const operation=()=>admitAccountOperation(env,uid,'billing'),deletion=()=>beginDeletionAdmission(env,{uid});
  const results=await Promise.allSettled(uid==='first'?[operation(),deletion()]:[deletion(),operation()]);
  const admitted=results.find(r=>r.status==='fulfilled'&&r.value.kind==='billing');
  if(admitted) await assert.rejects(assertDeletionQuiescent(env,uid),/operations_pending/);
  else assert.ok(await assertDeletionQuiescent(env,uid));
 }
});
test('missing schema refuses both operations and deletion instead of failing open',async t=>{
 const {env,db}=setup(t);db.exec('DROP TABLE account_deletion_admissions');
 await assert.rejects(admitAccountOperation(env,'owner','billing'));
 await assert.rejects(beginDeletionAdmission(env,{uid:'owner'}));
});
