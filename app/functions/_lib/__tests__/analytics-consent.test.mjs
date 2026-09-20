// Exercise the actual browser consent module without sending vendor traffic.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
const source = readFileSync(new URL('../../../../js/cookie-consent.js', import.meta.url), 'utf8');
const GA = 'G-SQYSWPFM5X';
function harness({host = 'app.jobhackai.io', consent = true, config, pendingServer = false, search = '', cookies = new Map(), store = new Map()} = {}) {
  const scripts = [], insertedScripts = [], elements = new Map(), timers = [], requests = [], listeners = {};
  if (consent !== null) store.set('jha_cookie_consent_v1', JSON.stringify({version:1,analytics: consent}));
  function element(tag = 'div') {
    return { tagName: tag, style: {}, innerHTML: '', classList: {add(){},remove(){},contains(){return false;}},
      setAttribute(k,v){this[k]=v;}, getAttribute(k){return this[k];}, addEventListener(){}, focus(){},
      remove(){ const i = scripts.indexOf(this); if(i >= 0) scripts.splice(i,1); },
      querySelector(){return element();}, parentNode: {insertBefore(e){scripts.push(e);insertedScripts.push(e);}} };
  }
  const node = id => { if(!elements.has(id)) elements.set(id, element()); return elements.get(id); };
  const document = {
    readyState: 'loading', title: 'JobHackAI', referrer: 'https://example.com/?email=private@example.com', cookie: '',
    createElement: element, getElementById: node,
    head: {appendChild(e){scripts.push(e);insertedScripts.push(e);}}, body: {style:{},appendChild(){}},
    addEventListener(type,fn){listeners[type]=fn;},
    querySelector(selector){ return this.querySelectorAll(selector)[0] || null; },
    querySelectorAll(selector){const needle=selector.match(/src\*="([^"]+)"/)?.[1]; return needle ? scripts.filter(s => (s.src||'').includes(needle)) : [];},
    getElementsByTagName(){return [element('script')];}
  };
  Object.defineProperty(document, 'cookie', {
    get(){return [...cookies].map(([k,v])=>k+'='+v).join('; ');},
    set(value){const [pair,...attrs]=value.split(';');const pos=pair.indexOf('=');const key=pair.slice(0,pos),val=pair.slice(pos+1);
      if(attrs.some(a=>a.trim()==='Max-Age=0'))cookies.delete(key);else cookies.set(key,val);}
  });
  let resolveServer;
  const server = new Promise(r => {resolveServer=r;});
  const ctx = { document, location: { hostname:host, protocol:'https:', href:'https://'+host+'/login'+search, pathname:'/login', search },
    JHA_CONFIG: config, URL, CustomEvent: class {constructor(type){this.type=type;}}, HTMLScriptElement: class {},
    localStorage:{getItem:k=>store.get(k)??null,setItem:(k,v)=>store.set(k,v),removeItem:k=>store.delete(k)},
    setTimeout:fn=>{timers.push(fn);return timers.length;}, performance:{now:()=>0},
    dispatchEvent(){}, console:{log(){},warn(){}},
    fetch:async(url,options)=>{requests.push({url,options}); if(options.method==='GET'&&pendingServer)return server; return {ok:true,json:async()=>({ok:true})};}
  };
  ctx.window=ctx;
  vm.createContext(ctx); vm.runInContext(source,ctx);
  return {ctx, scripts, insertedScripts, requests, node, cookies, store,
    init:()=>listeners.DOMContentLoaded(),
    finishServer:analytics=>resolveServer({ok:true,json:async()=>({ok:true,consent:analytics===null?null:{version:1,analytics}, ...(analytics===null?{resetConsent:true}:{})})}),
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
  assert.equal(Object.prototype.toString.call(h.ctx.dataLayer[0]), '[object Arguments]');
  const config=h.ctx.dataLayer.find(a=>a[0]==='config')[2];
  assert.equal(config.page_referrer,'https://example.com/');
  assert.equal('debug_mode' in config,false,'production must omit the debug parameter entirely');
  assert.ok(!JSON.stringify(h.ctx.dataLayer).includes('secret'));
});

