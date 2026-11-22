// Real candidate HTML, preview code and consent bundle; synthetic identity/API
// and vendor runtimes. Every request is intercepted, including all collectors.
// No signup, billing, tool generation, or analytics reaches a live service.
// TOOL_TELEMETRY_TEST_BROWSER=webkit selects the second CI engine.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium, webkit } = require('playwright');
const root = process.env.UI_SOURCE_ROOT || path.resolve(__dirname, '../../..');
const consentKey = 'jha_cookie_consent_v1';
const PROD_GA = 'G-SQYSWPFM5X', QA_GA = 'G-VH888WWY3M', PROD_CLARITY = 'wskzma4clw';
const decision = analytics => ({ version: 1, analytics, updatedAt: new Date().toISOString() });
const specs = [
  { page: 'linkedin-optimizer', tool: 'linkedin_optimizer', prefix: 'linkedin', selector: '#lo-preview' },
  { page: 'interview-questions', tool: 'interview_questions', prefix: 'interview-questions', selector: '#jha-preview-gate' },
  { page: 'resume-feedback-pro', tool: 'resume_feedback', prefix: 'resume-feedback', selector: '#jha-preview-gate' }
];
const campaign = '?utm_source=fixture&utm_medium=synthetic&utm_campaign=tool_preview&utm_content=tool_fixture';
const gaStub = `(()=>{const q=window.dataLayer||[],initial=q.slice(),push=q.push.bind(q);let id='';const emit=a=>{const v=Array.from(a);if(v[0]==='config')id=v[1];if(v[0]==='event'&&!window['ga-disable-'+id]){const p=new URLSearchParams({tid:id,en:v[1]});for(const[k,x]of Object.entries(v[2]||{}))if(typeof x!=='function')p.set('ep.'+k,String(x));fetch('https://www.google-analytics.com/g/collect?'+p,{method:'POST',mode:'no-cors'});}};q.push=function(a){const n=push(a);emit(a);return n};initial.forEach(emit);window.__fixtureGaLoaded=true;})();`;
const clarityStub = `(()=>{const queued=(window.clarity?.q||[]).slice();window.__fixtureClarityCalls=[];window.clarity=function(...a){window.__fixtureClarityCalls.push(a);if(a[0]==='consentv2'&&a[1].analytics_Storage==='granted'){document.cookie='_clck=synthetic; Path=/';document.cookie='_clsk=synthetic; Path=/';fetch('https://l.clarity.ms/collect',{method:'POST',body:JSON.stringify({url:location.href,referrer:document.referrer}),mode:'no-cors'});}};queued.forEach(a=>window.clarity(...a));})();`;
const mime = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.png':'image/png', '.svg':'image/svg+xml', '.woff2':'font/woff2' };
let browser;
before(async () => { browser = await (process.env.TOOL_TELEMETRY_TEST_BROWSER === 'webkit' ? webkit : chromium).launch({headless:true}); });
after(async () => { await browser?.close(); });

