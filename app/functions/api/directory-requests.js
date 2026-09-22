import {directoryOriginAllowed,directoryEnabled,readSmallJson,saveDirectoryRequest,notifyDirectoryRequest} from '../_lib/directory-requests.js';
export async function onRequest(context) {
  const {request,env} = context;
  const origin = request.headers.get('Origin');
  const headers = {'Content-Type':'application/json','Cache-Control':'no-store','Vary':'Origin','X-Content-Type-Options':'nosniff'};
  const reply = (body,status) => new Response(JSON.stringify(body),{status,headers});
  if (!directoryEnabled(env)) return reply({ok:false,error:'not_available'},404);
  if (!directoryOriginAllowed(env,origin)) return reply({ok:false,error:'origin_not_allowed'},403);
  Object.assign(headers,{'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Methods':'POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type'});
  if (request.method==='OPTIONS') return new Response(null,{status:204,headers});
  if (request.method!=='POST') return reply({ok:false,error:'method_not_allowed'},405);
  let input;
  try {input=await readSmallJson(request);} catch (_) {return reply({ok:false,error:'invalid_request'},400);}
  try {
    const result = await saveDirectoryRequest(env,input,request.headers.get('CF-Connecting-IP'));
    if (result.body.ok) {
      // No content or raw provider errors in logs, and no email before commit.
      context.waitUntil(notifyDirectoryRequest(env,result.body.request_id).catch(()=>console.warn('[DIRECTORY] Notification remains queued for review/retry')));
    }
    if (result.status===429) headers['Retry-After']='3600';
    return reply(result.body,result.status);
  } catch (_) {return reply({ok:false,error:'save_unavailable'},503);}
}
