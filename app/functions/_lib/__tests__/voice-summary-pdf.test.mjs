// Interview summary PDF: content selection and rendering.
// Run: node --test app/functions/_lib/__tests__/voice-summary-pdf.test.mjs
//
// The summary is a deterministic selection from the saved report payload, so
// these tests pin what may and may not reach the document, then read the
// generated PDF bytes back (helpers/pdf-test-kit.mjs) to prove the text is
// real, complete and selectable.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildInterviewSummary, summaryFilename, summaryUnavailableMessage, renderSummaryPdf,
  SUMMARY_UNAVAILABLE_MESSAGES
} from '../../../../js/voice-summary-pdf.js';
import { loadPdfDeps, readPdf } from './helpers/pdf-test-kit.mjs';
import { scoreVoiceTranscript } from '../voice-scorecard.js';

const EM_DASH = String.fromCharCode(0x2014);

function report(overrides = {}, scorecard = {}) {
  return {
    sessionId: 'sess-internal-4f9d2c',
    role: 'Customer Service Representative',
    seniority: 'Entry level',
    status: 'completed',
    startedAt: '2026-11-08 15:00:00',
    createdAt: '2026-11-08 15:00:00',
    endedAt: '2026-11-08 15:12:00',
    durationSeconds: 720,
    scorecardReady: true,
    endReason: 'user_ended',
    fullAccess: true,
    questionCount: 4,
    scorecard: {
      methodologyVersion: 2,
      overall: 72,
      dimensions: { communication: 74, structure: 66, contentDepth: 71, roleFit: 78 },
      saoBalance: { situation: 40, action: 45, outcome: 15 },
      assessmentScope: 'Based on a practice interview for an entry level customer service role. Scheduling tools were not explored.',
      competencies: [
        { name: 'Customer empathy', status: 'demonstrated', quote: 'I let her finish before I said anything.', feedback: 'You listened fully before responding.' },
        { name: 'Describing results', status: 'needs_practice', quote: 'It worked out in the end.', feedback: 'You did not say what happened next.' },
        { name: 'Scheduling tools', status: 'not_assessed', quote: '', feedback: 'This did not come up.' }
      ],
      saoCoaching: ['End each story with what changed for the customer.', 'Practice the difficult customer story out loud.'],
      topStrength: 'You stayed calm and specific about the upset customer.',
      topImprovement: 'Finish each answer with the outcome.',
      moments: [{ quote: 'I let her finish before I said anything.', comment: 'Good listening.' }],
      summary: 'You gave clear, honest examples. The main gap was the ending of each story.',
      ...scorecard
    },
    transcript: [
      { speaker: 'assistant', text: 'TRANSCRIPT_QUESTION_MARKER tell me about a difficult customer.' },
      { speaker: 'user', text: 'TRANSCRIPT_ANSWER_MARKER she was upset about a late order.' }
    ],
    ...overrides
  };
}

async function pdfOf(data) {
  const summary = buildInterviewSummary(data);
  assert.equal(summary.available, true, 'fixture must be exportable: ' + summary.reason);
  const bytes = await renderSummaryPdf(summary, loadPdfDeps());
  assert.equal(Buffer.from(bytes.slice(0, 5)).toString('latin1'), '%PDF-');
  return { summary, bytes, pdf: await readPdf(bytes) };
}

const squash = (s) => String(s).replace(/\s+/g, '');

// ------------------------------------------------------------ selection

test('a normal full report becomes strengths, improvements and next practice', () => {
  const s = buildInterviewSummary(report());
  assert.equal(s.available, true);
  assert.equal(s.role, 'Customer Service Representative');
  assert.equal(s.seniority, 'Entry level');
  assert.equal(s.dateLabel, 'November 8, 2026');
  assert.deepEqual(s.wentWell, [
    { label: '', text: 'You stayed calm and specific about the upset customer.' },
    { label: 'Customer empathy', text: 'You listened fully before responding.' }
  ]);
  assert.deepEqual(s.workOn, [
    { label: 'Top priority', text: 'Finish each answer with the outcome.' },
    { label: 'Describing results', text: 'You did not say what happened next.' }
  ]);
  assert.deepEqual(s.nextPractice, ['End each story with what changed for the customer.', 'Practice the difficult customer story out loud.']);
  assert.equal(s.overview, 'You gave clear, honest examples. The main gap was the ending of each story.');
});

test('the existing top improvement leads; without one the first saved practice step does', () => {
  assert.equal(buildInterviewSummary(report()).workOn[0].text, 'Finish each answer with the outcome.');
  const s = buildInterviewSummary(report({}, { topImprovement: '' }));
  assert.deepEqual(s.workOn[0], { label: 'Top priority', text: 'End each story with what changed for the customer.' });
  assert.deepEqual(s.nextPractice, ['Practice the difficult customer story out loud.'], 'the promoted step is not repeated');
});

