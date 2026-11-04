import test from 'node:test';
import assert from 'node:assert/strict';
import { createVoiceAudioDiagnostics } from '../../../../js/voice-audio-diagnostics.js';
import { createVoiceClientHarness, PLAN_PAYLOAD } from './helpers/voice-client-harness.mjs';

function environment(hostname = 'dev.jobhackai.io', search = '?voiceAudioDebug=1') {
  let interval, cleared = 0;
  const listeners = new Map();
  return {
    location: { hostname, search }, navigator: {}, document: { hidden: false, hasFocus: () => true },
    setInterval: fn => { interval = fn; return 1; }, clearInterval: () => { cleared++; },
    addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: name => listeners.delete(name),
    tick: () => interval(), cleared: () => cleared, listeners
  };
}

test('diagnostics stay off without explicit flag and on all other hosts, including production', () => {
  for (const host of ['jobhackai.io', 'app.jobhackai.io', 'qa.jobhackai.io', 'dev.jobhackai.io.attacker.test']) {
    assert.equal(createVoiceAudioDiagnostics(environment(host), () => ({})), null);
  }
  assert.equal(createVoiceAudioDiagnostics(environment('dev.jobhackai.io', ''), () => ({})), null);
  assert.equal(createVoiceAudioDiagnostics(environment('dev.jobhackai.io', '?voiceAudioDebug=false'), () => ({})), null);
});

test('provider traces discard content, credentials, raw IDs and unrecognized strings', () => {
  const trace = createVoiceAudioDiagnostics(environment(), () => ({}));
  trace.event('receive', { type: 'session.updated', session: { id: 'session-secret', instructions: 'private prompt',
    client_secret: { value: 'secret' }, audio: { input: { turn_detection: {
      type: 'semantic_vad', interrupt_response: false, create_response: false
    } } } } });
  trace.event('receive', { type: 'response.output_audio_transcript.done', transcript: 'private words', item_id: 'secret-item' });
  trace.event('receive', { type: 'response.done', response: { id: 'secret-response', status: 'cancelled',
    status_details: { reason: 'turn_detected', error: { message: 'private error' } }, output: [{ text: 'private output' }] } });
  trace.event('receive', { type: 'response.done', response: { status: 'private status', status_details: { reason: 'private reason' } } });
  trace.event('receive', { type: 'response.output_audio.delta', delta: 'secret-base64' });
  const data = trace.report();
  assert.equal(data.events.length, 4);
  assert.equal(data.events[0].interrupt, false);
  assert.equal(data.events[1].textLength, 13);
  assert.equal(data.events[2].reason, 'turn_detected');
  assert.equal(data.events[3].status, null);
  assert.equal(data.events[3].reason, null);
  assert.doesNotMatch(JSON.stringify(data), /private|secret|base64/);
});

test('trace memory is bounded and exported snapshots cannot mutate retained evidence', () => {
  const trace = createVoiceAudioDiagnostics(environment(), () => ({}));
  for (let i = 0; i < 3100; i++) trace.mark('play-request');
  assert.equal(trace.report().events.length, 3000);
  assert.equal(trace.report().dropped, 100);
  trace.report().events[0].kind = 'changed';
  assert.equal(trace.report().events[0].kind, 'play-request');
});

test('media and stats stay allowlisted, listeners stop, and stale stats cannot enter a replacement trace', async () => {
  const env = environment();
  let resolveStats;
  const pc = { connectionState: 'connected', getStats: () => new Promise(resolve => { resolveStats = resolve; }) };
  const audio = { paused: false, muted: false, currentTime: 1, readyState: 4, volume: 1,
    srcObject: { getAudioTracks: () => [{ muted: false, readyState: 'live', label: 'private speaker' }] } };
  const stream = { getAudioTracks: () => [{ enabled: true, label: 'private microphone' }] };
  const trace = createVoiceAudioDiagnostics(env, () => ({ audioSetup: true }));
  trace.watch(pc, audio, stream);
  env.tick();
  await Promise.resolve();
  resolveStats(new Map([['private-id', { type: 'inbound-rtp', kind: 'audio', bytesReceived: 100,
    totalAudioEnergy: 0.4, address: 'private-address', trackIdentifier: 'private-track' }]]));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(trace.report().events.at(-1).totalAudioEnergy, 0.4);
  assert.doesNotMatch(JSON.stringify(trace.report()), /private/);
  env.tick();
  await Promise.resolve();
  trace.stop();
  const count = trace.report().events.length;
  resolveStats(new Map([['x', { type: 'inbound-rtp', kind: 'audio', bytesReceived: 200 }]]));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(trace.report().events.length, count);
  assert.equal(env.cleared(), 1);
  assert.equal(env.listeners.size, 0);
});

test('the shipped client traces real sends, replies and teardown without activating an interview', async () => {
  let trace;
  const h = createVoiceClientHarness({ hostname: 'dev.jobhackai.io', search: '?voiceAudioDebug=1',
    onAudioDiagnostics: value => { trace = value; }, routes: {
      '/api/plan/me': () => ({ ...PLAN_PAYLOAD, voice: { ...PLAN_PAYLOAD.voice, transport: 'managed' } }),
      '/api/voice/connection': (url, init) => {
        const body = JSON.parse(init.body);
        return body.action === 'close' ? { connectionClosed: true, sessionReserved: true }
          : { sessionId: body.sessionId, attemptId: 'private-attempt', sdp: 'v=0 answer-sdp',
            requiresAudioCheck: true, interviewInstructions: 'private interview instructions',
            model: 'test', maxMinutes: 20, deadlineAt: new Date(Date.now() + 120000).toISOString() };
      }
    } });
  try {
    await h.ready();
    h.el('vi-role').value = 'Engineer';
    await h.click('vi-start-btn');
    await h.openDataChannel();
    h.event({ type: 'output_audio_buffer.started', response_id: 'provider-private-id' });
    h.event({ type: 'output_audio_buffer.cleared', response_id: 'provider-private-id' });
    await h.endInterview();
    const rows = trace.report().events;
    assert.ok(rows.some(row => row.kind === 'send' && row.type === 'session.update'));
    assert.ok(rows.some(row => row.kind === 'receive' && row.type === 'output_audio_buffer.cleared'));
    assert.ok(rows.some(row => row.kind === 'teardown'));
    assert.doesNotMatch(JSON.stringify(trace.report()), /not-in-trace|provider-private-id|answer-sdp/);
    assert.ok(!h.requests.some(request => request.body?.action === 'activate'));
  } finally { h.dispose(); }
});
