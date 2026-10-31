# Voice release quality for the Brighton pilot

Prepared October 30, 2026. Product priority 1. This is a proposed release
acceptance contract, not a production approval or a claim that the gates passed.

## Purpose and partner agreement

Voice should be a useful, respectful practice coach between appointments. It
must help people explain their experience, including paid work, school,
volunteering and caregiving. It must not turn accent, speech pace, confidence,
employment gaps or a difficult personal history into a judgment of ability.
Practice feedback is not a hiring decision or a validated employability score.

The October 29 [Brighton meeting notes and transcript](https://docs.google.com/document/d/17bcX2aBg-kezcJGH71bG-s1Xlr4DgVfr9x2LvQe1Y0M/edit)
record a free, 30-day pilot for ten participants, with all three full-time talent
development specialists evaluating the tool. The meeting amended the earlier
two-coach slide. IT review, staff training, account logistics and any required
confidentiality paperwork precede the pilot clock. No launch date or participant
demographics are assumed here. Broad privacy/compliance claims in a meeting are
not substitutes for verifying the actual product data flow and retention.

Keep the existing design system and architecture. Improve voice behavior,
controls and feedback where evidence warrants it. A new model, framework or
site-wide redesign is not a prerequisite for this release.

## Evidence status and scoped engineering work

Source review initially used `ef7865ed5bf64252f1353f3daad75193638046e7`; the
development review branch is based on `d5e864cd63777b09deab07bd7de7e46a6910c520`.
Capture the actual deployed app, worker and
configuration revisions for every acceptance run; a source revision alone is
not deployment proof.

Local validation for this review: the respectful-disclosure instruction and
its prompt regressions were updated. Interviewer (55), conduct (64) and
lifecycle (64) checks passed, 183 total; the interviewer suite was rerun after
the final wording adjustment. The fix is prepared for development review, not deployed. No provider
session was started. These checks verify instructions and deterministic
behavior, not actual model speech.

The October 30 goodbye check is accepted as **owner-observed**, corroborated by
saved completion, one history entry and provider closure. It was not recorded.
That supports the bounded stop/save result, not independently verified audio,
caption accuracy, latency or naturalness. Do not repeat it solely to replace
the missed recording. Full natural completion and interruption recovery remain
human acceptance gates.

| Finding | Evidence and required disposition |
| --- | --- |
| Dismissive response to past personal hardship | A saved QA answer received a dismissal consistent with the literal "not the right place" prompt. Correct that instruction locally: acknowledge briefly, allow a relevant example or a different one, never demand private details. Keep current imminent-danger handling separate. Prompt-contract tests cannot establish the model's spoken response; listen to the release candidate. |
| Clarification can use up question opportunities | `js/voice-turn-plan.js` spends budget on response requests, including interrupted turns; the client has no dedicated repetition path. Reproduce "please repeat/rephrase" and interrupted-answer cases. Resolve premature topic advancement before acceptance, without removing the anti-loop limit. This is a source-identified risk, not yet an observed live failure. |
| Unsupported evidence can leave contradictory coaching | Reproduced through mocked provider output. The local correction clears unverified global praise, advice, summary and numerical assessments when a competency or moment quote is rejected, while retaining verified excerpts. Two regressions cover invalid competency and moment evidence even when three other assessments remain grounded. This protects new reports; previously saved reports are not silently rewritten. |
| Language support is inconsistent | The prompt allows switching languages, while lifecycle patterns and whitespace-based evidence thresholds depend on English. Initial acceptance covers English with varied accents. Product must define and accurately communicate the supported language scope before the pilot; other languages need audio-check, stop/close, transcript and feedback acceptance together. Accented English is not a separate language. |
| Accessibility and responsive behavior need acceptance | View transitions lack explicit focus handoff; multiple live regions may compete; narrow-screen header overflow was previously observed. Verify and fix concrete failures with keyboard, screen reader, mobile and zoom testing. These are not claims of a completed accessibility audit. |

Detailed technical behavior and provisional scoring thresholds are documented in
[voice-turn-budget-evidence.md](voice-turn-budget-evidence.md). Three topics,
at most two follow-up opportunities each, a final invitation and a clean close
are the intended sequence. Request counting alone does not prove meaningful
topic progression. Word-count thresholds do not validate fairness or score
calibration; concise but useful answers must still receive useful qualitative
feedback when there is enough captured evidence.

## Required release cases

Every row needs a result, reviewer, exact build and evidence reference. Use
**automated**, **artifact-verified**, **owner-observed**, **recorded/reviewed**,
**failed**, or **not run**. A passing script does not close a listening gate.
An unrun case stays open. Cases can be combined when their observations remain
distinguishable; do not inflate the evidence by counting the same run twice.

| Area | Exercise | Pass condition |
| --- | --- | --- |
| Hearing and captions | Sound check, a short and long answer, ordinary thinking pauses, varied accents and speaking pace | Both sides are audible; captions preserve important meaning; no repeated silent capture failure or interruption of normal pauses. Manually compare selected spoken segments with captions and saved text. |
| Candidate control | Repeat/rephrase, interrupt, resume an answer, mute/unmute, skip a personal example | The user understands what is happening and can recover. Clarification is not treated as an inadequate answer or used to rush through all topics. |
| Relevant coaching | Comparable examples from hourly work, technical work, school, volunteering, caregiving and a career transition | Follow-ups use the actual answer and role. Transferable skills and qualitative outcomes count. No invented experience, demand for corporate metrics, or personality/accent judgment. |
| Dignity and boundaries | Past health event, caregiving gap, difficult workplace story and ordinary interview anxiety; separate scripted current-danger fixture | Brief respectful acknowledgment, choice to continue or choose another example, no medical probing or diagnosis. Historical context does not itself trigger misconduct/safety termination. Current danger retains the dedicated safety path. |
| Full interview | All three topics, final invitation, natural close, near-deadline wrap-up | Meaningful progression without repetitive probing; no new interview question after the close; closure is reliable. Do not infer coverage from elapsed time. |
| Ending | Manual Finish, a genuine spoken end request, historical/hypothetical uses of "end" and incidental farewells within answers | Intentional end saves once and closes the provider; ordinary answer content does not end the interview. Preserve the existing bounded owner-observed goodbye result. |
| Recovery and access | Network loss during and between answers, mic denied/unavailable, resumed session, eligible/ineligible access and credit paths | Clear recovery, no silent lost answer, no repeated intake after a valid resume, no extra charge or unauthorized access. Retry feature-off behavior still works. |
| Feedback integrity | Limited and score-eligible samples, unsupported quotation injection, plausible transcription errors, comparable experience examples | Quotes and advice follow captured evidence. Rejected evidence cannot remain as criticism elsewhere. Missing/unasked skills remain unassessed. Limited evidence gets qualitative feedback without numbers; an upgrade does not manufacture eligibility. |
| Usability | Keyboard-only, screen-reader walkthrough, supported desktop/mobile browsers, 200% zoom | Visible focus, logical view/dialog focus, readable captions, reachable mute/finish/reconnect, no obstructed controls or disruptive competing announcements. Familiar site styles are retained. |
| Persistence and privacy | One history entry, reopen, selected deletion, account isolation, mic/provider closure | No duplicate session or charge, wrong-account data or interview-owned mic capture/provider activity after finish. Verify actual deletion, retention and access behavior rather than relying on copy. |

Accessibility checks follow [W3C clear-controls guidance](https://www.w3.org/WAI/WCAG2/supplemental/patterns/o1p05-clear-controls/)
and [visible keyboard focus guidance](https://www.w3.org/WAI/WCAG22/Understanding/focus-visible).
This targeted review does not certify WCAG compliance. Include participants with
different access needs when volunteers and the partner can support that review;
do not collect diagnoses or require disclosures to participate.

## Recording and staff review

Before an evidence session, place the QA recorder beside the interview, explain
what is captured and who reviews it, obtain the tester's agreement, and verify
the visible **Recording** state. Record and play a short sample containing both
the microphone and interviewer audio first. Record the output path and verify
the final file opens. Tab sharing by itself is not proof of recording.

This is an opt-in QA procedure, not default recording of production users. Keep
raw recordings and private transcripts out of the repository and public issues.
The separate QA recorder may continue, with agreement, to capture report
generation; explicitly stop it after the planned evidence is captured and
verify its stopped state. It is distinct from interview-owned microphone
capture and provider activity, which must stop when the interview finishes.
Agree reviewer access, retention and deletion before participant capture. If a
recording fails, preserve truthful owner observations and persisted evidence;
do not represent them as independent audio review.

Each of the three specialists uses this short rubric to evaluate the **tool**:

| Dimension | Question for the reviewer |
| --- | --- |
| Listening | Did it capture the answer's meaning and respond to what was actually said? |
| Pace and control | Could the person think, clarify, interrupt and finish without fighting the interface? |
| Relevance | Did questions fit the role and value transferable experience? |
| Respect | Did it handle uncertainty, speech differences and personal context without shaming or pressure? |
| Evidence honesty | Did feedback distinguish demonstrated, missing and uncertain evidence? |
| Usability | Could the person follow captions and use essential controls in their access setup? |
| Coaching value | Was there a specific, achievable next practice step? |

Mark each dimension **usable**, **needs improvement**, **blocking**, or **not
observed**. Add an example or timestamp and the impact on the experience, not a
rating of the person's intelligence, fluency or job readiness. Each specialist
completes a rehearsal and reviews feedback before participant onboarding.
Product consolidates disagreements; a blocking observation is not averaged away.

## Release sequence and decision record

1. **Engineering candidate:** resolve the concrete issues above and complete
   relevant automated checks. Identify delivered app/worker/config versions.
   Keep the existing candidate-UI, dev-to-QA promotion, migration 033,
   retry-feature-off and environment-parity requirements attached to PR #1032.
   Recheck their status before release; this document does not mark them passed.
2. **Product acceptance:** complete the required cases on that candidate,
   including a visibly recorded full interview and independent listening
   review. Product owns usability/coaching acceptance; engineering owns
   accounting, persistence, provider closure and recovery evidence.
3. **Partner readiness:** all three specialists rehearse using the rubric;
   complete IT/privacy review, training, account setup and support arrangements.
   Confirm the rollout owner, rollback/disable procedure and who receives an
   incident. Verify those mechanisms work before relying on them.
4. **Controlled pilot:** start the agreed ten-participant, 30-day clock only
   after readiness and owner release authorization. Capture completion counts,
   capture/recovery failures, premature endings, report usefulness and support
   incidents with denominators. Distinguish expected early exits from failures.
   The small sample cannot establish reliability or fairness for all users.
5. **Expansion decision:** Product and the owner review evidence and unresolved
   issues before broader availability. Pilot completion alone is not approval.

Acceptance target: every required case has a passing disposition or an explicit
scope restriction reviewed by Product and the owner, all three specialists have
completed their review, and no unresolved release-blocking failure remains.
These are proposed gates, not achieved metrics. Do not waive account isolation,
unauthorized capture, fabricated evidence or lost/duplicate credit failures.

Pause the affected path and use the verified rollback/disable procedure for
wrong-account data, continued interview-owned mic capture/provider activity after finish,
lost/duplicate paid sessions, unsafe termination behavior or fabricated feedback.
Repeated caption loss, premature endings, inaccessible controls or question
loops hold rollout/expansion until resolved and rechecked. Production release
and model changes remain separately authorized.
