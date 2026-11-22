// Run: NODE_PATH=app/node_modules node --test marketing/tests/features-tour-e2e.cjs
// Real vendor serialization: FEATURES_VENDOR_MODE=real <same command>.
// Every page/app/API/collector request is intercepted. Only vendor JavaScript
// downloads are allowed in real mode; no analytics collection reaches a vendor.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const { chromium } = require(require.resolve('playwright', { paths: [path.resolve(__dirname, '../../app')] }));
const root = path.resolve(__dirname, '..');
const real = process.env.FEATURES_VENDOR_MODE === 'real';
const output = path.resolve(__dirname, '../../output/playwright');
const PROD_GA = 'G-SQYSWPFM5X', QA_GA = 'G-VH888WWY3M', PROD_CLARITY = 'wskzma4clw';
const consentKey = 'jha_cookie_consent_v1';
const campaignQuery = '?utm_source=qa_e2e&utm_medium=synthetic&utm_campaign=features_tour_validation&utm_content=features_fixture&utm_id=e2e_123';
const sensitiveQuery = '&email=private%40example.test&oobCode=fixture_secret&session_id=cs_fixture';
const evidence = { mode: real ? 'real vendor scripts; all collectors intercepted' : 'stub vendor runtimes', limitation: 'Synthetic anonymous browser and consent API. Intercepted requests do not prove receiving-account ingestion.', scenarios: [], vendorScripts: [] };
const scriptCache = new Map();
let browser;
before(async () => { fs.mkdirSync(output, { recursive: true }); browser = await chromium.launch({ headless: true }); });
after(async () => { if (browser) await browser.close(); fs.writeFileSync(path.join(output, `features-analytics-e2e-${real ? 'real' : 'stub'}.json`), JSON.stringify(evidence, null, 2)); });

const gaStub = `(() => { const q=window.dataLayer||[]; const initial=q.slice(); const push=q.push.bind(q); let id=''; const emit=a=>{const v=Array.from(a);if(v[0]==='config')id=v[1];if(v[0]==='event'&&!window['ga-disable-'+id]){const p=new URLSearchParams({v:'2',tid:id,en:v[1]});for(const[k,x]of Object.entries(v[2]||{}))if(typeof x!=='function')p.set('ep.'+k,String(x));fetch('https://www.google-analytics.com/g/collect?'+p,{method:'POST',mode:'no-cors'});}};q.push=function(a){const n=push(a);emit(a);return n};initial.forEach(emit);window.__fixtureGaLoaded=true;})();`;
const clarityStub = `(() => { const queued=(window.clarity&&window.clarity.q||[]).slice();window.__fixtureClarityCalls=[];window.clarity=function(...a){window.__fixtureClarityCalls.push(a);if(a[0]==='consentv2'&&a[1].analytics_Storage==='granted'){document.cookie='_clck=synthetic; Path=/; SameSite=Lax';document.cookie='_clsk=synthetic; Path=/; SameSite=Lax';fetch('https://l.clarity.ms/collect',{method:'POST',body:'fixture-replay-start',mode:'no-cors'});}};queued.forEach(a=>window.clarity(...a));window.__fixtureClarityLoaded=true;})();`;
const mime = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.png':'image/png', '.jpg':'image/jpeg', '.svg':'image/svg+xml', '.json':'application/json', '.woff2':'font/woff2', '.ttf':'font/ttf' };
const decision = analytics => ({ version: 1, analytics, updatedAt: new Date().toISOString() });
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, label, timeout = 10000) { const end=Date.now()+timeout; while(Date.now()<end){if(await check())return;await pause(50);}assert.fail(`Timed out: ${label}`); }

