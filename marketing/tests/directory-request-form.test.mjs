import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../directory/request-form.js',import.meta.url),'utf8');
function setup(host='dev0.jobhackai-app-marketing-seo.pages.dev') {
 const nodes={},calls=[],events=[];let submit,outcome='offline',consent=false;
 for(const id of ['directory-request','request-submit','request-error','request-environment','request-reference','request-success']) nodes[id]={hidden:false,disabled:true,textContent:'',focus(){this.focused=true;},reportValidity:()=>true,addEventListener:(name,fn)=>{submit=fn;}};
 const fields={business_name:'Test',website:'https://example.com',service_area:'Covington',service_details:'Synthetic',contact_email:'owner@example.com'};
 vm.runInNewContext(source,{document:{getElementById:id=>nodes[id]},window:{location:{hostname:host},JHA:{cookieConsent:{hasAnalyticsConsent:()=>consent},gtagSafe:(...args)=>events.push(args)}},crypto,AbortController,setTimeout,clearTimeout,FormData:class {constructor(){return new Map(Object.entries(fields));}},fetch:async(url,init)=>{calls.push({url,...init});if(outcome==='offline')throw Error();return {ok:outcome!=='invalid',status:outcome==='invalid'?400:201,json:async()=>outcome==='invalid'?{errors:{contact_email:'Enter a valid contact email.'}}:{ok:true,request_id:'saved-reference',duplicate:outcome==='duplicate'}};}});
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
