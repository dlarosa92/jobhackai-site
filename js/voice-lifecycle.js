/**
 * Interview lifecycle for the voice mock interview.
 *
 * Two live defects shared one root cause: the client had no notion of when
 * the interview officially IS. Speech before the interview began was
 * committed to the transcript and scored, and after the interviewer said the
 * report was being prepared the session kept accepting speech and could
 * carry on interviewing. Both are the same lifecycle-boundary failure.
 *
 * This module owns that boundary:
 *
 *   CONNECTING -> AUDIO_CHECK -> ACTIVE_INTERVIEW -> CLOSING -> COMPLETE
 *
 * The application owns session state and decides whether speech is committed
 * to the transcript/evaluation; the voice model owns only the wording of
 * questions, follow-ups, and the closing. COMPLETE is reachable from every
 * phase because the existing terminal paths (manual end, time up, conduct,
 * safety, connection lost) can fire at any point and must keep working.
 *
 * Commit decisions are per-ITEM, not per-phase-at-arrival: whisper
 * transcripts arrive asynchronously, so the audio-check acknowledgement's
 * transcript routinely lands after the interview has gone ACTIVE. Each
 * conversation item is classified once, at the moment it is announced (or
 * committed), and that classification is permanent — a late transcript for an
 * excluded item stays excluded, and a late transcript for an item announced
 * during the active interview is committed even if it arrives during CLOSING.
 * Exclusion always wins over inclusion, whatever order events replay in.
 */

export var LIFECYCLE = {
  CONNECTING: 'connecting',
  AUDIO_CHECK: 'audio_check',
  ACTIVE_INTERVIEW: 'active_interview',
  CLOSING: 'closing',
  COMPLETE: 'complete'
};

// Forward-only transition table. Reconnects never move the phase backwards:
// a drop during the audio check stays in AUDIO_CHECK (the fresh realtime
// session redoes the check), and a drop mid-interview stays ACTIVE.
var TRANSITIONS = {
  connecting: { audio_check: true, complete: true },
  audio_check: { active_interview: true, complete: true },
  active_interview: { closing: true, complete: true },
  closing: { complete: true },
  complete: {}
};

/**
 * Does this INTERVIEWER utterance announce the normal wrap-up — thanking the
 * candidate and saying the report is being prepared?
 *
 * Same rationale as isSafetyReferral / isConductWarningLine in
 * js/voice-conduct.js: lifecycle decisions cannot depend on the model calling
 * a tool (live, it skipped both existing tools), so the spoken line is the
 * signal. The prompt mandates the closing turn thank the candidate and say
 * the report is being prepared and will appear on this page, with no question
 * in that final turn.
 *
 * Biased hard toward precision: a false positive ends a legitimate interview
 * and burns the candidate's session; a false negative is only today's
 * behavior (the candidate ends manually). So ALL of the following must hold:
 *   - no question mark anywhere in the utterance — the mid-interview
 *     deflection for "when will I hear back" mentions the report but is
 *     mandated to be followed by the next question in the same turn
 *   - a closing-register thanks (for their time/conversation, not "thanks
 *     for asking" or "thank you for sharing") or an explicit wrap signal
 *     ("that's all my questions", "that concludes...")
 *   - a report sentence: report/feedback + being prepared / will appear /
 *     ready / on its way
 */
export function isClosingAnnouncement(text) {
  if (typeof text !== 'string' || text.length < 12) return false;
  if (text.indexOf('?') >= 0) return false;
  var lower = text.toLowerCase();
  var closingThanks =
    /\bthank(?:s|\s+you)\b[^]{0,60}\b(?:your time|for talking|for speaking|for joining|for the conversation|for sitting down|for meeting|for coming|today)\b/.test(lower);
  var wrapSignal =
    /\b(?:that(?:'s| is) (?:all|everything)|that (?:concludes|wraps)|this (?:concludes|wraps)|we(?:'re| are) (?:done|finished|at time|out of time)|no (?:further|more) questions)\b/.test(lower);
  if (!closingThanks && !wrapSignal) return false;
  var sentences = lower.replace(/([.!])/g, '$1\n').split('\n');
  for (var i = 0; i < sentences.length; i++) {
    var s = sentences[i];
    if (!s) continue;
    if (!/\b(?:report|feedback|results|evaluation)\b/.test(s)) continue;
    if (/\b(?:being prepared|prepared|being generated|generated|will appear|appears? on this page|on its way|ready|available)\b/.test(s)) return true;
  }
  return false;
}

