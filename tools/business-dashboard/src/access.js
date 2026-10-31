import { createRemoteJWKSet, jwtVerify } from 'jose';
export const ACCESS_AUD = '884df74e9be8546b0051980538c8e00a75efd2b1d2da5a04a4e4fbe78f3a4a40';
export const ACCESS_ISSUER = 'https://jobhack.cloudflareaccess.com';
const OWNER = 'sebastian.larosa@jobhackai.io';
const KEYS = createRemoteJWKSet(new URL(`${ACCESS_ISSUER}/cdn-cgi/access/certs`));
const knownCapabilities = ['read','prepare','reconcile','contribute','coordinate'];

export async function accessIdentity(token, env, keys=KEYS) {
  try {
    const {payload}=await jwtVerify(token,keys,{issuer:ACCESS_ISSUER,audience:ACCESS_AUD,algorithms:['RS256']});
    if(typeof payload.email==='string'&&payload.email.toLowerCase()===OWNER)return {role:'owner',id:OWNER};
    // Only the cryptographically verified Access service-token common_name is accepted.
    const configured=JSON.parse(env.DASHBOARD_MACHINE_IDENTITIES || '{}');
    const capabilities=Object.hasOwn(configured,payload.common_name||'')?configured[payload.common_name]:null;
    if(!payload.email&&typeof payload.common_name==='string'&&Array.isArray(capabilities)&&capabilities.length&&capabilities.every(c=>knownCapabilities.includes(c)))return {role:'machine',id:payload.common_name,capabilities};
  } catch { /* Missing, expired, foreign or invalid credentials fail closed. */ }
  return null;
}
export async function requestIdentity(request,env,ctx) {
  if(ctx.access?.aud===ACCESS_AUD){const identity=await ctx.access.getIdentity();if(identity?.email?.toLowerCase()===OWNER)return {role:'owner',id:OWNER};}
  const token=request.headers.get('cf-access-jwt-assertion');return token?accessIdentity(token,env):null;
}
export function allowed(identity,method,path) {
  if(identity?.role==='owner')return true;
  if(identity?.role!=='machine')return false;
  const caps=identity.capabilities;
  if(method==='GET'&&caps.includes('read'))return ['/api/campaigns','/api/operating-guide','/api/session','/api/workflow','/api/analytics'].includes(path)||/^\/api\/work-items(?:\/[a-z0-9_-]+)?$/.test(path);
  if(method!=='POST')return false;
  if(['/api/workflow/start','/api/workflow/finish'].includes(path))return ['prepare','reconcile','coordinate'].some(c=>caps.includes(c));
  const routes={
    '/api/workflow/handoff':'prepare','/api/analytics':'reconcile',
    '/api/work-items/prepare':'prepare','/api/outreach/prepare':'prepare',
    '/api/work-items/capture-native':'reconcile','/api/work-items/reconcile':'reconcile','/api/work-items/source-health':'reconcile','/api/work-items/receipt':'reconcile',
    '/api/work-items/contribute':'contribute','/api/work-items/rank':'coordinate','/api/work-items/coordination':'coordinate',
  };
  return !!routes[path]&&caps.includes(routes[path]);
}