async function fixture(t, spec, { serverConsent = null, host = 'app.jobhackai.io', config, query = campaign, referrer, delayGate = false, offscreen = false } = {}) {
  const origin = 'https://' + host;
  const context = await browser.newContext({ viewport: {width:390,height:844} });
  t.after(async () => { await context.unrouteAll({behavior:'wait'}); await context.close(); });
  const collections = [], vendors = [], api = [], errors = [];
  await context.addInitScript(({ config, delayGate, offscreen }) => {
    if (config) window.JHA_CONFIG = config;
    let user = null, resolveGate;
    const ready = delayGate ? new Promise(resolve => { resolveGate = resolve; }) : Promise.resolve(null);
    window.__REAL_AUTH_READY = true;
    window.__firebaseAuthReadyFired = true;
    window.__navigationReadyFired = true;
    localStorage.setItem('user-plan','free');
    window.FirebaseAuthManager = {
      getCurrentUser: () => user, isAuthenticated: () => !!user, isAuthReady: () => true,
      waitForAuthReady: () => user ? Promise.resolve(user) : ready,
      requireAuth: () => !!user, requireVerifiedEmail: async () => !!user,
      getIdToken: async () => user ? 'synthetic-token' : null,
      onAuthStateChanged: callback => { callback(user); return () => {}; }
    };
    window.JobHackAINavigation = {getAuthState:()=>({isAuthenticated:!!user}),getEffectivePlan:()=>user?'free':'visitor'};
    window.RoleSelector = function () {};
    window.__releaseGate = () => resolveGate?.(null);
    window.__setToolAuth = next => {
      user = next ? {uid:'synthetic-user',emailVerified:true,getIdToken:async()=> 'synthetic-token'} : null;
      document.dispatchEvent(new CustomEvent('firebase-auth-ready',{detail:{user}}));
      window.dispatchEvent(new CustomEvent('navigationReady'));
    };
    document.addEventListener('DOMContentLoaded', () => {
      document.dispatchEvent(new CustomEvent('firebase-auth-ready',{detail:{user}}));
    });
    // Preserve real capture-phase tracking, but prevent navigation to accounts.
    document.addEventListener('click', event => { if(event.target.closest?.('[data-cta]')) event.preventDefault(); }, true);
  }, {config,delayGate,offscreen});
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin === origin && url.pathname === '/api/cookie-consent') {
      if (request.method() === 'POST') serverConsent = JSON.parse(request.postData()).consent;
      return route.fulfill({json:{ok:true,consent:serverConsent}});
    }
    if (url.hostname === 'www.googletagmanager.com' || url.hostname === 'www.clarity.ms') {
      vendors.push(url.href);
      return route.fulfill({contentType:'text/javascript',body:url.hostname === 'www.googletagmanager.com' ? gaStub : clarityStub});
    }
    if (/(?:google-analytics\.com|clarity\.ms|bing\.com)$/.test(url.hostname)) {
      collections.push({url:url.href,body:request.postData()});
      return route.fulfill({status:204,headers:{'access-control-allow-origin':'*'}});
    }
    if (url.origin !== origin) return route.abort();
    if (url.pathname.startsWith('/api/')) {
      api.push(url.pathname);
      if (url.pathname === '/api/plan/me') return route.fulfill({json:{plan:'free',voice:{enabled:false}}});
      return route.fulfill({json:{success:true,items:[],data:null,roles:[]}});
    }
    const realScripts = ['/js/tool-preview-telemetry.js','/js/cookie-consent.js','/js/voice-cta.js','/js/linkedin-optimizer.js','/js/modals.js','/js/page-access-control.js'];
    if (url.pathname.startsWith('/js/') && !realScripts.includes(url.pathname)) return route.fulfill({contentType:'text/javascript',body:''});
    const file = path.resolve(root,'.'+url.pathname);
    if (!file.startsWith(root+path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return route.fulfill({status:404,body:'Fixture route missing'});
    let body=fs.readFileSync(file);
    if(offscreen && path.extname(file)==='.html') body=body.toString().replace('</head>','<style>main{margin-top:1800px!important}</style></head>');
    return route.fulfill({contentType:mime[path.extname(file)]||'application/octet-stream',body});
  });
  const page = await context.newPage();
  page.setDefaultTimeout(5000);
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(origin+'/'+spec.page+'.html'+query, referrer ? {referer:referrer} : {});
  await page.waitForFunction(() => !!window.JHA?.cookieConsent);
  if (!delayGate) await page.locator(spec.selector).waitFor({state:'visible'});
  const events = name => page.evaluate(name => (window.dataLayer||[]).map(x=>Array.from(x)).filter(x=>x[0]==='event'&&(!name||x[1]===name)),name);
  async function choose(analytics) {
    if (await page.locator('#jha-cookie-banner').count()) await page.locator(analytics ? '#jha-accept-all' : '#jha-reject-all').click();
    else {
      await page.evaluate(() => window.JHA.cookieConsent.openPreferences());
      if (await page.locator('#jha-toggle-analytics').isChecked() !== analytics) await page.locator('.jha-toggle').click();
      await page.locator('#jha-save-preferences').click();
    }
    await page.waitForFunction(expected => !!window.JHA.cookieConsent.hasAnalyticsConsent()===expected && !localStorage.getItem('jha_cookie_consent_pending_v1'),analytics);
    await page.waitForTimeout(80);
  }
  const click = action => page.locator(`[data-cta="${spec.prefix}-preview-${action}"]`).click();
  return {page,events,choose,click,collections,vendors,api,errors};
}

