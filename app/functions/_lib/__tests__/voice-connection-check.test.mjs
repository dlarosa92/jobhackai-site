import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const page = readFileSync(new URL('../../../../voice-connection-check.html', import.meta.url), 'utf8');
const source = page.match(/<script type="module">([\s\S]*?)<\/script>/)[1]
  .replace(/import authManager from [^;]+;/, '');
async function harness(responses, initialUser={getIdToken:async()=> 'test-only-token'}) {
  const nodes = new Map(), events = {}, calls = [], peers = [], order = [];
  const element = id => {
    if (!nodes.has(id)) nodes.set(id, {disabled:true,textContent:'',addEventListener(type, fn) {this[type] = fn;}});
    return nodes.get(id);
  };
  const timers = new Set();
  class AudioContext {
    state='suspended';
    resume() { order.push('resume'); this.state='running'; return Promise.resolve(); }
    close() { this.state='closed'; return Promise.resolve(); }
    createMediaStreamDestination() { return {stream:{getAudioTracks:()=>[{stop(){}}],getTracks:()=>[{stop(){}}]}}; }
  }
  class RTCPeerConnection {
    constructor() {peers.push(this);}
    addTrack() {}
    createDataChannel() {return this.channel={close(){}};}
    async createOffer() {return {type:'offer',sdp:'v=0-test'};}
    async setLocalDescription(value) {this.localDescription=value;}
    async setRemoteDescription() {this.channel.onopen();}
    close() {this.connectionState='closed'; this.onconnectionstatechange?.();}
  }
  await vm.runInNewContext('(async()=>{' + source + '})()', {
    document:{getElementById:element},location:{hostname:'qa.jobhackai.io'},AudioContext,RTCPeerConnection,
    authManager:{waitForAuthReady:async()=>initialUser,onAuthStateChange(fn){events.auth=fn;}},
    crypto:{randomUUID:()=> '11111111-1111-4111-8111-111111111111'},Date,AbortSignal,
    setTimeout(fn, ms) {const timer=setTimeout(fn,ms);timers.add(timer);return timer;},
    clearTimeout(timer) {clearTimeout(timer);timers.delete(timer);},
    addEventListener(type, fn) {events[type]=fn;},
    async fetch(path, init) {
      order.push('fetch'); const body=init.body ? JSON.parse(init.body) : null;
      calls.push({path,body}); const response=responses.shift();
      if (response instanceof Error) throw response;
      return {ok:true,status:200,json:async()=>response};
    }
  });
  const flush=async()=>{for(let i=0;i<10;i++)await new Promise(resolve=>setImmediate(resolve));};
  return {element,events,calls,peers,order,flush,
    async click(id) {assert.equal(element(id).disabled,false,id+' enabled');element(id).click();await flush();},
    cleanup() {for(const timer of timers)clearTimeout(timer);}};
}
const plan={voice:{transport:'managed'}}, opened={attemptId:'attempt-1',sdp:'v=0-answer'};
test('pending authentication does not enable Start and a later user does', async t=>{
  const h=await harness([], {_authPending:true});t.after(h.cleanup);
  assert.equal(h.element('start').disabled,true);
  h.events.auth({getIdToken:async()=> 'test-only-token'});
  assert.equal(h.element('start').disabled,false);assert.equal(h.calls.length,0);
});
test('preflight failure leaves Start retryable and starts audio before awaiting network', async t=>{
  const h=await harness([new Error('offline')]);t.after(h.cleanup);
  await h.click('start');
  assert.deepEqual(h.order,['resume','fetch']);
  assert.equal(h.element('start').disabled,false);
  assert.equal(h.peers.length,0);
});
test('saved but pending closure remains finishable and retains unload warning', async t=>{
  const h=await harness([plan,opened,{}, {saved:true,connectionClosed:false,closureNeedsReview:false}, {},
    {saved:true,connectionClosed:true}]);t.after(h.cleanup);
  await h.click('start'); await h.click('finish');
  assert.equal(h.element('finish').disabled,false);
  let warned=false;h.events.beforeunload({preventDefault(){warned=true;}});assert.equal(warned,true);
  await h.click('finish');assert.equal(h.element('status').textContent,'Check finished.');
  warned=false;h.events.beforeunload({preventDefault(){warned=true;}});assert.equal(warned,false);
});
test('successful reconnect completes normally using the original session and replacement attempt', async t=>{
  const h=await harness([plan,opened,{attemptId:'attempt-2',sdp:'v=0-answer'},{},{saved:true,connectionClosed:true}]);t.after(h.cleanup);
  await h.click('start');await h.click('drop');await h.click('reconnect');await h.click('finish');
  assert.equal(h.calls[2].body.sessionId,h.calls[1].body.sessionId);
  assert.equal(h.calls[2].body.replacesAttemptId,'attempt-1');
  assert.equal(h.calls.at(-1).body.reason,'user_ended');
});
test('failed reconnect requires Finish and does not replay an uncertain create', async t=>{
  const h=await harness([plan,opened,new Error('timeout'),{}, {saved:true,connectionClosed:false,closureNeedsReview:true}]);t.after(h.cleanup);
  await h.click('start');await h.click('drop');await h.click('reconnect');
  assert.equal(h.element('reconnect').disabled,true);assert.equal(h.element('finish').disabled,false);
  await h.click('finish');assert.equal(h.calls.at(-1).body.reason,'connection_lost');
  assert.match(h.element('status').textContent,/needs review/);
});
