// Local browser regression surface: actual candidate navigation and DOM,
// synthetic auth/HTTP boundaries, no analytics or remote requests.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../../..');
const plans = ['visitor', 'free', 'weekly', 'monthly', 'pack', 'trial', 'essential', 'pro', 'premium'];

function fixtureHtml(copy, displayPlan) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Navigation regression — ${copy}</title>
${['tokens', 'reset', 'main', 'header'].map(name => `<link rel="stylesheet" href="/css/${name}.css?copy=${copy}">`).join('')}
<style>main{max-width:1000px;margin:2rem auto;padding:1rem}pre{white-space:pre-wrap;overflow-wrap:anywhere}button.fixture-button{padding:.6rem;margin:.4rem}#result{font-weight:700}</style>
<script>
const fixtureState = {plan:${JSON.stringify(displayPlan)}, user:null, requests:0};
function fixtureSetPlan(plan) {
  fixtureState.plan=plan;
  fixtureState.user=plan==='visitor'?null:{uid:'navigation-fixture-'+plan,email:'fixture@example.test',emailVerified:true,getIdToken:async()=> 'fixture-token'};
  for(const store of [localStorage,sessionStorage]) {
    store.removeItem('logout-intent'); store.removeItem('force-logged-out');
    store.setItem('user-authenticated',String(!!fixtureState.user));
    store.setItem('user-plan',plan); store.removeItem('dev-plan');
    store.removeItem('firebase:authUser:navigation-fixture:[DEFAULT]');
    if(fixtureState.user) store.setItem('firebase:authUser:navigation-fixture:[DEFAULT]',JSON.stringify(fixtureState.user));
  }
}
fixtureSetPlan(fixtureState.plan);
window.__REAL_AUTH_READY=true;
window.FirebaseAuthManager={getCurrentUser:()=>fixtureState.user,isAuthenticated:()=>!!fixtureState.user,waitForAuthReady:async()=>fixtureState.user};
window.fetch=async()=> {fixtureState.requests++;return new Response(JSON.stringify({plan:fixtureState.plan,voice:{enabled:false}}),{headers:{'Content-Type':'application/json'}});};
function fixtureCache(mode) {
  if(mode==='missing') {delete window.PlanCache;return;}
  window.PlanCache={getCachedPlan:()=>null,setCachedPlan:()=>{},getPlan:()=> {
    if(mode==='pending') return new Promise(()=>{});
    if(mode==='failed') return Promise.resolve(null);
    return Promise.resolve({plan:fixtureState.plan,voice:{enabled:false}});
  }};
}
fixtureCache('missing');
</script></head><body>
<header class="site-header"><div class="container">
<a class="nav-logo" href="#"><svg width="24" height="24" fill="none" stroke="#1F2937" stroke-width="2"><rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7V5a2 2 0 012-2h4a2 2 0 012 2v2"/></svg><span>JOBHACKAI<sup>&trade;</sup></span></a>
<div class="nav-group"><nav class="nav-links" aria-label="Main navigation"></nav></div>
<button class="mobile-toggle" aria-label="Open navigation menu" aria-expanded="false" aria-controls="mobileNav">☰</button>
</div></header><nav class="mobile-nav" id="mobileNav" aria-label="Mobile navigation"></nav>
<main><h1>Navigation regression: ${copy}</h1>
<p>Actual candidate navigation; synthetic accounts. No remote requests or real sign-in. Do not follow product links.</p>
<button class="fixture-button" id="run">Run DOM regression matrix</button>
<label>Display plan <select id="display-plan">${plans.map(plan=>`<option${plan===displayPlan?' selected':''}>${plan}</option>`).join('')}</select></label>
<label>Render path <select id="display-renderer"><option>updateNavigation</option><option>applyNavForUser</option></select></label>
<button class="fixture-button" id="display">Show selected plan</button>
<p id="result" role="status">Ready</p><pre id="details"></pre></main>
${copy==='marketing'?'<script src="/candidate-components.js"></script>':''}
<script src="/candidate-navigation.js?copy=${copy}"></script>
<script src="/candidate-mobile-menu.js?copy=${copy}"></script><script>
function assert(condition,message) {if(!condition) throw new Error(message);}
function checkPlan(plan) {
  const state=window.JobHackAINavigation.getAuthState();
  assert(state.isAuthenticated===(plan!=='visitor'),'Authentication changed for '+plan);
  assert(state.userPlan===(plan==='visitor'?null:plan),'Stored plan '+plan+' became '+state.userPlan);
  const effective=window.JobHackAINavigation.getEffectivePlan();
  assert(effective===plan,'Effective plan '+plan+' became '+effective);
}
function checkContainer(container,plan) {
  const links=[...container.querySelectorAll('a')];
  const voice=links.filter(link=>link.textContent.trim()==='Voice Mock Interview');
  const primary=voice.filter(link=>!link.closest('.nav-dropdown,.mobile-nav-group'));
  assert(voice.length===(plan==='visitor'?0:1),'Voice link count '+voice.length);
  assert(primary.length===0,'Unexpected top-level Voice shortcut');
  for(const link of voice) assert(link.getAttribute('aria-disabled')!=='true'&&!link.classList.contains('locked-link'),'Voice must be clickable');
  if(plan==='visitor') {
    assert(links.some(link=>link.textContent.trim()==='Features'),'Features remains discoverable');
  }
  else {
    const target=new URL(voice[0].href);
    assert(target.origin===${JSON.stringify(copy==='marketing'?'https://dev.jobhackai.io':'https://app.jobhackai.io')}&&target.pathname==='/voice-interview.html','App target '+target.href);
    const nested=voice.find(link=>link.closest('.nav-dropdown,.mobile-nav-group'));
    const group=nested.closest('.nav-dropdown,.mobile-nav-group');
    assert(group?.querySelector('.nav-dropdown-toggle,.mobile-nav-trigger')?.textContent.trim()==='Interview Prep','Voice must be under Interview Prep');
    assert(group.querySelector('.nav-dropdown-menu a,.mobile-nav-submenu a')===nested,'Voice must be first under Interview Prep');
    for(const link of voice) assert(link.href===nested.href,'Voice entry points must share the app target');
    for(const label of ['Resume Feedback','Cover Letter','Interview Questions','Typed Mock Interview','LinkedIn Optimizer']) {
      const link=links.find(item=>item.textContent.trim()===label);
      assert(link,'Missing '+label);
      assert(link.getAttribute('aria-disabled')!=='true'&&!link.classList.contains('locked-link'),label+' locked');
    }
  }
}
function renderAndCheck(plan,renderer) {
  checkPlan(plan);
  if(renderer==='updateNavigation') window.JobHackAINavigation.updateNavigation();
  else window.applyNavForUser(fixtureState.user);
  checkContainer(document.querySelector('.nav-links'),plan);
  checkContainer(document.getElementById('mobileNav'),plan);
}
document.getElementById('display').onclick=()=> {
  fixtureSetPlan(document.getElementById('display-plan').value);
  fixtureCache('missing'); renderAndCheck(fixtureState.plan,document.getElementById('display-renderer').value);
};
document.getElementById('run').onclick=async()=> {
  const rows=[];let passed=0,failed=0;
  document.getElementById('run').disabled=true;
  document.getElementById('result').textContent='Running actual DOM checks…';
  for(const mode of ['missing','pending','failed','disabled']) {
    fixtureCache(mode);
    for(const plan of ${JSON.stringify(plans)}) {
      fixtureSetPlan(plan);
      for(const renderer of ['updateNavigation','applyNavForUser']) {
        try {
          renderAndCheck(plan,renderer); renderAndCheck(plan,renderer);
          await Promise.resolve();
          checkPlan(plan);
          checkContainer(document.querySelector('.nav-links'),plan);
          checkContainer(document.getElementById('mobileNav'),plan);
          passed++;rows.push('PASS '+mode+' / '+plan+' / '+renderer+' / desktop+mobile repeated');
        } catch(error) {failed++;rows.push('FAIL '+mode+' / '+plan+' / '+renderer+': '+error.message);}
      }
    }
  }
  fixtureSetPlan(${JSON.stringify(displayPlan)});fixtureCache('missing');
  window.JobHackAINavigation.updateNavigation();
  document.getElementById('details').textContent=rows.join(String.fromCharCode(10));
  document.getElementById('result').textContent=passed+' passed; '+failed+' failed. Both render paths and both DOM containers checked.';
  document.getElementById('result').dataset.failures=String(failed);
  document.getElementById('run').disabled=false;
};
</script></body></html>`;
}

function startNavigationFixture({port=43181}={}) {
  const server=http.createServer((req,res)=> {
    const url=new URL(req.url,'http://localhost');
    const copy=url.searchParams.get('copy')==='marketing'?'marketing':'root';
    const plan=plans.includes(url.searchParams.get('displayPlan'))?url.searchParams.get('displayPlan'):'monthly';
    res.setHeader('Cache-Control','no-store');
    res.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'none'; base-uri 'none'");
    if(req.method!=='GET') {res.writeHead(405);return res.end();}
    if(url.pathname==='/'||url.pathname==='/navigation-fixture.html') {
      res.setHeader('Content-Type','text/html');return res.end(fixtureHtml(copy,plan));
    }
    const sourceRoot=copy==='marketing'?path.join(root,'marketing'):root;
    let file,type;
    if(url.pathname==='/candidate-components.js') {file=path.join(root,'marketing/js/component-loader.js');type='text/javascript';}
    else if(url.pathname==='/candidate-navigation.js') {file=path.join(sourceRoot,'js/navigation.js');type='text/javascript';}
    else if(url.pathname==='/candidate-mobile-menu.js') {file=path.join(sourceRoot,'js/mobile-menu.js');type='text/javascript';}
    else if(/^\/css\/(tokens|reset|main|header)\.css$/.test(url.pathname)) {file=path.join(sourceRoot,url.pathname);type='text/css';}
    if(!file||!fs.existsSync(file)) {res.writeHead(404);return res.end('Not found');}
    res.setHeader('Content-Type',type);res.end(fs.readFileSync(file));
  });
  server.listen(port,'127.0.0.1',()=>console.log('Navigation fixture: http://localhost:'+server.address().port+'/navigation-fixture.html?copy=root&displayPlan=monthly'));
  return server;
}
module.exports={startNavigationFixture};
if(require.main===module) startNavigationFixture();
