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
    assert.ok(card.innerHTML.includes('Your practice feedback'));
    assert.ok(card.innerHTML.includes('>72<'), 'the overall score renders');
    assert.ok(card.innerHTML.includes('Communication'));
    assert.ok(card.innerHTML.includes('Answer structure'));
    assert.ok(card.innerHTML.includes('What worked'));
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

test('usage keeps one response per ID and includes the ending transcription without its words', async () => {
  const h = await liveInterviewWithOneAnswer();
  try {
    h.event({ type: 'response.done', response: { id: 'r2', usage: { input_tokens: 200, output_tokens: 90 } } });
    h.event({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'stop-usage', transcript: "I'll end the interview", usage: { type: 'tokens', input_tokens: 15, output_tokens: 5, input_token_details: { audio_tokens: 15, text_tokens: 0 } } });
    await h.settle();
    const usage = h.completeBodies()[0].usageEvidence;
    assert.equal(usage.events.filter(e => e.id === 'r2').length, 1);
    assert.equal(usage.events.find(e => e.id === 'stop-usage').usage.input_tokens, 15);
    assert.ok(!JSON.stringify(usage).includes("I'll end"));
    assert.equal(usage.source, 'client_reported');
  } finally { h.dispose(); }
});

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

for (const withoutModules of [[], ['isExplicitEndRequest']]) {
  test(`live QA standalone stop stays out of persisted transcript (${withoutModules.length ? 'fallback' : 'module'})`, async () => {
    const h = await liveInterviewWithOneAnswer({ withoutModules });
    try {
      h.event({ type: 'conversation.item.created', item: { id: 'qa-stop' } });
      h.event({ type: 'input_audio_buffer.committed', item_id: 'qa-stop' });
      h.event({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'qa-stop', transcript: "I'll end the interview." });
      await h.settle();
      const bodies = h.completeBodies();
      assert.equal(bodies.length, 1);
      assert.equal(bodies[0].reason, 'user_ended');
      assert.ok(bodies[0].transcript.some(turn => turn.speaker === 'user'), 'retain the actual answer');
      assert.ok(!bodies[0].transcript.some(turn => turn.text.includes("I'll end")));
    } finally { h.dispose(); }
  });
}

// --------------------------------------------------- live safety end view

for (const withoutModules of [[], ['isExplicitEndRequest']]) {
  for (const request of ["I'd like to end this now.", 'I would like to end this now.', 'I gotta go. Bye-bye.', 'I have to go, goodbye.']) {
    test(`QA spoken stop completes once and excludes the control (${request}, ${withoutModules.length ? 'fallback' : 'module'})`, async () => {
      const h = await liveInterviewWithOneAnswer({ withoutModules });
      try {
        h.event({ type: 'conversation.item.created', item: { id: 'qa-stop' } });
        h.event({ type: 'input_audio_buffer.committed', item_id: 'qa-stop' });
        h.event({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'qa-stop', transcript: request });
        await h.settle();
        // A repeated ASR completion must not submit another completion.
        h.event({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'qa-stop', transcript: request });
        await h.settle();
        const bodies = h.completeBodies();
        assert.equal(bodies.length, 1);
        assert.equal(bodies[0].reason, 'user_ended');
        assert.ok(bodies[0].transcript.some(turn => turn.speaker === 'user'));
        assert.ok(!bodies[0].transcript.some(turn => turn.text === request));
        assert.ok(h.peerConnection().tracks.every(track => track.enabled === false));
      } finally { h.dispose(); }
    });
  }
  test(`bare leave answer does not end a paid session (${withoutModules.length ? 'fallback' : 'module'})`, async () => {
    const h = await liveInterviewWithOneAnswer({ withoutModules });
    try {
      h.event({ type: 'conversation.item.created', item: { id: 'career-answer' } });
      h.event({ type: 'input_audio_buffer.committed', item_id: 'career-answer' });
      h.event({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'career-answer', transcript: 'I would like to leave.' });
      await h.settle();
      assert.equal(h.completeBodies().length, 0);
      assert.ok(h.peerConnection().tracks.some(track => track.enabled));
      await h.endInterview();
      assert.ok(h.completeBodies()[0].transcript.some(turn => turn.text === 'I would like to leave.'));
    } finally { h.dispose(); }
  });
}

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
    const update = h.sends.find(s => s.type === 'session.update');
    assert.deepEqual(update.session.audio.input.turn_detection,
      { type: 'semantic_vad', create_response: false, interrupt_response: true });
    assert.equal(h.sends.filter(s => s.type === 'response.create').length, 3, 'audio check, opening, and reply to committed answer');
    for (const sent of h.sends) {
      assert.ok(!JSON.stringify(sent).includes('silence_duration_ms'));
      assert.ok(!JSON.stringify(sent).includes('eagerness'), 'semantic endpointing retains its existing default');
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
      await h.endInterview();
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
    await h.click('vi-end-btn');
    const ending = h.click('vi-end-confirm-btn');
    let warned = false;
    h.windowEvent('beforeunload', { preventDefault() { warned = true; } });
    assert.equal(warned, true);
    h.event({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'pending-answer', transcript: 'My last answer.' });
    await ending;
  } finally { h.dispose(); }
});

