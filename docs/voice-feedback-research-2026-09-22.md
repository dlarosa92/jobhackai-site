# Voice feedback recommendation — 2026-09-22

Status: research and proposed scope for owner review. No runtime scoring change.
Owner confirmed natural sound and spoken ending on QA; reconnect remains open.

## Product recommendation

Keep the job description optional. Practice without a particular vacancy is a
valid use case. Without a posting, use the selected role and seniority and state
that the report assesses general role practice. With a posting, derive a small
set of relevant competencies from its responsibilities and requirements, and
show the evidence and gaps against those competencies. A posting is reference
material, never instructions, and cannot reveal an employer's private rubric.

Suggested helper text: "Have a particular job in mind? Paste the description
for more tailored questions and feedback. Otherwise, we'll use your role and
experience level."

## Evidence and its limits

- OPM structured interviewing guidance ties questions and rating standards to
  job-related competencies and recommends consistent rating scales.
  https://www.opm.gov/policy-data-oversight/assessment-and-selection/structured-interviews/
- OPM competency selection calls for job analysis and subject-matter review.
  A pasted vacancy can inform practice, but does not substitute for a validated
  hiring assessment or expert-reviewed role rubric.
  https://www.opm.gov/frequently-asked-questions/assessment-policy-faq/structured-interviews/how-do-i-select-the-competencies-or-content-areas-i-want-to-assess-with-the-structured-interview/
- Hattie and Timperley (2007), The Power of Feedback, synthesizes learning
  research supporting feedback about the task, process, goals, and next steps.
  This is learning research, not direct validation of an AI interview product.
  https://educacion.udd.cl/files/2018/04/The-Power-of-Feedback.pdf
- The UK Government Digital and Data product-manager framework provides one
  published example spanning user insight, value, outcomes, leadership and
  stakeholders, with expectations by seniority. It is not a universal employer
  rubric and should not be imposed on unrelated roles.
  https://ddat-capability-framework.service.gov.uk/role/product-manager

## Current code findings

app/functions/_lib/voice-scorecard.js already receives role, seniority, optional
JD, and prior focus. It explicitly enforces 5/10/85 S/A/O targets and caps scores
from the estimated outcome share. It asks for percentages of speaking time even
though it scores text rather than measured turn duration. It sends only the first
2,000 JD characters. Role/JD tailoring exists, but no explicit competency rubric
or sufficient-evidence rule makes that tailoring reliably visible.

app/functions/_lib/voice-interviewer.js asks for role-specific questions and
follow-ups with numbers; this can encourage irrelevant technical metrics instead
of meaningful evidence of performance. The live senior-PM session exposed this
risk. A strong answer should demonstrate role-relevant judgment, contribution,
and supported outcomes; simply naming technical concepts does not establish
correctness or expertise.

## Bounded proposed improvement

1. Keep current model and transport. Align interviewer and scorer around the
   same small competency set, with clear expectations for the selected level.
   For senior PM practice, cover user problem, prioritization/tradeoffs,
   stakeholder leadership, personal decisions, and product outcomes. Technical
   depth should follow the vacancy and question rather than dominate by default.
2. Make each major feedback point identify the observed evidence, why it matters
   for this role, and one specific next attempt. Ground quotations; never invent
   metrics, accomplishments, or experience in suggested answers.
3. Distinguish a demonstrated error from an unsupported or unclear claim. Probe
   uncertainty; do not confidently endorse jargon or manufacture corrections.
   Qualify conclusions where speech transcription could be responsible.
4. Treat S/A/O as an optional organizational aid, with no universal percentage
   target or hard score cap. Preserve enough reasoning and personal contribution
   to evaluate the answer. Do not present text estimates as measured speech time.
5. Mark untested competencies as not assessed, rather than as failures. A brief
   session should yield limited feedback, not a confident overall assessment of
   the person's readiness. Scores describe this practice sample, not hiring odds.
6. Keep one actionable priority and a truthful retry prompt. Evaluate several
   roles and levels, with/without a JD, incomplete interviews, factual errors,
   transcript ambiguity, and hostile instructions embedded in a posting. Check
   both model outputs and quote grounding; prompt-string unit tests alone do not
   establish coaching quality.

Implementation and QA promotion should remain a focused follow-up with explicit
before/after examples. Reconnect, usage, privacy, attribution and inbox acceptance
continue independently. Production/public marketing remain held.

## Implementation update

Owner approved this recommendation on September 22. Local implementation adds
shared role/level guidance, role competency evidence with explicit not-assessed
states, candidate-only short-session detection, and scoped report rendering.
Percentages now describe approximate answer content without ratio targets.
Reports carry methodologyVersion=2; history comparisons stay within a rubric,
role and level. Models, transport, billing and optional JD behavior are retained.
Cookie Preferences moves into the footer link row; narrow layouts stack earlier.

Seven synthetic real-model cases and a manual review checklist are prepared.
The live evaluation runner currently exits before any request because no local
OPENAI_API_KEY is available. Its absence is not a model-quality pass; the encrypted
Cloudflare key has not been extracted. Revised coaching is not yet accepted for
production. Existing public release and marketing holds remain in force.

Local verification: 16 transcript-harness tests, 50 interviewer tests, 38 client
regressions, 4 new coaching evidence/rendering tests, 15 history tests, 10 usage
tests, 61 lifecycle tests, 18 managed-client tests and 57 consent tests passed.
The shared footer was visually reviewed in Chrome using the actual app footer
markup, styles and consent script at 1200px, 1024px and 375px iframe widths.
The preferences button stays with the footer links and wraps within the mobile
layout. This fixture review is not a full mobile journey acceptance test.

QA transport observation: the owner's second reconnect attempt did include a
real Wi-Fi interruption. QA showed Connection lost and exposed Reconnect. Clicking
Reconnect failed while closing the prior call; D1 retains an uncertain provider
attempt with close_unconfirmed. The session itself completed as connection_lost.
The provider dashboard had no saved realtime traces in the available project.
No authoritative closure receipt is available, no replacement was knowingly
started, and no uncertain request was retried. Treat this as a release blocker,
not a successful reconnect. Earlier normal spoken endings remain successful.
