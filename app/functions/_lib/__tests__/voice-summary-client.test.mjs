// Interview summary PDF: the download action in the real voice client.
// Run: node --test app/functions/_lib/__tests__/voice-summary-client.test.mjs
//
// Drives js/voice-interview.js through the shared client harness with the
// shipped summary module, PDF bundles and fonts. Pins where the button
// appears, that a download re-reads the report first and only ever issues
// GET requests, and that duplicate clicks and failures behave predictably.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createVoiceClientHarness, scoredSessionPayload, safetySessionPayload, PLAN_PAYLOAD
} from './helpers/voice-client-harness.mjs';
import { loadPdfDeps, fontBytes, readPdf } from './helpers/pdf-test-kit.mjs';

// Dates and times are local; pin the zone so results match on any machine.
process.env.TZ = 'UTC';

const BUTTON = 'vi-summary-pdf-btn';
const STATUS = 'vi-summary-pdf-status';

const fonts = () => ({ __bytes: fontBytes('Inter-Regular.ttf') });
const boldFonts = () => ({ __bytes: fontBytes('Inter-Bold.ttf') });

// The lazily injected vendor scripts "load" by exposing the shipped bundles.
function loadVendorScript(el, win) {
  const { PDFLib, fontkit } = loadPdfDeps();
  if (el.src.includes('pdf-lib')) win.PDFLib = PDFLib;
  else if (el.src.includes('fontkit')) win.fontkit = fontkit;
  else return false;
  return true;
}

async function openReport(payload, options = {}) {
  const session = options.session || (() => payload);
  const h = createVoiceClientHarness({
    search: '?session=' + payload.sessionId,
    elementIds: [BUTTON, STATUS],
    onScript: options.onScript || loadVendorScript,
    withoutModules: options.withoutModules || [],
    routes: {
      '/api/plan/me': () => PLAN_PAYLOAD,
      '/api/voice/sessions': () => ({ sessions: [] }),
      '/api/voice/session/': session,
      'Inter-Regular.ttf': options.regularFont || fonts,
      'Inter-Bold.ttf': options.boldFont || boldFonts,
      ...(options.routes || {})
    }
  });
  await h.ready();
  return h;
}

// Click the way a browser does: the event reaches the report container's
// delegated listener with the button as its target.
function click(h) {
  const handlers = h.el('vi-scorecard')._listeners.click || [];
  assert.ok(handlers.length > 0, 'the report container has a click listener');
  handlers.forEach((fn) => fn({ type: 'click', target: h.el(BUTTON) }));
}

async function until(h, condition, what) {
  for (let i = 0; i < 400; i++) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('timed out waiting for ' + what + '; status: ' + h.el(STATUS).textContent + '; logs: ' + JSON.stringify(h.logs));
}

const idle = (h) => h.el(BUTTON).disabled === false && h.el(BUTTON).textContent === 'Download summary PDF';
const sessionGets = (h) => h.requests.filter((r) => r.url.includes('/api/voice/session/'));
const offered = (h) => h.el('vi-scorecard').innerHTML.includes('id="' + BUTTON + '"');

test('a full report reopened from history offers the download and produces a real PDF', async () => {
  const payload = scoredSessionPayload();
  const h = await openReport(payload);
  try {
    const html = h.el('vi-scorecard').innerHTML;
    assert.ok(offered(h));
    assert.ok(html.includes('>Download summary PDF</button>'), 'the action is clearly labeled');
    assert.ok(html.indexOf(BUTTON) < html.indexOf('Evidence and limits of this feedback'), 'it sits with the headline feedback');

    click(h);
    assert.equal(h.el(BUTTON).disabled, true, 'the button is disabled while preparing');
    assert.equal(h.el(BUTTON).textContent, 'Preparing PDF...');
    await until(h, () => h.downloads.length === 1, 'the download');
    await until(h, () => idle(h), 'the button to reset');

    assert.equal(h.downloads[0].filename, 'JobHackAI-interview-summary-Product-Manager-2026-07-20-1500.pdf');
    assert.equal(h.downloads[0].blob.type, 'application/pdf');
    const pdf = await readPdf(new Uint8Array(await h.downloads[0].blob.arrayBuffer()));
    assert.equal(pdf.pageCount, 1);
    assert.equal(pdf.info.title, 'Interview practice summary \u00B7 Product Manager \u00B7 July 20, 2026');
    assert.ok(pdf.text.includes('You quantified the checkout relaunch.'));
    assert.ok(pdf.text.includes('Top priority: Name the outcome before the process.'));
    assert.ok(!pdf.text.includes('I owned the checkout relaunch.'), 'the transcript stays out');
    assert.equal(h.el(STATUS).textContent, 'Your summary PDF has been downloaded.');
    assert.deepEqual(h.analyticsEvents.filter((e) => e.name === 'summary_pdf_download').map((e) => e.params.result), ['downloaded']);
  } finally { h.dispose(); }
});