test('revoking and regranting reuse the same GA runtime and configuration',async()=>{
  const h=harness({config:{CLARITY_ID:''}});await h.init();h.runTimers();
  const script=h.scripts[0], gtag=h.ctx.gtag;
  for(let i=0;i<3;i++) {
    h.setConsent(false);
    assert.equal(h.ctx['ga-disable-'+GA],true);
    h.setConsent(true);h.runTimers();
    assert.equal(h.ctx['ga-disable-'+GA],false);
    assert.equal(h.scripts[0],script);
    assert.equal(h.ctx.gtag,gtag);
  }
  assert.equal(h.insertedScripts.length,1,'removing a tag does not unload its runtime');
  assert.equal(h.ctx.dataLayer.filter(a=>a[0]==='config').length,1);
  assert.equal(h.events('page_view').length,1);
});

for (const tokenResult of ['reject', 'empty']) {
  test('a signed-in token failure does not become anonymous consent: '+tokenResult, async () => {
    const h=harness();
    h.ctx.FirebaseAuthManager={getCurrentUser:()=>({getIdToken:async()=>{if(tokenResult==='reject')throw new Error('expired');return null;}})};
    await h.init();
    h.setConsent(false);
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(h.requests.length,0);
    assert.equal(h.ctx.JHA.cookieConsent.hasAnalyticsConsent(),false);
    assert.equal(h.ctx['ga-disable-'+GA],true);
  });
}