test('not assessed is listed on its own and never as something to work on', () => {
  const s = buildInterviewSummary(report());
  assert.deepEqual(s.notAssessed, ['Scheduling tools']);
  const improvement = JSON.stringify(s.workOn) + JSON.stringify(s.nextPractice);
  assert.ok(!improvement.includes('Scheduling tools'));
  assert.ok(!improvement.includes('This did not come up.'));
  assert.ok(!JSON.stringify(s.wentWell).includes('Scheduling tools'));
});

test('an older report with only the original fields still produces a summary', () => {
  const s = buildInterviewSummary(report({}, {
    methodologyVersion: undefined, assessmentScope: undefined, competencies: undefined, saoCoaching: undefined, saoBalance: undefined
  }));
  assert.equal(s.available, true);
  assert.equal(s.wentWell.length, 1);
  assert.equal(s.workOn.length, 1);
  assert.deepEqual(s.nextPractice, [], 'no next practice section is invented');
  assert.deepEqual(s.notAssessed, []);
  assert.ok(s.notes.includes('This feedback is based on the answers captured in this practice session.'));
});

test('missing role, seniority, date and summary are left out, not filled in', () => {
  const s = buildInterviewSummary(report({ role: null, seniority: null, startedAt: null, createdAt: null }, { summary: null }));
  assert.equal(s.available, true);
  assert.equal(s.role, '');
  assert.equal(s.seniority, '');
  assert.equal(s.dateLabel, '');
  assert.equal(s.overview, '');
  assert.equal(summaryFilename(s), 'JobHackAI-interview-summary.pdf');
});

test('only one side of the feedback is still an honest summary', () => {
  const onlyStrength = buildInterviewSummary(report({}, { topImprovement: null, saoCoaching: [], competencies: [] }));
  assert.equal(onlyStrength.available, true);
  assert.deepEqual(onlyStrength.workOn, []);
  const onlyImprovement = buildInterviewSummary(report({}, { topStrength: null, competencies: [] }));
  assert.equal(onlyImprovement.available, true);
  assert.deepEqual(onlyImprovement.wentWell, []);
});

test('feedback-only reports carry their existing qualification and no scores', () => {
  const limited = buildInterviewSummary(report({}, { feedbackOnly: true, evidenceLimited: true, overall: null, dimensions: null, saoBalance: null }));
  assert.ok(limited.notes[0].includes('This is a report limitation, not a judgment of your ability.'));
  const feedbackOnly = buildInterviewSummary(report({}, { feedbackOnly: true, overall: null, dimensions: null, saoBalance: null }));
  assert.ok(feedbackOnly.notes[0].includes('limited sample'));
});

test('the summary carries no scores, quotes, transcript or identifiers', () => {
  const json = JSON.stringify(buildInterviewSummary(report()));
  for (const hidden of ['sess-internal-4f9d2c', 'TRANSCRIPT_QUESTION_MARKER', 'TRANSCRIPT_ANSWER_MARKER',
    'I let her finish before I said anything.', 'Good listening.', '"overall"', '72', '74', '66', '71', '78']) {
    assert.ok(!json.includes(hidden), 'summary must not contain ' + hidden);
  }
});

// ------------------------------------------------------------ unavailable states

const { scorecard: TOO_SHORT } = await scoreVoiceTranscript(
  { role: 'Product Manager', transcript: [{ speaker: 'user', text: 'Hello?' }] }, {});

const UNAVAILABLE = {
  'no payload (deleted or failed load)': [null, 'missing'],
  'pending: no scorecard yet': [report({ scorecardReady: false, scorecard: null }), 'pending'],
  'failed scoring: completed with no scorecard': [report({ scorecardReady: false, scorecard: null, status: 'completed' }), 'pending'],
  'too short (the production too-short card)': [report({ scorecard: TOO_SHORT }), 'too_short'],
  'locked free view': [report({ fullAccess: false, transcript: null,
    scorecard: { partial: true, topStrength: 'Clear example.', topImprovement: 'Lead with the result.', overall: 72, dimensions: null, moments: null, summary: null } }), 'locked'],
  'a partial card is never exported even if the access flag were wrong': [report({ scorecard: { partial: true, topStrength: 'x', topImprovement: 'y' } }), 'locked'],
  'expired': [report({ expired: true, fullAccess: false, scorecard: null, role: null, seniority: null }), 'expired'],
  'safety-ended': [report({ endReason: 'ended_for_safety', scorecard: null, scorecardReady: false }), 'safety'],
  'legacy safety row that still carries a scorecard': [report({ endReason: 'ended_for_safety' }), 'safety'],
  'a report with no usable feedback': [report({}, { topStrength: '', topImprovement: '', saoCoaching: [], competencies: [] }), 'empty']
};

