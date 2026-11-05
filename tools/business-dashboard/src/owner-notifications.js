// Fixed private operational route, never a general mail API. Sends only from the existing cron.
export const OWNER_RECIPIENT='sebastian.larosa@jobhackai.io';
export const OWNER_SENDER='JobHackAI <noreply@jobhackai.io>';
export const COMPANY_BRIEF='https://chatgpt.com/space/page_fed12c661ba88191b522b9dad45a115b';
const API='https://api.resend.com/emails', HOUR=3600000;
export const notificationsEnabled=env=>env?.OWNER_NOTIFICATIONS_ENABLED==='true';
const environment=env=>['dev','qa','prod'].includes(env?.OWNER_NOTIFICATION_ENVIRONMENT)?env.OWNER_NOTIFICATION_ENVIRONMENT:'unconfigured';
const configured=env=>['dev','qa','prod'].includes(env.OWNER_NOTIFICATION_ENVIRONMENT)&&!!env.OWNER_RESEND_API_KEY;
const clean=(value,max=800)=>String(value||'').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g,'').slice(0,max);
const stamp=value=>new Date(value).toISOString();
const names={preparation:'Work completed',reconciliation:'Source checks',coordination:'Team priorities'};

// Statement belongs to the same D1 batch as the successfully completed run.
export function briefStatement(db,run,result,now,env){
  const count=result.advancedItems.length+result.completedHandoffs.length;
  if(!count)return null; // A checked source or huddle alone is not a business result.
  const subject=`JobHackAI: ${names[run.workflow]||'work update'}`;
  const body=`${clean(result.summary,1200)}\n\n${count} saved work update(s) were recorded. This notice reports the saved operating event above. Open the company brief for the latest saved context; it may not yet include this event:\n${COMPANY_BRIEF}\n\nRecorded ${now}. This notice does not verify customer growth or revenue.`;
  return db.prepare(`INSERT OR IGNORE INTO owner_notifications(id,kind,environment,subject,body,created_at,next_attempt_at,updated_at)
    SELECT ?, 'brief', ?, ?, ?, ?, ?, ? FROM workflow_runs WHERE id=? AND status='advanced' AND finished_at=?`)
    .bind(`brief:${run.id}`,environment(env),subject,body,now,now,now,run.id,now);
}

// Queue from canonical alert rows inside the deadline check's transaction. Concurrent checks
// use the persisted episode timestamp, not independent read-time timestamps.
export function alertStatements(db,ids,now,env){
  const active=JSON.stringify(ids);
  return [
    db.prepare(`INSERT OR IGNORE INTO owner_notifications(id,kind,environment,subject,body,created_at,next_attempt_at,updated_at)
      SELECT 'failure:'||id||':'||first_seen_at,'failure',?,'JobHackAI needs attention',
        substr(detail,1,1200)||? ,?,?,? FROM workflow_alerts
      WHERE resolved_at IS NULL AND id IN (SELECT value FROM json_each(?))`)
      .bind(environment(env),`\n\nThe team needs to investigate this issue. This notice reports the operating condition above. Open the company brief for the latest saved context; it may not yet include this event:\n${COMPANY_BRIEF}\n\nChecked ${now}. This is a monitoring alert, not permission to repeat an external action.`,now,now,now,active),
    db.prepare(`INSERT OR IGNORE INTO owner_notifications(id,kind,environment,subject,body,created_at,next_attempt_at,updated_at)
      SELECT 'recovery:'||id||':'||first_seen_at,'recovery',?,'JobHackAI monitoring update',
        'This earlier alert is no longer active: '||substr(detail,1,1000)||?,?,?,? FROM workflow_alerts
      WHERE resolved_at IS NULL AND id NOT IN (SELECT value FROM json_each(?))
      AND EXISTS(SELECT 1 FROM owner_notifications n WHERE n.id='failure:'||workflow_alerts.id||':'||workflow_alerts.first_seen_at AND n.attempts>0)`)
      .bind(environment(env),`\n\nThis clears the monitoring condition; it does not prove the underlying business work finished. Open the company brief for the latest saved context; it may not yet include this event:\n${COMPANY_BRIEF}\n\nChecked ${now}.`,now,now,now,active),
    db.prepare(`UPDATE owner_notifications SET state='failed',last_reason='resolved_before_dispatch',updated_at=?
      WHERE kind='failure' AND state='pending' AND attempts=0 AND id IN (
        SELECT 'failure:'||id||':'||first_seen_at FROM workflow_alerts WHERE resolved_at IS NULL
        AND id NOT IN (SELECT value FROM json_each(?)))`).bind(now,active)
  ];
}

