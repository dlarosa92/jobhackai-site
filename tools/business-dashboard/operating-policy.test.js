import test from 'node:test';
import assert from 'node:assert/strict';
import {businessHoursElapsed, monthlyReportPeriod, outreachWindowOpen, sevenFullDaysElapsed} from './src/operating-policy.js';
const at=Date.parse;
test('ordinary blockers accrue only Eastern business hours, preserving partial hours and DST',()=>{
 const friday='2026-10-30T20:30:00Z'; // Friday 16:30 EDT, DST ends Sunday.
 assert.equal(businessHoursElapsed(friday,at('2026-11-01T20:00:00Z')),false);
 assert.equal(businessHoursElapsed(friday,at('2026-11-02T15:29:59Z')),false);
 assert.equal(businessHoursElapsed(friday,at('2026-11-02T15:30:00Z')),true);
 assert.equal(businessHoursElapsed('2026-11-16T21:00:00Z',at('2026-11-17T14:59:59Z')),false);
 assert.equal(businessHoursElapsed('2026-11-16T21:00:00Z',at('2026-11-17T15:00:00Z')),true);
 assert.equal(businessHoursElapsed('invalid',at('2026-11-17T15:00:00Z')),false);
});
test('recipient email window is timezone-specific, includes weekends and fails closed on invalid zones',()=>{
 assert.equal(outreachWindowOpen(at('2026-11-21T14:00:00Z')),true);
 assert.equal(outreachWindowOpen(at('2026-11-21T21:59:59Z')),true);
 assert.equal(outreachWindowOpen(at('2026-11-21T22:00:00Z')),false);
 assert.equal(outreachWindowOpen(at('2026-11-21T14:00:00Z'),'America/Los_Angeles'),false);
 assert.equal(outreachWindowOpen(at('2026-11-21T17:00:00Z'),'America/Los_Angeles'),true);
 assert.equal(outreachWindowOpen(at('2026-11-21T17:00:00Z'),'unrecognized'),false);
});
test('seven full days never uses weekdays or local calendar shortcuts across DST',()=>{
 const start='2026-10-30T16:00:00Z';
 assert.equal(sevenFullDaysElapsed(start,at('2026-11-06T15:59:59Z')),false);
 assert.equal(sevenFullDaysElapsed(start,at('2026-11-06T16:00:00Z')),true);
 assert.equal(sevenFullDaysElapsed('invalid',at('2026-11-06T16:00:00Z')),false);
});
test('monthly report stays due after a first-day outage and keeps its previous-month identity',()=>{
 const early=monthlyReportPeriod(new Date('2027-01-01T05:00:00Z'));
 assert.equal(early.period,'2026-12');assert.equal(early.identity,'monthly:2026-12');assert.equal(early.dueAt,'2027-01-01T14:00:00.000Z');assert.equal(early.due,false);
 const due=monthlyReportPeriod(new Date('2027-01-01T14:00:00Z'));
 assert.equal(due.due,true);assert.equal(due.receiptCheckRequired,true);
 const recovered=monthlyReportPeriod(new Date('2027-01-02T18:00:00Z'));
 assert.equal(recovered.due,true);assert.equal(recovered.identity,due.identity);
 const summer=monthlyReportPeriod(new Date('2027-07-01T13:00:00Z'));
 assert.equal(summer.dueAt,'2027-07-01T13:00:00.000Z');assert.equal(summer.due,true);
});
