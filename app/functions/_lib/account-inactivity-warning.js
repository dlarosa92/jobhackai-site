import { getDb } from './db.js';
import { canonicalEnvironmentName } from './stripe-environment.js';

const definitiveRejections=new Set([400,401,403,404,405,406,413,415,422]);

export async function sendInactivityWarning(env, user, claim, onProviderStart) {
  const db=getDb(env);
  const expected={dev:'https://dev.jobhackai.io',qa:'https://qa.jobhackai.io',prod:'https://app.jobhackai.io'}[canonicalEnvironmentName(env)];
  if (!expected || env.FRONTEND_URL!==expected || !env.RESEND_API_KEY ||
      typeof user?.email!=='string' || user.email.length>320 || /[\s<>]/.test(user.email) || !user.email.includes('@') ||
      claim?.uid!==user.auth_id || claim?.kind!=='maintenance' || typeof onProviderStart!=='function') {
    throw new Error('inactivity_warning_configuration_invalid');
  }
  const admitted=await db.prepare(`SELECT 1 FROM account_operation_claims WHERE id=? AND auth_id=?
    AND kind='maintenance' AND state='active'`).bind(claim.id,user.auth_id).first();
  if(!admitted)throw new Error('inactivity_warning_admission_required');
  // The caller has verified eligibility while holding exclusive maintenance.
  // A finished/invalidated cycle receives a new idempotency key. An unresolved
  // cycle is never overwritten, even beyond the provider's 24-hour key window.
  let warning=await db.prepare('SELECT * FROM account_inactivity_warnings WHERE auth_id=?').bind(user.auth_id).first();
  if(warning && ['sending','needs_review'].includes(warning.state)) return {status:'skipped',uncertain:false};
  if(!warning || warning.state!=='pending' || warning.email!==user.email) {
    await db.prepare(`INSERT INTO account_inactivity_warnings(id,auth_id,email)
      VALUES(?,?,?) ON CONFLICT(auth_id) DO UPDATE SET id=excluded.id,email=excluded.email,
      state='pending',provider_id=NULL,operation_id=NULL,attempts=0,last_error_code=NULL,
      created_at=datetime('now'),sent_at=NULL
      WHERE account_inactivity_warnings.state IN ('pending','sent','canceled')`)
      .bind(crypto.randomUUID(),user.auth_id,user.email).run();
    warning=await db.prepare('SELECT * FROM account_inactivity_warnings WHERE auth_id=?').bind(user.auth_id).first();
  }
  const sending=await db.prepare(`UPDATE account_inactivity_warnings SET state='sending',operation_id=?,
    attempts=attempts+1,last_error_code=NULL WHERE id=? AND auth_id=? AND email=? AND state='pending' AND attempts<3
    AND EXISTS(SELECT 1 FROM users WHERE id=? AND auth_id=? AND email=?)
    AND NOT EXISTS(SELECT 1 FROM account_deletion_admissions WHERE auth_id=?) RETURNING *`)
    .bind(claim.id,warning.id,user.auth_id,user.email,user.id,user.auth_id,user.email,user.auth_id).first();
  if(!sending)return {status:'skipped',uncertain:false};
  const payload={from:'JobHackAI <noreply@jobhackai.io>',to:[user.email],
    subject:'Keep your JobHackAI account active',
    html:`<div style="font-family:Arial,sans-serif;max-width:540px;margin:auto;color:#1F2937">
      <h2>Would you like to keep your JobHackAI account?</h2>
      <p>Your account has been inactive for at least 23 months. If it remains inactive, we may delete the account and saved tool content after 24 months of inactivity, no sooner than 30 days after this notice.</p>
      <p><a href="${expected}/login">Sign in to keep your account</a>. Signing in starts a new activity period.</p>
      <p>If you no longer need the account, no action is needed. Required billing and security records may be retained.</p>
      <p>Questions? Contact privacy@jobhackai.io. <a href="${expected}/privacy">Privacy policy</a></p>
      <p>JobHackAI</p></div>`};
  let status='uncertain',providerId=null;
  onProviderStart();
  try {
    const response=await fetch('https://api.resend.com/emails',{method:'POST',signal:AbortSignal.timeout(10000),
      headers:{Authorization:`Bearer ${env.RESEND_API_KEY}`,'Content-Type':'application/json',
        'Idempotency-Key':`inactivity-warning/${sending.id}`},body:JSON.stringify(payload)});
    if(!response.ok) {
      status=definitiveRejections.has(response.status)?'rejected':'uncertain';
      await response.body?.cancel();
    } else {
      const body=await response.json();
      if(typeof body?.id==='string' && body.id && body.id.length<=256) {providerId=body.id;status='accepted';}
    }
  } catch (_) { /* No raw provider diagnostics or automatic retry. */ }
  if(status==='accepted') {
    const sentAt=new Date().toISOString();
    const results=await db.batch([
      db.prepare(`UPDATE account_inactivity_warnings SET state=CASE WHEN EXISTS(
        SELECT 1 FROM users WHERE id=? AND auth_id=? AND email=?) THEN 'sent' ELSE NULL END,
        provider_id=?,sent_at=?,last_error_code=NULL WHERE id=? AND operation_id=? AND state='sending'`)
        .bind(user.id,user.auth_id,user.email,providerId,sentAt,sending.id,claim.id),
      db.prepare(`UPDATE users SET deletion_warning_sent_at=? WHERE id=? AND auth_id=? AND email=?
        AND EXISTS(SELECT 1 FROM account_inactivity_warnings WHERE id=? AND operation_id=? AND state='sent' AND sent_at=?)`)
        .bind(sentAt,user.id,user.auth_id,user.email,sending.id,claim.id,sentAt)
    ]);
    if(results.some(result=>result.meta?.changes!==1))throw new Error('inactivity_warning_receipt_unconfirmed');
  } else {
    const next=status==='uncertain'||sending.attempts>=3?'needs_review':'pending';
    const result=await db.prepare(`UPDATE account_inactivity_warnings SET state=?,last_error_code=?
      WHERE id=? AND operation_id=? AND state='sending'`)
      .bind(next,status==='uncertain'?'provider_unconfirmed':'provider_rejected',sending.id,claim.id).run();
    if(result.meta?.changes!==1)throw new Error('inactivity_warning_receipt_unconfirmed');
  }
  return {status,uncertain:status==='uncertain'};
}
