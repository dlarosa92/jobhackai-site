// Voice interview client test suite (standalone, no framework)
// Run: node app/functions/_lib/__tests__/voice-client.test.mjs
//
// These drive the REAL js/voice-interview.js against a stub DOM and a routed
// fetch (see helpers/voice-client-harness.mjs), because both defects they pin
// live in the client's own wiring rather than in a pure helper:
//
//   1. Opening a Safety session from history rendered its explanation into a
//      container that ships hidden, so the report panel came up blank.
//   2. "I want to end this interview, can you end it for me?" was committed to
//      the transcript, persisted, and quoted back as scored report feedback.

import assert from 'node:assert/strict';
import {
  createVoiceClientHarness,
  scoredSessionPayload,
  safetySessionPayload,
  PLAN_PAYLOAD
} from './helpers/voice-client-harness.mjs';

let passed = 0;
let failed = 0;
const pending = [];
function test(name, fn) {
  pending.push(async () => {
    try { await fn(); passed++; console.log(`  ✓ ${name}`); }
    catch (err) { failed++; console.error(`  ✗ ${name}\n    ${err.message}`); }
  });
}

// Open voice-interview.html?session=<id> — what clicking a history row does.
async function openPastSession(payload) {
  const harness = createVoiceClientHarness({
    search: '?session=' + payload.sessionId,
    routes: {
      '/api/plan/me': () => PLAN_PAYLOAD,
      '/api/voice/sessions': () => ({ sessions: [] }),
      '/api/voice/session/': () => payload
    }
  });
  await harness.ready();
  return harness;
}

// ------------------------------------------------- safety history rendering

test('opening a Safety session from history renders the safety state instead of a blank panel', async () => {
  const h = await openPastSession(safetySessionPayload());
  try {
    const card = h.el('vi-scorecard');
    // The defect exactly: correct HTML written into a container that ships
    // display:none, with the status line hidden too — nothing on screen.
    assert.notEqual(card.style.display, 'none', 'the report panel must be visible');
    assert.ok(card.innerHTML.length > 0, 'the report panel must not be empty');
    assert.equal(h.el('vi-done-view').style.display, '', 'the done view is the one on screen');

    // It says what happened and that there is deliberately no score.
    assert.ok(card.innerHTML.includes('Interview ended early for safety'));
    assert.ok(card.innerHTML.includes('No score is given for a safety-ended session'));
    assert.ok(card.innerHTML.includes('nothing about it counts against you'));
    // Preserved metadata still renders.
    assert.ok(card.innerHTML.includes('Saved to history'));
    assert.ok(card.innerHTML.includes('Product Manager'));
  } finally { h.dispose(); }
});

test('a Safety session stays scoreless: no score, no dimensions, no coaching, no upgrade wall', async () => {
  const h = await openPastSession(safetySessionPayload());
  try {
    const html = h.el('vi-scorecard').innerHTML;
    for (const marker of ['vi-sc-overall', 'vi-sc-score', 'vi-sc-dims', 'vi-sc-delta', 'vi-sao-bal', 'Top strength', 'Improve this first', 'vi-sc-locked']) {
      assert.ok(!html.includes(marker), `safety report must not contain ${marker}`);
    }
    assert.ok(!html.includes('Your interview report'));
  } finally { h.dispose(); }
});

test('a Safety session never polls for a scorecard the server deliberately never writes', async () => {
  const h = await openPastSession(safetySessionPayload());
  try {
    await h.settle();
    const gets = h.requests.filter((r) => r.url.includes('/api/voice/session/') && r.method === 'GET');
    assert.equal(gets.length, 1, 'one read, then the safety state — no scoring poll');
    assert.equal(h.completeBodies().length, 0, 'reopening a past session never re-completes it');
  } finally { h.dispose(); }
});

