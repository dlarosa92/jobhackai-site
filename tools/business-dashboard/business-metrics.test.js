import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {businessMetrics,metricPeriods,seriesFromRows} from './src/business-metrics.js';

function fixture(){
 const sql=new DatabaseSync(':memory:');
 sql.exec(`CREATE TABLE users(created_at TEXT);CREATE TABLE mock_interview_sessions(created_at TEXT);CREATE TABLE voice_sessions(status TEXT,ended_at TEXT);CREATE TABLE stripe_collected_payments(charge_id TEXT,environment TEXT,livemode INTEGER,currency TEXT,charge_created_at INTEGER,amount_captured INTEGER);CREATE TABLE stripe_payment_refunds(charge_id TEXT,status TEXT,currency TEXT,refund_created_at INTEGER,amount INTEGER);`);
 const db={prepare(query){return {bind(...args){this.args=args;return this;},async all(){return {results:sql.prepare(query).all(...this.args)};}};}};
 return {sql,db};
}
test('periods are complete Eastern days, including midnight and DST boundaries',()=>{
 assert.deepEqual(metricPeriods(new Date('2026-11-02T04:30:00Z')), {days:7,start:'2026-10-25',end:'2026-10-31',previousStart:'2026-10-18',previousEnd:'2026-10-24',timezone:'America/New_York'});
 const p=metricPeriods(new Date('2026-11-02T05:30:00Z'));
 assert.equal(p.end,'2026-11-01');assert.equal(p.start,'2026-10-26');
 const series=seriesFromRows([{ts:Date.parse('2026-11-01T05:30:00Z')/1000,value:1},{ts:Date.parse('2026-11-01T06:30:00Z')/1000,value:2},{ts:Date.parse('2026-11-02T05:01:00Z')/1000,value:99}],p);
 assert.equal(series.value,3);assert.equal(series.series.at(-1).value,3);
});
test('real SQLite history keeps refunds, test limitations, prior periods and missing paid counts distinct',async()=>{
 const {sql,db}=fixture();const stamp=s=>Date.parse(s)/1000;
 const charge=sql.prepare('INSERT INTO stripe_collected_payments VALUES(?,?,?,?,?,?)');
 charge.run('live','prod',1,'usd',stamp('2026-10-24T15:00:00Z'),3000);
 charge.run('old','prod',1,'usd',stamp('2026-10-15T15:00:00Z'),1000);
 charge.run('test','prod',0,'usd',stamp('2026-10-24T15:00:00Z'),9999);
 charge.run('qa','qa',1,'usd',stamp('2026-10-24T15:00:00Z'),9999);
 charge.run('foreign','prod',1,'eur',stamp('2026-10-24T15:00:00Z'),9999);
 sql.prepare('INSERT INTO stripe_payment_refunds VALUES(?,?,?,?,?)').run('old','succeeded','usd',stamp('2026-10-25T15:00:00Z'),1000);
 sql.exec("INSERT INTO users VALUES('2026-10-20 03:59:00'),('2026-10-20 04:00:00'),('2026-10-27 04:01:00'); INSERT INTO mock_interview_sessions VALUES('2026-10-22 14:00:00'); INSERT INTO voice_sessions VALUES('completed','2026-10-22 14:30:00'),('abandoned','2026-10-22 14:30:00'),('active',NULL);");
 const data=await businessMetrics(db,new Date('2026-10-27T18:00:00Z'));const get=id=>data.periods[7].metrics.find(m=>m.id===id);
 assert.equal(get('money').value,2000);assert.equal(get('money').previous,1000);assert.equal(get('money').change,1000);
 assert.equal(get('accounts').value,1);assert.equal(get('accounts').previous,1);assert.match(get('accounts').note,/test/);
 assert.equal(get('interviews').value,2);assert.equal(get('customers').value,null);assert.deepEqual(get('customers').series,[]);
 assert.equal(data.periods[28].metrics.find(m=>m.id==='money').value,3000);
});
test('a failed source is unavailable, while a successfully read empty source is zero',async()=>{
 const db={prepare(query){return {bind(){return this;},async all(){if(query.includes('refunds')||query.includes('mock_interview_sessions'))throw new Error('Unavailable');return {results:[]};}};}};
 const data=await businessMetrics(db,new Date('2026-10-27T18:00:00Z'));
 const get=id=>data.periods[7].metrics.find(m=>m.id===id);
 assert.equal(get('money').value,null);assert.equal(get('interviews').value,null);assert.equal(get('accounts').value,0);assert.equal(get('accounts').series.length,7);
});
