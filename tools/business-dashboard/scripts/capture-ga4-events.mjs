import {readFile,writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {previousDay,validateReport} from '../src/analytics.js';

// Normalize actual browser captures. Never supply remembered or inferred event rows.
export function reportFromCaptures(captures,now=new Date()) {
  if(!Array.isArray(captures)||!captures.length)throw Error('Native Events table captures are required.');
  const endDate=previousDay(now),startDate=new Date(Date.parse(endDate+'T12:00:00Z')-27*86400000).toISOString().slice(0,10);
  const months=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const events=new Map(),names=new Set();let totalRows,totalEvents,sourceUrl,checkedAt='';
  for(const capture of captures) {
    if(typeof capture.dom!=='string')throw Error('Each capture needs the raw native DOM, URL and capture time.');
    const url=new URL(capture.url);
    if(url.protocol!=='https:'||url.hostname!=='analytics.google.com'||!url.href.includes('p523348532'))throw Error('Wrong GA4 property or source.');
    const at=Date.parse(capture.capturedAt);
    if(!Number.isFinite(at)||at>now.getTime()+300000||now.getTime()-at>7200000)throw Error('Stale or invalid native capture time.');
    const date=capture.dom.match(/generic: ([A-Z][a-z]{2}) (\d{1,2})(?:, (\d{4}))? - ([A-Z][a-z]{2}) (\d{1,2}), (\d{4})/);
    if(!date)throw Error('Visible native date picker was not captured.');
    const startYear=Number(date[3]||Number(date[6])-(months.indexOf(date[1])>months.indexOf(date[4])?1:0));
    const iso=(year,month,day)=>`${year}-${String(months.indexOf(month)+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
    if(iso(startYear,date[1],date[2])!==startDate||iso(date[6],date[4],date[5])!==endDate)throw Error('Native date window does not match the rolling 28 days through yesterday.');
    const range=capture.dom.match(/generic: (\d+)-(\d+) of (\d+)/);
    const total=capture.dom.match(/\bTotal ([\d,]+) 100% of total/);
    if(!range||!total)throw Error('Missing native table pagination or total.');
    const [first,last,count]=range.slice(1).map(Number),eventCount=Number(total[1].replaceAll(',',''));
    if(first<1||last<first||last>count||count>300)throw Error('Invalid native page range.');
    if(totalRows!==undefined&&(totalRows!==count||totalEvents!==eventCount))throw Error('Native report changed between pages. Capture all pages again.');
    totalRows=count;totalEvents=eventCount;
    const rows=[...capture.dom.matchAll(/^\s*- row "Checkbox for selecting row \d+ (\d+) ([A-Za-z][A-Za-z0-9_]*) ([\d,]+) \([^)]*\) ([\d,]+) \(/gm)].map(m=>({index:Number(m[1]),name:m[2],count:Number(m[3].replaceAll(',','')),users:Number(m[4].replaceAll(',',''))}));
    if(rows.length!==last-first+1||rows.some((row,i)=>row.index!==first+i))throw Error('Native page is still loading or incomplete: row range and table rows disagree. Read the loaded page again.');
    for(const row of rows){if(events.has(row.index)||names.has(row.name))throw Error('Duplicate event row or repeated page.');events.set(row.index,row);names.add(row.name);}
    sourceUrl=url.href;checkedAt=[checkedAt,new Date(at).toISOString()].sort().at(-1);
  }
  if(events.size!==totalRows||[...events.values()].reduce((sum,row)=>sum+row.count,0)!==totalEvents)throw Error('Missing native event rows. Read the remaining page before importing.');
  return validateReport({property:'523348532',windowDays:28,startDate,endDate,checkedAt,sourceUrl,events:[...events.values()].sort((a,b)=>a.index-b.index).map(({index,...row})=>row),campaigns:[],kitActions:[],coverage:{internalTrafficExcluded:false,attributionVerified:false,purchasesReconciled:false,campaignBreakdownComplete:false,kitActionBreakdownComplete:false},notes:`Parsed ${events.size} distinct native Events rows from ${captures.length} browser captures. Their counts sum to the displayed ${totalEvents} events. Native date pickers and page ranges agree. Campaign, kit action, internal traffic, attribution and collected purchase reconciliation remain unverified.`},now);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const [output,...files]=process.argv.slice(2);if(!output||!files.length)throw Error('Usage: capture-ga4-events.mjs output.json native-page-1.json [native-page-2.json ...]');
  const report=reportFromCaptures(await Promise.all(files.map(async file=>JSON.parse(await readFile(file,'utf8')))));
  await writeFile(output,JSON.stringify(report,null,2),{mode:0o600,flag:'wx'});
  console.log(JSON.stringify({output,rows:report.events.length,checkedAt:report.checkedAt,startDate:report.startDate,endDate:report.endDate}));
}