async function fixture(name, { host='jobhackai.io', serverConsent=null, localConsent, config, pendingConsent, failConsent=false, delayConsent=0, javaScriptEnabled=true, sensitive=false, user=null, historyFailure=false, nativeDialog=true }={}) {
  const record={name,host,requests:[],collections:[],blocked:[],pageErrors:[]};evidence.scenarios.push(record);
  const context=await browser.newContext({viewport:{width:1440,height:1000},javaScriptEnabled});
  await context.addInitScript(({localConsent,pendingConsent,config,consentKey,user,historyFailure,nativeDialog})=>{
    if(config)window.JHA_CONFIG=config;
    if(localConsent!==undefined)localStorage.setItem(consentKey,JSON.stringify(localConsent));
    if(pendingConsent)localStorage.setItem('jha_cookie_consent_pending_v1',JSON.stringify(pendingConsent));
    window.__REAL_AUTH_READY=true;
    if(historyFailure)history.replaceState=()=>{throw new Error('Synthetic history failure');};
    if(!nativeDialog)HTMLDialogElement.prototype.showModal=undefined;
    if(user){user.getIdToken=async()=> 'fixture-auth-token';localStorage.setItem('user-authenticated','true');localStorage.setItem('user-plan','free');}
    window.FirebaseAuthManager={getCurrentUser:()=>user,waitForAuthReady:async()=>user,isAuthenticated:()=>!!user,onAuthStateChanged:fn=>{fn(user);return()=>{};}};
    // The real delegated CTA tracker still receives the actual click. Only
    // navigation into app accounts is prevented by this test boundary.
    document.addEventListener('click',event=>{if(event.target.closest?.('[data-cta], [data-plan-id]'))event.preventDefault();},true);
  },{localConsent,pendingConsent,config,consentKey,user,historyFailure,nativeDialog});
  await context.route('**/*',async route=>{
    const request=route.request(),url=new URL(request.url());
    if(url.pathname==='/api/cookie-consent'){
      record.requests.push({kind:'consent',url:url.href,method:request.method(),body:request.postData()});
      if(delayConsent)await pause(delayConsent);
      if(failConsent)return route.fulfill({status:503,contentType:'application/json',body:'{"ok":false}'});
      if(request.method()==='POST')serverConsent=JSON.parse(request.postData()).consent;
      return route.fulfill({contentType:'application/json',headers:{'access-control-allow-origin':`https://${host}`,'access-control-allow-credentials':'true'},body:JSON.stringify({ok:true,consent:serverConsent})});
    }
    const googleScript=url.hostname==='www.googletagmanager.com'&&url.pathname.startsWith('/gtag/');
    const clarityScript=(url.hostname==='www.clarity.ms'&&url.pathname.startsWith('/tag/'))||url.hostname==='scripts.clarity.ms';
    if((googleScript||clarityScript)&&request.resourceType()==='script'){
      record.requests.push({kind:'vendor-script',url:url.href});
      if(url.hostname==='www.clarity.ms')record.clarityBootstrap=await request.frame().evaluate(()=>(window.clarity?.q||[]).map(a=>Array.from(a)));
      if(!real)return route.fulfill({contentType:'text/javascript',body:googleScript?gaStub:clarityStub});
      // This is the only permitted outbound network path. The loaded code
      // remains inside a browser context whose collectors are intercepted.
      if(!scriptCache.has(url.href))scriptCache.set(url.href,(async()=>{const response=await route.fetch({headers:{accept:'*/*'}});assert.equal(response.status(),200);const body=await response.body();evidence.vendorScripts.push({url:url.href,sha256:crypto.createHash('sha256').update(body).digest('hex'),bytes:body.length});return body;})());
      return route.fulfill({contentType:'text/javascript',body:await scriptCache.get(url.href)});
    }
    if(/(?:google-analytics\.com|clarity\.ms|bing\.com)$/.test(url.hostname)){
      const buffer=request.postDataBuffer();let body=request.postData(),encoding='plain';
      if(buffer?.[0]===31&&buffer?.[1]===139){body=zlib.gunzipSync(buffer).toString('utf8');encoding='gzip decoded for inspection';}
      record.collections.push({url:url.href,method:request.method(),resourceType:request.resourceType(),body,encoding});
      return route.fulfill({status:url.hostname.endsWith('clarity.ms')?200:204,headers:{'access-control-allow-origin':'*'},body:''});
    }
    if(url.hostname===host&&url.pathname==='/js/firebase-auth.js')return route.fulfill({contentType:'text/javascript',body:'document.dispatchEvent(new CustomEvent("firebase-auth-ready")); export {};'});
    if(url.hostname===host){
      let relative=decodeURIComponent(url.pathname).replace(/^\/+/, '');
      if(relative==='features'||relative==='features.html')relative='features.html';
      const file=path.resolve(root,relative);
      if(file.startsWith(root+path.sep)&&fs.existsSync(file)&&fs.statSync(file).isFile())return route.fulfill({contentType:mime[path.extname(file)]||'application/octet-stream',body:fs.readFileSync(file)});
      record.blocked.push({url:url.href,reason:'Unimplemented local fixture route'});
      return route.fulfill({status:404,body:'Fixture route not found'});
    }
    record.blocked.push({url:url.href,reason:'External network blocked'});
    return route.fulfill({status:204});
  });
  const page=await context.newPage();page.setDefaultTimeout(6000);page.on('pageerror',error=>record.pageErrors.push(error.message));
  await page.goto(`https://${host}/features${campaignQuery}${sensitive?sensitiveQuery:''}`);
  if(javaScriptEnabled)await page.waitForFunction(()=>window.JHA?.cookieConsent&&document.querySelector('[role=tab]'));
  const state=async()=>page.evaluate(()=>({commands:(window.dataLayer||[]).map(x=>Array.from(x)),consent:window.JHA?.cookieConsent.hasAnalyticsConsent(),cookies:document.cookie,clarityCalls:window.__fixtureClarityCalls||null,gaDisabled:window['ga-disable-G-SQYSWPFM5X']}));
  const events=async name=>(await state()).commands.filter(x=>x[0]==='event'&&(!name||x[1]===name));
  async function choose(analytics){
    if(await page.locator('#jha-cookie-banner').count())await page.locator(analytics?'#jha-accept-all':'#jha-reject-all').click();
    else{await page.locator('#open-cookie-preferences').click();if(await page.locator('#jha-toggle-analytics').isChecked()!==analytics)await page.locator('.jha-toggle').click();assert.equal(await page.locator('#jha-toggle-analytics').isChecked(),analytics);await page.locator('#jha-save-preferences').click();}
    await until(async()=>await page.evaluate(()=>!localStorage.getItem('jha_cookie_consent_pending_v1')),'consent write');
    if(analytics)await until(async()=>(await state()).consent===true,'grant applied');
  }
  async function close(){record.finalState=await state();record.passed=true;await context.close();}
  return {context,page,record,state,events,choose,close};
}
function vendorScripts(record){return record.requests.filter(x=>x.kind==='vendor-script');}
function gaHits(record){return record.collections.filter(x=>/google-analytics\.com/.test(new URL(x.url).hostname)).flatMap(x=>{
  const query=new URL(x.url).searchParams,lines=(x.body||'').split('\n').filter(Boolean);
  return (lines.length?lines:['']).map(line=>Object.fromEntries([...query,...new URLSearchParams(line)]));
});}
function checkContext(event){const p=event[2];assert.equal(p.asset_id,'voice_features_01');for(const prefix of ['first','last']){assert.equal(p[`jha_${prefix}_source`],'qa_e2e');assert.equal(p[`jha_${prefix}_campaign`],'features_tour_validation');assert.equal(p[`jha_${prefix}_asset`],'features_fixture');}}
async function clickCta(f,label='features-free-voice'){await f.page.locator(`[data-cta="${label}"]`).click();if(real)await pause(180);}
async function step(f,value){await f.page.locator(`[data-tour-tab="${value}"]`).click();if(real)await pause(180);}

