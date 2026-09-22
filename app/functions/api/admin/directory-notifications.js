import {directoryEnabled,directoryDb,notifyDirectoryRequest} from '../../_lib/directory-requests.js';
// Private recovery only. Reuses the existing admin secret; never sent to a page.
// A distinct header avoids treating the admin credential as a Firebase token.
export async function onRequest({request,env}) {
  const json=(body,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store'}});
  if (!directoryEnabled(env)) return json({error:'not_available'},404);
  const given=request.headers.get('X-Admin-Key')||'';
  if (!env.ADMIN_API_KEY || given.length>1024) return json({error:'unauthorized'},401);
  const hash=async text=>crypto.subtle.digest('SHA-256',new TextEncoder().encode(text));
  const [a,b]=await Promise.all([hash(given),hash(env.ADMIN_API_KEY)]);
  if (!crypto.subtle.timingSafeEqual(a,b)) return json({error:'unauthorized'},401);
  if (!['GET','POST'].includes(request.method)) return json({error:'method_not_allowed'},405);
  try {
    const db=directoryDb(env);
    if (request.method==='POST') {
      const pending=await db.prepare(`SELECT id FROM directory_requests WHERE notification_next_attempt_at<=datetime('now') AND (notification_status='pending' OR (notification_status='sending' AND notification_lease_until<datetime('now'))) ORDER BY created_at LIMIT 5`).all();
      for (const row of pending.results) await notifyDirectoryRequest(env,row.id);
    }
    const result=await db.prepare(`SELECT notification_status,COUNT(*) AS count FROM directory_requests GROUP BY notification_status`).all();
    return json({notifications:result.results});
  } catch (_) {return json({error:'notification_recovery_unavailable'},503);}
}