test('a stop transcription arriving during the completion flush is excluded', async () => {
  const h = await liveInterviewWithOneAnswer();
  try {
    h.event({ type: 'conversation.item.created', item: { id: 'late-stop' } });
    h.event({ type: 'input_audio_buffer.committed', item_id: 'late-stop' });
    await h.click('vi-end-btn');
    const ending = h.click('vi-end-confirm-btn');
    h.event({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'late-stop', transcript: "I'll end the interview." });
    await ending;
    assert.equal(h.completeBodies().length, 1);
    assert.ok(!h.completeBodies()[0].transcript.some(turn => turn.text.includes("I'll end")));
    assert.ok(h.completeBodies()[0].transcript.some(turn => turn.speaker === 'user'));
  } finally { h.dispose(); }
});

test('spoken stop silences playback immediately while a late answer still flushes and saves', async () => {
  const h = await liveInterviewWithOneAnswer();
  try {
    const audio = h.el('vi-remote-audio');
    const remoteStream = { id: 'remote-audio' };
    let pauses = 0;
    audio.pause = () => { pauses++; };
    h.peerConnection().ontrack({ streams: [remoteStream] });
    h.event({ type: 'output_audio_buffer.started', response_id: 'playing-question' });
    h.event({ type: 'conversation.item.created', item: { id: 'pending-real-answer' } });
    h.event({ type: 'input_audio_buffer.committed', item_id: 'pending-real-answer' });
    h.event({ type: 'conversation.item.created', item: { id: 'spoken-stop' } });
    h.event({ type: 'input_audio_buffer.committed', item_id: 'spoken-stop' });
    h.event({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'spoken-stop', transcript: "I'll end the interview." });
    assert.ok(pauses > 0, 'playback stops before the transcript flush finishes');
    assert.equal(audio.srcObject, null);
    assert.notEqual(h.peerConnection().connectionState, 'closed', 'keep the data channel for the pending answer');
    assert.equal(h.completeBodies().length, 0, 'do not save before the pending transcript arrives');
    const sends = h.sends.length;
    h.event({ type: 'response.created', response: { id: 'racing-question' } });
    assert.ok(h.sends.slice(sends).some(event => event.type === 'response.cancel'));
    h.peerConnection().ontrack({ streams: [remoteStream] });
    assert.equal(audio.srcObject, null, 'a late media track must not restart playback');
    h.event({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'pending-real-answer', transcript: 'The final outcome was a reduction in support tickets.' });
    await h.settle();
    assert.equal(h.completeBodies().length, 1);
    assert.ok(h.completeBodies()[0].transcript.some(turn => turn.text.includes('reduction in support tickets')));
    assert.ok(!h.completeBodies()[0].transcript.some(turn => turn.text.includes("I'll end")));
  } finally { h.dispose(); }
});

test('a natural wrap-up keeps its audio until playback finishes, then releases it', async () => {
  const h = await liveInterviewWithOneAnswer();
  try {
    const audio = h.el('vi-remote-audio');
    const stream = { id: 'closing-audio' };
    audio.pause = () => {};
    h.peerConnection().ontrack({ streams: [stream] });
    h.event({ type: 'response.created', response: { id: 'closing-response' } });
    h.event({ type: 'conversation.item.created', item: { id: 'closing-item' } });
    h.event({ type: 'output_audio_buffer.started', response_id: 'closing-response' });
    h.event({ type: 'response.output_audio_transcript.done', item_id: 'closing-item', response_id: 'closing-response', transcript: 'Thank you for your time. Your written feedback report is being prepared and will appear on this page.' });
    h.event({ type: 'response.done', response: { id: 'closing-response' } });
    assert.equal(audio.srcObject, stream, 'do not cut off the natural closing line');
    assert.equal(h.completeBodies().length, 0);
    h.event({ type: 'output_audio_buffer.stopped', response_id: 'closing-response' });
    await h.settle();
    assert.equal(h.completeBodies().length, 1);
    assert.equal(h.completeBodies()[0].reason, 'completed');
    assert.equal(audio.srcObject, null);
  } finally { h.dispose(); }
});


// Connection setup can settle after End, or after a replacement connection.
// Drive actual pending browser operations rather than inspecting source text.
function deferred() {
  let resolve;
  const promise = new Promise(r => { resolve = r; });
  return { promise, resolve };
}
function trackedMic() {
  const track = { enabled: true, stop() { this.enabled = false; } };
  return { track, getTracks: () => [track], getAudioTracks: () => [track] };
}

