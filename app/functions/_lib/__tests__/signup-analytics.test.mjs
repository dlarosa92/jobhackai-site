import test from 'node:test';
import assert from 'node:assert/strict';
import { recordVerifiedSignup, recordLinkedInRedirectSignup } from '../../../../js/signup-analytics.js';

test('new OAuth accounts are counted once without email or profile data; ordinary logins are excluded', async () => {
  const calls = [];
  global.window = { JHA: {
    gtagSafe: (...args) => calls.push(args),
    trackEventSafe: (...args) => calls.push(args),
    cookieConsent: { flushAnalyticsBeforeNavigate: async () => calls.push(['flush']) }
  } };
  const user = { uid: 'new-google', email: 'private@example.com', displayName: 'Private Name' };
  assert.equal(await recordVerifiedSignup(user, false, 'google'), false);
  assert.equal(await recordVerifiedSignup(user, undefined, 'google'), false);
  assert.equal(await recordVerifiedSignup(user, 'true', 'google'), false);
  assert.deepEqual(calls, []);
  assert.equal(await recordVerifiedSignup(user, true, 'google'), true);
  assert.equal(await recordVerifiedSignup(user, true, 'google'), false);
  assert.equal(calls.filter(x => x[0] === 'sign_up').length, 1);
  assert.equal(calls[0][0], 'set');
  assert.equal(JSON.stringify(calls).includes('private@example.com'), false);
  assert.equal(JSON.stringify(calls).includes('Private Name'), false);
  assert.equal(await recordVerifiedSignup({uid:'new-linkedin'}, true, 'linkedin'), true);
  assert.equal(calls.filter(x => x[0] === 'sign_up').length, 2);
  delete global.window;
});

test('missing or failing analytics does not break account creation', async () => {
  global.window = {};
  assert.equal(await recordVerifiedSignup({uid:'no-wrapper'}, true, 'google'), false);
  global.window.JHA = { trackEventSafe() { throw new Error('analytics unavailable'); } };
  assert.equal(await recordVerifiedSignup({uid:'failed-wrapper'}, true, 'google'), false);
  delete global.window;
});

test('LinkedIn redirect receipt is account-specific, short-lived, and consumed once', async () => {
  let receipt; const calls=[];
  global.window={sessionStorage:{getItem:()=>receipt,removeItem:()=>{receipt=null;}},JHA:{trackEventSafe:(...args)=>calls.push(args)}};
  for(const value of [{uid:'someone-else',isNewUser:true,at:Date.now()},
    {uid:'redirect-user',isNewUser:true,at:Date.now()-16*60*1000},
    {uid:'redirect-user',isNewUser:false,at:Date.now()}]) {
    receipt=JSON.stringify(value);
    assert.equal(await recordLinkedInRedirectSignup({uid:'redirect-user'}),false);
    assert.equal(receipt,null);
  }
  receipt=JSON.stringify({uid:'redirect-user',isNewUser:true,at:Date.now()});
  assert.equal(await recordLinkedInRedirectSignup({uid:'redirect-user'}),true);
  assert.equal(await recordLinkedInRedirectSignup({uid:'redirect-user'}),false);
  assert.equal(calls.length,1);assert.equal(calls[0][1].method,'linkedin');
  delete global.window;
});
