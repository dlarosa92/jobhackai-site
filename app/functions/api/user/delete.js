import { getBearer, verifyFirebaseIdToken } from '../../_lib/firebase-auth.js';
import { processAccountDeletion } from '../../_lib/account-deletion-process.js';

export async function onRequest(context) {
  const { request, env } = context;
  const headers=corsHeaders(request.headers.get('Origin') || '',env);
  if(request.method==='OPTIONS') return new Response(null,{headers});
  if(request.method!=='POST') return Response.json({error:'Method not allowed'},{status:405,headers});
  const token=getBearer(request);
  if(!token) return Response.json({error:'Unauthorized'},{status:401,headers});
  let verified;
  try { verified=await verifyFirebaseIdToken(token,env.FIREBASE_PROJECT_ID); }
  catch(_) { return Response.json({error:'Invalid token'},{status:401,headers}); }
  try {
    const result=await processAccountDeletion(env,{uid:verified.uid,email:verified.payload?.email || null});
    return Response.json(result,{status:result.status==='complete'?200:202,headers});
  } catch(_) {
    // Configuration/database/provider details and identifiers never escape.
    return Response.json({ok:false,error:'Account deletion could not be confirmed. Please retry or contact privacy@jobhackai.io.'},
      {status:503,headers});
  }
}

function corsHeaders(origin, env) {
  const fallbackOrigins = ['https://dev.jobhackai.io', 'https://qa.jobhackai.io'];
  const configured = env?.FRONTEND_URL || null;
  const allowedList = configured ? [configured, ...fallbackOrigins] : fallbackOrigins;
  const allowed = origin && allowedList.includes(origin) ? origin : (configured || 'https://dev.jobhackai.io');
  return {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    'Vary': 'Origin'
  };
}