test('End releases a microphone granted after the interview has already completed', async () => {
  const permission = deferred();
  const lateMic = trackedMic();
  let micRequests = 0;
  const h = createVoiceClientHarness({ routes: LIVE_ROUTES,
    getUserMedia: () => ++micRequests === 1 ? Promise.resolve(trackedMic()) : permission.promise });
  try {
    await h.ready(); h.el('vi-role').value = 'Product Manager';
    const starting = h.click('vi-start-btn');
    await h.settle();
    assert.equal(micRequests, 2, 'the connection microphone request is pending');
    await h.endInterview();
    permission.resolve(lateMic);
    await starting;
    assert.equal(lateMic.track.enabled, false, 'late microphone must be stopped');
    assert.equal(h.requests.filter(r => r.url.includes('/realtime/calls')).length, 0);
    assert.equal(h.peerConnection(), null);
    assert.equal(h.completeBodies().length, 1);
    assert.equal(h.el('vi-done-view').style.display, '');
    assert.equal(h.logs.filter(l => l[0] === 'alert').length, 0);
  } finally { permission.resolve(lateMic); h.dispose(); }
});

test('End aborts an in-flight SDP exchange and ignores its late answer', async () => {
  const answer = deferred();
  const h = createVoiceClientHarness({ routes: { ...LIVE_ROUTES,
    'api.openai.com/v1/realtime/calls': () => answer.promise } });
  try {
    await h.ready(); h.el('vi-role').value = 'Product Manager';
    const starting = h.click('vi-start-btn');
    await h.settle();
    const pc = h.peerConnection();
    const request = h.requests.find(r => r.url.includes('/realtime/calls'));
    assert.ok(request, 'SDP request was sent');
    await h.endInterview();
    answer.resolve({ __text: 'v=0 late answer' });
    await starting;
    assert.equal(request.signal?.aborted, true);
    assert.equal(pc.connectionState, 'closed');
    assert.equal(pc.remoteDescription, undefined, 'ended connection must not accept an answer');
    assert.ok(pc.tracks.every(t => t.enabled === false));
    assert.equal(h.completeBodies().length, 1);
    assert.equal(h.el('vi-done-view').style.display, '');
    assert.equal(h.logs.filter(l => l[0] === 'alert').length, 0);
  } finally { answer.resolve({ __text: 'v=0 late answer' }); h.dispose(); }
});

test('End during reconnect token lookup cannot reopen the microphone or overwrite the report', async () => {
  const token = deferred();
  let calls = 0;
  const session = LIVE_ROUTES['/api/voice/session'];
  const h = await liveInterviewWithOneAnswer({ routes: { ...LIVE_ROUTES,
    '/api/voice/session': () => ++calls === 1 ? session() : token.promise } });
  try {
    const oldPc = h.peerConnection();
    const reconnecting = h.click('vi-reconnect-btn');
    await h.settle();
    assert.equal(calls, 2);
    await h.endInterview();
    token.resolve(session());
    await reconnecting;
    assert.equal(h.peerConnection(), oldPc, 'no replacement peer connection after End');
    assert.equal(h.requests.filter(r => r.url.includes('/realtime/calls')).length, 1);
    assert.equal(h.completeBodies().length, 1);
    assert.equal(h.el('vi-done-view').style.display, '');
  } finally { token.resolve(session()); h.dispose(); }
});

test('events from a replaced data channel cannot end or speak into the replacement interview', async () => {
  const h = await liveInterviewWithOneAnswer();
  try {
    const oldPc = h.peerConnection();
    const oldChannel = h.dataChannel();
    await h.click('vi-reconnect-btn');
    assert.notEqual(h.peerConnection(), oldPc);
    oldChannel.onmessage({ data: JSON.stringify({ type: 'conversation.item.input_audio_transcription.completed',
      item_id: 'stale-end', transcript: "I'll end the interview" }) });
    oldChannel.onopen();
    oldPc.ontrack({ streams: [{}] });
    await h.settle();
    assert.equal(h.completeBodies().length, 0, 'a stale channel does not own the current session');
    assert.equal(h.el('vi-live-view').style.display, '');
    assert.equal(h.el('vi-remote-audio').srcObject, null);
  } finally { h.dispose(); }
});

test('an aborted SDP fetch cannot replace the completed report with a connection error', async () => {
  const h = createVoiceClientHarness({ routes: { ...LIVE_ROUTES,
    'api.openai.com/v1/realtime/calls': (url, options) => new Promise((resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    }) } });
  try {
    await h.ready(); h.el('vi-role').value = 'Product Manager';
    const starting = h.click('vi-start-btn');
    await h.settle();
    await h.endInterview();
    await starting;
    assert.equal(h.el('vi-done-view').style.display, '');
    assert.equal(h.completeBodies().length, 1);
    assert.equal(h.logs.filter(l => l[0] === 'alert').length, 0);
    assert.equal(h.peerConnection().connectionState, 'closed');
    assert.ok(h.peerConnection().tracks.every(t => t.enabled === false));
  } finally { h.dispose(); }
});

// ------------------------------------------------------------ live view