test('undecided sends nothing; Accept sends one page view without replaying tour interactions',async()=>{
  const f=await fixture('undecided-then-accept');await step(f,'setup');await f.page.locator('#tour-setup [data-expand-capture]').click();await f.page.keyboard.press('Escape');await clickCta(f);await pause(150);
  assert.equal(vendorScripts(f.record).length,0);assert.equal(f.record.collections.length,0);assert.equal((await f.events()).length,0);
  await f.choose(true);await until(async()=>(await f.events('page_view')).length===1,'one page view');
  assert.equal((await f.events('features_tour_step')).length,0);assert.equal((await f.events('features_screenshot_open')).length,0);
  assert.equal((await f.events('cta_click')).length,1,'existing shared CTA queue flushes only after Accept');
  const state=await f.state(),config=state.commands.find(x=>x[0]==='config');
  assert.equal(config[1],PROD_GA);assert.equal(config[2].send_page_view,false);assert.equal(config[2].allow_google_signals,false);assert.equal(config[2].allow_ad_personalization_signals,false);assert.equal('debug_mode'in config[2],false);
  assert.deepEqual(config[2].linker.domains,['jobhackai.io','app.jobhackai.io']);
  const consent=state.commands.filter(x=>x[0]==='consent');assert.equal(consent[0][1],'default');assert.equal(consent[0][2].analytics_storage,'denied');assert.equal(consent[1][2].analytics_storage,'granted');for(const x of consent)for(const key of ['ad_storage','ad_user_data','ad_personalization'])assert.equal(x[2][key],'denied');
  assert.ok(state.commands.indexOf(consent[1])<state.commands.indexOf(config));
  checkContext((await f.events('page_view'))[0]);assert.ok(!JSON.stringify(state.commands).includes('fixture_secret'));assert.ok(!JSON.stringify(state.commands).includes('private@example.test'));assert.ok(!JSON.stringify(state.commands).includes('cs_fixture'));
  await until(()=>gaHits(f.record).some(h=>h.en==='page_view'),'intercepted serialized page_view');assert.equal(gaHits(f.record).filter(h=>h.en==='page_view').length,1);assert.ok(gaHits(f.record).every(h=>h.tid===PROD_GA));
  assert.deepEqual(f.record.clarityBootstrap[0],['consentv2',{analytics_Storage:'granted',ad_Storage:'denied'}]);
  if(!real){assert.deepEqual(state.clarityCalls[0],['consentv2',{analytics_Storage:'granted',ad_Storage:'denied'}]);}
  await f.close();
});

