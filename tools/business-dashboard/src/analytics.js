// Aggregate reporting only. Native GA collection and payment reconciliation remain separate.
const property='523348532';
function fail(message,status=400){throw Object.assign(new Error(message),{status});}
function count(value){if(!Number.isSafeInteger(value)||value<0)fail('Counts must be nonnegative integers.');return value;}
function label(value,max=300){if(typeof value!=='string'||!value.trim()||value.length>max)fail('Invalid report label.');return value;}
function rows(value,convert){if(!Array.isArray(value)||value.length>300)fail('Use a bounded aggregate report.');return value.map(convert);}
export function previousDay(now=new Date()) {
  const day=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
  return new Date(Date.parse(`${day}T12:00:00Z`)-86400000).toISOString().slice(0,10);
}
export function validateReport(input,now=new Date()) {
  if(!input||typeof input!=='object'||Array.isArray(input))fail('A report object is required.');
  if(input.property!==property||input.windowDays!==28)fail('Use the production property and rolling 28-day report.');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(input.startDate||'')||!/^\d{4}-\d{2}-\d{2}$/.test(input.endDate||''))fail('Explicit report dates are required.');
  const end=previousDay(now),start=new Date(Date.parse(`${end}T12:00:00Z`)-27*86400000).toISOString().slice(0,10);
  if(input.endDate!==end||input.startDate!==start)fail(`Use the current rolling window ${start} through ${end}. Preserve older windows as history.`);
  const checked=Date.parse(input.checkedAt);
  if(!Number.isFinite(checked)||checked>now.getTime()+300000||now.getTime()-checked>2*3600000)fail('A fresh Analytics source read is required.');
  let source;try{source=new URL(input.sourceUrl);}catch{fail('Use the native Analytics source URL.');}
  if(source.protocol!=='https:'||source.hostname!=='analytics.google.com'||!source.href.includes(property))fail('Use the native production Analytics source URL.');
  const events=rows(input.events,e=>({name:label(e.name,100),count:count(e.count),users:count(e.users)}));
  if(!events.length||new Set(events.map(e=>e.name)).size!==events.length)fail('Supply distinct observed event rows. Missing events remain unverified.');
  const campaigns=rows(input.campaigns||[],c=>({source:label(c.source),medium:label(c.medium),campaign:label(c.campaign),content:label(c.content),sessions:count(c.sessions),contactIntentSessions:count(c.contactIntentSessions)}));
  const kitActions=rows(input.kitActions||[],k=>({asset:label(k.asset),action:label(k.action),count:count(k.count)}));
  const coverage=input.coverage||{};
  for(const k of ['internalTrafficExcluded','attributionVerified','purchasesReconciled','campaignBreakdownComplete','kitActionBreakdownComplete'])if(typeof coverage[k]!=='boolean')fail('State every measurement coverage limitation explicitly.');
  return {property,windowDays:28,startDate:start,endDate:end,checkedAt:new Date(checked).toISOString(),sourceUrl:source.href,events,campaigns,kitActions,coverage,notes:label(input.notes,6000)};
}
export async function analyticsReport(db,now=new Date()) {
  const row=await db.prepare('SELECT * FROM analytics_reports ORDER BY checked_at DESC,id DESC LIMIT 1').first();
  if(!row)return {status:'not_connected',report:null,detail:'No verified aggregate report has been imported. Native GA collection is separate.'};
  const report=JSON.parse(row.payload),stale=report.endDate!==previousDay(now)||now.getTime()-Date.parse(row.checked_at)>30*3600000;
  const health=await db.prepare("SELECT status,checked_at,detail FROM source_health WHERE source='analytics'").first();
  if(health&&health.status!=='current'&&health.checked_at>=row.checked_at)return {status:'incomplete',report,detail:`Saved figures are not currently verified. ${health.detail}`};
  return {status:stale?'stale':'current',report,detail:'Last verified GA4 report. Collection, attribution and purchase reconciliation are separate checks.'};
}
export async function analyticsApi(request,env,now=new Date()) {
  try {
    if(request.method==='GET')return Response.json(await analyticsReport(env.DASHBOARD_DB,now),{headers:{'Cache-Control':'no-store'}});
    if(request.method!=='POST')fail('Method not allowed.',405);
    const reader=request.body?.getReader();if(!reader)fail('Missing report.');let size=0;const chunks=[];
    while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>196608){await reader.cancel();fail('Report too large.',413);}chunks.push(value);}
    const bytes=new Uint8Array(size);let offset=0;for(const value of chunks){bytes.set(value,offset);offset+=value.length;}
    let input;try{input=JSON.parse(new TextDecoder().decode(bytes));}catch{fail('Invalid report JSON.');}
    const report=validateReport(input,now),id=`ga4-${report.endDate}-${report.checkedAt}`,payload=JSON.stringify(report);
    const old=await env.DASHBOARD_DB.prepare('SELECT payload FROM analytics_reports WHERE id=?').bind(id).first();
    if(old&&old.payload!==payload)fail('This observation already exists with different data.',409);
    await env.DASHBOARD_DB.prepare('INSERT INTO analytics_reports(id,checked_at,payload) VALUES(?,?,?) ON CONFLICT DO NOTHING').bind(id,report.checkedAt,payload).run();
    return Response.json({saved:true,id},{headers:{'Cache-Control':'no-store'}});
  }catch(error){if(error.status)return Response.json({error:error.message},{status:error.status});throw error;}
}