test('regression: a legacy safety row with a stored score still renders scoreless', async () => {
  // A few rows were scored before suppression existed. That report is the one
  // that framed a crisis disclosure as unprofessional behavior.
  const legacy = safetySessionPayload({
    scorecardReady: true,
    scorecard: { overall: 31, dimensions: { communication: 30, structure: 25, contentDepth: 28, roleFit: 40 }, topStrength: 'x', topImprovement: 'y' }
  });
  const h = await openPastSession(legacy);
  try {
    const html = h.el('vi-scorecard').innerHTML;
    assert.ok(html.includes('Interview ended early for safety'));
    assert.ok(!html.includes('31'), 'a legacy safety score must never surface');
    assert.ok(!html.includes('vi-sc-overall'));
  } finally { h.dispose(); }
});

test('a normal scored session from history still renders its normal report', async () => {
  const h = await openPastSession(scoredSessionPayload());
  try {
    const card = h.el('vi-scorecard');
    assert.notEqual(card.style.display, 'none');
    assert.ok(card.innerHTML.includes('Your interview report'));
    assert.ok(card.innerHTML.includes('>72<'), 'the overall score renders');
    assert.ok(card.innerHTML.includes('Communication'));
    assert.ok(card.innerHTML.includes('S + A = O structure'));
    assert.ok(card.innerHTML.includes('Top strength'));
    assert.ok(card.innerHTML.includes('Moments from your interview'));
    assert.ok(card.innerHTML.includes('Full transcript'));
    assert.ok(!card.innerHTML.includes('ended early for safety'));
  } finally { h.dispose(); }
});

// -------------------------------------------- explicit spoken end request

const LIVE_ROUTES = {
  '/api/plan/me': () => PLAN_PAYLOAD,
  '/api/voice/sessions': () => ({ sessions: [] }),
  '/api/voice/session/': (url) => (url.includes('/complete')
    ? { sessionId: 'live-1', status: 'completed' }
    : { sessionId: 'live-1', scorecardReady: false }),
  '/api/voice/session': () => ({ sessionId: 'live-1', clientSecret: 'ek_test', model: 'gpt-realtime-mini', mode: 'subscription', maxMinutes: 20 }),
  'api.openai.com/v1/realtime/calls': () => ({ __text: 'v=0 answer' })
};

// Start a session and drive it to a live interview with one real answer
// recorded. Returns the harness, positioned right before the end request.
async function liveInterviewWithOneAnswer(harnessOptions = {}) {
  const h = createVoiceClientHarness({ routes: LIVE_ROUTES, ...harnessOptions });
  await h.ready();
  h.el('vi-role').value = 'Product Manager';
  h.el('vi-seniority').value = 'Senior';
  await h.click('vi-start-btn');
  await h.openDataChannel();

  // Audio check: greeting, then the candidate's acknowledgement.
  h.event({ type: 'response.created', response: { id: 'r1' } });
  h.event({ type: 'conversation.item.created', item: { id: 'a1' } });
  h.event({ type: 'response.output_audio_transcript.done', item_id: 'a1', response_id: 'r1', transcript: 'Hi, Maya. Before we begin, can you hear me clearly?' });
  h.event({ type: 'response.done', response: { id: 'r1', usage: { input_tokens: 100, output_tokens: 50 } } });
  h.event({ type: 'conversation.item.created', item: { id: 'u1' } });
  h.event({ type: 'input_audio_buffer.committed', item_id: 'u1' });
  h.event({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'u1', transcript: 'Yes, I can hear you fine.' });

  // The opening settles the acknowledgement; the interview is officially live.
  h.event({ type: 'response.created', response: { id: 'r2' } });
  h.event({ type: 'conversation.item.created', item: { id: 'a2' } });
  h.event({ type: 'response.output_audio_transcript.done', item_id: 'a2', response_id: 'r2', transcript: 'Welcome to the mock interview for the Product Manager role. Tell me about a launch you owned.' });
  h.event({ type: 'response.done', response: { id: 'r2', usage: { input_tokens: 200, output_tokens: 90 } } });

  // A genuine answer.
  h.event({ type: 'conversation.item.created', item: { id: 'u2' } });
  h.event({ type: 'input_audio_buffer.committed', item_id: 'u2' });
  h.event({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'u2', transcript: 'I owned the checkout relaunch and cut drop-off by eighteen percent in one quarter.' });
  await h.settle(2);
  return h;
}

