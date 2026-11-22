// Real candidate pages with local identity/API fixtures. No external requests,
// signups, credit consumption, or analytics collection are permitted.
// Run: node --test app/tests/ui/tool-preview.test.cjs
// PREVIEW_TEST_BROWSER=webkit runs the same checks in WebKit.
const {test, before, after} = require('node:test');
const assert = require('node:assert/strict');
const {once} = require('node:events');
const {chromium, webkit, expect} = require('@playwright/test');
const {startFixtureServer} = require('./fixture-server.cjs');
let browser, server, base;
const fixtures = [
  {page:'interview-questions', input:'#iq-role', title:'Interview Questions'},
  {page:'resume-feedback-pro', input:'#rf-job-title', title:'Resume Feedback'}
];
before(async () => {
  server = startFixtureServer({port:0, bootstrap:"window.JHA_CONFIG={GA_ID:'',CLARITY_ID:''};", apiHandler(req,res,url) {
    if (url.pathname !== '/api/cookie-consent') return false;
    res.writeHead(200, {'Content-Type':'application/json'});
    res.end(JSON.stringify({ok:true,consent:null}));
    return true;
  }});
  await once(server, 'listening');
  base = `http://127.0.0.1:${server.address().port}`;
  const engine = process.env.PREVIEW_TEST_BROWSER || 'chromium';
  assert.ok(['chromium','webkit'].includes(engine));
  browser = await ({chromium,webkit})[engine].launch({headless:true});
});
after(async () => {
  await browser?.close();
  if (server) await new Promise(resolve=>server.close(resolve));
});
async function surface(t) {
  const context = await browser.newContext({viewport:{width:390,height:844}, reducedMotion:'reduce'});
  t.after(async()=>{ await context.unrouteAll({behavior:'wait'}); await context.close(); });
  await context.route('**/*', route => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
  const page = await context.newPage();
  const errors = [], requests = [];
  page.on('pageerror',error=>errors.push(error.message));
  page.on('request',request=>{
    const url = new URL(request.url());
    if (url.pathname.startsWith('/api/') && url.pathname !== '/api/cookie-consent') requests.push(url.pathname);
  });
  return {context,page,errors,requests};
}
async function ready(page) {
  await page.waitForFunction(()=>document.documentElement.classList.contains('nav-ready') && window.MobileMenuInitialized);
  const reject = page.getByRole('button',{name:'Reject Analytics',exact:true});
  if (await reject.isVisible()) await reject.click();
}
for (const fixture of fixtures) {
  test(`${fixture.title}: one accessible anonymous preview at mobile and desktop widths`, async t => {
    const {page,requests,errors} = await surface(t);
    await page.goto(`${base}/${fixture.page}.html?plan=visitor&utm_source=fixture#example`);
    await expect(page.locator('#jha-preview-gate')).toBeVisible();
    await ready(page);
    await expect(page.getByRole('heading',{name:fixture.title,exact:true,level:1})).toBeVisible();
    await expect(page.getByRole('heading',{name:'Login Required',exact:true})).toHaveCount(0);
    await expect(page.locator('.jha-gate-btn')).toHaveAttribute('href',`/login.html?mode=signup&redirect=%2F${fixture.page}.html`);
    await expect(page.locator('.jha-gate-login')).toHaveAttribute('href',`/login.html?redirect=%2F${fixture.page}.html`);
    await page.locator('.jha-gate-btn').focus();
    await page.keyboard.press('Tab');
    // macOS WebKit may require Safari's link-navigation shortcut.
    if (process.env.PREVIEW_TEST_BROWSER==='webkit' && !(await page.locator('.jha-gate-login').evaluate(e=>e===document.activeElement))) {
      await page.locator('.jha-gate-btn').focus();
      await page.keyboard.press('Alt+Tab');
    }
    await expect(page.locator('.jha-gate-login')).toBeFocused();
    const toggle = page.getByRole('button',{name:'Open navigation menu'});
    for (let i=0; i<2; i++) {
      await toggle.click();
      await expect(toggle).toHaveAttribute('aria-expanded','true');
      await expect(page.locator('#mobileNav')).toHaveClass(/open/);
      await page.keyboard.press('Escape');
      await expect(toggle).toHaveAttribute('aria-expanded','false');
    }
    for (const width of [375,390,430,1024,1440]) {
      await page.setViewportSize({width,height:900});
      const metrics = await page.evaluate(()=>({
        width:innerWidth, scroll:document.documentElement.scrollWidth,
        position:getComputedStyle(document.querySelector('#jha-preview-gate')).position,
        visibleControls:[...document.querySelectorAll('main input,main select,main button,main textarea')].filter(e=>e.getBoundingClientRect().width>0).length,
        originalsHidden:[...document.querySelectorAll('[data-jha-preview-content]')].every(e=>e.hidden&&e.inert&&getComputedStyle(e).display==='none')
      }));
      assert.ok(metrics.scroll <= metrics.width, `${fixture.page}: no overflow at ${width}px`);
      assert.equal(metrics.position,'static');
      assert.equal(metrics.visibleControls,0);
      assert.equal(metrics.originalsHidden,true);
    }
    await page.evaluate(()=>{document.dispatchEvent(new CustomEvent('jha-preview-mode'));document.dispatchEvent(new CustomEvent('jha-preview-mode'));});
    await expect(page.locator('#jha-preview-gate')).toHaveCount(1);
    assert.deepEqual(requests,[], 'anonymous preview cannot initialize tool API requests');
    assert.deepEqual(errors,[]);
  });
  test(`${fixture.title}: pending and anonymous auth stay gated; a late real user restores once`, async t => {
    const {context,page,requests,errors} = await surface(t);
    await context.addInitScript(()=>{
      document.addEventListener('DOMContentLoaded',()=>{
        const el=document.createElement('div'); el.id='fixture-hidden-panel';el.hidden=true;el.inert=true;
        document.querySelector('main')?.appendChild(el);
      });
    });
    await context.route('**/api/**',async route=>{
      const url=new URL(route.request().url());
      if (url.origin !== base) return route.abort();
      if (route.request().headers().authorization) {
        url.searchParams.set('plan','free');
        return route.fulfill({response:await route.fetch({url:url.href})});
      }
      return route.continue();
    });
    await page.goto(`${base}/${fixture.page}.html?plan=visitor`);
    await expect(page.locator('#jha-preview-gate')).toBeVisible();
    await ready(page);
    for (const state of ['pending','anonymous']) {
      await page.evaluate(state=>{
        const user=state==='pending'?{_authPending:true}:null;
        window.FirebaseAuthManager.getCurrentUser=()=>user;
        window.FirebaseAuthManager.waitForAuthReady=async()=>user;
        document.dispatchEvent(new CustomEvent('firebase-auth-ready',{detail:{user}}));
      },state);
      await expect(page.locator('#jha-preview-gate')).toBeVisible();
      await expect(page.locator(fixture.input)).toBeHidden();
    }
    assert.deepEqual(requests,[]);
    await page.evaluate(()=>{
      const user={uid:'late-fixture',email:'late@example.test',emailVerified:true,getIdToken:async()=> 'fixture-token'};
      window.FirebaseAuthManager.getCurrentUser=()=>user;
      window.FirebaseAuthManager.waitForAuthReady=async()=>user;
      window.FirebaseAuthManager.isAuthenticated=()=>true;
      localStorage.setItem('user-plan','free');
      document.dispatchEvent(new CustomEvent('firebase-auth-ready',{detail:{user}}));
      document.dispatchEvent(new CustomEvent('firebase-auth-ready',{detail:{user}}));
    });
    await expect(page.locator('#jha-preview-gate')).toHaveCount(0);
    await expect(page.locator(fixture.input)).toBeVisible();
    await expect(page.locator(fixture.input)).toBeEnabled();
    assert.deepEqual(await page.evaluate(()=>({
      hidden:document.getElementById('fixture-hidden-panel').hidden,
      inert:document.getElementById('fixture-hidden-panel').inert,
      markers:document.querySelectorAll('[data-jha-preview-content]').length,
      preview:window.__JHA_PREVIEW_MODE__
    })),{hidden:true,inert:true,markers:0,preview:false});
    await page.locator(fixture.input).fill('QA Engineer');
    if (fixture.page==='interview-questions') {
      await page.locator('#btn-generate').click();
      await expect(page.locator('#iq-questions')).toContainText('Synthetic practice question 1');
      assert.equal(requests.filter(path=>path==='/api/interview-questions/generate').length,1,'late auth must not duplicate generation handlers');
    }
    assert.deepEqual(errors,[]);
  });
  test(`${fixture.title}: a signed-in free account opens the actual tool`, async t => {
    const {page,errors} = await surface(t);
    await page.goto(`${base}/${fixture.page}.html?plan=free`);
    await ready(page);
    await expect(page.locator(fixture.input)).toBeVisible();
    await expect(page.locator(fixture.input)).toBeEnabled();
    await expect(page.locator('#jha-preview-gate')).toHaveCount(0);
    await page.locator(fixture.input).fill('QA Engineer');
    assert.deepEqual(errors,[]);
  });
}