test('a late candidate transcription never replaces the pinned question', async () => {
  const h = await liveInterviewWithOneAnswer();
  try {
    // The candidate's next answer is committed, then the interviewer asks the
    // next question, and only then does whisper deliver the answer's text.
    h.event({ type: 'conversation.item.created', item: { id: 'u3' } });
    h.event({ type: 'input_audio_buffer.committed', item_id: 'u3' });
    h.event({ type: 'response.created', response: { id: 'r3' } });
    h.event({ type: 'conversation.item.created', item: { id: 'a3' } });
    h.event({ type: 'response.output_audio_transcript.done', item_id: 'a3', response_id: 'r3', transcript: 'How did you choose what to cut?' });
    h.event({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'u3', transcript: 'We had a challenge with the launch date.' });
    await h.settle();
    assert.equal(h.el('vi-question').textContent, 'How did you choose what to cut?');
    const recent = h.el('vi-recent-turns').innerHTML;
    assert.ok(recent.indexOf('We had a challenge') !== -1, 'the late answer joins the recent conversation');
    assert.ok(recent.indexOf('We had a challenge') < recent.indexOf('How did you choose'), 'turns are in conversation order, not arrival order');
    assert.equal(h.el('vi-recent').style.display, '');
  } finally { h.dispose(); }
});

test('the speaking indicator follows the audio, not response.done', async () => {
  const h = await liveInterviewWithOneAnswer();
  try {
    h.event({ type: 'response.created', response: { id: 'r3' } });
    h.event({ type: 'output_audio_buffer.started', response_id: 'r3' });
    assert.ok(h.el('vi-speaking')._classes.has('vi-speaking-on'));
    assert.equal(h.el('vi-speaking-label').textContent, 'Interviewer speaking');
    // Generation finishes about a second in; the audio keeps playing.
    h.event({ type: 'response.done', response: { id: 'r3' } });
    assert.ok(h.el('vi-speaking')._classes.has('vi-speaking-on'), 'still speaking after response.done');
    h.event({ type: 'output_audio_buffer.stopped', response_id: 'r3' });
    assert.ok(!h.el('vi-speaking')._classes.has('vi-speaking-on'));
    assert.equal(h.el('vi-speaking-label').textContent, 'Your turn');
  } finally { h.dispose(); }
});

test('without audio buffer events the indicator falls back to response.done', async () => {
  const h = await liveInterviewWithOneAnswer();
  try {
    h.event({ type: 'response.created', response: { id: 'r3' } });
    assert.equal(h.el('vi-speaking-label').textContent, 'Interviewer speaking');
    h.event({ type: 'response.done', response: { id: 'r3' } });
    assert.ok(!h.el('vi-speaking')._classes.has('vi-speaking-on'));
    assert.equal(h.el('vi-speaking-label').textContent, 'Your turn');
  } finally { h.dispose(); }
});

test('the countdown remains active across the audio check and interview', async () => {
  const h = createVoiceClientHarness({ routes: LIVE_ROUTES });
  try {
    await h.ready();
    h.el('vi-role').value = 'Product Manager';
    await h.click('vi-start-btn');
    await h.openDataChannel();
    assert.equal(h.el('vi-timer').textContent, '20:00');
    assert.ok(!h.el('vi-timer')._classes.has('vi-timer--held'), 'session clock also runs during the audio check');
    h.event({ type: 'response.created', response: { id: 'r1' } });
    h.event({ type: 'conversation.item.created', item: { id: 'a1' } });
    h.event({ type: 'response.output_audio_transcript.done', item_id: 'a1', response_id: 'r1', transcript: 'Hi. Before we begin, can you hear me clearly?' });
    h.event({ type: 'response.done', response: { id: 'r1' } });
    assert.equal(h.el('vi-question').textContent, 'Hi. Before we begin, can you hear me clearly?');
    h.event({ type: 'conversation.item.created', item: { id: 'u1' } });
    h.event({ type: 'input_audio_buffer.committed', item_id: 'u1' });
    assert.ok(!h.el('vi-timer')._classes.has('vi-timer--held'), 'counting once the interview begins');
  } finally { h.dispose(); }
});

test('End asks first during the interview, and Keep going keeps the session', async () => {
  const h = await liveInterviewWithOneAnswer();
  try {
    await h.click('vi-end-btn');
    assert.equal(h.el('vi-end-confirm').open, true);
    assert.equal(h.completeBodies().length, 0, 'nothing ends on the first press');
    assert.equal(h.el('vi-live-view').style.display, '');
    await h.click('vi-end-keep');
    assert.equal(h.el('vi-end-confirm').open, false);
    assert.equal(h.completeBodies().length, 0);
    await h.click('vi-end-btn');
    await h.click('vi-end-confirm-btn');
    assert.equal(h.completeBodies().length, 1);
    assert.equal(h.completeBodies()[0].reason, 'user_ended');
    const names = h.analyticsEvents.map(e => e.name);
    assert.equal(names.filter(n => n === 'end_confirm_shown').length, 2);
    assert.equal(names.filter(n => n === 'end_confirm_cancel').length, 1);
  } finally { h.dispose(); }
});

