// Exercise the actual browser consent module without sending vendor traffic.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
const source = readFileSync(new URL('../../../../js/cookie-consent.js', import.meta.url), 'utf8');
const GA = 'G-SQYSWPFM5X';
function harness({host = 'app.jobhackai.io', consent = true, config, pendingServer = false, search = ''} = {}) {
  const scripts = [], elements = new Map(), timers = [], requests = [], listeners = {};
  const store = new Map();
  if (consent !== null) store.set('jha_cookie_consent_v1', JSON.stringify({analytics: consent}));
  function element(tag = 'div') {
    return { tagName: tag, style: {}, innerHTML: '', classList: {add(){},remove(){},contains(){return false;}},
      setAttribute(k,v){this[k]=v;}, getAttribute(k){return this[k];}, addEventListener(){}, focus(){},
      remove(){ const i = scripts.indexOf(this); if(i >= 0) scripts.splice(i,1); },
      querySelector(){return element();}, parentNode: {insertBefore(e){scripts.push(e);}} };
  }
  const node = id => { if(!elements.has(id)) elements.set(id, element()); return elements.get(id); };
  const document = {
    readyState: 'loading', title: 'JobHackAI', referrer: 'https://example.com/?email=private@example.com', cookie: '',
    createElement: element, getElementById: node,
    head: {appendChild(e){scripts.push(e);}}, body: {style:{},appendChild(){}},
    addEventListener(type,fn){listeners[type]=fn;},
    querySelector(selector){ return this.querySelectorAll(selector)[0] || null; },
    querySelectorAll(selector){const needle=selector.match(/src\*="([^"]+)"/)?.[1]; return needle ? scripts.filter(s => (s.src||'').includes(needle)) : [];},
    getElementsByTagName(){return [element('script')];}
  };
  let resolveServer;
  const server = new Promise(r => {resolveServer=r;});
  const ctx = { document, location: { hostname:host, protocol:'https:', href:'https://'+host+'/login'+search, pathname:'/login', search },
    JHA_CONFIG: config, URL, CustomEvent: class {constructor(type){this.type=type;}}, HTMLScriptElement: class {},
    localStorage:{getItem:k=>store.get(k)??null,setItem:(k,v)=>store.set(k,v)},
    setTimeout:fn=>{timers.push(fn);return timers.length;}, performance:{now:()=>0},
    dispatchEvent(){}, console:{log(){},warn(){}},
    fetch:async(url,options)=>{requests.push({url,options}); if(options.method==='GET'&&pendingServer)return server; return {ok:true,json:async()=>({ok:true})};}
  };
  ctx.window=ctx;
  vm.createContext(ctx); vm.runInContext(source,ctx);
  return {ctx, scripts, requests, node,
    init:()=>listeners.DOMContentLoaded(),
    finishServer:analytics=>resolveServer({ok:true,json:async()=>({ok:true,consent:{analytics}})}),
    runTimers(){while(timers.length)timers.shift()();},
    events:name=>(ctx.dataLayer||[]).filter(a=>a[0]==='event'&&a[1]===name),
    setConsent(analytics){ctx.JHA.cookieConsent.openPreferences();node('jha-toggle-analytics').checked=analytics;node('jha-save-preferences').onclick();}
  };
}
for (const host of ['dev.jobhackai.io','localhost','127.0.0.1','abc.pages.dev','notjobhackai.io']) {
  test(host+' never defaults to production analytics or production consent writes',async()=>{
    const h=harness({host}); await h.init();h.runTimers();
    h.ctx.JHA.trackEventSafe('sign_up',{method:'email'});
    assert.equal(h.scripts.length,0);
    assert.equal(h.events('sign_up').length,0);
    assert.equal(h.ctx['ga-disable-'+GA],true);
    assert.equal(h.requests[0].url,'/api/cookie-consent');
  });
}
test('QA uses only the verified development property and enables DebugView',async()=>{
  const h=harness({host:'qa.jobhackai.io'});await h.init();h.runTimers();
  assert.equal(h.scripts.length,1);assert.ok(h.scripts[0].src.includes('G-VH888WWY3M'));
  assert.equal(h.ctx['ga-disable-'+GA],true);
  const config=h.ctx.dataLayer.find(a=>a[0]==='config');
  assert.equal(config[2].debug_mode,true);assert.equal(config[2].cookie_domain,'qa.jobhackai.io');
});
test('an explicit separate test destination is supported; copied production IDs are blocked',async()=>{
  const blocked=harness({host:'qa.jobhackai.io',config:{GA_ID:GA,CLARITY_ID:'wskzma4clw'}});
  await blocked.init();blocked.runTimers();assert.equal(blocked.scripts.length,0);
  const separate=harness({host:'qa.jobhackai.io',config:{GA_ID:'G-TEST123'}});
  await separate.init();separate.runTimers();
  assert.equal(separate.scripts.length,1);assert.ok(separate.scripts[0].src.includes('G-TEST123'));
  assert.equal(separate.events('page_view').length,1);
});
test('explicitly empty destination disables production tracking',async()=>{
  const h=harness({config:{GA_ID:'',CLARITY_ID:''}});await h.init();h.runTimers();assert.equal(h.scripts.length,0);
});
test('denied consent sends no analytics and rejecting clears predecision events',async()=>{
  const h=harness({consent:null});h.ctx.JHA.trackEventSafe('sign_up',{method:'email'});
  await h.init();h.node('jha-reject-all').onclick();h.runTimers();
  assert.equal(h.scripts.length,0);assert.equal(h.events('sign_up').length,0);
  h.setConsent(true);h.runTimers();assert.equal(h.events('sign_up').length,0);
});
for (const timing of ['before-init','after-init','after-fallback']) {
  test('one page_view when app tracking arrives '+timing,async()=>{
    const h=harness();
    const view=()=>h.ctx.JHA.gtagSafe('event','page_view',{page_location:h.ctx.location.href});
    if(timing==='before-init')view();await h.init();
    if(timing==='after-init')view();h.runTimers();
    if(timing==='after-fallback')view();
    assert.equal(h.events('page_view').length,1);
    h.setConsent(false);const before=h.ctx.dataLayer.length;
    assert.equal(h.ctx['ga-disable-'+GA],true);
    h.ctx.gtag('event','blocked_direct_call',{});h.ctx.JHA.trackEventSafe('blocked_helper',{});
    assert.equal(h.ctx.dataLayer.length,before);
    h.setConsent(true);h.runTimers();assert.equal(h.events('page_view').length,1);
    h.ctx.JHA.trackEventSafe('allowed_again',{});assert.equal(h.events('allowed_again').length,1);
  });
}
test('older server consent cannot override a new local rejection',async()=>{
  const h=harness({consent:true,pendingServer:true});const init=h.init();
  h.setConsent(false);h.finishServer(true);await init;h.runTimers();
  assert.equal(h.ctx.JHA.cookieConsent.hasAnalyticsConsent(),false);assert.equal(h.scripts.length,0);
});
test('authentication/checkout parameters never enter page URLs sent to GA',async()=>{
  const h=harness({search:'?oobCode=secret&email=person@example.com&session_id=cs_private&utm_source=linkedin&utm_campaign=voice_beta_2026_09'});
  await h.init();h.runTimers();
  const params=h.events('page_view')[0][2];
  assert.equal(params.page_path,'/login');
  assert.equal(params.page_location,'https://app.jobhackai.io/login?utm_source=linkedin&utm_campaign=voice_beta_2026_09');
  const config=h.ctx.dataLayer.find(a=>a[0]==='config')[2];
  assert.equal(config.page_referrer,'https://example.com/');
  assert.ok(!JSON.stringify(h.ctx.dataLayer).includes('secret'));
});