test('consented steps, report views, zoom and every CTA emit controlled events once',async()=>{
  const f=await fixture('all-interactions',{serverConsent:decision(true)});await until(async()=>(await f.events('page_view')).length===1,'page view');
  assert.equal((await f.events('features_tour_step')).length,0);assert.equal((await f.events('features_report_view')).length,0);
  await step(f,'setup');await step(f,'setup');await f.page.locator('[data-tour-tab="setup"]').press('ArrowRight');await step(f,'feedback');
  const steps=await f.events('features_tour_step');assert.deepEqual(steps.map(x=>[x[2].tour_step,x[2].interaction]),[['setup','click'],['conversation','keyboard'],['feedback','click']]);
  await f.page.locator('[data-report-tab="overview"]').click();await f.page.locator('[data-report-tab="overview"]').click();await f.page.locator('[data-report-tab="overview"]').press('ArrowRight');
  assert.deepEqual((await f.events('features_report_view')).map(x=>[x[2].report_view,x[2].interaction]),[['overview','click'],['evidence','keyboard']]);
  const evidenceImages=f.page.locator('[data-report-panel="evidence"] .product-shot img');
  assert.equal(await evidenceImages.count(),2,'default evidence panel shows both coaching and colored scores');
  await evidenceImages.last().scrollIntoViewIfNeeded();
  await f.page.waitForFunction(()=>[...document.querySelectorAll('[data-report-panel="evidence"] .product-shot img')].every(image=>image.complete&&image.naturalWidth>0&&image.getBoundingClientRect().height>0));
  const zooms=[];
  for(const value of ['setup','conversation','feedback']){
    await step(f,value);
    if(value==='feedback')for(const view of ['overview','evidence','scores']){
      await f.page.locator(`[data-report-tab="${view==='scores'?'evidence':view}"]`).click();
      const link=f.page.locator(`#tour-feedback [data-expand-capture][data-report-view="${view}"]`);
      assert.equal(await link.isVisible(),true);
      await link.click();
      assert.equal(await f.page.locator('[data-capture-dialog]').isVisible(),true);
      await f.page.waitForFunction(()=>{const image=document.querySelector('[data-capture-dialog] img');return image.complete&&image.naturalWidth>0;});
      assert.equal(await f.page.locator('[data-capture-dialog] img').getAttribute('src'),await link.getAttribute('href').then(href=>new URL(href,f.page.url()).href));
      zooms.push([value,view]);await f.page.keyboard.press('Escape');
    }else{await f.page.locator(`#tour-${value} [data-expand-capture]`).click();zooms.push([value,undefined]);await f.page.keyboard.press('Escape');}
  }
  assert.deepEqual((await f.events('features_screenshot_open')).map(x=>[x[2].tour_step,x[2].report_view]),zooms);
  const labels=await f.page.locator('main [data-cta]').evaluateAll(nodes=>nodes.map(n=>n.dataset.cta));for(const label of labels)await clickCta(f,label);
  assert.deepEqual((await f.events('cta_click')).map(x=>x[2].cta_label),labels);
  const all=await f.events();all.forEach(checkContext);assert.equal(all.filter(x=>x[1]==='page_view').length,1);
  for(const x of all.filter(x=>x[1].startsWith('features_'))){assert.ok(!JSON.stringify(x).includes('Product Manager'));assert.ok(!JSON.stringify(x).includes('/assets/'));}
  await until(()=>gaHits(f.record).filter(h=>h.en==='cta_click').length===labels.length,'serialized CTA hits');
  for(const name of ['features_tour_step','features_report_view','features_screenshot_open'])assert.equal(gaHits(f.record).filter(h=>h.en===name).length,all.filter(x=>x[1]===name).length);
  for(const hit of gaHits(f.record).filter(h=>h.en==='page_view'||h.en==='cta_click'||h.en?.startsWith('features_'))){assert.equal(hit['ep.asset_id'],'voice_features_01');assert.equal(hit['ep.jha_first_campaign'],'features_tour_validation');assert.equal(hit['ep.jha_last_asset'],'features_fixture');if(real)assert.equal(hit.gcs,'G101','analytics granted, advertising denied');}
  assert.deepEqual(f.record.pageErrors,[]);await f.close();
});

