import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../directory/directory.js',import.meta.url),'utf8');
function setup({category='ev-charger-installation',listing='leitner-electric',categoryPage=false,consent=true,visible=true,filter=false}={}) {
  const events=[],docListeners={},winListeners={},formListeners={};
  const cards=[{dataset:{region:'Cincinnati',service:'panel-upgrade'}},{dataset:{region:'Northern Kentucky',service:'indoor-outdoor'}},{dataset:{region:'Cincinnati'}}];
  const fields=new Map([['region',''],['service','']]);
  const count={textContent:''},empty={hidden:true};
  const filters={addEventListener:(name,fn)=>formListeners[name]=fn};
  const doc={body:{dataset:{directoryCategory:category,listing,categoryPage:String(categoryPage)}},visibilityState:visible?'visible':'hidden',
    getElementById:id=>id==='filters'?(filter?filters:null):id==='result-count'?count:empty,
    querySelectorAll:()=>cards,addEventListener:(name,fn)=>docListeners[name]=fn};
  const win={JHA:{cookieConsent:{hasAnalyticsConsent:()=>consent},gtagSafe:(...args)=>events.push(args)},addEventListener:(name,fn)=>winListeners[name]=fn};
  vm.runInNewContext(source,{document:doc,window:win,FormData:class {constructor(){return new Map(fields);}},setTimeout:fn=>fn()});
  return {events,cards,count,empty,fields,
    grant(value){consent=value;winListeners['cookie-consent-granted']();},
    visible(value){doc.visibilityState=value?'visible':'hidden';docListeners.visibilitychange();},
    filter(){formListeners.change();},reset(){fields.forEach((_,key)=>fields.set(key,''));formListeners.reset();},
    click(href){docListeners.click({target:{closest:()=>({dataset:{directoryContact:listing},getAttribute:()=>href})}});}};
}
test('EV views and contact actions retain category, listing identity and tri-state market without leaking destinations',()=>{
 const h=setup();h.click('https://provider.example/?email=private@example.com');h.click('tel:+15135551234');h.click('mailto:private@example.com');h.click('javascript:ignored');
 assert.equal(h.events.length,4);
 assert.deepEqual(h.events.slice(1).map(x=>x[2].contact_method),['provider_website','phone','email']);
 for(const [, ,p] of h.events){assert.equal(p.directory_category,'ev_charger_installation');assert.equal(p.directory_market,'greater_cincinnati_tri_state');assert.equal(p.listing_id,'leitner-electric');}
 assert.doesNotMatch(JSON.stringify(h.events),/private|5551234|provider.example|javascript/);
});
test('legacy detailing category and market remain unchanged',()=>{
 const h=setup({category:'',listing:'pearls'});assert.equal(h.events[0][2].directory_category,'mobile_detailing');assert.equal(h.events[0][2].directory_market,'nky_cincinnati');
});
test('category view waits for visible consent, occurs once and does not replay denied contacts',()=>{
 const h=setup({listing:'',categoryPage:true,consent:false,visible:false});h.click('https://provider.example');h.grant(true);assert.equal(h.events.length,0);
 h.visible(true);assert.deepEqual(h.events.map(x=>x[1]),['directory_category_view']);h.visible(false);h.visible(true);h.grant(false);h.click('tel:123');h.grant(true);assert.equal(h.events.length,1);
});
test('EV filters use only the actual form fields and label installers; missing fields are safely excluded',()=>{
 const h=setup({listing:'',filter:true});h.fields.set('service','panel-upgrade');h.filter();assert.deepEqual(h.cards.map(c=>c.hidden),[false,true,true]);assert.equal(h.count.textContent,'1 installer · alphabetical order');
 h.fields.set('region','Northern Kentucky');h.filter();assert.equal(h.count.textContent,'0 installers · alphabetical order');assert.equal(h.empty.hidden,false);
 h.reset();assert.equal(h.count.textContent,'3 installers · alphabetical order');assert.ok(h.cards.every(c=>!c.hidden));assert.equal(h.empty.hidden,true);
});
test('detailing utility filters and plural labels retain existing behavior',()=>{
 const h=setup({category:'',listing:'',filter:true});h.cards[0].dataset.utilities='self-contained';h.fields.set('utilities','self-contained');h.filter();assert.equal(h.count.textContent,'1 detailer · alphabetical order');h.reset();assert.equal(h.count.textContent,'3 detailers · alphabetical order');
});