test('Escape cancels the Finish dialog without ending or losing the transcript', async () => {
  const h = await liveInterviewWithOneAnswer();
  try {
    await h.click('vi-end-btn');
    let prevented = false;
    for (const listener of h.el('vi-end-confirm')._listeners.cancel || []) {
      listener({ preventDefault() { prevented = true; } });
    }
    assert.equal(prevented, true);
    assert.equal(h.el('vi-end-confirm').open, false);
    assert.equal(h.completeBodies().length, 0);
    await h.click('vi-end-btn');
    assert.equal(h.el('vi-end-confirm').open, true);
    await h.click('vi-end-confirm-btn');
    assert.equal(h.completeBodies().length, 1);
    assert.ok(h.completeBodies()[0].transcript.some(t => t.speaker === 'user'));
  } finally { h.dispose(); }
});

test('missing dialog and confirm APIs keep the interview running', async () => {
  const h = await liveInterviewWithOneAnswer();
  try {
    h.el('vi-end-confirm').showModal = undefined;
    await h.click('vi-end-btn');
    assert.equal(h.completeBodies().length, 0);
    assert.equal(h.el('vi-live-view').style.display, '');
    assert.equal(h.analyticsEvents.filter(e => e.name === 'end_confirm_cancel').length, 1);
  } finally { h.dispose(); }
});

test('End before the official interview ends at once without asking', async () => {
  const h = createVoiceClientHarness({ routes: LIVE_ROUTES });
  try {
    await h.ready();
    h.el('vi-role').value = 'Product Manager';
    await h.click('vi-start-btn');
    await h.openDataChannel();
    await h.click('vi-end-btn');
    assert.equal(h.el('vi-end-confirm').open, false);
    assert.equal(h.completeBodies().length, 1);
  } finally { h.dispose(); }
});

test('a spoken end request is not held behind the confirmation', async () => {
  const h = await liveInterviewWithOneAnswer();
  try {
    await h.click('vi-end-btn');
    h.event({ type: 'conversation.item.created', item: { id: 'u3' } });
    h.event({ type: 'input_audio_buffer.committed', item_id: 'u3' });
    h.event({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'u3', transcript: 'Please end this interview.' });
    await h.settle();
    assert.equal(h.completeBodies().length, 1);
    assert.equal(h.el('vi-end-confirm').open, false, 'the confirmation closes with the session');
  } finally { h.dispose(); }
});

test('the live and done views switch the page into focus modes', async () => {
  const h = await liveInterviewWithOneAnswer();
  try {
    assert.ok(h.wrap()._classes.has('vi-mode-live'));
    await h.endInterview();
    assert.ok(!h.wrap()._classes.has('vi-mode-live'));
    assert.ok(h.wrap()._classes.has('vi-mode-done'));
  } finally { h.dispose(); }
});

test('an early end the server credits back says so on the done view', async () => {
  const h = await liveInterviewWithOneAnswer({ routes: { ...LIVE_ROUTES,
    '/api/voice/session/': (url) => (url.includes('/complete')
      ? { sessionId: 'live-1', status: 'completed', creditRestored: true }
      : { sessionId: 'live-1', scorecardReady: false }) } });
  try {
    await h.endInterview();
    assert.equal(h.el('vi-grace-note').style.display, '');
    assert.equal(h.analyticsEvents.filter(e => e.name === 'grace_credit_restored').length, 1);
  } finally { h.dispose(); }
});

test('a normal end shows no grace note', async () => {
  const h = await liveInterviewWithOneAnswer();
  try {
    await h.endInterview();
    assert.equal(h.el('vi-grace-note').style.display, 'none');
  } finally { h.dispose(); }
});

// -------------------------------------------------- setup access and Start

for (const [label, planRoute] of [
  ['a server error', () => ({ __status: 500, error: 'server_error' })],
  ['a network failure', () => { throw new Error('offline'); }]
]) {
  test(`${label} on the plan lookup offers a retry instead of a stuck access check`, async () => {
    let failing = true;
    const h = createVoiceClientHarness({ routes: {
      '/api/plan/me': () => (failing ? planRoute() : PLAN_PAYLOAD),
      '/api/voice/sessions': () => ({ sessions: [] })
    } });
    try {
      await h.ready();
      assert.equal(h.el('vi-setup-view').style.display, '', 'a failed lookup is not the feature-disabled view');
      assert.equal(h.el('vi-disabled-view').style.display, 'none');
      assert.match(h.el('vi-entitlement').textContent, /could not check your access/i);
      assert.equal(h.el('vi-start-btn').disabled, true);
      assert.equal(h.el('vi-entitlement-retry').style.display, '');

      failing = false;
      await h.click('vi-entitlement-retry');
      assert.equal(h.el('vi-entitlement-retry').style.display, 'none');
      assert.equal(h.el('vi-start-btn').disabled, false);
      assert.match(h.el('vi-entitlement').textContent, /voice interviews left this calendar month|subscription/);
    } finally { h.dispose(); }
  });
}