test('Reject drops predecision and denied interactions, then a later grant starts cleanly',async()=>{
  const f=await fixture('reject-then-grant');await clickCta(f);await step(f,'setup');await f.choose(false);await clickCta(f);await step(f,'feedback');
  assert.equal(vendorScripts(f.record).length,0);assert.equal(f.record.collections.length,0);assert.equal((await f.events()).length,0);assert.ok(!(await f.state()).cookies.includes('jha_campaign_prod'));
  await f.choose(true);await until(async()=>(await f.events('page_view')).length===1,'page view after regrant');assert.equal((await f.events('cta_click')).length,0);assert.equal((await f.events('features_tour_step')).length,0);await f.close();
});

test('withdrawal stops events and Clarity; regrant reuses GA and leaves replay stopped',async()=>{
  const f=await fixture('withdraw-regrant',{serverConsent:decision(true)});await until(()=>gaHits(f.record).some(h=>h.en==='page_view'),'initial collection');
  if(!real)await until(async()=>!!(await f.state()).clarityCalls?.length,'Clarity loaded');
  await f.choose(false);await pause(real?300:30);const count=(await f.events()).length,collectionCount=f.record.collections.length;await step(f,'setup');await clickCta(f);await f.page.evaluate(()=>{window.gtag?.('event','direct_after_revoke',{});window.JHA.trackEventSafe('helper_after_revoke',{});window.scrollTo(0,document.body.scrollHeight);});await pause(real?1500:200);
  assert.equal((await f.events()).length,count);assert.equal((await f.state()).gaDisabled,true);assert.ok(!(await f.state()).cookies.includes('jha_campaign_prod'));assert.ok(!(await f.context.cookies()).some(c=>['_clck','_clsk'].includes(c.name)));
  assert.equal(f.record.collections.length,collectionCount,'no continuing vendor collection after withdrawal');
  const consent=(await f.state()).commands.filter(x=>x[0]==='consent').at(-1);assert.equal(consent[2].analytics_storage,'denied');
  if(!real)assert.equal((await f.state()).clarityCalls.at(-1)[0],'stop');
  const scriptsBefore=vendorScripts(f.record).length;await f.choose(true);await step(f,'feedback');assert.equal((await f.events('features_tour_step')).length,1);assert.equal((await f.events('page_view')).length,1);assert.equal((await f.state()).commands.filter(x=>x[0]==='config').length,1);assert.equal(vendorScripts(f.record).length,scriptsBefore);await f.close();
});

test('QA uses separate GA/debug/cookie/linker scope and no production Clarity',async()=>{
  const f=await fixture('qa-isolation',{host:'qa-marketing.jobhackai.io',serverConsent:decision(true)});await until(async()=>(await f.events('page_view')).length===1,'QA page view');const s=await f.state(),c=s.commands.find(x=>x[0]==='config');assert.equal(c[1],QA_GA);assert.equal(c[2].debug_mode,true);assert.equal(c[2].cookie_prefix,'jha_qa');assert.deepEqual(c[2].linker.domains,['qa.jobhackai.io','qa-marketing.jobhackai.io']);assert.equal(s.gaDisabled,true);assert.ok(s.cookies.includes('jha_campaign_qa_v2'));assert.ok(!s.cookies.includes('jha_campaign_prod='));assert.ok(vendorScripts(f.record).every(x=>!x.url.includes(PROD_GA)&&!x.url.includes(PROD_CLARITY)));assert.ok(f.record.requests.filter(x=>x.kind==='consent').every(x=>new URL(x.url).hostname==='qa.jobhackai.io'));await until(()=>gaHits(f.record).some(h=>h.tid===QA_GA),'QA serialized hit');await f.close();
});

