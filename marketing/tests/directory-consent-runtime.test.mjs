// Exercise the actual browser consent module without sending vendor traffic.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
const source = readFileSync(new URL('../directory/consent.js', import.meta.url), 'utf8');
const GA = 'G-SQYSWPFM5X';
function harness({host = 'app.jobhackai.io', consent = true, config, pendingServer = false, pendingPost = false, search = '', cookies = new Map(), store = new Map(), scopedCookies = null, footerPreferences = false, accountAuthPage = false} = {}) {
  const scripts = [], insertedScripts = [], appendedElements = [], elements = new Map(), timers = [], requests = [], listeners = {};
  if (consent !== null) store.set('jha_cookie_consent_v1', JSON.stringify({version:1,analytics: consent}));
  function element(tag = 'div') {
    return { tagName: tag, style: {}, innerHTML: '', classList: {add(){},remove(){},contains(){return false;}},
      setAttribute(k,v){this[k]=v;}, getAttribute(k){return this[k];}, events:{}, addEventListener(type,fn){this.events[type]=fn;}, focus(){},
      remove(){ const i = scripts.indexOf(this); if(i >= 0) scripts.splice(i,1); },
      querySelector(){return element();}, parentNode: {insertBefore(e){scripts.push(e);insertedScripts.push(e);}} };
  }
  const node = id => { if(!elements.has(id)) elements.set(id, element()); return elements.get(id); };
  const document = {
    readyState: 'loading', title: 'JobHackAI', referrer: 'https://example.com/?email=private@example.com', cookie: '',
    createElement: element, getElementById: id => footerPreferences && id === 'open-cookie-preferences' ? (elements.get(id) || null) : node(id),
    head: {appendChild(e){scripts.push(e);insertedScripts.push(e);}}, body: {style:{},appendChild(e){appendedElements.push(e);}},
    addEventListener(type,fn){listeners[type]=fn;},
    querySelector(selector){ if(accountAuthPage && selector === 'script[type="module"][src*="firebase-auth.js"]')return {}; if(footerPreferences && selector === 'footer') return {appendChild(e){appendedElements.push(e);elements.set(e.id,e);}}; return this.querySelectorAll(selector)[0] || null; },
    querySelectorAll(selector){const needle=selector.match(/src\*="([^"]+)"/)?.[1]; return needle ? scripts.filter(s => (s.src||'').includes(needle)) : [];},
    getElementsByTagName(){return [element('script')];}
  };
  Object.defineProperty(document, 'cookie', {
    get(){if(scopedCookies)return scopedCookies.read(host);return [...cookies].map(([k,v])=>k+'='+v).join('; ');},
    set(value){if(scopedCookies){scopedCookies.write(host,value);return;}const [pair,...attrs]=value.split(';');const pos=pair.indexOf('=');const key=pair.slice(0,pos),val=pair.slice(pos+1);
      if(attrs.some(a=>a.trim()==='Max-Age=0'))cookies.delete(key);else cookies.set(key,val);}
  });
  let resolveServer;
  const server = new Promise(r => {resolveServer=r;});
  let resolvePost;const post = new Promise(r => {resolvePost=r;});
  const ctx = { document, location: { hostname:host, protocol:'https:', href:'https://'+host+'/login'+search, pathname:'/login', search },
    __REAL_AUTH_READY: !accountAuthPage,
    JHA_CONFIG: config, URL, CustomEvent: class {constructor(type){this.type=type;}}, HTMLScriptElement: class {},
    localStorage:{getItem:k=>store.get(k)??null,setItem:(k,v)=>store.set(k,v),removeItem:k=>store.delete(k)},
    setTimeout:fn=>{timers.push(fn);return timers.length;}, performance:{now:()=>0},
    dispatchEvent(){}, console:{log(){},warn(){}},
    fetch:async(url,options)=>{requests.push({url,options}); if(options.method==='GET'&&pendingServer)return server; if(options.method==='POST'&&pendingPost)return post; return {ok:true,json:async()=>({ok:true})};}
  };
  ctx.window=ctx;
  vm.createContext(ctx); vm.runInContext(source,ctx);
  return {ctx, scripts, insertedScripts, appendedElements, requests, node, cookies, store,
    init:()=>listeners.DOMContentLoaded(),
    authReady(user){ctx.__REAL_AUTH_READY=true;ctx.FirebaseAuthManager={getCurrentUser:()=>user};return listeners['firebase-auth-ready']?.();},
    finishPost:()=>resolvePost({ok:true,json:async()=>({ok:true})}),
    finishServer:analytics=>resolveServer({ok:true,json:async()=>({ok:true,consent:analytics===null?null:{version:1,analytics}, ...(analytics===null?{resetConsent:true}:{})})}),
    runTimers(){while(timers.length)timers.shift()();},
    events:name=>(ctx.dataLayer||[]).filter(a=>a[0]==='event'&&a[1]===name),
    setConsent(analytics){ctx.JHA.cookieConsent.openPreferences();node('jha-toggle-analytics').checked=analytics;node('jha-save-preferences').onclick();}
  };
}
test('account pages wait for restored authentication and the server consent decision',async()=>{
  const h=harness({accountAuthPage:true,consent:true,pendingServer:true});
  const startup=h.init();await Promise.resolve();await Promise.resolve();h.runTimers();
  assert.equal(h.requests.length,0);assert.equal(h.scripts.length,0);
  await startup;
  assert.equal(h.ctx.JHA.cookieConsent.hasAnalyticsConsent(),false);
  const resume=h.authReady({getIdToken:async()=>'fixture-auth-token'});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(h.requests[0].options.headers.Authorization,'Bearer fixture-auth-token');
  assert.equal(h.scripts.length,0);
  h.finishServer(false);await resume;h.runTimers();
  assert.equal(h.scripts.length,0);assert.equal(h.ctx.JHA.cookieConsent.hasAnalyticsConsent(),false);
});
for(const analytics of [false,true])test('early account-page choice stays pending until identity is ready: '+analytics,async()=>{
  const h=harness({accountAuthPage:true,consent:true});await h.init();
  h.setConsent(analytics);await Promise.resolve();await Promise.resolve();
  assert.equal(h.requests.length,0);assert.equal(h.scripts.length,0);
  await h.authReady({getIdToken:async()=>'fixture-auth-token'});h.runTimers();
  assert.ok(h.requests.some(r=>r.options.method==='POST'&&r.options.headers.Authorization==='Bearer fixture-auth-token'));
  assert.equal(h.store.has('jha_cookie_consent_pending_v1'),false);
  assert.equal(h.ctx.JHA.cookieConsent.hasAnalyticsConsent(),analytics);
});
test('an unavailable authenticated consent read cannot load a cached browser grant',async()=>{
  const h=harness({accountAuthPage:true,consent:true});await h.init();
  h.ctx.fetch=async()=>({ok:false,status:503});
  await h.authReady({getIdToken:async()=>'fixture-auth-token'});h.runTimers();
  assert.equal(h.scripts.length,0);assert.equal(h.ctx.JHA.cookieConsent.hasAnalyticsConsent(),false);
});
test('confirmed signed-out account pages can use browser consent without a token',async()=>{
  const h=harness({host:'qa.jobhackai.io',accountAuthPage:true,consent:true});await h.init();
  await h.authReady(null);h.runTimers();
  assert.equal(h.requests[0].options.headers.Authorization,undefined);
  assert.equal(h.scripts.length,1);
});
for (const [host, policy] of [['jobhackai.io','https://app.jobhackai.io/cookies'],['app.jobhackai.io','/cookies'],['qa.jobhackai.io','https://qa.jobhackai.io/cookies'],['develop.jobhackai-app-marketing-seo.pages.dev','https://qa.jobhackai.io/cookies'],['abc.pages.dev','https://dev.jobhackai.io/cookies']]) {
  test(host+' cookie policy link uses the matching app without changing consent API routing', async()=>{
    const h=harness({host,consent:null}); await h.init();
    const banner=h.appendedElements.find(e=>e.id==='jha-cookie-banner');
    assert.ok(banner.innerHTML.includes(`href="${policy}"`));
    if(host!=='jobhackai.io') assert.equal(h.requests[0].url,'/api/cookie-consent');
  });
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
  assert.equal(config[2].debug_mode,true);assert.equal(config[2].cookie_domain,'jobhackai.io');assert.equal(config[2].cookie_prefix,'jha_qa');
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

test('Clarity receives analytics-only consent before loading, never advertising consent',async()=>{
  const h=harness({config:{GA_ID:'',CLARITY_ID:'test-project'}});await h.init();
  assert.equal(h.insertedScripts.length,1);
  const command=h.ctx.clarity.q[0];
  assert.equal(command[0],'consentv2');assert.equal(command[1].analytics_Storage,'granted');assert.equal(command[1].ad_Storage,'denied');
});
test('withdrawal stops loaded Clarity without calling its restart-triggering denial API',async()=>{
  const h=harness({config:{GA_ID:'',CLARITY_ID:'test-project'}});await h.init();
  const calls=[];let active=true;let restarts=0;
  // Mirror the relevant SDK lifecycle: denial while active schedules a
  // restart; stop replaces the dispatcher with a queue.
  h.ctx.clarity=(...args)=>{
    calls.push(args);
    if(args[0]==='consentv2' && args[1].analytics_Storage==='denied' && active) restarts++;
    if(args[0]==='stop') {
      active=false;
      h.ctx.clarity=function(...entry){(h.ctx.clarity.q ||= []).push(entry);};
    }
  };
  h.cookies.set('_clck','test-user');h.cookies.set('_clsk','test-session');
  h.setConsent(false);
  assert.deepEqual(calls,[['stop']]);assert.equal(active,false);assert.equal(restarts,0);
  assert.equal(h.cookies.has('_clck'),false);assert.equal(h.cookies.has('_clsk'),false);
  h.setConsent(true);h.ctx.JHA.clarityIdentifySafe('must-not-queue');
  assert.equal(active,false);assert.equal(h.ctx.clarity.q?.length||0,0);
  assert.equal(h.insertedScripts.length,1);
});
test('withdrawal then regrant during download preserves the stop and drops old identity',async()=>{
  const h=harness({config:{GA_ID:'',CLARITY_ID:'test-project'}});await h.init();
  h.ctx.JHA.clarityIdentifySafe('old-identity');h.setConsent(false);h.setConsent(true);
  assert.deepEqual(Array.from(h.ctx.clarity.q,call=>call[0]),['stop']);
  h.ctx.JHA.clarityIdentifySafe('new-identity');
  assert.ok(!h.ctx.clarity.q.some(call=>call[0]==='identify'));
  const calls=[];h.ctx.clarity=(...args)=>calls.push(args);h.scripts[0].onload();
  assert.deepEqual(calls,[['stop']]);assert.equal(h.insertedScripts.length,1);
});
test('failed Clarity tag retries after a new grant without restoring stale identity',async()=>{
  const h=harness({config:{GA_ID:'',CLARITY_ID:'test-project'}});await h.init();
  h.ctx.JHA.clarityIdentifySafe('old-identity');const failed=h.scripts[0];failed.onerror();
  h.setConsent(false);h.setConsent(true);
  assert.equal(h.scripts.length,1);assert.notEqual(h.scripts[0],failed);
  assert.equal(h.insertedScripts.length,2);
  assert.deepEqual(Array.from(h.ctx.clarity.q,call=>call[0]),['consentv2']);
  assert.equal(h.ctx.clarity.q[0][1].analytics_Storage,'granted');
  assert.equal(h.ctx.clarity.q[0][1].ad_Storage,'denied');
});
test('a failed tag cannot replace a runtime that has already taken over',async()=>{
  const h=harness({config:{GA_ID:'',CLARITY_ID:'test-project'}});await h.init();
  const calls=[];const runtime=(...args)=>calls.push(args);h.ctx.clarity=runtime;
  h.scripts[0].onerror();h.setConsent(false);h.setConsent(true);
  assert.equal(h.ctx.clarity,runtime);assert.equal(h.insertedScripts.length,1);
  assert.deepEqual(calls,[['stop']]);
});
test('directory has no default session replay on either production or QA',async()=>{
 for(const host of ['jobhackai.io','directory-qa.jobhackai-app-marketing-seo.pages.dev']){
 const h=harness({host});await h.init();h.runTimers();assert.equal(h.scripts.some(s=>s.src.includes('clarity.ms')),false);
 }
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

test('legacy cached consent without a server record is undecided so visitors can choose again',async()=>{
  for(const value of [{analytics:true},{version:2,analytics:true},{version:1,analytics:'true'},[]]){
    const h=harness();h.store.set('jha_cookie_consent_v1',JSON.stringify(value));await h.init();
    assert.equal(h.ctx.JHA.cookieConsent.hasConsent(),false);
    assert.equal(h.ctx.JHA.cookieConsent.hasAnalyticsConsent(),null);
    assert.equal(h.scripts.length,0);
  }
});

test('privacy button works before a stalled consent read and a late grant cannot undo rejection',async()=>{
  const h=harness({pendingServer:true});const init=h.init();
  assert.equal(typeof h.node('open-cookie-preferences').events.click,'function');
  h.node('open-cookie-preferences').events.click();
  assert.ok(h.appendedElements.some(e=>e.id==='jha-cookie-modal'));
  h.node('jha-toggle-analytics').checked=false;h.node('jha-save-preferences').onclick();
  assert.equal(h.ctx.JHA.cookieConsent.hasAnalyticsConsent(),false);
  h.finishServer(true);await init;
  assert.equal(h.ctx.JHA.cookieConsent.hasAnalyticsConsent(),false);
  assert.equal(h.scripts.length,0);
});
test('privacy button works while an old pending grant is still being saved',async()=>{
  const store=new Map([['jha_cookie_consent_pending_v1',JSON.stringify({version:1,analytics:true})]]);
  const h=harness({store,pendingPost:true});const init=h.init();
  h.node('open-cookie-preferences').events.click();
  assert.ok(h.appendedElements.some(e=>e.id==='jha-cookie-modal'));
  h.node('jha-toggle-analytics').checked=false;h.node('jha-save-preferences').onclick();
  assert.equal(h.ctx.JHA.cookieConsent.hasAnalyticsConsent(),false);
  h.finishPost();await init;
  assert.equal(h.ctx.JHA.cookieConsent.hasAnalyticsConsent(),false);
  assert.equal(h.scripts.length,0);
});

test('QA marketing uses the QA API and tag while preserving production cookies',async()=>{
  const cookies=new Map([['jha_client_id','7bbba230-b755-4d31-b475-e20cf6d00ed9'],['jha_campaign_prod','production-campaign']]);
  const h=harness({host:'qa-marketing.jobhackai.io',cookies,search:'?utm_source=linkedin&utm_medium=organic_social&utm_campaign=qa_voice'});
  await h.init();h.runTimers();
  assert.equal(h.ctx.JHA.apiBase,'https://qa.jobhackai.io');
  assert.equal(h.requests[0].url,'https://qa.jobhackai.io/api/cookie-consent');
  assert.equal(cookies.get('jha_client_id'),'7bbba230-b755-4d31-b475-e20cf6d00ed9');
  assert.equal(cookies.get('jha_campaign_prod'),'production-campaign');
  assert.notEqual(cookies.get('jha_client_id_qa'),cookies.get('jha_client_id'));
  assert.ok(cookies.has('jha_client_id_qa'));assert.ok(cookies.has('jha_campaign_qa_v2'));
  const config=h.ctx.dataLayer.find(a=>a[0]==='config');
  assert.equal(config[1],'G-VH888WWY3M');assert.equal(config[2].cookie_prefix,'jha_qa');
  assert.deepEqual(Array.from(config[2].linker.domains),['qa.jobhackai.io','qa-marketing.jobhackai.io','directory-qa.jobhackai-app-marketing-seo.pages.dev']);
  assert.ok(!h.scripts.some(s=>s.src.includes(GA)));
});
test('QA app preserves an external campaign across a marketing handoff and internal tags',async()=>{
  const cookies=new Map();
  const marketing=harness({host:'qa-marketing.jobhackai.io',cookies,search:'?utm_source=linkedin&utm_medium=organic_social&utm_campaign=qa_voice&utm_content=article_01'});
  await marketing.init();marketing.runTimers();
  const original=cookies.get('jha_campaign_qa_v2'),identity=cookies.get('jha_client_id_qa');
  const app=harness({host:'qa.jobhackai.io',cookies,search:'?utm_source=internal&utm_medium=internal&utm_campaign=wrong'});
  app.ctx.document.referrer='https://qa-marketing.jobhackai.io/';
  await app.init();app.runTimers();
  assert.equal(cookies.get('jha_campaign_qa_v2'),original);assert.equal(cookies.get('jha_client_id_qa'),identity);
  app.setConsent(false);app.runTimers();
  assert.equal(cookies.has('jha_campaign_qa_v2'),false);
});

test('old QA host and domain campaigns are retired and cannot return after rejection',async()=>{
  const old=encodeURIComponent(JSON.stringify({first:{at:Date.now()-1000,source:'old',medium:'email',campaign:'stale'},last:{at:Date.now()-1000,source:'old',medium:'email',campaign:'stale'}}));
  const records=new Map([['qa.jobhackai.io|jha_campaign_qa',old],['jobhackai.io|jha_campaign_qa',old],['jobhackai.io|jha_campaign_prod','production']]);
  const scopedCookies={
    read(host){return [...records].filter(([k])=>{const domain=k.split('|')[0];return host===domain||host.endsWith('.'+domain);}).map(([k,v])=>k.split('|')[1]+'='+v).join('; ');},
    write(host,value){const [pair,...attrs]=value.split(';');const pos=pair.indexOf('=');const domain=attrs.find(a=>a.trim().startsWith('Domain='))?.trim().slice(7).replace(/^\./,'')||host;
      const key=domain+'|'+pair.slice(0,pos);if(attrs.some(a=>a.trim()==='Max-Age=0'))records.delete(key);else records.set(key,pair.slice(pos+1));}
  };
  const app=harness({host:'qa.jobhackai.io',scopedCookies});await app.init();app.runTimers();
  assert.equal(records.has('qa.jobhackai.io|jha_campaign_qa'),false);assert.equal(records.has('jobhackai.io|jha_campaign_qa'),false);
  const marketing=harness({host:'qa-marketing.jobhackai.io',scopedCookies,search:'?utm_source=linkedin&utm_medium=organic_social&utm_campaign=new_qa'});
  await marketing.init();marketing.runTimers();
  assert.ok(records.get('jobhackai.io|jha_campaign_qa_v2').includes('new_qa'));
  app.setConsent(false);app.runTimers();app.setConsent(true);app.runTimers();
  assert.equal(records.has('jobhackai.io|jha_campaign_qa_v2'),false);
  assert.equal(records.get('jobhackai.io|jha_campaign_prod'),'production');
});

test('marketing footer reopens its own consent controls after a prior rejection', async()=>{
  const h=harness({host:'qa-marketing.jobhackai.io',consent:false,footerPreferences:true,search:'?utm_source=linkedin&utm_medium=organic_social&utm_campaign=qa_voice'});
  await h.init();h.runTimers();
  const button=h.node('open-cookie-preferences');
  assert.equal(button.tagName,'button');assert.equal(button.type,'button');
  assert.equal(button.textContent,'Cookie Preferences');assert.equal(h.scripts.length,0);
  button.events.click();assert.equal(h.node('jha-toggle-analytics').checked,false);
  h.node('jha-toggle-analytics').checked=true;h.node('jha-save-preferences').onclick();h.runTimers();
  assert.equal(h.ctx.JHA.cookieConsent.hasAnalyticsConsent(),true);
  assert.ok(h.cookies.has('jha_campaign_qa_v2'));
  assert.ok(h.scripts.some(s=>s.src.includes('G-VH888WWY3M')));
  button.events.click();h.node('jha-toggle-analytics').checked=false;h.node('jha-save-preferences').onclick();
  assert.equal(h.cookies.has('jha_campaign_qa_v2'),false);
});