test('an explicit spoken end request ends the session through the normal manual-end path', async () => {
  const h = await liveInterviewWithOneAnswer();
  try {
    h.event({ type: 'conversation.item.created', item: { id: 'u3' } });
    h.event({ type: 'input_audio_buffer.committed', item_id: 'u3' });
    h.event({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'u3', transcript: 'I want to end this interview, can you end it for me?' });
    await h.settle();

    const bodies = h.completeBodies();
    assert.equal(bodies.length, 1, 'the session completes exactly once');
    assert.equal(bodies[0].reason, 'user_ended', 'it is a normal manual end, not a conduct or safety close');
  } finally { h.dispose(); }
});

test('the end request itself never reaches the transcript, the evaluation input, or the report', async () => {
  const h = await liveInterviewWithOneAnswer();
  try {
    h.event({ type: 'conversation.item.created', item: { id: 'u3' } });
    h.event({ type: 'input_audio_buffer.committed', item_id: 'u3' });
    h.event({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'u3', transcript: 'I want to end this interview, can you end it for me?' });
    await h.settle();

    // The persisted transcript IS the evaluation input: voice-scorecard.js
    // reads transcript_json and nothing else, so keeping it out here keeps it
    // out of the score, the quoted moments, and any follow-up generated from it.
    const transcript = h.completeBodies()[0].transcript;
    const spoken = transcript.map((t) => t.text).join(' | ');
    assert.ok(!spoken.includes('end this interview'), 'the control utterance must not be stored');
    assert.ok(!spoken.toLowerCase().includes('end it for me'));
    assert.ok(!transcript.some((t) => t.speaker === 'user' && /end (this|the) interview/i.test(t.text)));
  } finally { h.dispose(); }
});

test('the genuine answer immediately before the end request survives and is scored normally', async () => {
  const h = await liveInterviewWithOneAnswer();
  try {
    h.event({ type: 'conversation.item.created', item: { id: 'u3' } });
    h.event({ type: 'input_audio_buffer.committed', item_id: 'u3' });
    h.event({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'u3', transcript: 'Please end this interview.' });
    await h.settle();

    const transcript = h.completeBodies()[0].transcript;
    assert.deepEqual(transcript, [
      { speaker: 'assistant', text: 'Welcome to the mock interview for the Product Manager role. Tell me about a launch you owned.' },
      { speaker: 'user', text: 'I owned the checkout relaunch and cut drop-off by eighteen percent in one quarter.' }
    ], 'the interview keeps its real turns, in order, and only loses the control utterance');
  } finally { h.dispose(); }
});

test('the pre-interview audio-check exchange is still excluded, end request or not', async () => {
  const h = await liveInterviewWithOneAnswer();
  try {
    h.event({ type: 'conversation.item.created', item: { id: 'u3' } });
    h.event({ type: 'input_audio_buffer.committed', item_id: 'u3' });
    h.event({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'u3', transcript: 'Can you end the interview now?' });
    await h.settle();

    const spoken = h.completeBodies()[0].transcript.map((t) => t.text).join(' | ');
    assert.ok(!spoken.includes('can you hear me clearly'), 'the greeting stays out');
    assert.ok(!spoken.includes('Yes, I can hear you fine.'), 'the acknowledgement stays out');
  } finally { h.dispose(); }
});

test('an ordinary answer that merely mentions ending an interview is kept and scored', async () => {
  const h = await liveInterviewWithOneAnswer();
  try {
    const story = 'When I want to end the interview loop early I tell the recruiter the same day.';
    h.event({ type: 'conversation.item.created', item: { id: 'u3' } });
    h.event({ type: 'input_audio_buffer.committed', item_id: 'u3' });
    h.event({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'u3', transcript: story });
    await h.settle();

    assert.equal(h.completeBodies().length, 0, 'a story about interviews must not end the session');
    // ...and it is on its way to the transcript like any other answer.
    h.event({ type: 'conversation.item.created', item: { id: 'u4' } });
    h.event({ type: 'input_audio_buffer.committed', item_id: 'u4' });
    h.event({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'u4', transcript: 'Please end this interview.' });
    await h.settle();
    const spoken = h.completeBodies()[0].transcript.map((t) => t.text);
    assert.ok(spoken.includes(story), 'the narrative answer is preserved');
  } finally { h.dispose(); }
});

