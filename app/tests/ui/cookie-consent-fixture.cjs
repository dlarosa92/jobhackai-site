// Run: node app/tests/ui/cookie-consent-fixture.cjs
// Open http://127.0.0.1:8771 in Safari. This serves the actual consent runtime
// with delayed synthetic auth and browser-local consent receipts. No accounts,
// analytics vendors or remote APIs are contacted.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../../..');
const html = `<!doctype html><html><head><meta charset="utf-8">
<title>Cookie consent regression check</title>
<link rel="stylesheet" href="/consent.css">
<style>body{font:18px system-ui;margin:32px;background:#f8fafc;color:#172033}button{font:inherit;padding:10px;margin:6px}pre{white-space:pre-wrap;padding:16px;background:white;border:1px solid #ccd3dd}footer{margin-top:32px}</style>
<script>
window.__REAL_AUTH_READY=false;
window.JHA_CONFIG={GA_ID:'',CLARITY_ID:''};
window.FirebaseAuthManager={getCurrentUser:()=>null};
window.fixturePosts=0;
window.fetch=async(url,options={})=>{
  if(url!=='/api/cookie-consent')throw new Error('Fixture blocked unexpected request');
  if(options.method==='POST'){
    window.fixturePosts++;
    localStorage.setItem('fixture-server-consent',JSON.stringify(JSON.parse(options.body).consent));
    return {ok:true,json:async()=>({ok:true})};
  }
  return {ok:true,json:async()=>({ok:true,consent:JSON.parse(localStorage.getItem('fixture-server-consent')||'null')})};
};
function restoreAuth(){window.__REAL_AUTH_READY=true;document.dispatchEvent(new CustomEvent('firebase-auth-ready'));}
function resetVisit(){
  for(const key of ['jha_cookie_consent_v1','jha_cookie_consent_pending_v1','fixture-server-consent'])localStorage.removeItem(key);
  location.reload();
}
document.addEventListener('DOMContentLoaded',()=>{
  setTimeout(restoreAuth,250);
  setInterval(()=>{
    const saved=localStorage.getItem('jha_cookie_consent_v1');
    const server=localStorage.getItem('fixture-server-consent');
    const text='Sign-in restored: '+window.__REAL_AUTH_READY+'\\nCookie banners: '+document.querySelectorAll('#jha-cookie-banner').length+'\\nOpen preferences dialogs: '+document.querySelectorAll('#jha-cookie-modal.active').length+'\\nSaved browser choice: '+(saved||'none')+'\\nSaved account choice: '+(server||'none')+'\\nConsent saves this visit: '+window.fixturePosts;
    if(document.getElementById('status').textContent!==text)document.getElementById('status').textContent=text;
  },100);
});
</script>
<script src="/cookie-consent.js" defer></script>
<script type="module" src="/firebase-auth.js"></script>
</head><body><h1>Cookie consent regression check</h1>
<p>Local test of delayed sign-in. Expected: one banner, working buttons, no banner after saving or reloading a saved choice.</p>
<button onclick="resetVisit()">New undecided visit</button>
<button onclick="restoreAuth()">Repeat sign-in event</button>
<button onclick="location.reload()">Reload saved visit</button>
<pre id="status" aria-live="polite">Waiting for sign-in...</pre>
<footer><button id="open-cookie-preferences">Cookie Preferences</button></footer>
</body></html>`;
const server = http.createServer((req, res) => {
  const route = new URL(req.url, 'http://127.0.0.1').pathname;
  res.setHeader('Cache-Control', 'no-store');
  if (route === '/') {res.setHeader('Content-Type','text/html');return res.end(html);}
  if (route === '/firebase-auth.js') {res.setHeader('Content-Type','text/javascript');return res.end('// Synthetic auth is restored by the visible fixture.');}
  const files = {'/cookie-consent.js': ['js/cookie-consent.js','text/javascript'], '/consent.css':['marketing/css/cookie-consent.css','text/css']};
  if (!files[route]) {res.writeHead(404);return res.end('Not found');}
  res.setHeader('Content-Type',files[route][1]);
  res.end(fs.readFileSync(path.join(root,files[route][0])));
});
server.listen(8771,'127.0.0.1',()=>console.log('Cookie fixture: http://127.0.0.1:8771'));