export async function notificationStatus(env){
  if(!notificationsEnabled(env))return {status:'disabled',detail:'Owner email notifications are off.'};
  let rows;try{rows=await env.DASHBOARD_DB.prepare('SELECT state,COUNT(*) AS count FROM owner_notifications GROUP BY state').all();}
  catch{return {status:'unavailable',detail:'Owner notification storage could not be read. Delivery is unverified.'};}
  const reviews=await env.DASHBOARD_DB.prepare("SELECT state,last_reason,COUNT(*) AS count FROM owner_notifications WHERE state IN ('failed','uncertain') OR last_reason IN ('delivery_receipt_requires_review','complaint_monitoring_window_closed') OR environment<>? GROUP BY state,last_reason").bind(environment(env)).all();
  const suppressed=reviews.results.some(r=>['provider_bounced','provider_complained','provider_suppressed'].includes(r.last_reason));
  return {status:suppressed?'suppressed':configured(env)?'configured':'missing_configuration',reviewRequired:reviews.results,
    detail:suppressed?'Owner email stopped after a bounce, complaint or provider suppression. Investigate before resuming.':configured(env)?'Provider acceptance, delivery and phone visibility are separate checks. Delivered receipts are monitored for seven days only.':'Owner email is enabled but its dedicated Resend credential or explicit environment binding is missing. No send can occur.',
    counts:Object.fromEntries(rows.results.map(r=>[r.state,r.count]))};
}
async function boundedJson(response){
  const reader=response.body?.getReader();if(!reader)throw new Error('missing_response');
  const parts=[];let size=0;
  try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>65536)throw new Error('oversized_response');parts.push(value);}}
  finally{await reader.cancel().catch(()=>{});}
  const out=new Uint8Array(size);let offset=0;for(const p of parts){out.set(p,offset);offset+=p.length;}
  return JSON.parse(new TextDecoder().decode(out));
}
async function persist(db,row,values,now){
  return db.prepare(`UPDATE owner_notifications SET state=?,provider_id=COALESCE(?,provider_id),
    accepted_at=CASE WHEN ?='accepted' THEN COALESCE(accepted_at,?) ELSE accepted_at END,
    delivered_at=CASE WHEN ?='delivered' THEN COALESCE(delivered_at,?) ELSE delivered_at END,
    last_reason=?,next_attempt_at=?,next_poll_at=?,token=NULL,lease_until=NULL,updated_at=? WHERE id=? AND token=?`)
    .bind(values.state,values.provider||null,values.state,now,values.state,now,values.reason||null,
      values.next||now,values.poll||null,now,row.id,row.token).run();
}

