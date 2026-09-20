// Project-pinned Admin client for recoverable deletion. It never persists a
// user token or returns provider payloads/errors to the caller.
export async function createFirebaseDeletionClient(saJson, expectedProjectId) {
  let sa;
  try { sa = JSON.parse(saJson); } catch (_) { throw new Error('identity_configuration_invalid'); }
  if (typeof expectedProjectId !== 'string' || !/^[a-z][a-z0-9-]{4,61}[a-z0-9]$/.test(expectedProjectId) ||
      sa?.project_id !== expectedProjectId || typeof sa.client_email !== 'string' ||
      !sa.client_email.endsWith('.iam.gserviceaccount.com') || typeof sa.private_key !== 'string') {
    throw new Error('identity_configuration_invalid');
  }
  let key;
  try {
    const pem = sa.private_key.replace('-----BEGIN PRIVATE KEY-----','').replace('-----END PRIVATE KEY-----','').replace(/\s/g,'');
    key = await crypto.subtle.importKey('pkcs8', Uint8Array.from(atob(pem), c => c.charCodeAt(0)),
      {name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'}, false, ['sign']);
  } catch (_) { throw new Error('identity_configuration_invalid'); }
  const base = `https://identitytoolkit.googleapis.com/v1/projects/${expectedProjectId}/accounts:`;
  const encode = object => btoa(JSON.stringify(object)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
  let token = null;
  async function accessToken() {
    if (token) return token;
    const now = Math.floor(Date.now()/1000);
    const input = `${encode({alg:'RS256',typ:'JWT'})}.${encode({iss:sa.client_email,
      scope:'https://www.googleapis.com/auth/identitytoolkit',aud:'https://oauth2.googleapis.com/token',iat:now,exp:now+3600})}`;
    const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5',key,new TextEncoder().encode(input));
    const signed = input+'.'+btoa(String.fromCharCode(...new Uint8Array(signature))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
    try {
      const response = await fetch('https://oauth2.googleapis.com/token',{method:'POST',
        headers:{'Content-Type':'application/x-www-form-urlencoded'},
        body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion:signed}),
        signal:AbortSignal.timeout(10000)});
      const body = await response.json();
      if (!response.ok || typeof body.access_token !== 'string' || !body.access_token) throw Error();
      token = body.access_token;return token;
    } catch (_) { throw new Error('identity_authorization_unavailable'); }
  }
  async function request(method, uid) {
    if (typeof uid !== 'string' || !uid || uid.length>128 || /\s/.test(uid)) throw new Error('identity_uid_invalid');
    const authorization = await accessToken();
    try {
      const response = await fetch(base+method,{method:'POST',
        headers:{'Content-Type':'application/json',Authorization:`Bearer ${authorization}`},
        body:JSON.stringify({localId:method==='lookup'?[uid]:uid}),signal:AbortSignal.timeout(10000)});
      const body = await response.json();
      if (!response.ok || !body || typeof body !== 'object' || Array.isArray(body) || body.error) throw Error();
      return body;
    } catch (_) { throw new Error('identity_request_unconfirmed'); }
  }
  return {
    async exists(uid) {
      const body = await request('lookup',uid);
      if (body.users === undefined && Object.keys(body).some(key => key !== 'kind')) throw new Error('identity_response_invalid');
      const users = body.users ?? [];
      if (!Array.isArray(users) || users.length>1 || users.some(user => user?.localId !== uid || user.tenantId)) {
        throw new Error('identity_response_invalid');
      }
      return users.length===1;
    },
    async remove(uid) {
      // Even a nominal success is followed by a fresh lookup by the processor.
      // A timeout or USER_NOT_FOUND is reconciled by lookup, never text matching.
      await request('delete',uid);
    }
  };
}
