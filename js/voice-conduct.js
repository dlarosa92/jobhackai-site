/**
 * Conduct escalation gate for the voice mock interview.
 *
 * "One clear warning, then end" used to live only in the interviewer's prompt,
 * which means nothing actually stopped the model from ending a session it had
 * never warned — a false positive would have closed a legitimate interview and
 * consumed the candidate's session. The interviewer now reports each conduct
 * action as a two-stage tool call, and this gate decides what the client does
 * with it, so the rule holds in application state regardless of how well the
 * model follows instructions.
 *
 * Refusing an unwarned end still counts as the warning. That way a genuinely
 * abusive candidate is closed out on their next incident rather than getting a
 * free pass, and the deviation is recorded against the session instead of
 * disappearing.
 */

export var CONDUCT_WARNING_STAGE = 'warning';
export var CONDUCT_END_STAGE = 'end';

export function createConductGate() {
  var warned = false;
  var deviated = false;
  var seen = Object.create(null);

  /**
   * What the client should do with a reported conduct stage:
   *   'warn'         record the warning; the interview continues
   *   'warn_instead' an end was requested with no prior warning: refuse the
   *                  end, but treat this as the warning
   *   'end'          end the session (a warning already happened)
   *   'ignore'       nothing to do (duplicate call, duplicate warning, or an
   *                  unknown stage)
   *
   * `callId` identifies the tool call. Realtime surfaces the same call twice —
   * once as its own event, then again in the response.done output — and acting
   * on the replay would quietly convert a refused unwarned end into a real one,
   * defeating the whole gate. So each call is decided exactly once.
   */
  function decide(stage, callId) {
    if (callId) {
      if (seen[callId]) return 'ignore';
      seen[callId] = true;
    }
    if (stage === CONDUCT_END_STAGE) {
      if (warned) return 'end';
      warned = true;
      deviated = true;
      return 'warn_instead';
    }
    if (stage === CONDUCT_WARNING_STAGE) {
      if (warned) return 'ignore';
      warned = true;
      return 'warn';
    }
    return 'ignore';
  }

  // Reported to /complete so a conduct termination is auditable, and so a
  // session where the model skipped the warning is countable separately.
  function endReason() {
    return deviated ? 'ended_by_interviewer_unwarned' : 'ended_by_interviewer';
  }

  function wasWarned() { return warned; }

  // Only for a brand-new session. A reconnect must NOT reset this, or a
  // candidate could clear their warning by dropping the connection.
  function reset() {
    warned = false;
    deviated = false;
    seen = Object.create(null);
  }

  return {
    decide: decide,
    endReason: endReason,
    wasWarned: wasWarned,
    reset: reset
  };
}

if (typeof window !== 'undefined') {
  window.createConductGate = createConductGate;
}