// At most one POST and one receipt GET per 15-minute invocation. No sleeps or unbounded work.
export async function flushOwnerNotifications(env,now=new Date(),transport=fetch){
  if(!notificationsEnabled(env))return {status:'disabled',attempted:0,polled:0};
  const db=env.DASHBOARD_DB,at=now.toISOString(),retryCutoff=stamp(now.getTime()-23*HOUR),old=stamp(now.getTime()-24*HOUR);
  if(!configured(env))return {status:'missing_configuration',attempted:0,polled:0};
  const suppressed=await db.prepare("SELECT 1 FROM owner_notifications WHERE last_reason IN ('provider_bounced','provider_complained','provider_suppressed') LIMIT 1").first();
  if(suppressed)return {status:'suppressed',attempted:0,polled:0};
  // Expired ambiguous attempts never get a new key or a blind retry outside provider's window.
  await db.prepare(`UPDATE owner_notifications SET state='uncertain',last_reason='send_outcome_requires_review',token=NULL,lease_until=NULL,updated_at=?
    WHERE state IN ('pending','sending') AND first_attempt_at IS NOT NULL AND (first_attempt_at<=? OR attempts>=5)
    AND (lease_until IS NULL OR lease_until<=?)`).bind(at,retryCutoff,at).run();
  await db.prepare(`UPDATE owner_notifications SET state='failed',last_reason='unsent_notice_expired',updated_at=?
    WHERE state='pending' AND first_attempt_at IS NULL AND created_at<=?`).bind(at,old).run();
  await db.prepare("UPDATE owner_notifications SET next_poll_at=NULL,last_reason=CASE WHEN state='delivered' THEN 'complaint_monitoring_window_closed' ELSE 'delivery_receipt_requires_review' END,token=NULL,lease_until=NULL WHERE state IN ('accepted','delivered') AND ((state='accepted' AND poll_attempts>=48) OR (state='delivered' AND (delivery_poll_attempts>=8 OR delivered_at<=?))) AND (lease_until IS NULL OR lease_until<=?)").bind(stamp(now.getTime()-7*24*HOUR),at).run();
  const lease=stamp(now.getTime()+60000);
  let attempted=0,polled=0;
  const pollToken=crypto.randomUUID();
  const receipt=await db.prepare(`UPDATE owner_notifications SET token=?,lease_until=?,poll_attempts=poll_attempts+CASE WHEN state='accepted' THEN 1 ELSE 0 END,delivery_poll_attempts=delivery_poll_attempts+CASE WHEN state='delivered' THEN 1 ELSE 0 END,updated_at=?
    WHERE id=(SELECT id FROM owner_notifications WHERE state IN ('accepted','delivered') AND environment=? AND next_poll_at<=?
    AND (lease_until IS NULL OR lease_until<=?) AND ((state='accepted' AND poll_attempts<48) OR (state='delivered' AND delivery_poll_attempts<8)) ORDER BY next_poll_at,id LIMIT 1) RETURNING *`)
    .bind(pollToken,lease,at,environment(env),at,at).first();
  if(receipt){
    let outcome={state:receipt.state,reason:'delivery_receipt_unverified',poll:stamp(now.getTime()+(receipt.state==='delivered'?24:1)*HOUR)};
    try{
      const response=await transport(`${API}/${encodeURIComponent(receipt.provider_id)}`,{method:'GET',redirect:'manual',signal:AbortSignal.timeout(10000),headers:{Authorization:`Bearer ${env.OWNER_RESEND_API_KEY}`}});
      if(response.ok){const data=await boundedJson(response);
        if(data.id!==receipt.provider_id||JSON.stringify(data.to)!==JSON.stringify([OWNER_RECIPIENT])||data.from!==OWNER_SENDER||data.subject!==(receipt.environment==='prod'?receipt.subject:`[${receipt.environment.toUpperCase()} TEST] ${receipt.subject}`)||data.text!==receipt.body||(data.cc?.length||0)>0||(data.bcc?.length||0)>0){outcome={state:'uncertain',reason:'provider_receipt_mismatch'};}
        else if(data.last_event==='delivered')outcome={state:'delivered',poll:stamp(now.getTime()+24*HOUR)};
        else if(['bounced','complained','failed','suppressed'].includes(data.last_event))outcome={state:'failed',reason:`provider_${data.last_event}`};
      }else{outcome.reason=`receipt_http_${response.status}`;await response.body?.cancel();}
    }catch{ /* a failed receipt read cannot authorize another send */ }
    if((outcome.state==='accepted'&&receipt.poll_attempts>=48)||(outcome.state==='delivered'&&receipt.delivery_poll_attempts>=8)){outcome.reason=outcome.state==='accepted'?'delivery_receipt_requires_review':'complaint_monitoring_window_closed';outcome.poll=null;}
    await persist(db,receipt,outcome,at);polled=1;
  }
  const stopped=await db.prepare("SELECT 1 FROM owner_notifications WHERE last_reason IN ('provider_bounced','provider_complained','provider_suppressed') LIMIT 1").first();
  if(stopped)return {status:'suppressed',attempted,polled};
  const token=crypto.randomUUID();
  const row=await db.prepare(`UPDATE owner_notifications SET state='sending',attempts=attempts+1,token=?,lease_until=?,
    first_attempt_at=COALESCE(first_attempt_at,?),updated_at=? WHERE id=(SELECT id FROM owner_notifications
    WHERE environment=? AND (state='pending' OR (state='sending' AND lease_until<=?)) AND next_attempt_at<=? AND attempts<5
    AND (first_attempt_at IS NULL OR first_attempt_at>?)
    AND NOT EXISTS(SELECT 1 FROM owner_notifications stop WHERE stop.last_reason IN ('provider_bounced','provider_complained','provider_suppressed')) ORDER BY created_at,id LIMIT 1)
    RETURNING *`).bind(token,lease,at,at,environment(env),at,at,retryCutoff).first();
  if(row){
    const body=JSON.stringify({from:OWNER_SENDER,to:[OWNER_RECIPIENT],subject:row.environment==='prod'?row.subject:`[${row.environment.toUpperCase()} TEST] ${row.subject}`,text:row.body});
    let outcome={state:'pending',reason:'send_outcome_unknown',next:stamp(now.getTime()+Math.min(60,15*2**(row.attempts-1))*60000)};
    try{
      const response=await transport(API,{method:'POST',redirect:'manual',signal:AbortSignal.timeout(10000),
        headers:{Authorization:`Bearer ${env.OWNER_RESEND_API_KEY}`,'Content-Type':'application/json','Idempotency-Key':`owner-notice/${row.environment}/${row.id}`},body});
      if(response.ok){const data=await boundedJson(response);
        if(typeof data.id==='string'&&/^[a-zA-Z0-9_-]{1,128}$/.test(data.id))outcome={state:'accepted',provider:data.id,poll:stamp(now.getTime()+15*60000)};
      }else{
        outcome.reason=`provider_http_${response.status}`;
        if(response.status<500&&![408,409,429].includes(response.status))outcome.state='failed';
        await response.body?.cancel();
      }
    }catch{ /* exact payload/key may retry inside 23 hours; never assume failure means no send */ }
    await persist(db,row,outcome,at);attempted=1;
  }
  return {status:'checked',attempted,polled};
}