/**
 * Is this INTERVIEWER utterance another hearing check — "can you hear me
 * clearly/now/okay?" — rather than interview content?
 *
 * Used for exactly one decision: when the candidate's audio-check reply was
 * NOT a confirmation ("I can't hear you", "can you repeat?"), the model
 * re-runs the check, and the provisional ACTIVE transition has to be walked
 * back so the repeated check and the eventual real acknowledgement stay out
 * of the transcript and scoring.
 *
 * Precision-biased on purpose: the register requires "hear me" (or an
 * audio-is-it-working phrasing) inside a QUESTION sentence, which no real
 * interview opening uses — "tell me about a time you were not heard" or
 * "what if a customer says they can't hear you?" never match. A missed
 * paraphrase ("is that better?") merely leaves that round committed, i.e.
 * the pre-fix behavior; a false positive would swallow a real opening, so
 * the asymmetry decides the bias.
 */
export function isHearingCheckTurn(text) {
  if (typeof text !== 'string' || text.length < 8) return false;
  var sentences = text.toLowerCase().replace(/([.!?])/g, '$1\n').split('\n');
  for (var i = 0; i < sentences.length; i++) {
    var s = sentences[i];
    if (!s || s.indexOf('?') < 0) continue;   // hearing checks are questions
    if (/\b(?:can|could|do|are) you hear me\b/.test(s)) return true;
    if (/\bare you able to hear me\b/.test(s)) return true;
    if (/\bhear(?:ing)? me (?:now|okay|ok|clearly|better|alright|all right|this time)\b/.test(s)) return true;
    if (/\b(?:is|are) (?:my|the) (?:audio|sound|mic|microphone|voice)\b[^]{0,30}\b(?:coming through|working|clear(?:er)?|better|okay|ok|audible)\b/.test(s)) return true;
    if (/\bam i coming through\b/.test(s)) return true;
    if (/\bcoming through (?:okay|ok|clearly|clear|better|now|alright|all right)\b/.test(s)) return true;
  }
  return false;
}

