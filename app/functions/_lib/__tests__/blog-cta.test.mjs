import assert from 'node:assert/strict';
import { test } from 'node:test';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const source = readFileSync(new URL('../../../../js/blog-cta.js', import.meta.url), 'utf8');
function setup({consent=false,existing=true,host='jobhackai.io',observerAvailable=true}={}) {
  const calls=[],windowListeners={},documentListeners={};
  let ready=false,appended=0,observeCallback,disconnects=0,granted=consent;
  const cta={innerHTML:'old trial',classList:{add(){}},setAttribute(name){if(name==='data-blog-cta-ready')ready=true;}};
  const article={appendChild(){appended++;}};
  const document={readyState:'complete',visibilityState:'visible',title:'Interview guide',body:{dataset:{assetId:'tell_me_about_yourself_blog_01'}},
    querySelector(selector){return selector==='[data-blog-cta-ready]'?(ready?cta:null):selector==='article'?article:selector==='.post-cta'?(existing?cta:null):selector==='h1'?{textContent:'Interview guide'}:null;},
    createElement(){return cta;},addEventListener(name,fn){documentListeners[name]=fn;},removeEventListener(name){delete documentListeners[name];}};
  const window={location:{hostname:host,pathname:'/blog/test-interview/'},JHA:{cookieConsent:{hasAnalyticsConsent:()=>granted},gtagSafe:(...args)=>calls.push(args)},
    addEventListener(name,fn){windowListeners[name]=fn;},removeEventListener(name){delete windowListeners[name];}};
  class Observer {constructor(fn){observeCallback=fn;}observe(){}disconnect(){disconnects++;}}
  const context=vm.createContext({window,document,IntersectionObserver:observerAvailable?Observer:undefined});
  vm.runInContext(source,context);
  return {calls,cta,document,windowListeners,documentListeners,grant(value){granted=value;},
    intersect(ratio){observeCallback([{isIntersecting:ratio>0,intersectionRatio:ratio}]);},rerun(){vm.runInContext(source,context);},get appended(){return appended;},get disconnects(){return disconnects;}};
}
test('an existing article CTA is updated once without appending a second offer',()=>{
  const h=setup({consent:true});h.rerun();
  assert.equal(h.appended,0);assert.equal(h.calls.length,0);
  assert.ok(h.cta.innerHTML.includes('feedback preview'));assert.ok(h.cta.innerHTML.includes('https://app.jobhackai.io/pricing'));
  assert.ok(!/29\/mo|3.day|trial/i.test(h.cta.innerHTML));
});
test('a missing CTA is inserted but a below-fold render is not an impression',()=>{
  const h=setup({existing:false,consent:true});assert.equal(h.appended,1);h.intersect(0);h.intersect(.2);assert.equal(h.calls.length,0);
  h.intersect(.8);h.intersect(1);assert.equal(h.calls.length,1);assert.equal(h.disconnects,1);
  assert.equal(h.calls[0][1],'blog_cta_view');assert.equal(h.calls[0][2].asset_id,'tell_me_about_yourself_blog_01');
});
test('visible CTA waits for consent and sends only once when consent is granted',()=>{
  const h=setup();h.intersect(1);assert.equal(h.calls.length,0);
  h.grant(true);h.windowListeners['cookie-consent-granted']();assert.equal(h.calls.length,1);
  assert.equal(h.windowListeners['cookie-consent-granted'],undefined);
});
test('scrolling away before consent does not manufacture a view',()=>{
  const h=setup();h.intersect(1);h.intersect(0);h.grant(true);h.windowListeners['cookie-consent-granted']();assert.equal(h.calls.length,0);
  h.intersect(1);assert.equal(h.calls.length,1);
});
test('hidden pages wait for visibility and browsers without observation emit no impression',()=>{
  const h=setup({consent:true});h.document.visibilityState='hidden';h.intersect(1);assert.equal(h.calls.length,0);
  h.document.visibilityState='visible';h.documentListeners.visibilitychange();assert.equal(h.calls.length,1);
  const unsupported=setup({observerAvailable:false,consent:true});unsupported.windowListeners['cookie-consent-granted']();assert.equal(unsupported.calls.length,0);
});
test('preview CTA destinations never open production billing',()=>{
  for(const [host,base] of [['qa.jobhackai.io','qa'],['develop.jobhackai-app-marketing-seo.pages.dev','qa'],['dev0.jobhackai-app-marketing-seo.pages.dev','dev'],['localhost','dev']]){
    assert.ok(setup({host}).cta.innerHTML.includes(`https://${base}.jobhackai.io/pricing`),host);
  }
});
test('marketing preview navigation and footer use the matching nonproduction app',()=>{
  const components=readFileSync(new URL('../../../../marketing/js/component-loader.js',import.meta.url),'utf8');
  for(const [host,base] of [['jobhackai.io','app'],['www.jobhackai.io','app'],['qa.jobhackai.io','qa'],['develop.jobhackai-app-marketing-seo.pages.dev','qa'],['dev0.jobhackai-app-marketing-seo.pages.dev','dev'],['localhost','dev']]){
    const link={getAttribute:()=>'/cookies',href:''};
    const window={location:{hostname:host}};
    const document={readyState:'complete',querySelectorAll:selector=>selector.includes('data-app-path')?[link]:[]};
    vm.runInNewContext(components,{window,document,console});
    assert.equal(window.getAppBaseUrl(),`https://${base}.jobhackai.io`);
    assert.equal(link.href,`https://${base}.jobhackai.io/cookies`);
  }
});