for(const host of ['dev.jobhackai.io','127.0.0.1','candidate.pages.dev'])test(`${host}: no implicit production or QA tracking`,async()=>{
  const f=await fixture(`nonproduction-${host}`,{host,serverConsent:decision(true)});await until(async()=>(await f.state()).consent===true,'fixture consent');await step(f,'setup');await clickCta(f);await pause(100);assert.equal(vendorScripts(f.record).length,0);assert.equal(f.record.collections.length,0);assert.equal((await f.events()).length,0);assert.equal((await f.state()).gaDisabled,true);assert.ok(f.record.requests.filter(x=>x.kind==='consent').every(x=>new URL(x.url).hostname===host));await f.close();
});

test('copied production IDs fail closed on QA',async()=>{
  const f=await fixture('copied-production-ids',{host:'qa-marketing.jobhackai.io',serverConsent:decision(true),config:{GA_ID:PROD_GA,CLARITY_ID:PROD_CLARITY}});await until(async()=>(await f.state()).consent===true,'QA consent');await clickCta(f);await pause(100);assert.equal(vendorScripts(f.record).length,0);assert.equal(f.record.collections.length,0);await f.close();
});

test('server rejection defeats a stale grant; pending rejection survives failed sync',async()=>{
  const stale=await fixture('stale-grant-server-reject',{localConsent:decision(true),serverConsent:decision(false),delayConsent:150});await pause(250);assert.equal((await stale.state()).consent,false);assert.equal(vendorScripts(stale.record).length,0);await stale.close();
  const pending=await fixture('pending-reject-sync-failure',{localConsent:decision(true),pendingConsent:decision(false),failConsent:true});await pause(150);await step(pending,'setup');assert.equal((await pending.state()).consent,false);assert.equal(vendorScripts(pending.record).length,0);assert.ok(await pending.page.locator('[role="status"]').filter({hasText:'Account sync is pending'}).count());await pending.close();
});

test('no JavaScript leaves all examples and image links usable without analytics',async()=>{
  const f=await fixture('no-javascript',{javaScriptEnabled:false});assert.equal(await f.page.locator('[data-tour-panel]:visible').count(),3);assert.equal(await f.page.locator('[data-tour-tabs]:visible').count(),0);await f.page.locator('#tour-setup [data-expand-capture]').click();assert.match(f.page.url(),/\/assets\/features\/voice-setup\.png$/);assert.equal(vendorScripts(f.record).length,0);assert.equal(f.record.collections.length,0);f.record.passed=true;await f.context.close();
});

test('analytics failures do not break step, report, or screenshot controls',async()=>{
  const f=await fixture('analytics-throws',{serverConsent:decision(true)});await until(async()=>(await f.events('page_view')).length===1,'grant');await f.page.evaluate(()=>{window.JHA.trackEventSafe=()=>{throw new Error('Synthetic tracker failure');};});await step(f,'setup');assert.equal(await f.page.locator('#tour-setup').isVisible(),true);await step(f,'feedback');await f.page.locator('[data-report-tab="overview"]').click();assert.equal(await f.page.locator('[data-report-panel="overview"]').isVisible(),true);await f.page.locator('#tour-feedback [data-expand-capture][data-report-view="overview"]').click();assert.equal(await f.page.locator('[data-capture-dialog]').isVisible(),true);await f.page.keyboard.press('Escape');assert.deepEqual(f.record.pageErrors,[]);await f.close();
});