for (const spec of specs) {
  test(`${spec.page}: helper precedes exactly one consent loader`, () => {
    const source=fs.readFileSync(path.join(root,spec.page+'.html'),'utf8');
    const helper=[...source.matchAll(/<script\b[^>]*src="js\/tool-preview-telemetry\.js[^>]*>/g)];
    const consent=[...source.matchAll(/<script\b[^>]*src="js\/cookie-consent\.js[^>]*>/g)];
    assert.equal(helper.length,1); assert.equal(consent.length,1);
    assert.ok(helper[0].index<consent[0].index);
    assert.match(helper[0][0],/\bdefer\b/); assert.match(consent[0][0],/\bdefer\b/);
  });
  test(`${spec.page}: consented visible view, distinct clicks, dedup and revoke`, async t => {
    const f = await fixture(t,spec);
    await f.click('signup'); await f.click('login');
    assert.equal(f.vendors.length,0); assert.equal(f.collections.length,0);
    await f.choose(true);
    await f.page.locator(spec.selector+' h1').scrollIntoViewIfNeeded();
    await f.page.waitForFunction(() => (window.dataLayer||[]).some(x=>x[1]==='sign_up_gate_view'));
    assert.equal((await f.events('page_view')).length,1);
    assert.equal((await f.events('cta_click')).length,0,'pre-decision clicks must not replay');
    const view = (await f.events('sign_up_gate_view'))[0][2];
    assert.equal(view.asset_id,'tool_preview_'+spec.tool); assert.equal(view.tool,spec.tool);
    assert.equal(view.page_path,'/'+spec.page+'.html'); assert.equal(view.business_line,'career_product');
    assert.equal(view.preview_type,'illustrative'); assert.equal(view.jha_last_campaign,'tool_preview');
    await f.page.evaluate(selector => {
      const preview=document.querySelector(selector);
      window.JHA.toolPreviewTelemetry.observe(preview); window.JHA.toolPreviewTelemetry.observe(preview);
      document.dispatchEvent(new CustomEvent('jha-preview-mode'));
      window.dispatchEvent(new CustomEvent('cookie-consent-granted'));
      preview.querySelector('p').textContent='Synthetic private resume JD profile secret canary';
    },spec.selector);
    await f.click('signup'); await f.click('login');
    const clicks = await f.events('cta_click');
    assert.deepEqual(clicks.map(x=>x[2].cta_label),[spec.prefix+'-preview-signup',spec.prefix+'-preview-login']);
    assert.deepEqual(clicks.map(x=>x[2].action),['signup','login']);
    assert.ok(clicks.every(x=>x[2].asset_id==='tool_preview_'+spec.tool));
    assert.equal((await f.events('sign_up_gate_view')).length,1);
    assert.equal(await f.page.locator('body').getAttribute('data-clarity-mask'),'true');
    const clarity = await f.page.evaluate(() => window.__fixtureClarityCalls);
    assert.deepEqual(clarity[0],['consentv2',{analytics_Storage:'granted',ad_Storage:'denied'}]);
    await f.choose(false);
    const before=f.collections.length;
    await f.click('signup'); await f.click('login'); await f.page.waitForTimeout(100);
    assert.equal(f.collections.length,before);
    assert.ok(await f.page.evaluate(() => window.__fixtureClarityCalls.some(x=>x[0]==='stop')));
    assert.ok(!await f.page.evaluate(() => /_clck=|_clsk=/.test(document.cookie)));
    await f.choose(true); await f.click('signup');
    assert.equal((await f.events('cta_click')).length,3);
    assert.equal((await f.events('page_view')).length,1);
    assert.equal((await f.events('sign_up_gate_view')).length,1);
    assert.equal(f.vendors.filter(x=>x.includes('clarity.ms')).length,1,'replay stays stopped after revoke');
    assert.equal((await f.events()).filter(x=>['sign_up','purchase','begin_checkout'].includes(x[1])).length,0);
    assert.ok(!JSON.stringify(f.collections).includes('secret canary'));
    assert.deepEqual(f.api,[]); assert.deepEqual(f.errors,[]);
  });

  test(`${spec.page}: reject and repeated signals produce no events; later accept counts visible example`, async t => {
    const f = await fixture(t,spec,{serverConsent:decision(false)});
    await f.page.evaluate(selector => {
      window.JHA.toolPreviewTelemetry.observe(document.querySelector(selector));
      document.dispatchEvent(new CustomEvent('jha-preview-mode'));
    },spec.selector);
    await f.click('signup'); await f.click('login');
    assert.equal(f.collections.length,0); assert.equal(f.vendors.length,0);
    await f.choose(true);
    await f.page.locator(spec.selector+' h1').scrollIntoViewIfNeeded();
    await f.page.waitForFunction(() => (window.dataLayer||[]).some(x=>x[1]==='sign_up_gate_view'));
    assert.equal((await f.events('sign_up_gate_view')).length,1);
    assert.equal((await f.events('cta_click')).length,0);
    assert.deepEqual(f.errors,[]);
  });

  test(`${spec.page}: auth hides the preview before consent so stale visibility never replays`, async t => {
    const f = await fixture(t,spec);
    await f.page.waitForTimeout(80);
    await f.page.evaluate(() => window.__setToolAuth(true));
    await f.page.locator(spec.selector).waitFor({state:'hidden'});
    await f.choose(true);
    assert.equal((await f.events('sign_up_gate_view')).length,0);
    assert.equal((await f.events('page_view')).length,1);
  });

  test(`${spec.page}: unsafe URL preserves tool state while suppressing replay and sanitizing GA`, async t => {
    const query=campaign+'&email=synthetic%40example.test&oobCode=synthetic_secret&session_id=synthetic_session#private_fragment';
    const f=await fixture(t,spec,{serverConsent:decision(true),query});
    await f.page.waitForFunction(()=> (window.dataLayer||[]).some(x=>x[1]==='page_view'));
    await f.click('signup');
    assert.ok(f.page.url().includes('oobCode=synthetic_secret'),'functional URL is unchanged');
    assert.ok(f.vendors.every(x=>!x.includes('clarity.ms')));
    const payload=JSON.stringify(f.collections)+JSON.stringify(await f.events());
    for(const value of ['synthetic_secret','synthetic@example.test','synthetic_session','private_fragment']) assert.ok(!payload.includes(value),'no '+value+' in analytics');
    const href=await f.page.locator(`[data-cta="${spec.prefix}-preview-signup"]`).getAttribute('href');
    assert.equal(new URL(href,f.page.url()).searchParams.get('redirect'),'/'+spec.page+'.html');
    assert.deepEqual(f.errors,[]);
  });
}

test('LinkedIn static signup click is protected before asynchronous gate initialization',async t=>{
  const f=await fixture(t,specs[0],{delayGate:true});
  await f.click('signup'); await f.choose(true);
  assert.equal((await f.events('cta_click')).length,0);
  assert.equal((await f.events('sign_up_gate_view')).length,0);
  await f.page.evaluate(()=>window.__releaseGate());
  await f.page.locator('#lo-preview h1').scrollIntoViewIfNeeded();
  await f.page.waitForFunction(()=> (window.dataLayer||[]).some(x=>x[1]==='sign_up_gate_view'));
  assert.equal((await f.events('sign_up_gate_view')).length,1);
});

test('offscreen preview waits for visibility, including consent re-grant with existing GA runtime',async t=>{
  const f=await fixture(t,specs[0],{serverConsent:decision(true),offscreen:true});
  await f.page.waitForFunction(()=> (window.dataLayer||[]).some(x=>x[1]==='page_view'));
  assert.equal((await f.events('sign_up_gate_view')).length,0);
  await f.choose(false);
  await f.page.locator('#lo-preview h1').scrollIntoViewIfNeeded();
  await f.page.waitForTimeout(80);
  assert.equal((await f.events('sign_up_gate_view')).length,0);
  await f.choose(true);
  await f.page.waitForFunction(()=> (window.dataLayer||[]).some(x=>x[1]==='sign_up_gate_view'));
  assert.equal((await f.events('sign_up_gate_view')).length,1);
});

test('unsafe referrer never enters replay or GA payloads',async t=>{
  const f=await fixture(t,specs[0],{serverConsent:decision(true),referrer:'https://app.jobhackai.io/login.html?oobCode=synthetic_referrer_secret'});
  await f.page.waitForFunction(()=> (window.dataLayer||[]).some(x=>x[1]==='page_view'));
  assert.ok(f.vendors.every(x=>!x.includes('clarity.ms')));
  assert.ok(!JSON.stringify(f.collections).includes('synthetic_referrer_secret'));
  assert.ok(!JSON.stringify(await f.events()).includes('synthetic_referrer_secret'));
});

test('safe signup handoff retains replay, while encoded GA linker state stays untouched and suppresses replay',async t=>{
  const referrer='https://app.jobhackai.io/login.html?mode=signup&plan=free&redirect=%2Flinkedin-optimizer.html';
  const safe=await fixture(t,specs[0],{serverConsent:decision(true),referrer});
  await safe.page.waitForFunction(()=> !!window.__fixtureClarityCalls);
  assert.equal(safe.vendors.filter(x=>x.includes('clarity.ms')).length,1);
  const linked=await fixture(t,specs[0],{serverConsent:decision(true),query:campaign+'&_gl=1*synthetic*encoded_linker'});
  await linked.page.waitForFunction(()=> (window.dataLayer||[]).some(x=>x[1]==='page_view'));
  assert.ok(linked.page.url().includes('_gl=1*synthetic*encoded_linker'));
  assert.ok(linked.vendors.every(x=>!x.includes('clarity.ms')));
  const config=await linked.page.evaluate(()=> (window.dataLayer||[]).find(x=>x[0]==='config')[2]);
  assert.deepEqual(config.linker.domains,['jobhackai.io','app.jobhackai.io']);
  assert.ok(!config.page_location.includes('_gl'));
});

test('CTA action is bounded even if optional markup contains an arbitrary value',async t=>{
  const f=await fixture(t,specs[0],{serverConsent:decision(true)});
  for(const value of ['synthetic-private-value','signup\n']) {
    await f.page.locator('[data-cta="linkedin-preview-signup"]').evaluate((el,value)=>el.dataset.analyticsAction=value,value);
    await f.click('signup');
  }
  assert.ok((await f.events('cta_click')).every(event=>event[2].action===undefined));
  assert.ok(!JSON.stringify(f.collections).includes('synthetic-private-value'));
});

test('hidden resume placeholder never counts as output; visible output counts once after consent',async t=>{
  const f=await fixture(t,specs[2]);
  await f.page.evaluate(()=>window.__setToolAuth(true));
  await f.page.locator('#jha-preview-gate').waitFor({state:'hidden'});
  await f.choose(true);
  await f.page.waitForTimeout(1700);
  assert.equal((await f.events('tool_output_viewed')).length,0);
  await f.choose(false);
  await f.page.evaluate(()=>{
    const output=document.querySelector('#rf-feedback-content');
    output.textContent='Synthetic private resume feedback '.repeat(10);
    output.style.display='block'; output.hidden=false;
    // Show only this controlled synthetic result, with no generator request.
    document.querySelector('main').prepend(output);
  });
  await f.page.locator('#rf-feedback-content').scrollIntoViewIfNeeded();
  assert.equal((await f.events('tool_output_viewed')).length,0);
  await f.choose(true);
  await f.page.waitForFunction(()=> (window.dataLayer||[]).some(x=>x[1]==='tool_output_viewed'));
  await f.page.evaluate(()=>window.dispatchEvent(new CustomEvent('cookie-consent-granted')));
  const events=await f.events('tool_output_viewed');
  assert.equal(events.length,1); assert.equal(events[0][2].tool,'resume_feedback');
  assert.ok(!JSON.stringify(f.collections).includes('Synthetic private resume feedback'));
});

test('new output appearing after the offer poll stops is still measured without a scroll or consent change',async t=>{
  const f=await fixture(t,specs[2],{serverConsent:decision(true)});
  await f.page.evaluate(()=>window.__setToolAuth(true));
  await f.page.locator('#jha-preview-gate').waitFor({state:'hidden'});
  await f.page.waitForTimeout(1700);
  assert.equal((await f.events('tool_output_viewed')).length,0);
  await f.page.evaluate(()=>{
    const output=document.querySelector('#rf-feedback-content');
    output.textContent='Synthetic private result arriving later '.repeat(10);
    output.style.display='block'; output.hidden=false;
    document.querySelector('main').prepend(output);
  });
  await f.page.waitForFunction(()=> (window.dataLayer||[]).some(x=>x[1]==='tool_output_viewed'));
  assert.equal((await f.events('tool_output_viewed')).length,1);
  assert.ok(!JSON.stringify(f.collections).includes('Synthetic private result arriving later'));
});

for(const host of ['qa.jobhackai.io','dev.jobhackai.io']) test(`${host}: analytics destination isolation`,async t=>{
  const f=await fixture(t,specs[0],{host,serverConsent:decision(true)});
  await f.page.waitForTimeout(150);
  const commands=await f.page.evaluate(()=> (window.dataLayer||[]).map(x=>Array.from(x)));
  if(host.startsWith('qa.')) {
    assert.equal(commands.find(x=>x[0]==='config')[1],QA_GA);
    assert.equal((await f.events('page_view')).length,1);
  } else assert.equal(f.vendors.length,0);
  assert.ok(f.vendors.every(x=>!x.includes(PROD_GA)&&!x.includes(PROD_CLARITY)));
});

test('blocked tracker cannot break preview links or permit private values into event parameters',async t=>{
  const f=await fixture(t,specs[0],{serverConsent:decision(true)});
  await f.page.evaluate(()=>{window.JHA.trackEventSafe=()=>{throw new Error('Synthetic vendor failure');};});
  await f.click('signup'); await f.click('login');
  assert.equal(await f.page.locator('#lo-preview').isVisible(),true);
  assert.deepEqual(f.errors,[]);
});
