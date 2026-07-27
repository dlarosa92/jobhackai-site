/**
 * Ordered transcript assembly for the voice mock interview.
 *
 * The Realtime API does not deliver transcripts in conversational order. A
 * user turn's `conversation.item.input_audio_transcription.completed`
 * (whisper, computed asynchronously) routinely lands AFTER the assistant
 * transcript for the turn it preceded, so appending in arrival order
 * scrambles the conversation. That scrambled array is what gets stored,
 * shown back to the candidate, and fed to the scorecard model — where it
 * corrupts speaker attribution, the S + A = O balance, and quoted moments.
 *
 * Fix: `conversation.item.created` / `conversation.item.added` arrive in true
 * conversation order and carry the item id, so they reserve an ordered slot
 * that the later transcript events fill by `item_id`.
 *
 * Defensive by design: a transcript with no usable id, or an id that was
 * never announced, is appended at the end rather than dropped. A
 * mis-ordered turn is cosmetic; a missing turn corrupts the score.
 */

var DEFAULT_FLUSH_MS = 1500;

// Microphone echo: the interviewer's voice plays through the speakers, the
// open mic picks it up, and whisper transcribes it as a CANDIDATE turn — a
// real dev session's stored transcript opened with the interviewer's greeting
// attributed to the user. A user turn that is a near-verbatim copy of an
// adjacent interviewer turn is that artifact, not an answer. Thresholds are
// deliberately strict so genuine answers survive, and the test is
// BIDIRECTIONAL: the user turn must be made of the interviewer's words
// (containment) AND reproduce most of her line (coverage). Coverage is what
// saves a legitimate answer assembled from the question's own words — after
// "would you describe your role as strategic, operational, or both?", the
// answer "strategic, operational, or both - both" is 100% contained but
// covers a fraction of the question, while true echo reproduces the bulk of
// the line it leaked from. Short affirmations are never touched.
var ECHO_MIN_TOKENS = 5;
var ECHO_CONTAINMENT = 0.85;
var ECHO_COVERAGE = 0.5;
var ECHO_WINDOW = 2;

function echoTokens(text) {
  return String(text).toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);
}

// Is filled[at] (a user turn) a near-verbatim copy of an assistant turn within
// ECHO_WINDOW positions on either side? Both directions matter: the echo's
// conversation item can be created before or after the line it echoes.
function isEchoOfNeighbor(filled, at) {
  var mine = echoTokens(filled[at].text);
  if (mine.length < ECHO_MIN_TOKENS) return false;
  var mineSet = Object.create(null);
  for (var m = 0; m < mine.length; m++) mineSet[mine[m]] = true;
  for (var d = -ECHO_WINDOW; d <= ECHO_WINDOW; d++) {
    if (d === 0) continue;
    var n = filled[at + d];
    if (!n || n.speaker !== 'assistant') continue;
    var tks = echoTokens(n.text);
    var theirs = Object.create(null);
    for (var i = 0; i < tks.length; i++) theirs[tks[i]] = true;
    // Containment: the user turn is made of the interviewer's words
    var hit = 0;
    for (var k = 0; k < mine.length; k++) {
      if (theirs[mine[k]]) hit++;
    }
    if (hit / mine.length < ECHO_CONTAINMENT) continue;
    // Coverage: and it reproduces most of her line, not a fragment of it
    var theirsDistinct = 0;
    var covered = 0;
    for (var key in theirs) {
      theirsDistinct++;
      if (mineSet[key]) covered++;
    }
    if (theirsDistinct > 0 && covered / theirsDistinct >= ECHO_COVERAGE) return true;
  }
  return false;
}