test('an explicit invalid server decision clears a stale browser grant',async()=>{
  const h=harness({pendingServer:true,consent:true});const pending=h.init();h.finishServer(null);await pending;h.runTimers();
  assert.equal(h.ctx.JHA.cookieConsent.hasAnalyticsConsent(),null);assert.equal(h.scripts.length,0);assert.equal(h.ctx.JHA.cookieConsent.hasConsent(),false);
});
test('resetting invalid server consent discards queued events and identity before a later grant',async()=>{
  const h=harness({pendingServer:true,consent:true});
  const pending=h.init();
  h.ctx.JHA.gtagSafe('event','stale_grant_event',{});
  h.ctx.JHA.clarityIdentifySafe('stale_identity');
  h.finishServer(null);await pending;h.runTimers();
  assert.equal(h.ctx['ga-disable-'+GA],true);
  h.setConsent(true);h.runTimers();
  assert.equal(h.events('stale_grant_event').length,0);
  assert.ok(!(h.ctx.clarity?.q||[]).some(call=>call[0]==='identify'&&call[1]==='stale_identity'));
  h.ctx.JHA.gtagSafe('event','fresh_grant_event',{});
  assert.equal(h.events('fresh_grant_event').length,1);
});
test('a legacy or corrupt anonymous cookie is rotated before consent sync',async()=>{
  const h=harness();h.ctx.document.cookie='jha_client_id=legacy-corrupted-value';await h.init();h.setConsent(false);
  await new Promise(resolve=>setImmediate(resolve));
  const post=h.requests.find(r=>r.options.method==='POST');const body=JSON.parse(post.options.body);
  assert.match(body.clientId,/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.ok(h.ctx.document.cookie.includes(body.clientId));
});

const tagged = '?utm_source=linkedin&utm_medium=social&utm_campaign=voice_beta_2026_09&utm_content=answer_li_01';
const campaignValue = (h, key='jha_campaign_prod') => JSON.parse(decodeURIComponent(h.cookies.get(key)));
function gaIdentifiers(h) {
  h.ctx.gtag = (command, destination, field, callback) => {
    if(command === 'get') callback(field === 'client_id' ? '123456.1789800000' : '1789800000');
  };
}
test('campaign capture waits for consent and stores only controlled tags', async()=>{
  const h=harness({consent:null,search:tagged+'&email=private@example.com&oobCode=secret'});
  await h.init();assert.equal(h.cookies.has('jha_campaign_prod'),false);
  h.setConsent(true);const saved=campaignValue(h);
  assert.equal(saved.first.source,'linkedin');assert.equal(saved.last.asset,'answer_li_01');
  assert(!JSON.stringify(saved).includes('private'));assert(!JSON.stringify(saved).includes('secret'));
  gaIdentifiers(h);
  const context=await h.ctx.JHA.cookieConsent.getCheckoutAnalyticsContext();
  assert.equal(context.gaClientId,'123456.1789800000');assert.equal(context.gaSessionId,'1789800000');
  assert.equal(context.firstTouch.campaign,'voice_beta_2026_09');
  assert.equal(h.requests.at(-1).options.method,'POST','checkout explicitly persists the current consent');
});
test('marketing-to-app navigation preserves first and last touch despite internal UTMs', async()=>{
  const marketing=harness({host:'jobhackai.io',search:tagged});await marketing.init();
  const original=marketing.cookies.get('jha_campaign_prod');
  const app=harness({cookies:marketing.cookies,search:tagged.replace('linkedin','internal')});
  app.ctx.document.referrer='https://jobhackai.io/blog/how-to-answer-tell-me-about-yourself';
  await app.init();assert.equal(app.cookies.get('jha_campaign_prod'),original);
  gaIdentifiers(app);const context=await app.ctx.JHA.cookieConsent.getCheckoutAnalyticsContext();
  assert.equal(context.firstTouch.source,'linkedin');assert.equal(context.lastTouch.source,'linkedin');
});
test('a later external tagged visit updates last touch while retaining first touch', async()=>{
  const first=harness({search:tagged});await first.init();
  const next=harness({cookies:first.cookies,search:tagged.replace('linkedin','instagram')});await next.init();
  assert.equal(campaignValue(next).first.source,'linkedin');assert.equal(campaignValue(next).last.source,'instagram');
});
test('QA cannot inherit the production campaign cookie', async()=>{
  const prod=harness({search:tagged});await prod.init();
  const qa=harness({host:'qa.jobhackai.io',cookies:prod.cookies});await qa.init();gaIdentifiers(qa);
  const context=await qa.ctx.JHA.cookieConsent.getCheckoutAnalyticsContext();assert.equal(context.firstTouch,null);
});
test('rejection and invalid server reset delete campaign state', async()=>{
  const h=harness({search:tagged});await h.init();assert(h.cookies.has('jha_campaign_prod'));
  h.setConsent(false);assert.equal(h.cookies.has('jha_campaign_prod'),false);
  assert.equal(await h.ctx.JHA.cookieConsent.getCheckoutAnalyticsContext(),null);
  h.setConsent(true);assert(h.cookies.has('jha_campaign_prod'));
  const reset=harness({cookies:h.cookies,pendingServer:true});const pending=reset.init();reset.finishServer(null);await pending;
  assert.equal(reset.cookies.has('jha_campaign_prod'),false);
});
test('blocked GA leaves identifiers absent rather than fabricating them', async()=>{
  const h=harness({search:tagged});await h.init();
  const pending=h.ctx.JHA.cookieConsent.getCheckoutAnalyticsContext();
  await new Promise(resolve=>setImmediate(resolve));h.runTimers();const context=await pending;
  assert.equal(context.gaClientId,undefined);assert.equal(context.gaSessionId,undefined);
  assert.equal(context.firstTouch.source,'linkedin');
});
test('failed consent persistence yields no checkout attribution', async()=>{
  const h=harness({search:tagged});await h.init();gaIdentifiers(h);
  h.ctx.fetch=async()=>({ok:false,status:503});
  assert.equal(await h.ctx.JHA.cookieConsent.getCheckoutAnalyticsContext(),null);
  h.ctx.fetch=async()=>({ok:true,json:async()=>({ok:false})});
  assert.equal(await h.ctx.JHA.cookieConsent.getCheckoutAnalyticsContext(),null);
});
test('revocation while GA identifiers are pending cancels the checkout context', async()=>{
  const h=harness({search:tagged});await h.init();const callbacks=[];
  h.ctx.gtag=(command,destination,field,callback)=>{if(command==='get')callbacks.push(callback);};
  const pending=h.ctx.JHA.cookieConsent.getCheckoutAnalyticsContext();
  await new Promise(resolve=>setImmediate(resolve));h.setConsent(false);
  callbacks.forEach(callback=>callback('123.456'));
  assert.equal(await pending,null);
});
test('malformed or incomplete campaign tags and expired cookies are not attributed', async()=>{
  for(const search of ['?utm_source=linkedin',tagged.replace('answer_li_01','person@example.com')]){
    const h=harness({search});await h.init();assert.equal(h.cookies.has('jha_campaign_prod'),false);
  }
  const expired={at:Date.now()-91*86400000,source:'linkedin',medium:'social',campaign:'expired'};
  const h=harness({cookies:new Map([['jha_campaign_prod',encodeURIComponent(JSON.stringify({first:expired,last:expired}))]])});
  await h.init();gaIdentifiers(h);assert.equal((await h.ctx.JHA.cookieConsent.getCheckoutAnalyticsContext()).firstTouch,null);
});
test('unsupported local consent versions cannot grant Analytics or campaign capture', async()=>{
  const h=harness({search:tagged});
  h.ctx.localStorage.setItem('jha_cookie_consent_v1',JSON.stringify({version:0,analytics:true}));
  await h.init();assert.equal(h.scripts.length,0);assert.equal(h.cookies.has('jha_campaign_prod'),false);
});

test('failed rejection survives a reload and does not inherit the older server grant',async()=>{
  const h=harness();await h.init();
  h.ctx.fetch=async()=>({ok:false,status:503});h.setConsent(false);
  for(let i=0;i<20;i++)await Promise.resolve();
  assert.equal(JSON.parse(h.store.get('jha_cookie_consent_pending_v1')).analytics,false);
  const reload=harness({consent:null,store:h.store,cookies:h.cookies});
  reload.ctx.fetch=async()=>({ok:false,status:503});await reload.init();
  assert.equal(reload.ctx.JHA.cookieConsent.hasAnalyticsConsent(),false);
  assert.equal(reload.scripts.length,0);
  assert.equal(JSON.parse(reload.store.get('jha_cookie_consent_pending_v1')).analytics,false);
});
test('successful retry clears the durable pending decision',async()=>{
  const store=new Map([['jha_cookie_consent_pending_v1',JSON.stringify({version:1,analytics:false})]]);
  const h=harness({store});await h.init();
  assert.equal(h.ctx.JHA.cookieConsent.hasAnalyticsConsent(),false);
  assert.equal(store.has('jha_cookie_consent_pending_v1'),false);
  assert.equal(h.requests[0].options.method,'POST');
});
test('checkout honors account-wide withdrawal instead of posting a stale local grant',async()=>{
  const h=harness();await h.init();const calls=[];
  h.ctx.fetch=async(_url,options)=>{calls.push(options);return {ok:true,json:async()=>({ok:true,consent:{version:1,analytics:false}})};};
  assert.equal(await h.ctx.JHA.cookieConsent.getCheckoutAnalyticsContext(),null);
  assert.equal(calls.length,1);assert.equal(calls[0].method,'GET');
  assert.equal(h.ctx.JHA.cookieConsent.hasAnalyticsConsent(),false);
});
test('a valid recent last touch survives an expired first touch',async()=>{
  const h=harness();const recent={at:Date.now()-1000,source:'linkedin',medium:'organic_social',campaign:'recent'};
  h.cookies.set('jha_campaign_prod',encodeURIComponent(JSON.stringify({first:{...recent,at:Date.now()-91*86400000},last:recent})));
  await h.init();h.ctx.gtag=(_cmd,_id,_field,callback)=>callback(null);
  const context=await h.ctx.JHA.cookieConsent.getCheckoutAnalyticsContext();
  assert.equal(context.firstTouch,null);assert.equal(context.lastTouch.campaign,'recent');
});
