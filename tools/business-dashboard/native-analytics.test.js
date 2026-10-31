import test from 'node:test';import assert from 'node:assert/strict';
import {reportFromCaptures} from './scripts/capture-ga4-events.mjs';
const now=new Date('2026-10-31T19:10:00.000Z');
const page=(range,rows)=>({url:'https://analytics.google.com/analytics/web/#/a366252518p523348532/reports/explorer',capturedAt:'2026-10-31T19:05:00.000Z',dom:`- generic: Oct 3 - Oct 30, 2026\n- generic: ${range}\n- row "Total 10 100% of total 4 100% of total":\n${rows.map((r,i)=>`- row "Checkbox for selecting row ${i+1} ${r[0]} ${r[1]} ${r[2]} (50%) ${r[3]} (100%) 1.0 $0.00 (0%) Inline action menu":`).join('\n')}`});
test('native analytics accepts only complete matching pages and derives exact observed values',()=>{
 const r=reportFromCaptures([page('1-2 of 3',[[1,'page_view',7,4],[2,'purchase',2,2]]),page('3-3 of 3',[[3,'refund',1,1]])],now);
 assert.deepEqual(r.events,[{name:'page_view',count:7,users:4},{name:'purchase',count:2,users:2},{name:'refund',count:1,users:1}]);assert.equal(r.coverage.purchasesReconciled,false);
});
test('native analytics rejects the observed stale-row pagination transition',()=>{
 assert.throws(()=>reportFromCaptures([page('1-2 of 3',[[1,'page_view',7,4],[2,'purchase',2,2]]),page('3-3 of 3',[[3,'page_view',7,4],[4,'purchase',2,2]])],now),/still loading/);
});
test('native analytics rejects missing, duplicate, conflicting and stale evidence',()=>{
 const a=page('1-2 of 3',[[1,'page_view',7,4],[2,'purchase',2,2]]),b=page('3-3 of 3',[[3,'refund',1,1]]);
 assert.throws(()=>reportFromCaptures([a],now),/Missing native event rows/);
 assert.throws(()=>reportFromCaptures([a,a],now),/Duplicate/);
 assert.throws(()=>reportFromCaptures([a,{...b,dom:b.dom.replace('Total 10','Total 11')}],now),/changed between pages/);
 assert.throws(()=>reportFromCaptures([{...a,capturedAt:'2026-10-30T19:05:00Z'},b],now),/Stale/);
 assert.throws(()=>reportFromCaptures([{...a,dom:a.dom.replace('Oct 3','Oct 2')},b],now),/window/);
});