export function createInterviewLifecycle() {
  var phase = LIFECYCLE.CONNECTING;
  // Permanent per-item verdicts. `excluded` wins over `included`, so an item
  // classified during the audio check can never be re-included by a replayed
  // or late event after the interview goes ACTIVE.
  var excluded = Object.create(null);
  var included = Object.create(null);
  var greetingDone = false;
  // The transition on the candidate's post-greeting commit is PROVISIONAL:
  // at commit time the app cannot know whether they confirmed or said they
  // cannot hear (the whisper transcript arrives too late to wait for). The
  // first assistant transcript after the transition settles it — see
  // noteAssistantTurn. Until then, user items committed in the window are
  // remembered so a demotion can exclude them retroactively.
  var awaitingOpening = false;
  var pendingSinceAck = [];

  function is(p) { return phase === p; }

  function to(next) {
    var allowed = TRANSITIONS[phase];
    if (!allowed || !allowed[next]) return false;
    phase = next;
    return true;
  }

  function excludeItem(id) {
    if (id) excluded[id] = true;
  }

  /**
   * A conversation item was announced (conversation.item.created/added).
   * Returns true when the item belongs to the official interview — the caller
   * forwards only those to the transcript assembler, so excluded items never
   * create pending slots that a teardown flush would wait on.
   */
  function noteItem(id) {
    if (!id) return phase === LIFECYCLE.ACTIVE_INTERVIEW;
    if (excluded[id]) return false;
    if (included[id]) return true;
    if (phase === LIFECYCLE.ACTIVE_INTERVIEW) {
      included[id] = true;
      return true;
    }
    excluded[id] = true;
    return false;
  }

  /**
   * The interviewer's audio-check greeting finished generating. Only the
   * first response of the audio check counts; the flag arms the
   * acknowledgement transition below.
   */
  function noteGreetingDone() {
    if (phase === LIFECYCLE.AUDIO_CHECK) greetingDone = true;
  }

  function isGreetingDone() { return greetingDone; }

  /**
   * The candidate's speech was committed by VAD (input_audio_buffer.committed).
   * Classifies the committed item and drives the one automatic transition:
   * the first commit AFTER the greeting is the audio-check acknowledgement —
   * it is itself excluded from the transcript, and the interview goes ACTIVE
   * so the interviewer's reply (the opening + first question) is committed.
   *
   * Returns 'begin_interview' | 'committed' | 'excluded'.
   */
  function noteUserCommitted(itemId) {
    if (phase === LIFECYCLE.ACTIVE_INTERVIEW) {
      if (itemId && !excluded[itemId]) included[itemId] = true;
      // Committed before the opening settled the provisional ack: remembered,
      // so a demotion can pull it back out of the transcript.
      if (awaitingOpening && itemId) pendingSinceAck.push(itemId);
      return 'committed';
    }
    excludeItem(itemId);
    if (phase === LIFECYCLE.AUDIO_CHECK && greetingDone) {
      to(LIFECYCLE.ACTIVE_INTERVIEW);
      awaitingOpening = true;
      pendingSinceAck = [];
      return 'begin_interview';
    }
    return 'excluded';
  }

  /**
   * The first assistant transcript after a provisional acknowledgement
   * settles what that acknowledgement actually was.
   *
   *   'confirmed' — the turn is interview content (the opening): the ack was
   *                 real. Permanent: the window closes and never reopens, so
   *                 a mid-interview "can you hear me?" after a blip can never
   *                 drag the session backwards.
   *   'demoted'   — the turn is unmistakably ANOTHER hearing check, so the
   *                 candidate had said they could not hear: back to
   *                 AUDIO_CHECK. The check turn and every user item committed
   *                 in the window are excluded (exclusion wins over their
   *                 earlier inclusion), the greeting stays armed, and the
   *                 next commit is the next provisional acknowledgement.
   *   'none'      — nothing to settle (no window open, or no usable text).
   *
   * The caller must consult this BEFORE handing the turn to the transcript
   * assembler: exclusion gates future writes, it cannot unwrite one.
   */
  function noteAssistantTurn(itemId, transcript) {
    if (phase !== LIFECYCLE.ACTIVE_INTERVIEW || !awaitingOpening) return 'none';
    var text = typeof transcript === 'string' ? transcript.trim() : '';
    if (!text) return 'none';
    if (!isHearingCheckTurn(text)) {
      awaitingOpening = false;
      pendingSinceAck = [];
      return 'confirmed';
    }
    excludeItem(itemId);
    for (var i = 0; i < pendingSinceAck.length; i++) excludeItem(pendingSinceAck[i]);
    pendingSinceAck = [];
    awaitingOpening = false;
    // Internal, deliberate backward step — to() stays forward-only so no
    // outside caller can ever move the phase backwards.
    phase = LIFECYCLE.AUDIO_CHECK;
    // The repeated check is the greeting of this round: it has fully
    // generated (its transcript is what we just read), so the next commit is
    // the next provisional acknowledgement.
    greetingDone = true;
    return 'demoted';
  }

  function isAwaitingOpening() { return awaitingOpening; }

  /**
   * May this transcript be committed to the persisted transcript (and so to
   * history and scoring)? Id-carrying events answer from the item's permanent
   * verdict. An UNKNOWN id — its announcement and commit events both lost —
   * falls back to the phase at arrival, same as an id-less event: the
   * transcript assembler's rule is that a missing turn corrupts the score
   * while a mis-ordered one is cosmetic, and a dropped announcement must not
   * silently delete a genuine interview turn. Every excluded turn is excluded
   * by an explicit verdict, never by luck of event delivery.
   */
  function shouldCommit(itemId) {
    if (itemId) {
      if (excluded[itemId]) return false;
      if (included[itemId]) return true;
    }
    return phase === LIFECYCLE.ACTIVE_INTERVIEW;
  }

  /** A reconnect landed. During the audio check the fresh session re-greets. */
  function noteReconnect() {
    if (phase === LIFECYCLE.AUDIO_CHECK) greetingDone = false;
  }

  return {
    phase: function () { return phase; },
    is: is,
    to: to,
    excludeItem: excludeItem,
    noteItem: noteItem,
    noteGreetingDone: noteGreetingDone,
    isGreetingDone: isGreetingDone,
    noteUserCommitted: noteUserCommitted,
    noteAssistantTurn: noteAssistantTurn,
    isAwaitingOpening: isAwaitingOpening,
    shouldCommit: shouldCommit,
    noteReconnect: noteReconnect
  };
}

if (typeof window !== 'undefined') {
  window.createInterviewLifecycle = createInterviewLifecycle;
  window.isClosingAnnouncement = isClosingAnnouncement;
  window.isHearingCheckTurn = isHearingCheckTurn;
  window.VOICE_LIFECYCLE = LIFECYCLE;
}
