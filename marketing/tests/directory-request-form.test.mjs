import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../directory/request-form.js',import.meta.url),'utf8');
function setup(host='dev0.jobhackai-app-marketing-seo.pages.dev',search='') {
 const nodes={},calls=[],events=[];let submit,outcome='offline',consent=false;
 for(const id of ['directory-request','request-submit','request-error','request-environment','request-reference','request-success','directory-category']) nodes[id]={hidden:false,disabled:true,textContent:'',focus(){this.focused=true;},reportValidity:()=>true,addEventListener:(name,fn)=>{submit=fn;}};
 nodes['directory-category'].value='mobile-detailing';
 const fields={business_name:'Test',website:'https://example.com',service_area:'Covington',service_details:'Synthetic',contact_email:'owner@example.com'};
 Object.defineProperty(fields,'category',{enumerable:true,get:()=>nodes['directory-category'].value});
 vm.runInNewContext(source,{document:{getElementById:id=>nodes[id]},window:{location:{hostname:host,search},JHA:{cookieConsent:{hasAnalyticsConsent:()=>consent},gtagSafe:(...args)=>events.push(args)}},URLSearchParams,crypto,AbortController,setTimeout,clearTimeout,FormData:class {constructor(){return new Map(Object.entries(fields));}},fetch:async(url,init)=>{calls.push({url,...init});if(outcome==='offline')throw Error();return {ok:outcome!=='invalid',status:outcome==='invalid'?400:201,json:async()=>outcome==='invalid'?{errors:{contact_email:'Enter a valid contact email.'}}:{ok:true,request_id:'saved-reference',duplicate:outcome==='duplicate'}};}});
 return {nodes,calls,events,fields,send:()=>submit({preventDefault(){}}),outcome:value=>outcome=value,consent:value=>consent=value};
}
test('failed transport keeps form and reuses idempotency key; success focuses receipt without tracking unconsented',async()=>{
 const f=setup();await f.send();assert.equal(f.nodes['directory-request'].hidden,false);assert.equal(f.nodes['request-error'].focused,true);
 f.outcome('saved');await f.send();assert.equal(JSON.parse(f.calls[0].body).submission_key,JSON.parse(f.calls[1].body).submission_key);
 assert.equal(f.nodes['directory-request'].hidden,true);assert.equal(f.nodes['request-success'].focused,true);assert.match(f.nodes['request-reference'].textContent,/saved-reference/);assert.equal(f.events.length,0);
});
test('validation errors retain input; edited retry gets new key',async()=>{
 const f=setup();f.outcome('invalid');await f.send();assert.match(f.nodes['request-error'].textContent,/valid contact email/);
 f.fields.contact_email='new@example.com';await f.send();assert.notEqual(JSON.parse(f.calls[0].body).submission_key,JSON.parse(f.calls[1].body).submission_key);assert.equal(f.nodes['directory-request'].hidden,false);
});
test('saved event requires consent and new record; sends no fields or identifier',async()=>{
 const f=setup();f.consent(true);f.outcome('saved');await f.send();assert.equal(f.events[0][1],'directory_request_saved');assert.doesNotMatch(JSON.stringify(f.events),/example.com|saved-reference|business_name/);
 const duplicate=setup();duplicate.consent(true);duplicate.outcome('duplicate');await duplicate.send();assert.equal(duplicate.events.length,0);
});
test('QA, production and unrecognized previews cannot write dev',()=>{
 for(const host of ['jobhackai.io','qa-marketing.jobhackai.io','branch.jobhackai-app-marketing-seo.pages.dev']) assert.equal(setup(host).nodes['request-submit'].disabled,true);
});

test('EV deep link selects and submits its category, with aggregate-only attribution',async()=>{
 const f=setup(undefined,'?category=ev-charger-installation&email=ignored@example.com');
 assert.equal(f.nodes['directory-category'].value,'ev-charger-installation');f.outcome('saved');f.consent(true);await f.send();
 assert.equal(JSON.parse(f.calls[0].body).category,'ev-charger-installation');assert.equal(f.events[0][2].directory_category,'ev_charger_installation');assert.equal(f.events[0][2].directory_market,'greater_cincinnati_tri_state');assert.doesNotMatch(JSON.stringify(f.events),/ignored|example.com|saved-reference/);
});
test('changing category starts a distinct logical submission while unchanged retries reuse the key',async()=>{
 const f=setup();await f.send();f.nodes['directory-category'].value='ev-charger-installation';await f.send();await f.send();
 const payloads=f.calls.map(x=>JSON.parse(x.body));assert.notEqual(payloads[0].submission_key,payloads[1].submission_key);assert.equal(payloads[1].submission_key,payloads[2].submission_key);
});
test('unknown query categories retain the default; unsupported form values never submit',async()=>{
 const f=setup(undefined,'?category=private@example.com');assert.equal(f.nodes['directory-category'].value,'mobile-detailing');f.nodes['directory-category'].value='invalid';await f.send();assert.equal(f.calls.length,0);assert.match(f.nodes['request-error'].textContent,/category/);
});
test('legacy cached forms still explicitly submit the existing detailing category',async()=>{
 const f=setup();f.nodes['directory-category'].value='';await f.send();assert.equal(JSON.parse(f.calls[0].body).category,'mobile-detailing');
});
