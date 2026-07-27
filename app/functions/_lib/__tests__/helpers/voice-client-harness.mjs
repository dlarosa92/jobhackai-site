/**
 * Test harness for js/voice-interview.js.
 *
 * That file is the browser client: an IIFE that owns the report panel, the
 * realtime event routing, and the /complete call. Its defects are therefore
 * only provable by running it, so this harness runs the REAL file in a `vm`
 * context against a stub DOM, a stub RTCPeerConnection, and a routed fetch.
 * No production test seam, no framework, no jsdom — the file under test is
 * byte-for-byte the one that ships.
 *
 * The three browser modules it depends on (lifecycle, conduct, transcript
 * order) are imported for real and hung on the stub window, so the tests
 * exercise the shipped modules rather than the client's degraded fallbacks.
 */

import { readFileSync } from 'node:fs';
import vm from 'node:vm';

import {
  createInterviewLifecycle,
  isClosingAnnouncement,
  isHearingCheckTurn,
  isExplicitEndRequest,
  LIFECYCLE
} from '../../../../../js/voice-lifecycle.js';
import {
  createConductGate,
  createClosingTurnGate,
  readToolCall,
  isSafetyReferral,
  isConductWarningLine
} from '../../../../../js/voice-conduct.js';
import { createTranscriptOrder } from '../../../../../js/voice-transcript-order.js';

const CLIENT_SRC = new URL('../../../../../js/voice-interview.js', import.meta.url);

// Element ids the client looks up. Anything outside this list resolves to null,
// which is how the harness keeps the history rail switched off: initHistory
// bails on a missing #vi-history-panel, exactly as it does on a page that does
// not render the rail.
const ELEMENT_IDS = [
  'vi-setup-view', 'vi-live-view', 'vi-done-view', 'vi-disabled-view',
  'vi-status', 'vi-caption', 'vi-timer', 'vi-speaking',
  'vi-done-status', 'vi-scorecard',
  'vi-entitlement', 'vi-role', 'vi-seniority', 'vi-jd',
  'vi-start-btn', 'vi-end-btn', 'vi-mute-btn', 'vi-reconnect-btn',
  'vi-remote-audio'
];