test('a 403 on start keeps Start disabled once the reload says no sessions are left', async () => {
  let planCalls = 0;
  const h = createVoiceClientHarness({ routes: { ...LIVE_ROUTES,
    '/api/plan/me': () => (++planCalls === 1 ? PLAN_PAYLOAD
      : { voice: { enabled: true, canStart: false, unlimited: false, mode: null, reason: 'paywall', sessionsRemaining: 0 } }),
    '/api/voice/session': () => ({ __status: 403, error: 'Your free voice interview is used. Upgrade to keep practicing.', reason: 'paywall' })
  } });
  try {
    await h.ready();
    h.el('vi-role').value = 'Product Manager';
    await h.click('vi-start-btn');
    assert.equal(planCalls, 2, 'the 403 reloads the entitlement');
    assert.equal(h.el('vi-setup-view').style.display, '');
    assert.equal(h.el('vi-start-btn').disabled, true, 'no sessions left, so Start stays disabled');
    assert.equal(h.el('vi-start-btn').textContent, 'Start the interview');
    assert.match(h.el('vi-entitlement').innerHTML, /See plans/);
  } finally { h.dispose(); }
});

test('a start failure that is not a paywall still lets the user retry', async () => {
  const h = createVoiceClientHarness({ routes: { ...LIVE_ROUTES,
    '/api/voice/session': () => ({ __status: 502, error: 'Could not start the voice session. Please try again.' })
  } });
  try {
    await h.ready();
    h.el('vi-role').value = 'Product Manager';
    await h.click('vi-start-btn');
    assert.equal(h.el('vi-start-btn').disabled, false);
    assert.equal(h.el('vi-start-btn').textContent, 'Start the interview');
  } finally { h.dispose(); }
});

// ------------------------------------------------------- report variants

const FREE_TOO_SHORT = {
  partial: true, tooShort: true, overall: null, dimensions: null, moments: null, summary: null,
  topStrength: 'The session was too short to evaluate.',
  topImprovement: 'Run a full session so the interviewer can hear complete answers.'
};

test('a free session too short to score says so, with no score and no locked report', async () => {
  const h = await openPastSession(scoredSessionPayload({ fullAccess: false, transcript: null, scorecard: FREE_TOO_SHORT }));
  try {
    const html = h.el('vi-scorecard').innerHTML;
    assert.ok(html.includes('Not enough captured speech for feedback'));
    assert.ok(html.includes('Start another interview'));
    assert.ok(!html.includes('Top strength'));
    assert.ok(!html.includes('Run a full session so the interviewer can hear complete answers.'));
    for (const marker of ['vi-result-score', 'Your full report is ready', 'vi-sc-blur', 'What went well', 'Hear a strong answer', 'vi-locked-dims']) {
      assert.ok(!html.includes(marker), marker);
    }
    assert.ok(html.includes('href="voice-interview.html"'));
    assert.ok(!html.includes('/pricing?plan='));
  } finally { h.dispose(); }
});

const FREE_SCORED = {
  partial: true, overall: 58, methodologyVersion: 2, dimensions: null, moments: null, summary: null,
  topStrength: 'You named the stakeholder you had to persuade.',
  topImprovement: 'Say what you changed and what happened next.',
  teaserQuote: 'I challenged it.'
};
const freeReport = (overrides = {}) => scoredSessionPayload({
  fullAccess: false, transcript: null, questionCount: 3, scorecard: FREE_SCORED, ...overrides
});

test('the free report leads with feedback and keeps scores in optional detail', async () => {
  const h = await openPastSession(freeReport());
  try {
    const html = h.el('vi-scorecard').innerHTML;
    assert.ok(html.includes('Interview complete'));
    assert.ok(html.includes('<h2 class="vi-result-role">Product Manager</h2>'));
    assert.ok(html.includes('Senior · 14 min · 3 questions'));
    assert.ok(html.includes('<div class="vi-sc-score">58</div>'));
    assert.ok(html.includes('<details class="vi-feedback-details"><summary>Practice score details</summary>'));
    assert.ok(!html.includes('Getting there'));
    assert.ok(!html.includes('Interview ready'));
    const order = ['Interview complete', 'Your next step', 'What worked', 'vi-sc-score', 'In the full report', 'Keep practicing until this answer is automatic'];
    const at = order.map(marker => html.indexOf(marker));
    assert.ok(at.every(i => i >= 0), JSON.stringify(at));
    assert.deepEqual(at, [...at].sort((a, b) => a - b), 'sections appear in order');
    assert.ok(html.includes('Say what you changed and what happened next.'));
    assert.ok(html.includes('You named the stakeholder you had to persuade.'));
    assert.ok(html.includes('data-cta="voice-strong-answer-locked"'));
    assert.ok(!html.includes('Your full report is ready'));
  } finally { h.dispose(); }
});

test('locked details name the dimensions without any numbers', async () => {
  const h = await openPastSession(freeReport());
  try {
    const html = h.el('vi-scorecard').innerHTML;
    for (const name of ['Communication', 'Structure', 'Content depth', 'Role fit']) assert.ok(html.includes('<span>' + name + '</span>'), name);
    assert.ok(!html.includes('vi-dim-num') && !html.includes('vi-dim-fill'), 'no bars or numbers');
    for (const placeholder of ['>70<', '>55<', '>62<', '>75<']) assert.ok(!html.includes(placeholder), placeholder);
    assert.ok(html.includes('You said "I challenged it." The full report shows what to say instead.'));
  } finally { h.dispose(); }
});