test('downloading only reads: the report is rechecked with GET and nothing is posted', async () => {
  const h = await openReport(scoredSessionPayload());
  try {
    click(h);
    await until(h, () => h.downloads.length === 1 && idle(h), 'the download');
    assert.equal(sessionGets(h).length, 2, 'one read to render, one recheck at download time');
    assert.deepEqual([...new Set(h.requests.map((r) => r.method))], ['GET'], 'no request other than GET is ever made');
    const paths = h.requests.map((r) => r.url.split('?')[0]);
    for (const path of paths) {
      assert.ok(['/api/plan/me', '/api/voice/sessions', '/api/voice/session/sess-scored',
        'assets/fonts/Inter-Regular.ttf', 'assets/fonts/Inter-Bold.ttf'].includes(path), 'unexpected request: ' + path);
    }
    assert.ok(h.requests.every((r) => r.body == null), 'no request carries a body');
  } finally { h.dispose(); }
});

test('repeated downloads each produce a file and never anything but reads', async () => {
  const h = await openReport(scoredSessionPayload());
  try {
    for (let n = 1; n <= 3; n++) {
      click(h);
      await until(h, () => h.downloads.length === n && idle(h), 'download ' + n);
    }
    assert.equal(sessionGets(h).length, 4);
    assert.equal(h.requests.filter((r) => r.url.includes('assets/fonts/')).length, 2, 'fonts are fetched once and reused');
    assert.ok(h.requests.every((r) => r.method === 'GET'));
  } finally { h.dispose(); }
});

test('extra clicks while a PDF is being prepared do nothing', async () => {
  const h = await openReport(scoredSessionPayload());
  try {
    click(h); click(h); click(h);
    await until(h, () => h.downloads.length >= 1 && idle(h), 'the download');
    await h.settle(20);
    assert.equal(h.downloads.length, 1);
    assert.equal(sessionGets(h).length, 2);
  } finally { h.dispose(); }
});

test('a failed font load shows an error, re-enables the button, and a retry succeeds', async () => {
  let attempts = 0;
  const h = await openReport(scoredSessionPayload(), {
    regularFont: () => (++attempts === 1 ? { __status: 503 } : fonts())
  });
  try {
    click(h);
    await until(h, () => /could not create/.test(h.el(STATUS).textContent), 'the error');
    assert.equal(h.downloads.length, 0);
    assert.ok(idle(h), 'the button is usable again');
    assert.ok(h.el(STATUS).className.includes('vi-summary-pdf-status--error'));

    click(h);
    await until(h, () => h.downloads.length === 1 && idle(h), 'the retry');
    assert.equal(h.el(STATUS).textContent, 'Your summary PDF has been downloaded.');
    assert.equal(h.el(STATUS).className, 'vi-summary-pdf-status');
    assert.ok(h.requests.every((r) => r.method === 'GET'));
    assert.deepEqual(h.analyticsEvents.filter((e) => e.name === 'summary_pdf_download').map((e) => e.params.result), ['failed', 'downloaded']);
  } finally { h.dispose(); }
});

test('a failed library load is not cached: the next click loads it again', async () => {
  let scripts = 0;
  const h = await openReport(scoredSessionPayload(), {
    onScript: (el, win) => (++scripts === 1 ? false : loadVendorScript(el, win))
  });
  try {
    click(h);
    await until(h, () => /could not create/.test(h.el(STATUS).textContent), 'the error');
    assert.equal(h.downloads.length, 0);
    click(h);
    await until(h, () => h.downloads.length === 1 && idle(h), 'the retry');
  } finally { h.dispose(); }
});