// The browser's textContent -> innerHTML escaping, which escapeHtml() in the
// client leans on (it round-trips a detached div).
function escapeText(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function makeElement(id) {
  const classes = new Set();
  const attrs = Object.create(null);
  const listeners = Object.create(null);
  const el = {
    id: id || '',
    style: {},
    dataset: {},
    hidden: false,
    disabled: false,
    value: '',
    className: '',
    innerHTML: '',
    autoplay: false,
    srcObject: null,
    offsetParent: null,
    _textContent: '',
    get textContent() { return this._textContent; },
    set textContent(v) {
      this._textContent = String(v == null ? '' : v);
      this.innerHTML = escapeText(this._textContent);
    },
    classList: {
      add: (c) => classes.add(c),
      remove: (c) => classes.delete(c),
      contains: (c) => classes.has(c),
      toggle: (c, on) => { if (on === undefined ? classes.has(c) : !on) classes.delete(c); else classes.add(c); }
    },
    setAttribute: (k, v) => { attrs[k] = String(v); },
    getAttribute: (k) => (k in attrs ? attrs[k] : null),
    addEventListener: (type, fn) => { (listeners[type] = listeners[type] || []).push(fn); },
    removeEventListener: () => {},
    querySelector: () => null,
    querySelectorAll: () => [],
    appendChild: () => {},
    focus: () => {},
    click: () => {},
    _classes: classes,
    _listeners: listeners
  };
  return el;
}

/**
 * Build the harness. `routes` maps a URL substring to a handler
 * (url, options) => body object | { __text } | { __status }.
 *
 * `withoutModules` deletes named browser-module globals before the client
 * loads, so a test can prove the client's hand-synced fallbacks still hold when
 * a module script fails to execute.
 */
export function createVoiceClientHarness(options = {}) {
  const { search = '', routes = {}, withoutModules = [] } = options;

  const elements = Object.create(null);
  for (const id of ELEMENT_IDS) elements[id] = makeElement(id);

  const timers = new Set();
  const logs = [];
  const requests = [];
  const dataChannelSends = [];
  let dataChannel = null;
  let peerConnection = null;
  let domReadyHandler = null;

  const trackTimer = (handle) => { timers.add(handle); return handle; };

  const documentStub = {
    readyState: 'loading',
    getElementById: (id) => elements[id] || null,
    createElement: (tag) => makeElement('__' + tag),
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener: (type, fn) => { if (type === 'DOMContentLoaded') domReadyHandler = fn; },
    removeEventListener: () => {}
  };

  function respond(url, opts) {
    const key = Object.keys(routes).find((k) => String(url).includes(k));
    // The SDP exchange posts a raw offer body, everything else posts JSON.
    let body = null;
    if (opts && opts.body) {
      try { body = JSON.parse(opts.body); } catch (_) { body = String(opts.body); }
    }
    requests.push({ url: String(url), method: (opts && opts.method) || 'GET', body });
    if (!key) return Promise.resolve({ ok: false, status: 404, json: async () => ({ error: 'no route' }), text: async () => '' });
    const out = routes[key](String(url), opts || {});
    if (out && out.__text !== undefined) {
      return Promise.resolve({ ok: out.__status ? out.__status < 400 : true, status: out.__status || 200, text: async () => out.__text, json: async () => ({}) });
    }
    const status = (out && out.__status) || 200;
    return Promise.resolve({
      ok: status < 400,
      status,
      json: async () => ({ success: status < 400, ...(out || {}) }),
      text: async () => JSON.stringify(out || {})
    });
  }

  class StubPeerConnection {
    constructor() {
      this.connectionState = 'new';
      this.ontrack = null;
      this.onconnectionstatechange = null;
      this.tracks = [];
      peerConnection = this;
    }
    addTrack(track) { this.tracks.push(track); }
    createDataChannel() {
      dataChannel = {
        readyState: 'open',
        onmessage: null,
        onopen: null,
        send: (payload) => { dataChannelSends.push(JSON.parse(payload)); },
        close: () => { dataChannel.readyState = 'closed'; }
      };
      return dataChannel;
    }
    async createOffer() { return { type: 'offer', sdp: 'v=0 offer' }; }
    async setLocalDescription() {}
    async setRemoteDescription() {}
    close() { this.connectionState = 'closed'; }
  }

  const micTrack = () => ({ kind: 'audio', enabled: true, stop() { this.enabled = false; } });
  const micStream = () => {
    const tracks = [micTrack()];
    return { getTracks: () => tracks, getAudioTracks: () => tracks };
  };

  const win = {
    location: { search, href: 'https://app.jobhackai.io/voice-interview.html' + search, pathname: '/voice-interview.html' },
    navigator: { mediaDevices: { getUserMedia: async () => micStream() } },
    FirebaseAuthManager: {
      waitForAuthReady: async () => ({ getIdToken: async () => 'test-id-token' }),
      getCurrentUser: () => ({ getIdToken: async () => 'test-id-token' })
    },
    RoleSelector: function RoleSelector() {},
    // The real browser modules, so the client uses them rather than its
    // module-missing fallbacks.
    VOICE_LIFECYCLE: LIFECYCLE,
    createInterviewLifecycle,
    isClosingAnnouncement,
    isHearingCheckTurn,
    isExplicitEndRequest,
    createConductGate,
    createClosingTurnGate,
    readVoiceToolCall: readToolCall,
    isSafetyReferral,
    isConductWarningLine,
    createTranscriptOrder,
    addEventListener: () => {},
    removeEventListener: () => {}
  };

  win.window = win;
  win.document = documentStub;
  win.navigator = win.navigator;
  win.RTCPeerConnection = StubPeerConnection;
  win.URLSearchParams = URLSearchParams;
  win.fetch = (url, opts) => respond(url, opts);
  win.setTimeout = (fn, ms) => trackTimer(setTimeout(fn, ms));
  win.clearTimeout = (h) => { timers.delete(h); clearTimeout(h); };
  win.setInterval = (fn, ms) => trackTimer(setInterval(fn, ms));
  win.clearInterval = (h) => { timers.delete(h); clearInterval(h); };
  win.console = {
    log: (...a) => logs.push(['log', a.join(' ')]),
    warn: (...a) => logs.push(['warn', a.join(' ')]),
    error: (...a) => logs.push(['error', a.join(' ')])
  };
  win.alert = (msg) => logs.push(['alert', String(msg)]);

  for (const name of withoutModules) delete win[name];

  vm.createContext(win);
  vm.runInContext(readFileSync(CLIENT_SRC, 'utf8'), win, { filename: 'js/voice-interview.js' });

  // Let floating promises (the client fires several without awaiting) resolve.
  async function settle(ticks = 8) {
    for (let i = 0; i < ticks; i++) await new Promise((r) => setImmediate(r));
  }

  return {
    el: (id) => elements[id],
    logs,
    requests,
    sends: dataChannelSends,
    settle,
    /** Fire DOMContentLoaded and wait for the client's async init to finish. */
    async ready() {
      documentStub.readyState = 'interactive';
      if (!domReadyHandler) throw new Error('client never registered a DOMContentLoaded handler');
      await domReadyHandler({ type: 'DOMContentLoaded' });
      await settle();
    },
    /** Click a button the client bound a handler to. */
    async click(id) {
      const el = elements[id];
      const handlers = (el && el._listeners.click) || [];
      if (!handlers.length) throw new Error(`#${id} has no click handler`);
      for (const fn of handlers) await fn({ type: 'click', preventDefault() {} });
      await settle();
    },
    /** Open the realtime data channel (the client requests the greeting here). */
    async openDataChannel() {
      if (!dataChannel) throw new Error('no data channel was created');
      // A failed connect still leaves a (closed) data channel behind, and every
      // realtime event would then flow through a torn-down client — tests would
      // pass for the wrong reason. Fail loudly instead.
      if (!requests.some((r) => r.url.includes('/realtime/calls'))) {
        throw new Error('the SDP exchange never happened; connectRealtime failed: ' + JSON.stringify(logs));
      }
      if (dataChannel.readyState !== 'open') throw new Error('the data channel is not open; connectRealtime failed');
      await dataChannel.onopen();
      await settle(2);
    },
    /** Deliver one realtime event over the data channel. */
    event(evt) {
      if (!dataChannel || !dataChannel.onmessage) throw new Error('data channel is not listening');
      dataChannel.onmessage({ data: JSON.stringify(evt) });
    },
    peerConnection: () => peerConnection,
    /** POST bodies sent to /complete, in order. */
    completeBodies() {
      return requests.filter((r) => r.url.includes('/complete') && r.method === 'POST').map((r) => r.body);
    },
    dispose() {
      for (const h of timers) { clearTimeout(h); clearInterval(h); }
      timers.clear();
    }
  };
}

/** A GET /api/voice/session/:id payload for a completed, scored session. */
export function scoredSessionPayload(overrides = {}) {
  return {
    sessionId: 'sess-scored',
    role: 'Product Manager',
    seniority: 'Senior',
    status: 'completed',
    startedAt: '2026-07-20 15:00:00',
    createdAt: '2026-07-20 15:00:00',
    endedAt: '2026-07-20 15:14:00',
    durationSeconds: 840,
    scorecardReady: true,
    endReason: 'completed',
    fullAccess: true,
    scorecard: {
      overall: 72,
      dimensions: { communication: 74, structure: 66, contentDepth: 71, roleFit: 78 },
      topStrength: 'You quantified the checkout relaunch.',
      topImprovement: 'Name the outcome before the process.',
      moments: [{ quote: 'We cut drop-off by 18 percent.', comment: 'Strong, specific outcome.' }],
      summary: 'A solid, concrete interview.'
    },
    transcript: [
      { speaker: 'assistant', text: 'Tell me about a launch you owned.' },
      { speaker: 'user', text: 'I owned the checkout relaunch.' }
    ],
    ...overrides
  };
}

/** A GET /api/voice/session/:id payload for a safety-ended session. */
export function safetySessionPayload(overrides = {}) {
  return {
    sessionId: 'sess-safety',
    role: 'Product Manager',
    seniority: 'Senior',
    status: 'completed',
    startedAt: '2026-07-21 11:00:00',
    createdAt: '2026-07-21 11:00:00',
    endedAt: '2026-07-21 11:04:00',
    durationSeconds: 240,
    scorecardReady: false,
    endReason: 'ended_for_safety',
    fullAccess: true,
    scorecard: null,
    transcript: null,
    ...overrides
  };
}

export const PLAN_PAYLOAD = {
  voice: { enabled: true, canStart: true, unlimited: true, mode: 'subscription', sessionsRemaining: null }
};
