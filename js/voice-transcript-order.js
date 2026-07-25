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

  // Ordered, placeholder-free, with identical consecutive same-speaker
  // lines collapsed (dedupes realtime event replays).
  function list() {
    var out = [];
    for (var i = 0; i < slots.length; i++) {
      var s = slots[i];
      if (!s.speaker || !s.text) continue;
      var prev = out[out.length - 1];
      if (prev && prev.speaker === s.speaker && prev.text === s.text) continue;
      out.push({ speaker: s.speaker, text: s.text });
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
    list: list,
    pendingCount: pendingCount,
    flushTranscript: flushTranscript,
    reset: reset
  };
}

if (typeof window !== 'undefined') {
  window.createTranscriptOrder = createTranscriptOrder;
}