// ---- ASR noise fragments (live QA: standalone "You: you" / "You: Bye." turns) ----

test('a whisper noise fragment ("You.") never reaches the persisted transcript', async () => {
  const h = await liveInterviewWithOneAnswer();
  try {
    h.event({ type: 'conversation.item.created', item: { id: 'u3' } });
    h.event({ type: 'input_audio_buffer.committed', item_id: 'u3' });
    h.event({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'u3', transcript: 'You.' });
    await h.settle();
    h.event({ type: 'conversation.item.created', item: { id: 'u4' } });
    h.event({ type: 'input_audio_buffer.committed', item_id: 'u4' });
    h.event({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'u4', transcript: 'Please end this interview.' });
    await h.settle();

    const transcript = h.completeBodies()[0].transcript;
    assert.deepEqual(transcript, [
      { speaker: 'assistant', text: 'Welcome to the mock interview for the Product Manager role. Tell me about a launch you owned.' },
      { speaker: 'user', text: 'I owned the checkout relaunch and cut drop-off by eighteen percent in one quarter.' }
    ], 'the noise fragment is gone; every real turn survives in order');
  } finally { h.dispose(); }
});

test('a legitimate one-word answer ("Yes.") is kept — the noise filter never overreaches', async () => {
  const h = await liveInterviewWithOneAnswer();
  try {
    h.event({ type: 'conversation.item.created', item: { id: 'u3' } });
    h.event({ type: 'input_audio_buffer.committed', item_id: 'u3' });
    h.event({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'u3', transcript: 'Yes.' });
    await h.settle();
    h.event({ type: 'conversation.item.created', item: { id: 'u4' } });
    h.event({ type: 'input_audio_buffer.committed', item_id: 'u4' });
    h.event({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'u4', transcript: 'Please end this interview.' });
    await h.settle();

    const spoken = h.completeBodies()[0].transcript.map((t) => t.text);
    assert.ok(spoken.includes('Yes.'), 'a real short answer must be stored and scored');
  } finally { h.dispose(); }
});

test('a stray "Bye." neither ends the session nor reaches the transcript', async () => {
  const h = await liveInterviewWithOneAnswer();
  try {
    h.event({ type: 'conversation.item.created', item: { id: 'u3' } });
    h.event({ type: 'input_audio_buffer.committed', item_id: 'u3' });
    h.event({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'u3', transcript: 'Bye.' });
    await h.settle();
    assert.equal(h.completeBodies().length, 0, '"Bye." is not an end request; the interview stays live');

    h.event({ type: 'conversation.item.created', item: { id: 'u4' } });
    h.event({ type: 'input_audio_buffer.committed', item_id: 'u4' });
    h.event({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'u4', transcript: 'Please end this interview.' });
    await h.settle();
    const spoken = h.completeBodies()[0].transcript.map((t) => t.text);
    assert.ok(!spoken.includes('Bye.'), 'the noise fragment stays out of storage');
  } finally { h.dispose(); }
});

test('the hand-synced fallback holds when js/voice-lifecycle.js fails to load', async () => {
  const h = await liveInterviewWithOneAnswer({ withoutModules: ['isExplicitEndRequest'] });
  try {
    h.event({ type: 'conversation.item.created', item: { id: 'u3' } });
    h.event({ type: 'input_audio_buffer.committed', item_id: 'u3' });
    h.event({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'u3', transcript: 'I want to end this interview, can you end it for me?' });
    await h.settle();

    const bodies = h.completeBodies();
    assert.equal(bodies.length, 1);
    assert.equal(bodies[0].reason, 'user_ended');
    assert.ok(!bodies[0].transcript.some((t) => t.text.includes('end this interview')));
    // ...and the degraded mode is loud, so a dev session can diagnose it.
    assert.ok(h.logs.some((l) => l[0] === 'error' && l[1].includes('voice-lifecycle.js did not load')));
  } finally { h.dispose(); }
});

