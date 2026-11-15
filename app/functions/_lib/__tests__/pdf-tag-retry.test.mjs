// PDF uploads: a tagged PDF that the converter returns empty is retried once
// with its structure tree switched off.
//
// The converter here is a stand-in that behaves the way production did on
// 2026-11-14: for a tagged PDF it returns the metadata block and no page text,
// for an untagged one it returns the page text.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import {
  extractResumeText,
  hasPdfStructureTags,
  stripPdfStructureTags,
  unglueBullets,
  EXTRACTION_ERRORS
} from '../resume-extractor.js';

const samples = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../docs/Test Resumes');
const taggedPdf = readFileSync(path.join(samples, '100- Michael Rodriguez SE.pdf'));
const untaggedImagePdf = readFileSync(path.join(samples, 'Generic_Resume_ImageOnly.pdf'));

const toArrayBuffer = (buffer) => buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
const includesAscii = (arrayBuffer, text) => Buffer.from(arrayBuffer).includes(Buffer.from(text, 'latin1'));

const METADATA_ONLY = [
  '# resume.pdf',
  '## Metadata',
  '- PDFFormatVersion=1.3',
  '- IsLinearized=false',
  '- Title=100- Michael Rodriguez SE',
  '- Producer=macOS Version 15.6.1 (Build 24G90) Quartz PDFContext',
  '- Creator=Pages',
  '',
  '## Contents',
  '### Page 1',
  '',
  '### Page 2',
  ''
].join('\n');

const WITH_PAGE_TEXT = [
  '# resume.pdf',
  '## Metadata',
  '- PDFFormatVersion=1.3',
  '- Creator=Pages',
  '',
  '## Contents',
  '### Page 1',
  'Michael Rodriguez',
  'michael.rodriguez@email.com | (415) 555-0123 | San Francisco, CA',
  '',
  'PROFESSIONAL SUMMARY',
  'Experienced Software Engineer with 6+ years building scalable web applications and distributed systems.',
  'Proven track record leading cross-functional teams using agile methodologies to deliver features.',
  '',
  'EXPERIENCE',
  'Senior Software Engineer at CloudScale Technologies',
  'Led a team of five engineers building a React and Node.js platform used by 200,000 customers.'
].join('\n');

function fakeEnv(respond) {
  const calls = [];
  return {
    calls,
    AI: {
      async toMarkdown(documents) {
        const bytes = await documents[0].blob.arrayBuffer();
        calls.push(bytes);
        return [respond(bytes, calls.length)];
      }
    }
  };
}

const brokenOnTaggedPdfs = (bytes) => ({
  name: 'resume.pdf',
  mimeType: 'application/pdf',
  format: 'markdown',
  tokens: 0,
  data: includesAscii(bytes, '/StructTreeRoot') ? METADATA_ONLY : WITH_PAGE_TEXT
});

function silenceConsole(t) {
  const original = { log: console.log, warn: console.warn, error: console.error };
  const lines = [];
  for (const level of Object.keys(original)) {
    console[level] = (...args) => lines.push({ level, args });
  }
  t.after(() => Object.assign(console, original));
  return lines;
}

test('the sample PDF is tagged, and switching the tags off keeps the file the same size', () => {
  const original = toArrayBuffer(taggedPdf);
  assert.equal(hasPdfStructureTags(original), true);

  const untagged = stripPdfStructureTags(original);
  assert.equal(untagged.byteLength, original.byteLength, 'byte offsets in the PDF must not move');
  assert.equal(hasPdfStructureTags(untagged), false);
  assert.equal(includesAscii(untagged, '/StructTreeRooX'), true);

  // Only the renamed key bytes differ, and the caller's copy is left alone.
  const before = new Uint8Array(original);
  const after = new Uint8Array(untagged);
  let changed = 0;
  for (let i = 0; i < before.length; i++) if (before[i] !== after[i]) changed++;
  const occurrences = taggedPdf.toString('latin1').split('/StructTreeRoot').length - 1;
  assert.equal(changed, occurrences);
  assert.equal(hasPdfStructureTags(original), true);
});

test('an untagged PDF has nothing to switch off', () => {
  const original = toArrayBuffer(untaggedImagePdf);
  assert.equal(hasPdfStructureTags(original), false);
  assert.equal(stripPdfStructureTags(original), null);
});

test('a tagged PDF that converts to nothing is retried untagged and then succeeds', async (t) => {
  const lines = silenceConsole(t);
  const env = fakeEnv(brokenOnTaggedPdfs);

  const result = await extractResumeText(toArrayBuffer(taggedPdf), 'resume.pdf', env);

  assert.equal(env.calls.length, 2);
  assert.equal(includesAscii(env.calls[0], '/StructTreeRoot'), true, 'first attempt sends the file as uploaded');
  assert.equal(includesAscii(env.calls[1], '/StructTreeRoot'), false, 'retry sends the untagged copy');
  assert.equal(env.calls[1].byteLength, env.calls[0].byteLength);

  assert.match(result.text, /Michael Rodriguez/);
  assert.match(result.text, /CloudScale Technologies/);
  assert.doesNotMatch(result.text, /PDFFormatVersion|Creator=Pages/);
  assert.equal(result.fileType, 'pdf');

  const retryLog = lines.find((line) => String(line.args[0]).includes('retried without structure tags'));
  assert.ok(retryLog, 'the retry is logged');
  assert.doesNotMatch(JSON.stringify(retryLog.args), /Michael|Rodriguez|CloudScale|email\.com/, 'the log carries counts, not resume text');
});