for (const [name, [payload, reason]] of Object.entries(UNAVAILABLE)) {
  test('no summary for: ' + name, async () => {
    const s = buildInterviewSummary(payload);
    assert.deepEqual(s, { available: false, reason });
    assert.ok(summaryUnavailableMessage(reason).length > 20);
    await assert.rejects(renderSummaryPdf(s, loadPdfDeps()), /summary_unavailable/);
  });
}

test('fullAccess must be exactly true: truthy strings from a tampered payload do not unlock', () => {
  for (const value of ['true', 1, {}, undefined, null]) {
    assert.equal(buildInterviewSummary(report({ fullAccess: value })).available, false);
  }
});

// ------------------------------------------------------------ authored copy

test('authored copy uses US English and no em dash', () => {
  const s = buildInterviewSummary(report({}, { feedbackOnly: true, evidenceLimited: true }));
  const authored = [...Object.values(SUMMARY_UNAVAILABLE_MESSAGES), ...s.notes.filter((n) => !n.startsWith('Based on'))].join(' ');
  assert.ok(!authored.includes(EM_DASH));
  assert.ok(!/practis/i.test(authored));
  assert.ok(authored.includes('practice'));
});

// ------------------------------------------------------------ filename

test('filenames are descriptive, ASCII-safe and bounded', () => {
  assert.equal(summaryFilename(buildInterviewSummary(report())),
    'JobHackAI-interview-summary-Customer-Service-Representative-2026-11-08.pdf');
  const hostile = summaryFilename({ role: '../../etc/passwd "Se\u00F1or" <Dev>\u202E\\ \uD83D\uDE00 ' + 'x'.repeat(200), dateStamp: '2026-11-08' });
  assert.match(hostile, /^[A-Za-z0-9-]+\.pdf$/);
  assert.ok(hostile.length <= 90, hostile);
  assert.ok(hostile.includes('Senor'), 'accents fold to ASCII instead of vanishing');
  assert.equal(summaryFilename({ role: '\u8F6F\u4EF6\u5DE5\u7A0B\u5E08', dateStamp: 'not-a-date' }), 'JobHackAI-interview-summary.pdf');
});

// ------------------------------------------------------------ rendering

test('a typical report renders as one page of selectable text', async () => {
  const { pdf } = await pdfOf(report());
  assert.equal(pdf.pageCount, 1);
  assert.equal(pdf.info.title, 'Interview practice summary');
  for (const text of ['JOBHACKAI', 'Interview practice summary', 'Role: Customer Service Representative',
    'Seniority: Entry level', 'Session date: November 8, 2026', 'Overview', 'What went well', 'What to work on',
    'For your next practice', 'Not assessed in this session', 'About this feedback',
    'You stayed calm and specific about the upset customer.', 'Customer empathy: You listened fully before responding.',
    'Top priority: Finish each answer with the outcome.', 'Describing results: You did not say what happened next.',
    'Practice the difficult customer story out loud.', 'They are not weaknesses.']) {
    assert.ok(pdf.text.includes(text), 'PDF text must include: ' + text);
  }
  assert.ok(!/Page \d+ of/.test(pdf.text), 'a single page carries no page counter');
});

test('the PDF text carries no transcript, quotes, scores or identifiers', async () => {
  const { pdf, bytes } = await pdfOf(report());
  const raw = Buffer.from(bytes).toString('latin1');
  for (const hidden of ['sess-internal-4f9d2c', 'TRANSCRIPT_QUESTION_MARKER', 'TRANSCRIPT_ANSWER_MARKER',
    'I let her finish before I said anything.', 'Good listening.']) {
    assert.ok(!pdf.text.includes(hidden), 'PDF text must not include ' + hidden);
    assert.ok(!raw.includes(hidden), 'PDF bytes must not include ' + hidden);
  }
  assert.ok(!/\b(72|74|66|71|78)\b/.test(pdf.text), 'no scores are printed');
  assert.ok(!/out of 100|score/i.test(pdf.text));
});

test('sections with no saved content are omitted rather than padded', async () => {
  const { pdf } = await pdfOf(report({}, { saoCoaching: [], competencies: [], summary: '' }));
  for (const heading of ['Overview', 'For your next practice', 'Not assessed in this session']) {
    assert.ok(!pdf.text.includes(heading), heading + ' must be omitted');
  }
  assert.ok(pdf.text.includes('What went well'));
  assert.ok(pdf.text.includes('What to work on'));
});

