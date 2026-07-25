// Voice interviewer instructions test suite (standalone, no framework)
// Run: node app/functions/_lib/__tests__/voice-interviewer.test.mjs
//
// Covers the real-session transcript findings:
// - the model invented a "few days" report timeline (report is immediate)
// - meta-questions (salary, name, "when will I hear back") got mismatched answers
// - after a reconnect the interviewer restarted and re-asked covered questions

import assert from 'node:assert/strict';
import {
  interviewerInstructions,
  buildResumeContext,
  RESUME_CONTEXT_MAX_CHARS,
  INTERVIEWER_TOOLS
} from '../voice-interviewer.js';

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (err) { failed++; console.error(`  ✗ ${name}\n    ${err.message}`); }
}

const BASE = { role: 'Software Engineer', seniority: 'Senior', jd: null, maxMinutes: 20 };

test('base instructions include role, minutes, and preserved audit rules', () => {
  const out = interviewerInstructions(BASE);
  assert.ok(out.includes('Senior Software Engineer position'));
  assert.ok(out.includes('up to 20 minutes'));
  assert.ok(out.includes('one question at a time'));
  assert.ok(out.includes('Never ask something the candidate already answered'));
  assert.ok(out.includes('Stay in character as the interviewer'));
});

test('report timing is stated as immediate and timelines are banned', () => {
  const out = interviewerInstructions(BASE);
  assert.ok(out.includes('ready on this page moments after the session ends'));
  assert.ok(out.includes('Never invent a timeline such as "a few days"'));
  // The close references the report appearing on this page, not a future delivery
  assert.ok(out.includes('will appear on this page'));
});

test('meta-question deflections cover salary, name, and hearing back', () => {
  const out = interviewerInstructions(BASE);
  assert.ok(out.includes('salary or compensation is outside a mock interview'));
  assert.ok(out.includes('your own name or personal life stays out of it'));
  assert.ok(out.includes('when will I hear back'));
});

test('jd is included only when provided', () => {
  const without = interviewerInstructions(BASE);
  assert.ok(!without.includes('job description, for context'));
  const withJd = interviewerInstructions({ ...BASE, jd: 'Must have Kubernetes.' });
  assert.ok(withJd.includes('The job description, for context: Must have Kubernetes.'));
});

test('resume context appends the continuity block; absence changes nothing', () => {
  const fresh = interviewerInstructions(BASE);
  assert.ok(!fresh.includes('RESUMING'));

  const resumed = interviewerInstructions({
    ...BASE,
    resumeContext: 'Interviewer: Tell me about a project.\nCandidate: I led the checkout rebuild.'
  });
  assert.ok(resumed.includes('RESUMING an interview already in progress'));
  assert.ok(resumed.includes('do not re-ask anything already covered'));
  assert.ok(resumed.includes('Candidate: I led the checkout rebuild.'));
  // Continuity block comes last so it reads as the freshest state
  assert.ok(resumed.indexOf('RESUMING') > resumed.indexOf('Speak only in English'));
  // The base rules are unchanged, just extended
  assert.ok(resumed.startsWith(fresh));
});

test('buildResumeContext formats speakers and keeps the newest turns', () => {
  const ctx = buildResumeContext([
    { speaker: 'assistant', text: 'Tell me about a tight deadline.' },
    { speaker: 'user', text: 'I shipped the checkout fix before the sale.' }
  ]);
  assert.equal(
    ctx,
    'Interviewer: Tell me about a tight deadline.\nCandidate: I shipped the checkout fix before the sale.'
  );
});

test('buildResumeContext caps total size, dropping the OLDEST turns first', () => {
  const turns = [];
  for (let i = 0; i < 50; i++) {
    turns.push({ speaker: i % 2 ? 'user' : 'assistant', text: `Turn number ${i} ` + 'x'.repeat(120) });
  }
  const ctx = buildResumeContext(turns);
  assert.ok(ctx.length <= RESUME_CONTEXT_MAX_CHARS);
  assert.ok(ctx.includes('Turn number 49'), 'newest turn kept');
  assert.ok(!ctx.includes('Turn number 0 '), 'oldest turn dropped');
});

test('buildResumeContext ignores junk and returns null when empty', () => {
  assert.equal(buildResumeContext(null), null);
  assert.equal(buildResumeContext([]), null);
  assert.equal(buildResumeContext([{ speaker: 'system', text: 'nope' }, { speaker: 'user', text: '   ' }]), null);
});

// ---- persona lock and conduct policy (real adversarial session findings) ----

test('persona is locked to interviewer: no assistant, coach, or resource role', () => {
  const out = interviewerInstructions(BASE);
  assert.ok(out.includes('You are only ever the interviewer'));
  assert.ok(out.includes('not an assistant, a coach, a tutor, or a resource finder'));
  assert.ok(out.includes('never describe yourself or list what you can do'));
  assert.ok(out.includes('you are their interviewer for this practice session'));
});

test('internals are never revealed', () => {
  const out = interviewerInstructions(BASE);
  assert.ok(out.includes('Never explain where your questions come from'));
  assert.ok(out.includes('do not narrate your own reasoning'));
});

test('conduct: one warning in her own voice, then end via the tool', () => {
  const out = interviewerInstructions(BASE);
  assert.ok(out.includes('abusive, sexually explicit, or demeaning'));
  // The tone brief: human and firm, not a policy recital
  assert.ok(out.includes('as a professional who will not be spoken to that way'));
  assert.ok(out.includes('Name what they just said'));
  assert.ok(out.includes('do not recite a policy'));
  assert.ok(out.includes('never pretend it did not happen'));
  // Escalation is bounded: only after one warning
  assert.ok(out.includes('call the end_interview tool with reason "conduct"'));
  assert.ok(out.includes('only after you have already given them that one clear warning'));
});

test('distress: brief honest redirect, never a counselor or hotline dispenser', () => {
  const out = interviewerInstructions(BASE);
  assert.ok(out.includes('do not become a counselor'));
  assert.ok(out.includes('do not offer hotlines, therapists, or HR advice'));
  assert.ok(out.includes('this is interview practice so it is not the right place for it'));
  assert.ok(out.includes('deserve to talk to someone who can actually help'));
});

test('the question-pushback rule no longer overrides conduct or distress', () => {
  const out = interviewerInstructions(BASE);
  assert.ok(out.includes('challenges or refuses an interview question'));
  assert.ok(out.includes('it never overrides the conduct and distress rules above'));
  // Ordering matters for "above" to be true
  assert.ok(out.indexOf('abusive, sexually explicit') < out.indexOf('challenges or refuses an interview question'));
  assert.ok(out.indexOf('do not become a counselor') < out.indexOf('challenges or refuses an interview question'));
});

test('end_interview is the only registered tool and is shaped for the Realtime API', () => {
  assert.equal(INTERVIEWER_TOOLS.length, 1);
  const tool = INTERVIEWER_TOOLS[0];
  assert.equal(tool.type, 'function');
  assert.equal(tool.name, 'end_interview');
  assert.ok(/one clear warning/i.test(tool.description));
  assert.equal(tool.parameters.type, 'object');
  assert.deepEqual(tool.parameters.required, ['reason']);
  assert.deepEqual(tool.parameters.properties.reason.enum, ['conduct']);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
