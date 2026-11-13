// Interview practice summary PDF.
//
// Turns the report payload the page already renders from
// (GET /api/voice/session/:id) into a short, shareable summary: what went
// well, what to work on, and next practice steps. Everything here is a
// deterministic selection from saved feedback. Nothing is scored, summarized
// by a model, or sent anywhere: the PDF is assembled in the browser.
//
// Access is decided by the server, not here. The summary is offered only
// when the payload itself carries full access to a real, unexpired report;
// every other state returns { available: false, reason } and no document.

export const SUMMARY_UNAVAILABLE_MESSAGES = {
  missing: 'This report is no longer available, so there is no summary to download.',
  pending: 'This report is still being prepared. Try again once your feedback appears.',
  safety: 'No summary is created for a session that ended early for safety.',
  expired: 'This report has expired, so a summary is no longer available.',
  locked: 'A summary PDF is available with the full report.',
  too_short: 'This session did not capture enough of your answers to create a summary.',
  empty: 'This report does not include enough feedback to create a summary.'
};

export function summaryUnavailableMessage(reason) {
  return SUMMARY_UNAVAILABLE_MESSAGES[reason] || SUMMARY_UNAVAILABLE_MESSAGES.missing;
}

const LIMITED_EVIDENCE_NOTE = 'We could not verify all of the supporting evidence for this report, so no practice score was given. This is a report limitation, not a judgment of your ability.';
const FEEDBACK_ONLY_NOTE = 'This session was a limited sample, so it received feedback without a practice score.';
const DEFAULT_SCOPE = 'This feedback is based on the answers captured in this practice session.';
const CLOSING_NOTE = 'This summary reflects one practice session and is meant to guide your next practice.';