// --------------------------------------------------- live safety end view

test('a session that ends live for safety shows the same visible, scoreless state', async () => {
  // Same hidden-container defect as the history path: renderSafetyEnd is the
  // only renderer that never unhid #vi-scorecard, so the in-session safety
  // view came up blank too.
  const h = await liveInterviewWithOneAnswer();
  try {
    h.event({ type: 'output_audio_buffer.started', response_id: 'r3' });
    h.event({
      type: 'response.done',
      response: {
        id: 'r3',
        output: [{ type: 'function_call', name: 'end_for_safety', call_id: 'call_1', arguments: '{}' }]
      }
    });
    h.event({ type: 'output_audio_buffer.stopped', response_id: 'r3' });
    await h.settle();

    assert.equal(h.completeBodies()[0].reason, 'ended_for_safety');
    const card = h.el('vi-scorecard');
    assert.notEqual(card.style.display, 'none');
    assert.ok(card.innerHTML.includes('Interview ended early for safety'));
    assert.ok(!card.innerHTML.includes('vi-sc-overall'));
  } finally { h.dispose(); }
});

// ------------------------------------------------------------- pace guards

test('the client adds no fixed silence cutoff and no artificial turn delay', async () => {
  const h = await liveInterviewWithOneAnswer();
  try {
    // Everything the client sends on the data channel across a whole session:
    // the audio-check response.create and nothing that reconfigures turn
    // detection or paces the conversation.
    const types = h.sends.map((s) => s.type);
    assert.deepEqual(types, ['response.create'], 'the client only ever requests the opening turn');
    for (const sent of h.sends) {
      assert.ok(!JSON.stringify(sent).includes('silence_duration_ms'));
      assert.ok(!JSON.stringify(sent).includes('turn_detection'));
    }
  } finally { h.dispose(); }
});

// The subscription limit is distinct from spending the lifetime free session.
for (const [name, voice, expected, disabled] of [
  ['subscriber balance', { canStart: true, unlimited: true, mode: 'subscription', monthlyLimit: 60, monthlyRemaining: 7 }, '7 of 60', false],
  ['capped subscriber', { canStart: false, unlimited: true, mode: 'subscription', reason: 'limit_reached', monthlyLimit: 60, monthlyRemaining: 0 }, '00:00 UTC', true],
  ['older subscriber API', { canStart: true, unlimited: true, mode: 'subscription' }, 'calendar-month session limit', false],
  ['free first session', { canStart: true, unlimited: false, mode: 'free' }, 'first voice interview is free', false],
  ['pack balance', { canStart: true, unlimited: false, mode: 'pack', sessionsRemaining: 3 }, '3 sessions', false]
]) {
  test('entitlement banner: ' + name, async () => {
    const h = createVoiceClientHarness({ routes: {
      '/api/plan/me': () => ({ voice: { enabled: true, ...voice } })
    } });
    try {
      await h.ready();
      assert.ok(h.el('vi-entitlement').textContent.includes(expected));
      assert.equal(h.el('vi-start-btn').disabled, disabled);
      assert.ok(!h.el('vi-entitlement').textContent.includes('unlimited'));
      if (voice.mode === 'subscription') {
        assert.ok(!h.el('vi-entitlement').innerHTML.includes('/pricing'));
        assert.ok(!h.el('vi-entitlement').textContent.includes('free voice interview is used'));
      }
    } finally { h.dispose(); }
  });
}