test('a failed report recheck is an error the user can retry', async () => {
  let reads = 0;
  const payload = scoredSessionPayload();
  const h = await openReport(payload, { session: () => (++reads === 2 ? { __status: 500 } : payload) });
  try {
    click(h);
    await until(h, () => /could not create/.test(h.el(STATUS).textContent), 'the error');
    assert.equal(h.downloads.length, 0);
    click(h);
    await until(h, () => h.downloads.length === 1 && idle(h), 'the retry');
  } finally { h.dispose(); }
});

test('access is rechecked at download time: a report that is now locked exports nothing', async () => {
  let reads = 0;
  const full = scoredSessionPayload();
  const locked = scoredSessionPayload({ fullAccess: false, transcript: null,
    scorecard: { partial: true, topStrength: full.scorecard.topStrength, topImprovement: full.scorecard.topImprovement,
      overall: 72, dimensions: null, moments: null, summary: null } });
  const h = await openReport(full, { session: () => (++reads === 1 ? full : locked) });
  try {
    click(h);
    await until(h, () => h.el(STATUS).textContent.length > 0 && idle(h), 'the unavailable message');
    assert.equal(h.el(STATUS).textContent, 'A summary PDF is available with the full report.');
    assert.equal(h.downloads.length, 0);
    assert.equal(h.requests.filter((r) => r.url.includes('assets/fonts/')).length, 0, 'nothing is even loaded');
  } finally { h.dispose(); }
});

test('a report deleted since it was opened exports nothing and says so', async () => {
  let reads = 0;
  const payload = scoredSessionPayload();
  const h = await openReport(payload, { session: () => (++reads === 1 ? payload : { __status: 404 }) });
  try {
    click(h);
    await until(h, () => h.el(STATUS).textContent.length > 0 && idle(h), 'the unavailable message');
    assert.equal(h.el(STATUS).textContent, 'This report is no longer available, so there is no summary to download.');
    assert.equal(h.downloads.length, 0);
  } finally { h.dispose(); }
});

const NOT_OFFERED = {
  'a locked free report': scoredSessionPayload({ fullAccess: false, transcript: null,
    scorecard: { partial: true, topStrength: 'Clear example.', topImprovement: 'Lead with the result.', overall: 72, dimensions: null, moments: null, summary: null } }),
  'an expired report': scoredSessionPayload({ fullAccess: false, expired: true, activePlan: true, role: null, seniority: null, scorecard: null, transcript: null }),
  'a session too short to assess': scoredSessionPayload({ scorecard: { overall: null, topStrength: 'The session was too short to evaluate.',
    topImprovement: 'Run a full session so the interviewer can hear complete answers.', moments: [], summary: 'Too short.', tooShort: true } }),
  'a safety-ended session': safetySessionPayload(),
  'a legacy safety-ended session that still has a scorecard': scoredSessionPayload({ endReason: 'ended_for_safety' }),
  'a full report with no usable feedback': scoredSessionPayload({ scorecard: { overall: 72, moments: [], summary: 'Fine.' } })
};

for (const [name, payload] of Object.entries(NOT_OFFERED)) {
  test('the download is not offered for ' + name, async () => {
    const h = await openReport(payload);
    try {
      assert.ok(h.el('vi-scorecard').innerHTML.length > 0, 'the existing view still renders');
      assert.ok(!offered(h));
      assert.ok(!h.el('vi-scorecard').innerHTML.includes('summary PDF'));
    } finally { h.dispose(); }
  });
}

test('a pending report shows no download while it is still being prepared', async () => {
  const h = await openReport(scoredSessionPayload({ scorecardReady: false, scorecard: null }));
  try {
    assert.ok(!offered(h));
  } finally { h.dispose(); }
});

test('a session that fails to load shows the existing error and no download', async () => {
  const payload = scoredSessionPayload({ sessionId: 'someone-elses-session' });
  const h = await openReport(payload, { session: () => ({ __status: 404 }) });
  try {
    assert.equal(h.el('vi-done-status').textContent, 'Could not load that session.');
    assert.ok(!offered(h));
  } finally { h.dispose(); }
});

test('the report still renders in full if the summary module did not load', async () => {
  const h = await openReport(scoredSessionPayload(), { withoutModules: ['JobHackAIVoiceSummary'] });
  try {
    const html = h.el('vi-scorecard').innerHTML;
    assert.ok(html.includes('You quantified the checkout relaunch.'));
    assert.ok(!offered(h));
  } finally { h.dispose(); }
});