test('a teaser quote without closing punctuation still reads as a sentence', async () => {
  const h = await openPastSession(freeReport({ scorecard: { ...FREE_SCORED, teaserQuote: 'we just figured it out' } }));
  try {
    assert.ok(h.el('vi-scorecard').innerHTML.includes('You said "we just figured it out." The full report'));
  } finally { h.dispose(); }
});

test('no teaser line when the server sends no grounded quote', async () => {
  const h = await openPastSession(freeReport({ scorecard: { ...FREE_SCORED, teaserQuote: undefined } }));
  try {
    assert.ok(!h.el('vi-scorecard').innerHTML.includes('vi-teaser'));
  } finally { h.dispose(); }
});

for (const score of [49, 50, 74, 75]) {
  test(`a free score of ${score} stays sample-scoped and never claims readiness`, async () => {
    const h = await openPastSession(freeReport({ scorecard: { ...FREE_SCORED, overall: score } }));
    try {
      const html = h.el('vi-scorecard').innerHTML;
      assert.ok(html.includes('<div class="vi-sc-score">' + score + '</div>'));
      assert.ok(html.includes('Practice sample'));
      assert.ok(!html.includes('Interview ready'));
    } finally { h.dispose(); }
  });
}

test('without a server score the free report shows no number', async () => {
  const h = await openPastSession(freeReport({ scorecard: { ...FREE_SCORED, overall: null } }));
  try {
    const html = h.el('vi-scorecard').innerHTML;
    assert.ok(!html.includes('vi-result-score'));
    assert.ok(html.includes('Your next step'));
  } finally { h.dispose(); }
});

test('the retry button appears only when the server offers it', async () => {
  const plain = await openPastSession(freeReport());
  try { assert.ok(!plain.el('vi-scorecard').innerHTML.includes('Retry this question, free')); }
  finally { plain.dispose(); }
  const h = await openPastSession(freeReport({ retry: { eligible: true, question: 'Tell me about a decision you challenged?' } }));
  try {
    const card = h.el('vi-scorecard');
    assert.ok(card.innerHTML.includes('Retry this question, free'));
    for (const fn of card._listeners.click) fn({ target: { id: 'vi-retry-btn' } });
    assert.equal(h.analyticsEvents.filter(e => e.name === 'retry_start').length, 1);
  } finally { h.dispose(); }
});

test('the plan picker preselects Monthly and follows the selection', async () => {
  const h = await openPastSession(freeReport());
  try {
    const html = h.el('vi-scorecard').innerHTML;
    assert.ok(html.includes('value="monthly" checked'));
    assert.ok(html.includes('Continue with Monthly'));
    assert.ok(html.includes('href="/pricing?plan=monthly#plans"'));
    assert.ok(html.includes('data-cta="voice-scorecard-plan-continue"'));
    assert.ok(html.includes('Cancel anytime'));
    for (const price of ['$17<small>/week', '$34<small>/month', '$39<small>for 5 sessions']) assert.ok(html.includes(price), price);
    for (const fn of h.el('vi-scorecard')._listeners.change) fn({ target: { name: 'vi-plan', value: 'pack' } });
    const link = h.el('vi-plan-continue');
    assert.equal(link.getAttribute('href'), '/pricing?plan=pack#plans');
    assert.equal(link.getAttribute('data-plan'), 'pack');
    assert.equal(link.textContent, 'Continue with Interview Pack');
    assert.equal(h.el('vi-plan-note').textContent, 'One time payment. No subscription.');
    const picked = h.analyticsEvents.filter(e => e.name === 'plan_option_selected');
    assert.equal(picked.length, 1);
    assert.equal(picked[0].params.plan, 'pack');
  } finally { h.dispose(); }
});

test('each report view is tracked once with its access level', async () => {
  const h = await openPastSession(freeReport());
  try {
    const views = h.analyticsEvents.filter(e => e.name === 'report_view');
    assert.equal(views.length, 1);
    assert.equal(views[0].params.access, 'free');
    assert.equal(views[0].params.has_score, true);
  } finally { h.dispose(); }
});

const expiredPayload = (activePlan) => scoredSessionPayload({
  fullAccess: false, expired: true, activePlan, transcript: null,
  scorecard: { topStrength: 'Clear example.', topImprovement: 'Lead with the result.' }
});

test('an expired report points an active plan at a new interview, not an upgrade', async () => {
  const h = await openPastSession(expiredPayload(true));
  try {
    const html = h.el('vi-scorecard').innerHTML;
    assert.ok(html.includes('This report has expired.'));
    assert.ok(html.includes('Your plan is still active.'));
    assert.ok(html.includes('Start a new interview'));
    assert.ok(!/upgrade/i.test(html));
    assert.ok(!html.includes('href="/pricing"'));
    assert.equal(h.analyticsEvents.filter((e) => e.name === 'paywall_view').length, 0);
  } finally { h.dispose(); }
});