test('long feedback paginates without dropping a word or leaving a blank page', async () => {
  const sentence = (i) => `Paragraph ${i} explains one specific thing you did in this answer and why it mattered to the customer, the team and the result (marker-${i}-end).`;
  const long = (from, count) => Array.from({ length: count }, (_, i) => sentence(from + i)).join(' ');
  const data = report({ role: 'Senior Staff Principal Customer Experience Operations and Enablement Program Manager, Global Field Services and Partner Success (Night Shift), Northern Kentucky and Greater Cincinnati Region' }, {
    summary: long(0, 12),
    topStrength: long(100, 10),
    topImprovement: long(200, 10),
    competencies: Array.from({ length: 8 }, (_, i) => ({
      name: 'Competency number ' + i, status: i % 2 ? 'needs_practice' : 'demonstrated', quote: '', feedback: long(300 + i * 10, 6)
    })),
    saoCoaching: [long(500, 3), long(600, 3)]
  });
  const { summary, pdf } = await pdfOf(data);
  assert.ok(pdf.pageCount >= 3, 'expected several pages, got ' + pdf.pageCount);
  pdf.pages.forEach((text, i) => {
    assert.ok(text.replace(/JobHackAI\s+\u00B7\s+Interview practice summary|Page \d+ of \d+/g, '').trim().length > 40, `page ${i + 1} must carry content`);
    assert.ok(text.includes(`Page ${i + 1} of ${pdf.pageCount}`));
  });
  // Footers are drawn last on each page; drop them so text that continues
  // across a page break reads straight through.
  const all = squash(pdf.pages.map((text) => text.replace(/JobHackAI\s+\u00B7\s+Interview practice summary\s+Page \d+ of \d+/g, '')).join(' '));
  const expected = [summary.role, summary.overview, ...summary.wentWell.map((x) => x.text), ...summary.workOn.map((x) => x.text), ...summary.nextPractice];
  for (const text of expected) assert.ok(all.includes(squash(text)), 'nothing may be cut: ' + text.slice(0, 60));
  for (let i = 0; i < 8; i++) assert.ok(pdf.text.includes('Competency number ' + i + ':'));
});

test('a single unbroken string wider than the page is split, not clipped', async () => {
  const token = 'https://example.test/' + 'averyveryverylongunbrokenpathsegment'.repeat(12) + '/END-OF-TOKEN';
  const { pdf } = await pdfOf(report({ role: 'R' + 'o'.repeat(300) + 'le' }, { topStrength: 'See ' + token + ' for details.' }));
  const all = squash(pdf.text);
  assert.ok(all.includes(token));
  assert.ok(all.includes('R' + 'o'.repeat(300) + 'le'));
});

test('Unicode feedback renders and extracts; undrawable characters never break the export', async () => {
  const data = report({ role: 'Se\u00F1or D\u00E9veloppeur \u2013 Krak\u00F3w', seniority: 'Mid\u2011level' }, {
    topStrength: 'You said \u201Cna\u00EFve caf\u00E9 r\u00E9sum\u00E9\u201D clearly: \u0395\u03BB\u03BB\u03B7\u03BD\u03B9\u03BA\u03AC, \u0420\u0430\u0437\u0440\u0430\u0431\u043E\u0442\u0447\u0438\u043A, Vi\u1EC7t, \u0141\u00F3d\u017A, 50\u00A0% \u2192 80\u00A0%.',
    topImprovement: 'Great energy \uD83D\uDE00\uD83D\uDC4D\uD83C\uDFFD but name the result \u8F6F\u4EF6 next time\u200B.',
    summary: 'Combining marks: Cafe\u0301 and nai\u0308ve. Tabs\tand\nnewlines collapse.'
  });
  const { pdf } = await pdfOf(data);
  assert.equal(pdf.pageCount, 1);
  for (const text of ['Se\u00F1or D\u00E9veloppeur \u2013 Krak\u00F3w', '\u201Cna\u00EFve caf\u00E9 r\u00E9sum\u00E9\u201D',
    '\u0395\u03BB\u03BB\u03B7\u03BD\u03B9\u03BA\u03AC', '\u0420\u0430\u0437\u0440\u0430\u0431\u043E\u0442\u0447\u0438\u043A', 'Vi\u1EC7t', '\u0141\u00F3d\u017A', '\u2192',
    'Caf\u00E9 and na\u00EFve.', 'Tabs and newlines collapse.']) {
    assert.ok(pdf.text.includes(text), 'PDF text must include: ' + text);
  }
  assert.ok(pdf.text.includes('Great energy but name the result ?? next time.'), 'emoji are dropped and undrawable letters are marked: ' + pdf.text);
});

test('rendering needs its assets and says so', async () => {
  const s = buildInterviewSummary(report());
  await assert.rejects(renderSummaryPdf(s, {}), /summary_assets_missing/);
  await assert.rejects(renderSummaryPdf(s, { ...loadPdfDeps(), fonts: { regular: null, bold: null } }), /summary_assets_missing/);
});