// Saved feedback is single-paragraph prose. Collapse stray whitespace and
// control characters; never shorten or rewrite the words themselves.
function clean(value) {
  if (value == null) return '';
  return String(value).replace(/[\u0000-\u001F\u007F\u2028\u2029]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function sameText(a, b) {
  return clean(a).toLowerCase() === clean(b).toLowerCase();
}

function parseSessionDate(value) {
  if (!value) return null;
  let s = String(value);
  if (s.indexOf('T') === -1) s = s.replace(' ', 'T');
  if (!/Z|[+-]\d\d:?\d\d$/.test(s)) s += 'Z';
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December'];

function pad2(n) { return (n < 10 ? '0' : '') + n; }

/**
 * Build the summary model from a session report payload.
 *
 * @param {object} data - the GET /api/voice/session/:id payload
 * @returns {{available: false, reason: string} | {available: true, role: string,
 *   seniority: string, dateLabel: string, dateStamp: string, timeStamp: string,
 *   title: string, overview: string,
 *   wentWell: Array<{label: string, text: string}>,
 *   workOn: Array<{label: string, text: string}>, nextPractice: string[],
 *   notAssessed: string[], notes: string[]}}
 */
export function buildInterviewSummary(data) {
  if (!data || typeof data !== 'object') return { available: false, reason: 'missing' };
  // Same order as the report renderer: a safety ending is never a
  // performance document, whatever else the payload carries.
  if (data.endReason === 'ended_for_safety') return { available: false, reason: 'safety' };
  if (data.expired) return { available: false, reason: 'expired' };
  if (data.fullAccess !== true) return { available: false, reason: 'locked' };
  const sc = data.scorecard;
  if (!sc || typeof sc !== 'object' || data.scorecardReady === false) return { available: false, reason: 'pending' };
  if (sc.tooShort) return { available: false, reason: 'too_short' };
  // A partial (free view) card never reaches here with fullAccess true, but
  // the flag is the server's own marker for withheld feedback: honor it.
  if (sc.partial) return { available: false, reason: 'locked' };

  const coaching = (Array.isArray(sc.saoCoaching) ? sc.saoCoaching : []).map(clean).filter(Boolean);
  const competencies = (Array.isArray(sc.competencies) ? sc.competencies : [])
    .filter((c) => c && typeof c === 'object')
    .map((c) => ({ name: clean(c.name), status: c.status, feedback: clean(c.feedback) }));

  const wentWell = [];
  const topStrength = clean(sc.topStrength);
  if (topStrength) wentWell.push({ label: '', text: topStrength });
  competencies.forEach((c) => {
    if (c.status !== 'demonstrated' || !(c.name || c.feedback)) return;
    if (c.feedback && wentWell.some((item) => sameText(item.text, c.feedback))) return;
    wentWell.push({ label: c.name, text: c.feedback });
  });

  // The report's own priority rule: the saved top improvement, else the
  // first saved practice step.
  const workOn = [];
  const priority = clean(sc.topImprovement) || coaching[0] || '';
  if (priority) workOn.push({ label: 'Top priority', text: priority });
  competencies.forEach((c) => {
    if (c.status !== 'needs_practice' || !(c.name || c.feedback)) return;
    if (c.feedback && workOn.some((item) => sameText(item.text, c.feedback))) return;
    workOn.push({ label: c.name, text: c.feedback });
  });

  if (!wentWell.length && !workOn.length) return { available: false, reason: 'empty' };

  const nextPractice = [];
  coaching.forEach((step) => {
    if (sameText(step, priority) || nextPractice.some((s) => sameText(s, step))) return;
    nextPractice.push(step);
  });

  // "Not assessed" means the session never explored the area. It is listed
  // on its own so it cannot read as a weakness.
  const notAssessed = [];
  competencies.forEach((c) => {
    if (c.status === 'not_assessed' && c.name && notAssessed.indexOf(c.name) === -1) notAssessed.push(c.name);
  });

  const notes = [];
  if (sc.feedbackOnly) notes.push(sc.evidenceLimited ? LIMITED_EVIDENCE_NOTE : FEEDBACK_ONLY_NOTE);
  notes.push(clean(sc.assessmentScope) || DEFAULT_SCOPE);
  notes.push(CLOSING_NOTE);

  // Dates and times are shown in the reader's own time zone, like the report.
  const when = parseSessionDate(data.startedAt || data.createdAt);
  const role = clean(data.role);
  const dateLabel = when ? MONTHS[when.getMonth()] + ' ' + when.getDate() + ', ' + when.getFullYear() : '';
  return {
    available: true,
    role,
    seniority: clean(data.seniority),
    dateLabel,
    dateStamp: when ? when.getFullYear() + '-' + pad2(when.getMonth() + 1) + '-' + pad2(when.getDate()) : '',
    // 24 hour start time, so two sessions on the same day get different files.
    timeStamp: when ? pad2(when.getHours()) + pad2(when.getMinutes()) : '',
    title: ['Interview practice summary', role, dateLabel].filter(Boolean).join(' \u00B7 '),
    overview: clean(sc.summary),
    wentWell,
    workOn,
    nextPractice,
    notAssessed,
    notes
  };
}

/**
 * A download filename that is safe on every platform: ASCII letters, digits
 * and hyphens only, bounded length, no identifiers. The session start time
 * keeps two sessions for the same role on the same day apart.
 */
export function summaryFilename(summary) {
  let role = '';
  try { role = String((summary && summary.role) || '').normalize('NFKD'); } catch (_) { role = String((summary && summary.role) || ''); }
  role = role.replace(/[\u0300-\u036F]/g, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/g, '');
  const parts = ['JobHackAI-interview-summary'];
  if (role) parts.push(role);
  if (summary && /^\d{4}-\d{2}-\d{2}$/.test(summary.dateStamp || '')) {
    parts.push(summary.dateStamp);
    if (/^\d{4}$/.test(summary.timeStamp || '')) parts.push(summary.timeStamp);
  }
  return parts.join('-') + '.pdf';
}

// ---------- PDF layout ----------

const PAGE = { width: 612, height: 792, marginX: 56, top: 56, bottom: 64 }; // US Letter, points
const BODY_SIZE = 10.5;
const BODY_LEADING = 15.5;
const BRAND_GREEN = [0, 122 / 255, 48 / 255];       // --color-cta-green
const TEXT_MAIN = [31 / 255, 41 / 255, 55 / 255];   // --color-text-main
const TEXT_SECONDARY = [75 / 255, 85 / 255, 99 / 255];
const TEXT_MUTED = [107 / 255, 114 / 255, 128 / 255];
const DIVIDER = [229 / 255, 231 / 255, 235 / 255];

// Characters the embedded font cannot draw must not break the export or
// leave tofu boxes: pictographs and joiners are dropped, anything else
// becomes a question mark so the reader can see something was there.
const DROPPED = /[\u200B-\u200F\u202A-\u202E\u2060-\u2064\uFE00-\uFE0F\uFEFF]|\uD83C[\uDFFB-\uDFFF]|\uDB40[\uDC00-\uDDEF]/g;

function fontSafe(text, glyphs) {
  let s = clean(text);
  try { s = s.normalize('NFC'); } catch (_) {}
  s = s.replace(DROPPED, '');
  let out = '';
  for (const ch of s) {
    const cp = ch.codePointAt(0);
    if (glyphs.has(cp)) out += ch;
    else if (cp === 0x00A0 || cp === 0x2007 || cp === 0x202F || cp === 0x3000) out += ' ';
    else if (cp >= 0x1F000 || (cp >= 0x2600 && cp <= 0x27BF) || (cp >= 0x2B00 && cp <= 0x2BFF)) out += '';
    else out += '?';
  }
  return out.replace(/\s+/g, ' ').trim();
}

/**
 * Render the summary to PDF bytes.
 *
 * @param {object} summary - an available summary from buildInterviewSummary
 * @param {{PDFLib: object, fontkit: object, fonts: {regular: ArrayBuffer|Uint8Array, bold: ArrayBuffer|Uint8Array}, now?: Date}} deps
 * @returns {Promise<Uint8Array>}
 */
export async function renderSummaryPdf(summary, deps) {
  if (!summary || summary.available !== true) throw new Error('summary_unavailable');
  const { PDFLib, fontkit, fonts } = deps || {};
  if (!PDFLib || !fontkit || !fonts || !fonts.regular || !fonts.bold) throw new Error('summary_assets_missing');

  const doc = await PDFLib.PDFDocument.create();
  doc.registerFontkit(fontkit);
  const regular = await doc.embedFont(fonts.regular, { subset: true });
  const bold = await doc.embedFont(fonts.bold, { subset: true });
  const glyphs = new Map([[regular, new Set(regular.getCharacterSet())], [bold, new Set(bold.getCharacterSet())]]);
  const rgb = (c) => PDFLib.rgb(c[0], c[1], c[2]);
  const safe = (text, font) => fontSafe(text, glyphs.get(font));

  // Viewers show this title in the window title bar instead of the filename.
  doc.setTitle(summary.title || 'Interview practice summary', { showInWindowTitleBar: true });
  doc.setAuthor('JobHackAI');
  doc.setSubject('Practice interview feedback summary');
  doc.setCreator('JobHackAI');
  doc.setProducer('JobHackAI');
  doc.setLanguage('en-US');
  doc.setCreationDate((deps && deps.now) || new Date());

  const contentWidth = PAGE.width - PAGE.marginX * 2;
  let page = null;
  let y = 0;

  function newPage() {
    page = doc.addPage([PAGE.width, PAGE.height]);
    y = PAGE.height - PAGE.top;
  }
  // Move to a new page when the next block of `height` points will not fit.
  function ensure(height) {
    if (y - height < PAGE.bottom) newPage();
  }

  // Break runs ([{text, font}]) into lines no wider than maxWidth. A single
  // word wider than the line is split by character, so nothing is clipped.
  function wrapRuns(runs, size, maxWidth) {
    const lines = [];
    let line = [];
    let lineWidth = 0;
    const pushLine = () => { lines.push(line); line = []; lineWidth = 0; };
    runs.forEach((run) => {
      const spaceWidth = run.font.widthOfTextAtSize(' ', size);
      safe(run.text, run.font).split(' ').filter(Boolean).forEach((word) => {
        let rest = word;
        while (rest) {
          const gap = line.length ? spaceWidth : 0;
          const width = run.font.widthOfTextAtSize(rest, size);
          if (lineWidth + gap + width <= maxWidth) {
            line.push({ text: rest, font: run.font, x: lineWidth + gap });
            lineWidth += gap + width;
            rest = '';
          } else if (line.length) {
            pushLine();
          } else {
            // Longest prefix that fits on an empty line (at least one character).
            const chars = Array.from(rest);
            let count = 1;
            while (count < chars.length && run.font.widthOfTextAtSize(chars.slice(0, count + 1).join(''), size) <= maxWidth) count++;
            line.push({ text: chars.slice(0, count).join(''), font: run.font, x: 0 });
            pushLine();
            rest = chars.slice(count).join('');
          }
        }
      });
    });
    if (line.length) lines.push(line);
    return lines;
  }

  function drawRuns(runs, opts) {
    const size = opts.size || BODY_SIZE;
    const leading = opts.leading || BODY_LEADING;
    const indent = opts.indent || 0;
    const lines = wrapRuns(runs, size, contentWidth - indent);
    lines.forEach((line, index) => {
      ensure(leading);
      y -= leading;
      if (index === 0 && opts.bullet) {
        page.drawText(opts.bullet, { x: PAGE.marginX + indent - 11, y, size, font: regular, color: rgb(opts.bulletColor || TEXT_MAIN) });
      }
      line.forEach((piece) => {
        page.drawText(piece.text, { x: PAGE.marginX + indent + piece.x, y, size, font: piece.font, color: rgb(opts.color || TEXT_MAIN) });
      });
    });
    return lines.length;
  }

  function heading(text) {
    // Keep a heading with at least two lines of what follows it.
    ensure(26 + BODY_LEADING * 2);
    y -= 26;
    page.drawText(safe(text, bold), { x: PAGE.marginX, y, size: 13, font: bold, color: rgb(BRAND_GREEN) });
    y -= 3;
  }

  function bulletList(items) {
    items.forEach((item) => {
      const runs = [];
      if (item.label) runs.push({ text: item.text ? item.label + ':' : item.label, font: bold });
      if (item.text) runs.push({ text: item.text, font: regular });
      if (!runs.length) return;
      drawRuns(runs, { indent: 14, bullet: '\u2022', bulletColor: BRAND_GREEN });
      y -= 4;
    });
  }

  // ----- header: the site's briefcase mark and wordmark -----
  newPage();
  page.drawSvgPath('M 5 7 L 19 7 C 20.1 7 21 7.9 21 9 L 21 18 C 21 19.1 20.1 20 19 20 L 5 20 C 3.9 20 3 19.1 3 18 L 3 9 C 3 7.9 3.9 7 5 7 Z M 8 7 L 8 5 C 8 3.9 8.9 3 10 3 L 14 3 C 15.1 3 16 3.9 16 5 L 16 7', {
    x: PAGE.marginX - 2.5, y: y + 2, scale: 0.8, borderColor: rgb(TEXT_MAIN), borderWidth: 2
  });
  page.drawText('JOBHACKAI', { x: PAGE.marginX + 21, y: y - 13, size: 13, font: bold, color: rgb(TEXT_MAIN) });
  y -= 50;
  page.drawText('Interview practice summary', { x: PAGE.marginX, y, size: 22, font: bold, color: rgb(TEXT_MAIN) });
  y -= 8;

  const meta = [];
  if (summary.role) meta.push(['Role', summary.role]);
  if (summary.seniority) meta.push(['Seniority', summary.seniority]);
  if (summary.dateLabel) meta.push(['Session date', summary.dateLabel]);
  meta.forEach((row) => {
    drawRuns([{ text: row[0] + ':', font: bold }, { text: row[1], font: regular }], { color: TEXT_SECONDARY });
  });
  y -= 12;
  page.drawLine({ start: { x: PAGE.marginX, y }, end: { x: PAGE.width - PAGE.marginX, y }, thickness: 1.5, color: rgb(BRAND_GREEN) });
  y += 6;

  // ----- body -----
  if (summary.overview) {
    heading('Overview');
    drawRuns([{ text: summary.overview, font: regular }], {});
  }
  if (summary.wentWell.length) {
    heading('What went well');
    bulletList(summary.wentWell);
  }
  if (summary.workOn.length) {
    heading('What to work on');
    bulletList(summary.workOn);
  }
  if (summary.nextPractice.length) {
    heading('For your next practice');
    bulletList(summary.nextPractice.map((step) => ({ label: '', text: step })));
  }
  if (summary.notAssessed.length) {
    heading('Not assessed in this session');
    drawRuns([{ text: 'These areas did not come up in this session, so they were not assessed. They are not weaknesses.', font: regular }], { color: TEXT_SECONDARY });
    y -= 2;
    bulletList(summary.notAssessed.map((name) => ({ label: '', text: name })));
  }

  if (summary.notes.length) {
    ensure(20 + 13 * 2);
    y -= 14;
    page.drawLine({ start: { x: PAGE.marginX, y }, end: { x: PAGE.width - PAGE.marginX, y }, thickness: 0.75, color: rgb(DIVIDER) });
    y -= 2;
    drawRuns([{ text: 'About this feedback', font: bold }], { size: 9, leading: 13, color: TEXT_SECONDARY });
    summary.notes.forEach((note) => {
      drawRuns([{ text: note, font: regular }], { size: 9, leading: 13, color: TEXT_MUTED });
    });
  }

  // ----- footer on every page -----
  const pages = doc.getPages();
  pages.forEach((p, index) => {
    p.drawText('JobHackAI  \u00B7  Interview practice summary', { x: PAGE.marginX, y: 36, size: 8.5, font: regular, color: rgb(TEXT_MUTED) });
    if (pages.length > 1) {
      const label = 'Page ' + (index + 1) + ' of ' + pages.length;
      p.drawText(label, { x: PAGE.width - PAGE.marginX - regular.widthOfTextAtSize(label, 8.5), y: 36, size: 8.5, font: regular, color: rgb(TEXT_MUTED) });
    }
  });

  return doc.save();
}

if (typeof window !== 'undefined') {
  window.JobHackAIVoiceSummary = { buildInterviewSummary, summaryFilename, summaryUnavailableMessage, renderSummaryPdf };
}