test('desktop and mobile signup navigation preserve plan intent without false conversions',async()=>{
  const f=await fixture('navigation-signup',{host:'qa-marketing.jobhackai.io',serverConsent:decision(true)});await until(async()=>(await f.events('page_view')).length===1,'QA grant');
  for(const [width,selector,source]of [[1440,'.site-header [data-plan-id="free"]','navigation-cta-desktop'],[390,'#mobileNav [data-plan-id="free"]','navigation-cta-mobile']]){
    await f.page.setViewportSize({width,height:900});if(width<900)await f.page.locator('.mobile-toggle').click();const link=f.page.locator(selector);assert.equal(await link.getAttribute('data-plan-source'),source);assert.equal(new URL(await link.getAttribute('href')).hostname,'qa.jobhackai.io');assert.equal(new URL(await link.getAttribute('href')).searchParams.get('plan'),'free');await link.click();const selected=await f.page.evaluate(()=>({local:JSON.parse(localStorage.getItem('selectedPlan')),session:JSON.parse(sessionStorage.getItem('selectedPlan'))}));assert.equal(selected.local.planId,'free');assert.equal(selected.local.source,source);assert.deepEqual(selected.local,selected.session);if(width<900)await f.page.keyboard.press('Escape');
  }
  assert.equal((await f.events('sign_up')).length,0);assert.equal((await f.events('purchase')).length,0);assert.equal((await f.events('begin_checkout')).length,0);
  assert.deepEqual((await f.events('cta_click')).map(x=>[x[2].cta_label,x[2].cta_plan]),[['features-nav-free-desktop','free'],['features-nav-free-mobile','free']]);
  await f.page.evaluate(()=>document.dispatchEvent(new CustomEvent('firebase-auth-ready')));await pause(100);assert.equal(await f.page.locator('.site-header [data-plan-id="free"]').count(),1);assert.equal(await f.page.locator('#mobileNav [data-plan-id="free"]').count(),1);await f.page.setViewportSize({width:1440,height:900});await clickCta(f,'features-nav-free-desktop');assert.equal((await f.events('cta_click')).length,3);
  const links=await f.page.locator('[data-cta], [data-plan-id]').evaluateAll(nodes=>nodes.map(n=>n.href));assert.ok(links.every(href=>!/[?&](email|oobCode|session_id)=/.test(href)));assert.ok((await f.state()).cookies.includes('jha_campaign_qa_v2='));await f.close();
});

for(const emailVerified of [true,false])test(`auth-ready ${emailVerified?'verified':'unverified'} users do not retain visitor signup CTAs`,async()=>{
  const f=await fixture(`auth-navigation-${emailVerified}`,{serverConsent:decision(false),user:{uid:'synthetic-user',emailVerified}});await pause(150);assert.equal(await f.page.locator('.site-header [data-plan-id="free"], #mobileNav [data-plan-id="free"]').count(),0);await f.close();
});

test('sensitive URL parameters never reach GA or Clarity collectors',async()=>{
  const f=await fixture('sensitive-url',{serverConsent:decision(true),sensitive:true});await until(()=>gaHits(f.record).some(h=>h.en==='page_view'),'sanitized page view');await pause(real?1200:100);for(const request of f.record.collections){const payload=decodeURIComponent(request.url)+(request.body||'');for(const value of ['fixture_secret','private@example.test','cs_fixture'])assert.ok(!payload.includes(value),`${new URL(request.url).hostname} leaked ${value}`);}await f.close();
});

test('history replacement failure disables replay while GA sanitization and tour remain usable',async()=>{
  const f=await fixture('history-replacement-failure',{serverConsent:decision(true),sensitive:true,historyFailure:true});await until(()=>gaHits(f.record).some(h=>h.en==='page_view'),'sanitized GA page view');await step(f,'setup');assert.equal(await f.page.locator('#tour-setup').isVisible(),true);assert.equal((await f.events('features_tour_step')).length,1);assert.ok(vendorScripts(f.record).every(r=>!r.url.includes('clarity.ms')));assert.ok(!JSON.stringify(f.record.collections).includes('fixture_secret'));assert.deepEqual(f.record.pageErrors,[]);await f.close();
});

test('without native dialog support, tabs work and image links remain a usable fallback',async()=>{
  const f=await fixture('no-native-dialog',{serverConsent:decision(false),nativeDialog:false});await step(f,'setup');await f.page.locator('#tour-setup [data-expand-capture]').click();assert.match(f.page.url(),/\/assets\/features\/voice-setup\.png$/);assert.equal(f.record.collections.length,0);f.record.passed=true;await f.context.close();
});
