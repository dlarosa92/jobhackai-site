# Voice conversation controls and early wrap-up

Development acceptance on November 8 exposed an early wrap-up after repeated clarification and skip requests. The report saved and reopened, one credit was used, and the provider call closed cleanly. The planned quoted-ending example was never captured, so that scenario remains untested in this run.

## Cause

The client treated every usable transcript as an answered question. Requests such as "Could you repeat that?" and "Could you rephrase that?" spent the same application turn budget as actual answers. After nine question requests, the next exchanges became a final invitation and an unconditional closing request. Even "So I want to give example of something" at the final invitation caused the closing request.

Two regressions reproduced this behavior before the fix. The audio trace and stored transcript distinguish the early wrap-up from a report failure or a false spoken-Finish match.

## Change

- Standalone repeat, rephrase, hearing-check, skip/example-change and answer-continuation requests preserve the question budget.
- Rephrasing uses the current question as reference. A declined example is replaced without pressing for its details.
- A bare yes to the final invitation invites the candidate to speak before closing. Ordinary yes/no interview answers retain their existing behavior.
- Story text and mixed control-plus-answer turns are not classified as standalone controls. Duplicate, fragmented and reconnect events retain the existing ordering and deduplication gates.
- Removed conflicting prompt instructions claiming the model owns the clock or must not drop a declined question. The server deadline and normal follow-up limits still apply.
- Updated asset versions so the client and turn-plan module ship together.

## Validation and release gate

The full local voice suite, managed-client checks and application production build pass. Regression coverage includes the failed control sequence, final invitation, quoted control phrases, mixed fragments, duplicate events and reconnect continuity.

Promote through dev0 CI first, verify the canonical development deployment, then retest the audible conversation. This is not a live acceptance pass. The broader network-loss/provider-closure issue remains open. QA and production promotion remain gated on the original acceptance plan.