test('a lost creation response retries the same session id', async () => {
  let attempts = 0;
  const h = createVoiceClientHarness({ routes: {
    '/api/plan/me': () => PLAN_PAYLOAD,
    '/api/voice/sessions': () => ({ sessions: [] }),
    '/api/voice/session': () => {
      if (++attempts === 1) throw new Error('response lost');
      return { sessionId: 'retry', clientSecret: 'ek_test', model: 'test', maxMinutes: 20 };
    },
    'api.openai.com/v1/realtime/calls': () => ({ __text: 'v=0 answer' })
  } });
  try {
    await h.ready();
    h.el('vi-role').value = 'Engineer';
    await h.click('vi-start-btn');
    await h.click('vi-start-btn');
    const starts = h.requests.filter(r => r.url === '/api/voice/session');
    assert.equal(starts.length, 2);
    assert.match(starts[0].body.startRequestId, /^[0-9a-f-]{36}$/);
    assert.equal(starts[0].body.startRequestId, starts[1].body.startRequestId);
  } finally { h.dispose(); }
});

for (const reason of ['session_expired', 'session_ended']) {
  test('terminal reservation ' + reason + ' permits a new creation id', async () => {
    let attempts = 0;
    const h = createVoiceClientHarness({ routes: {
      '/api/plan/me': () => PLAN_PAYLOAD,
      '/api/voice/sessions': () => ({ sessions: [] }),
      '/api/voice/session': () => {
        attempts++;
        if (attempts === 1) throw new Error('lost response');
        if (attempts === 2) return { __status: 409, reason, error: reason };
        return { sessionId: 'new', clientSecret: 'ek_test', model: 'test', maxMinutes: 20 };
      },
      'api.openai.com/v1/realtime/calls': () => ({ __text: 'v=0 answer' })
    } });
    try {
      await h.ready(); h.el('vi-role').value = 'Engineer';
      for (let n = 0; n < 3; n++) await h.click('vi-start-btn');
      const starts = h.requests.filter(r => r.url === '/api/voice/session');
      assert.equal(starts.length, 3);
      assert.equal(starts[0].body.startRequestId, starts[1].body.startRequestId);
      assert.notEqual(starts[1].body.startRequestId, starts[2].body.startRequestId);
    } finally { h.dispose(); }
  });
}

for (const status of [401, 500]) {
  test('failed completion ' + status + ' retains the payload and offers retry before scoring', async () => {
    let attempts = 0;
    const h = await liveInterviewWithOneAnswer({ routes: {
      ...LIVE_ROUTES,
      '/api/voice/session/': (url) => url.includes('/complete')
        ? (++attempts === 1 ? { __status: status, error: 'temporary save failure' } : { status: 'completed' })
        : { scorecardReady: false }
    } });
    try {
      await h.click('vi-end-btn');
      assert.equal(h.completeBodies().length, 1);
      assert.ok(h.el('vi-save-status').textContent.includes('has not been saved'));
      assert.equal(h.el('vi-save-retry').style.display, '');
      assert.equal(h.requests.filter(r => r.method === 'GET' && r.url.includes('/api/voice/session/')).length, 0);
      const historyReads = h.requests.filter(r => r.url === '/api/voice/sessions').length;
      await h.click('vi-save-retry');
      assert.ok(h.requests.filter(r => r.url === '/api/voice/sessions').length > historyReads, 'recovered save refreshes history while scoring');
      assert.equal(h.completeBodies().length, 2);
      assert.deepEqual(h.completeBodies()[0], h.completeBodies()[1], 'retry preserves the complete original transcript and duration');
      assert.equal(h.el('vi-save-status').textContent, '');
      assert.equal(h.el('vi-save-retry').style.display, 'none');
      assert.ok(h.el('vi-done-status').textContent.includes('Interview saved'));
    } finally { h.dispose(); }
  });
}

test('closing during transcript flush warns before completion is assembled', async () => {
  const h = await liveInterviewWithOneAnswer();
  try {
    h.event({ type: 'conversation.item.created', item: { id: 'pending-answer' } });
    h.event({ type: 'input_audio_buffer.committed', item_id: 'pending-answer' });
    const ending = h.click('vi-end-btn');
    let warned = false;
    h.windowEvent('beforeunload', { preventDefault() { warned = true; } });
    assert.equal(warned, true);
    h.event({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'pending-answer', transcript: 'My last answer.' });
    await ending;
  } finally { h.dispose(); }
});

for (const t of pending) await t();
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