test('a tagged PDF that converts fine is sent once', async (t) => {
  silenceConsole(t);
  const env = fakeEnv(() => ({ name: 'resume.pdf', format: 'markdown', data: WITH_PAGE_TEXT }));

  const result = await extractResumeText(toArrayBuffer(taggedPdf), 'resume.pdf', env);

  assert.equal(env.calls.length, 1);
  assert.match(result.text, /Michael Rodriguez/);
});

test('a tagged PDF that is still empty after the retry reports the same error as before', async (t) => {
  const lines = silenceConsole(t);
  const env = fakeEnv(() => ({ name: 'resume.pdf', format: 'markdown', data: METADATA_ONLY }));

  await assert.rejects(
    extractResumeText(toArrayBuffer(taggedPdf), 'resume.pdf', env),
    (error) => {
      assert.equal(error.code, EXTRACTION_ERRORS.PARSE_ERROR);
      assert.equal(error.details.isEmpty, true);
      return true;
    }
  );
  assert.equal(env.calls.length, 2);
  assert.ok(lines.some((line) => String(line.args[0]).includes('[PDF] Extracted text empty after cleaning')));
});

test('an untagged PDF with no text is not retried', async (t) => {
  silenceConsole(t);
  const env = fakeEnv(() => ({ name: 'resume.pdf', format: 'markdown', data: METADATA_ONLY }));

  await assert.rejects(
    extractResumeText(toArrayBuffer(untaggedImagePdf), 'resume.pdf', env),
    (error) => error.code === EXTRACTION_ERRORS.PARSE_ERROR && error.details.isEmpty === true
  );
  assert.equal(env.calls.length, 1);
});

test('a converter error on a tagged PDF is retried, and the retry result is used', async (t) => {
  silenceConsole(t);
  const env = fakeEnv((bytes) => (includesAscii(bytes, '/StructTreeRoot')
    ? { name: 'resume.pdf', format: 'error', error: 'conversion failed' }
    : { name: 'resume.pdf', format: 'markdown', data: WITH_PAGE_TEXT }));

  const result = await extractResumeText(toArrayBuffer(taggedPdf), 'resume.pdf', env);

  assert.equal(env.calls.length, 2);
  assert.match(result.text, /Michael Rodriguez/);
});

test('a converter error that survives the retry is reported as a parse failure', async (t) => {
  silenceConsole(t);
  const env = fakeEnv(() => ({ name: 'resume.pdf', format: 'error', error: 'This PDF is encrypted' }));

  await assert.rejects(
    extractResumeText(toArrayBuffer(taggedPdf), 'resume.pdf', env),
    (error) => {
      assert.equal(error.code, EXTRACTION_ERRORS.PARSE_ERROR);
      assert.equal(error.details.parseFailed, true);
      assert.match(error.message, /password-protected/);
      return true;
    }
  );
});

test('a bullet stuck to the previous line is moved to its own line', () => {
  const glued = 'Senior Engineer at CloudScaleMarch 2021 - Present• Led a team of five• Cut load time by 45%';
  assert.equal(
    unglueBullets(glued),
    'Senior Engineer at CloudScaleMarch 2021 - Present\n• Led a team of five\n• Cut load time by 45%'
  );
});

test('bullets used as separators inside a line, and bullets already on their own line, are left alone', () => {
  const text = 'Skills: React • Node.js • Python\n• Led a team\n  • Nested point';
  assert.equal(unglueBullets(text), text);
  assert.equal(unglueBullets(''), '');
});

test('text recovered from a PDF has its bullets at the start of lines', async (t) => {
  silenceConsole(t);
  const gluedPage = [
    '# resume.pdf',
    '## Contents',
    '### Page 1',
    'Michael Rodriguezmichael.rodriguez@email.com | (415) 555-0123EXPERIENCESenior Software Engineer at CloudScale TechnologiesMarch 2021 - Present• Architected a React dashboard serving 500K daily users,',
    'improving page load time by 45%• Designed RESTful API services processing 10M requests per day• Led migration from a monolith to microservices, reducing deployment time by 60%'
  ].join('\n');
  const env = fakeEnv(() => ({ name: 'resume.pdf', format: 'markdown', data: gluedPage }));

  const result = await extractResumeText(toArrayBuffer(untaggedImagePdf), 'resume.pdf', env);

  const bulletLines = result.text.split('\n').filter((line) => line.startsWith('• '));
  assert.equal(bulletLines.length, 3);
  assert.doesNotMatch(result.text, /\S•/);
});
