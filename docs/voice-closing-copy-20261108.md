# Clear final interview closing

A recorded development interview completed automatically and played its full
closing, but the closing invited another answer after the application had
already stopped the microphone. The owner reported feeling cut off. This is
a conversation-state mismatch, not evidence of truncated closing playback.

The final invitation now announces that the questions are complete and waits
for the candidate's answer. Existing clarification, repeat and continuation
handling preserves that last answer opportunity. Only the following terminal
turn stops capture and announces completion.

The terminal response gets empty conversational input and explicit closing
words. It no longer receives the previous invitation as context, and its
instructions forbid an extra question. The shared interviewer prompt no longer requests a named,
personalized closing or a reference to the final answer. The visible input
status says the interview is complete and the microphone is off, including
after late transcription updates.

Response-specific playback waiting, the bounded closing timeout, transcript
persistence and the single-save guard remain in place. The application still
owns completion rather than detecting a particular closing phrase. Accounting,
retention, provider closure gates and analytics are outside this change.

Two regressions failed before the fix: terminal input inherited the conversation
and the closing status still claimed a transcript was received. Coverage also
checks that the final invitation keeps the microphone available and does not
save early. Existing stale-response, playback, final-answer continuation and
single-save tests remain required.

The recorded Safari retest on the deployed development build passed the final
invitation, preserved final reply, complete closing, automatic report, saved
report reopening, one-credit accounting and provider closure. The owner
confirmed the final answer was accepted and the full goodbye played. Local
recording and the complete diagnostic trace are retained; recording is stopped.

This was a short feedback-only test. It does not establish a graded substantive
free interview or the separate near-deadline case. The prior free-account
run's inappropriate conduct warning remains a separate unresolved conversation
issue. See the current QA candidate document for evidence and retained gates.

Promote through dev0, develop/QA, then main after the required checks. This
change does not waive any remaining acceptance case or provider-closure hold.
