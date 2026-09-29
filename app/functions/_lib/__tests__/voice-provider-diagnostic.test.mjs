import test from 'node:test';
import assert from 'node:assert/strict';
import {voiceProviderFailureDiagnostic as diagnose} from '../voice-provider-diagnostic.js';

test('a call-not-found diagnostic retains only fixed categories, never the body or private call details', async () => {
  const result = await diagnose(new Response(JSON.stringify({error:{code:'call_not_found',type:'invalid_request_error',
    message:'Call rtc_private not found. PRIVATE_CREDENTIAL PRIVATE_TRANSCRIPT',param:'PRIVATE_SDP'}}), {status:404}));
  assert.deepEqual(result,{bodyFormat:'json',errorCode:'call_not_found',errorType:'invalid_request_error',messageClass:'call_unavailable'});
  assert.doesNotMatch(JSON.stringify(result),/PRIVATE|rtc_private/);
});

test('unknown error fields cannot become a credential or content logging channel', async () => {
  const result = await diagnose(new Response(JSON.stringify({error:{code:'sk_private_key',type:'private_transcript',message:'private answer'}})));
  assert.deepEqual(result,{bodyFormat:'json',errorCode:'other',errorType:'other',messageClass:'unclassified'});
});

test('stream cleanup failures cannot escape diagnostic handling', async () => {
  const response={body:{getReader:()=>({
    read:async()=>({done:true}), cancel(){throw Error('cancel failed');},
    releaseLock(){throw Error('release failed');}
  })}};
  assert.deepEqual(await diagnose(response),{bodyFormat:'empty',errorCode:null,errorType:null,messageClass:'unclassified'});
});

test('HTML and empty 404 responses remain distinct from a provider call-unavailable diagnostic', async () => {
  assert.deepEqual(await diagnose(new Response('<html>Not Found</html>',{status:404})),
    {bodyFormat:'non_json',errorCode:null,errorType:null,messageClass:'unclassified'});
  assert.deepEqual(await diagnose(new Response(null,{status:404})),
    {bodyFormat:'empty',errorCode:null,errorType:null,messageClass:'unclassified'});
});

test('provider authentication failures are identified without repeating the key', async () => {
  assert.deepEqual(await diagnose(new Response(JSON.stringify({error:{code:'invalid_api_key',type:'invalid_request_error',message:'Invalid API key: sk_private'}}))),
    {bodyFormat:'json',errorCode:'invalid_api_key',errorType:'invalid_request_error',messageClass:'authorization'});
});

test('oversized and stalled diagnostic streams are cancelled and do not block call handling', async () => {
  for (const oversized of [true,false]) {
    let cancelled = false;
    const response = new Response(new ReadableStream({
      start(controller) { if (oversized) controller.enqueue(new Uint8Array(8193)); },
      cancel() { cancelled = true; }
    }));
    const before = Date.now();
    assert.deepEqual(await diagnose(response),{bodyFormat:'unavailable',errorCode:null,errorType:null,messageClass:'unclassified'});
    assert.equal(cancelled,true);
    assert.ok(Date.now()-before < 2500);
  }
});