test('an expired report without an active plan points to plans and never promises to keep reports', async () => {
  const h = await openPastSession(expiredPayload(false));
  try {
    const html = h.el('vi-scorecard').innerHTML;
    assert.ok(html.includes('This report has expired.'));
    assert.ok(html.includes('Reports are kept for 90 days.'));
    assert.ok(html.includes('href="/pricing"'));
    assert.ok(!/upgrade to keep every report/i.test(html));
    assert.ok(!html.includes('vi-dim-num') && !html.includes('vi-sc-blur'), 'no placeholder scores behind an expired report');
  } finally { h.dispose(); }
});

// ----------------------------------------------- session-over-session delta

// Finish a live session with the history rail on, then read the report the
// scoring poll renders. History is newest first and omits the live session.
async function finishedReport(history, scorecard) {
  const h = await liveInterviewWithOneAnswer({
    elementIds: ['vi-history-panel'],
    timerDelay: (ms) => (ms === 2500 || ms === 3500 ? 0 : ms),
    routes: { ...LIVE_ROUTES,
      '/api/voice/sessions': () => ({ sessions: history }),
      '/api/voice/session/': (url) => (url.includes('/complete')
        ? { sessionId: 'live-1', status: 'completed' }
        : scoredSessionPayload({ sessionId: 'live-1', scorecard: { ...scoredSessionPayload().scorecard, ...scorecard } }))
    }
  });
  await h.endInterview();
  // The poll timer is shortened to 0 ms, which still needs a real tick.
  await new Promise((resolve) => setTimeout(resolve, 20));
  await h.settle(20);
  return h;
}

const PM_SENIOR = { role: 'Product Manager', seniority: 'Senior', status: 'ready' };

test('full v2 feedback retains competencies, quoted moments and summary together', async () => {
  const h = await finishedReport([], {
    methodologyVersion: 2,
    assessmentScope: 'Based on one launch example.',
    competencies: [{ name: 'Customer judgment', status: 'demonstrated', quote: 'We interviewed five customers.', feedback: 'You tested the customer problem.' }],
    moments: [{ quote: 'We cut drop-off by 18 percent.', comment: 'Strong, specific outcome.' }],
    summary: 'A solid, concrete interview.'
  });
  try {
    const html = h.el('vi-scorecard').innerHTML;
    for (const text of ['Customer judgment', 'We interviewed five customers.', 'Strong, specific outcome.', 'A solid, concrete interview.']) {
      assert.ok(html.includes(text), 'full report retains ' + text);
    }
  } finally { h.dispose(); }
});

test('a v2 report shows the delta against the last v2 session for the same role and level', async () => {
  const h = await finishedReport([
    { sessionId: 'other-role', role: 'Data Engineer', seniority: 'Senior', status: 'ready', overall: 95, methodologyVersion: 2 },
    { sessionId: 'other-level', role: 'Product Manager', seniority: 'Junior', status: 'ready', overall: 90, methodologyVersion: 2 },
    { sessionId: 'same', ...PM_SENIOR, overall: 64, methodologyVersion: 2 },
    { sessionId: 'old-rubric', ...PM_SENIOR, overall: 30, methodologyVersion: 1 }
  ], { overall: 72, methodologyVersion: 2 });
  try {
    const html = h.el('vi-scorecard').innerHTML;
    assert.ok(html.includes('>72<'), 'the report rendered: ' + html.slice(0, 200));
    assert.ok(html.includes('▲ +8 vs your last session for this role'));
    assert.ok(!html.includes('vi-sc-delta--down'));
  } finally { h.dispose(); }
});

test('a lower v2 score keeps the muted downward styling', async () => {
  const h = await finishedReport([{ sessionId: 'same', ...PM_SENIOR, overall: 80, methodologyVersion: 2 }],
    { overall: 72, methodologyVersion: 2 });
  try {
    const html = h.el('vi-scorecard').innerHTML;
    assert.ok(html.includes('vi-sc-delta vi-sc-delta--down'));
    assert.ok(html.includes('▼ −8 vs your last session for this role'));
  } finally { h.dispose(); }
});

test('no delta when no earlier session shares the rubric, role and level', async () => {
  const h = await finishedReport([
    { sessionId: 'old-rubric', ...PM_SENIOR, overall: 30, methodologyVersion: 1 },
    { sessionId: 'other-role', role: 'Data Engineer', seniority: 'Senior', status: 'ready', overall: 95, methodologyVersion: 2 }
  ], { overall: 72, methodologyVersion: 2 });
  try {
    const html = h.el('vi-scorecard').innerHTML;
    assert.ok(html.includes('>72<'));
    assert.ok(!html.includes('vi-sc-delta'), 'scores from another rubric, role or level are never compared');
  } finally { h.dispose(); }
});

for (const t of pending) await t();
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
