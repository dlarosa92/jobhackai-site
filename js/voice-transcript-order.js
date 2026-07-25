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

export function createTranscriptOrder() {
  var slots = [];
  var byId = Object.create(null);

  function reserve(id) {
    if (!id) return null;
    if (byId[id]) return byId[id];
    var slot = { id: id, speaker: '', text: '' };
    byId[id] = slot;
    slots.push(slot);
    return slot;
  }

  function append(speaker, text) {
    slots.push({ id: null, speaker: speaker, text: text });
  }

  // conversation.item.created / conversation.item.added — reserves order
  function noteItem(id) {
    reserve(id);
  }

  // A transcript arrived. Fills its reserved slot, or appends when the id is
  // unknown/absent (graceful degradation to arrival order).
  function setText(id, speaker, text) {
    var slot = reserve(id);
    if (!slot) {
      append(speaker, text);
      return;
    }
    slot.speaker = speaker;
    slot.text = text;
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
  }

  return {
    noteItem: noteItem,
    setText: setText,
    append: append,
    list: list,
    reset: reset
  };
}

if (typeof window !== 'undefined') {
  window.createTranscriptOrder = createTranscriptOrder;
}