export function createTranscriptOrder() {
  var slots = [];
  var byId = Object.create(null);
  var waiters = [];

  // Realtime item events carry `previous_item_id` — the item this one follows.
  // Honoring it places out-of-band items (anything inserted rather than
  // appended, e.g. a resumed turn) correctly instead of at the end. An unknown
  // or absent anchor appends, which is the ordinary in-order case.
  function reserve(id, previousItemId) {
    if (!id) return null;
    if (byId[id]) return byId[id];
    var slot = { id: id, speaker: '', text: '' };
    byId[id] = slot;
    var anchor = previousItemId ? byId[previousItemId] : null;
    var at = anchor ? slots.indexOf(anchor) : -1;
    if (at >= 0) slots.splice(at + 1, 0, slot);
    else slots.push(slot);
    return slot;
  }

  function append(speaker, text) {
    slots.push({ id: null, speaker: speaker, text: text });
  }

  // conversation.item.created / conversation.item.added — reserves order
  function noteItem(id, previousItemId) {
    reserve(id, previousItemId);
  }

  // Reserved slots still waiting on a transcript. These are the turns that
  // `list()` would silently drop, so this is what a flush waits on.
  function pendingCount() {
    var n = 0;
    for (var i = 0; i < slots.length; i++) {
      var s = slots[i];
      if (s.id && (!s.speaker || !s.text)) n++;
    }
    return n;
  }

  function settleWaiters() {
    if (waiters.length === 0 || pendingCount() !== 0) return;
    var ready = waiters;
    waiters = [];
    for (var i = 0; i < ready.length; i++) ready[i](true);
  }

  // Resolves true once every announced slot has its transcript, false on
  // timeout. Callers tearing the connection down await this so a whisper
  // transcript still in flight — often the final turn, the one that ended the
  // session — is not lost with the data channel.
  function flushTranscript(opts) {
    var timeoutMs = opts && opts.timeoutMs != null ? Number(opts.timeoutMs) : DEFAULT_FLUSH_MS;
    if (pendingCount() === 0) return Promise.resolve(true);
    if (!(timeoutMs > 0)) return Promise.resolve(false);
    return new Promise(function (resolve) {
      var settled = false;
      var timer = null;
      function finish(filled) {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        var at = waiters.indexOf(onFilled);
        if (at >= 0) waiters.splice(at, 1);
        resolve(filled);
      }
      function onFilled(filled) { finish(filled !== false); }
      waiters.push(onFilled);
      timer = setTimeout(function () { finish(false); }, timeoutMs);
    });
  }

  // Retroactively remove an item's turn from the assembled transcript. The
  // lifecycle (js/voice-lifecycle.js) walks a provisionally-ACTIVE audio-check
  // round back AFTER its events may already have flowed through here, so
  // gating future writes is not enough: a whisper that already filled its
  // slot has to be pulled back out. The slot is detached, not deleted — a
  // tombstone stays in byId so a late transcript for the same id fills the
  // detached object instead of re-entering through the unknown-id append
  // path. Dropping a pending slot can complete a flush, so waiters settle.
  function drop(id) {
    if (!id) return;
    var slot = byId[id];
    if (!slot) {
      byId[id] = { id: id, speaker: '', text: '' };
      return;
    }
    var at = slots.indexOf(slot);
    if (at >= 0) slots.splice(at, 1);
    settleWaiters();
  }

  // A transcript arrived. Fills its reserved slot, or appends when the id is
  // unknown/absent (graceful degradation to arrival order).
  function setText(id, speaker, text) {
    var slot = reserve(id);
    if (!slot) {
      append(speaker, text);
      settleWaiters();
      return;
    }
    slot.speaker = speaker;
    slot.text = text;
    settleWaiters();
  }

  // Ordered, placeholder-free, with identical consecutive same-speaker lines
  // collapsed (dedupes realtime event replays) and microphone echo removed.
  function list() {
    var filled = [];
    for (var i = 0; i < slots.length; i++) {
      var s = slots[i];
      if (!s.speaker || !s.text) continue;
      filled.push({ speaker: s.speaker, text: s.text });
    }
    var out = [];
    for (var j = 0; j < filled.length; j++) {
      var t = filled[j];
      if (t.speaker === 'user' && isEchoOfNeighbor(filled, j)) continue;
      var prev = out[out.length - 1];
      if (prev && prev.speaker === t.speaker && prev.text === t.text) continue;
      out.push({ speaker: t.speaker, text: t.text });
    }
    return out;
  }

  function reset() {
    slots = [];
    byId = Object.create(null);
    // Release anyone mid-flush so a reset can never leave a pending await.
    var ready = waiters;
    waiters = [];
    for (var i = 0; i < ready.length; i++) ready[i](false);
  }

  return {
    noteItem: noteItem,
    setText: setText,
    append: append,
    drop: drop,
    list: list,
    pendingCount: pendingCount,
    flushTranscript: flushTranscript,
    reset: reset
  };
}

if (typeof window !== 'undefined') {
  window.createTranscriptOrder = createTranscriptOrder;
}
