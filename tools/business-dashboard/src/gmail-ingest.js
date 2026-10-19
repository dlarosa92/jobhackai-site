import { receiveGmailSync, signedJson } from './gmail-sync.js';
import { relayOutreach } from './outreach.js';

export default { async fetch(request, env) {
  if(new URL(request.url).pathname==='/outreach') {
    let input;
    try { input=await signedJson(request,env); }
    catch(error) { return Response.json({error:error.message==='too_large'?'Request too large':'Unauthorized'}, {status:error.message==='too_large'?413:401}); }
    try { return await relayOutreach(env,input); }
    catch { return Response.json({error:'Outreach check failed; no send authorized'}, {status:503}); }
  }
  return receiveGmailSync(request, env);
} };
