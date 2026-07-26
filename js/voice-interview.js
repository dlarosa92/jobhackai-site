// Voice Mock Interview client
// WebRTC directly to OpenAI Realtime using a server-minted ephemeral secret.
// The entitlement gate, consumption, and transcript/cost persistence all live
// server-side; this file is the connection + UI state machine.
(function () {
  'use strict';

  var REALTIME_CALLS_URL = 'https://api.openai.com/v1/realtime/calls';

  // Echo cancellation is the first defense against the interviewer's own voice
  // leaking from the speakers into the mic and coming back transcribed as a
  // candidate turn. Browsers usually default these on, but not universally,
  // and the observed dev transcript started with exactly that artifact.
  var MIC_CONSTRAINTS = { echoCancellation: true, noiseSuppression: true, autoGainControl: true };

  // How long ending the interview waits for transcripts already in flight.
  // Long enough for a trailing whisper result, short enough that nobody is
  // left staring at a spinner if an event never arrives.
  var TRANSCRIPT_FLUSH_MS = 1500;

  // Ceiling on waiting for the interviewer's closing line to finish before a
  // conduct end tears the session down. Generous enough for a spoken sentence,
  // hard enough that a dropped event cannot hold the session open.
  var CONDUCT_END_MAX_WAIT_MS = 6000;
  // How long to wait after the closing response completes for its audio to
  // begin, before concluding there is no closing audio at all.
  var CONDUCT_END_AUDIO_GRACE_MS = 750;

  // A genuine processing delay this long earns one truthful waiting cue.
  // This is an app-level prompt about OUR pipeline being slow, deliberately
  // far above conversational pause length: a 2-2.5s pause is the candidate or
  // the interviewer thinking, and must never trigger a cue or a reprompt.
  // ASR/VAD endpointing is untouched and stays server-side.
  var WAITING_CUE_MS = 4000;

  var state = {
    sessionId: null,
    model: null,
    pc: null,
    dc: null,
    micStream: null,
    audioEl: null,
    startedAtMs: null,
    timerInterval: null,
    maxMinutes: 20,
    order: null,               // ordered transcript assembler (voice-transcript-order.js)
    usage: { input: 0, output: 0 },
    ending: false,
    connected: false,
    audioPlaying: false,       // interviewer's audio is mid-playback
    audioResponseId: '',       // which response that audio belongs to
    answeredCalls: null,       // call_id -> true; each tool call answered exactly once
    conduct: null,             // escalation gate (voice-conduct.js); survives a reconnect
    conductEnd: null,          // pending end, waiting for the closing turn
    endCause: null,            // 'conduct' | 'safety' | 'closing' — which reason the pending end carries
    lifecycle: null,           // interview lifecycle (voice-lifecycle.js); owns commit boundaries
    turnWait: null             // { committedAtMs, cueTimer } — turn-start latency + waiting cue
  };

  function $(id) { return document.getElementById(id); }

  function show(viewId) {
    ['vi-setup-view', 'vi-live-view', 'vi-done-view', 'vi-disabled-view'].forEach(function (id) {
      var el = $(id);
      if (el) el.style.display = (id === viewId) ? '' : 'none';
    });
  }

  function setStatus(text, cls) {
    var el = $('vi-status');
    if (el) { el.textContent = text; el.className = 'vi-status ' + (cls || ''); }
  }

  async function getIdToken() {
    var user = null;
    if (window.FirebaseAuthManager) {
      if (typeof window.FirebaseAuthManager.waitForAuthReady === 'function') {
        user = await window.FirebaseAuthManager.waitForAuthReady();
      }
      if (!user && typeof window.FirebaseAuthManager.getCurrentUser === 'function') {
        user = window.FirebaseAuthManager.getCurrentUser();
      }
    }
    if (!user) throw new Error('not_authenticated');
    return user.getIdToken(true);
  }

  async function api(path, opts) {
    var token = await getIdToken();
    opts = opts || {};
    opts.headers = Object.assign({
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + token
    }, opts.headers || {});
    var res = await fetch(path, opts);
    var data = null;
    try { data = await res.json(); } catch (_) {}
    return { ok: res.ok, status: res.status, data: data };
  }

  function track(eventName, params) {
    try {
      var payload = Object.assign({ session_id: state.sessionId || undefined }, params || {});
      if (window.JHA && window.JHA.analytics && typeof window.JHA.analytics.track === 'function') {
        window.JHA.analytics.track(eventName, payload);
      } else if (typeof window.gtag === 'function') {
        window.gtag('event', eventName, payload);
      }
    } catch (_) {}
  }

  // ---------- entitlement banner ----------

  async function loadEntitlement() {
    try {
      var res = await api('/api/plan/me', { method: 'GET' });
      var voice = res.data && res.data.voice;
      if (!voice || !voice.enabled) { show('vi-disabled-view'); return; }

      initHistory(voice);

      var banner = $('vi-entitlement');
      var startBtn = $('vi-start-btn');
      if (!banner || !startBtn) return;

      if (voice.canStart) {
        startBtn.disabled = false;
        if (voice.unlimited) {
          banner.textContent = 'Your plan includes unlimited voice interviews.';
        } else if (voice.mode === 'pack') {
          banner.textContent = 'You have ' + voice.sessionsRemaining + ' session' + (voice.sessionsRemaining === 1 ? '' : 's') + ' left in your Interview Pack.';
        } else {
          banner.textContent = 'Your first voice interview is free. Make it count.';
        }
        banner.className = 'vi-banner vi-banner-ok';
      } else {
        startBtn.disabled = true;
        banner.innerHTML = 'Your free voice interview is used. <a href="/pricing">See plans</a> to keep practicing.';
        banner.className = 'vi-banner vi-banner-paywall';
        track('paywall_view', { surface: 'voice_setup' });
      }
    } catch (err) {
      // Logged-out users get bounced by the page guard; other errors stay quiet
      console.warn('[VOICE] entitlement load failed:', err && err.message);
    }
  }

  // ---------- realtime event handling ----------

  // js/voice-transcript-order.js is an ES module, so on the vanishing chance
  // it has not executed yet we degrade to plain arrival-order collection
  // rather than losing turns.
  function newTranscriptOrder() {
    if (typeof window.createTranscriptOrder === 'function') {
      return window.createTranscriptOrder();
    }
    var arr = [];
    return {
      noteItem: function () {},
      setText: function (id, speaker, text) { arr.push({ speaker: speaker, text: text }); },
      append: function (speaker, text) { arr.push({ speaker: speaker, text: text }); },
      list: function () { return arr.slice(); },
      // Arrival-order collection reserves nothing, so there is never anything
      // in flight to wait for.
      pendingCount: function () { return 0; },
      flushTranscript: function () { return Promise.resolve(true); },
      reset: function () { arr = []; }
    };
  }

  // The conversation in true order, for /complete and the resume tail.
  function getTranscript() {
    return state.order ? state.order.list() : [];
  }

  // ---------- interview lifecycle ----------

  // If js/voice-lifecycle.js failed to execute, fall back to a hand-synced
  // minimal copy rather than reverting to "commit everything": the module
  // going missing must not silently reintroduce the pre-interview-speech and
  // late-chatter defects. Loud, same pattern as the conduct fallbacks.
  var lifecycleModuleMissingReported = false;
  function reportLifecycleModuleMissing() {
    if (lifecycleModuleMissingReported) return;
    lifecycleModuleMissingReported = true;
    console.error('[VOICE] js/voice-lifecycle.js did not load; using built-in fallback. Report this.');
    track('voice_module_missing', { module: 'voice-lifecycle' });
  }

  var PHASES = (typeof window.VOICE_LIFECYCLE === 'object' && window.VOICE_LIFECYCLE) || {
    CONNECTING: 'connecting',
    AUDIO_CHECK: 'audio_check',
    ACTIVE_INTERVIEW: 'active_interview',
    CLOSING: 'closing',
    COMPLETE: 'complete'
  };

  // Hand-synced fallback of createInterviewLifecycle: same phases, same
  // permanent per-item verdicts (exclusion wins), same single automatic
  // transition on the post-greeting acknowledgement.
  function newInterviewLifecycle() {
    if (typeof window.createInterviewLifecycle === 'function') {
      return window.createInterviewLifecycle();
    }
    reportLifecycleModuleMissing();
    var TRANSITIONS = {
      connecting: { audio_check: true, complete: true },
      audio_check: { active_interview: true, complete: true },
      active_interview: { closing: true, complete: true },
      closing: { complete: true },
      complete: {}
    };
    var phase = PHASES.CONNECTING;
    var excluded = Object.create(null);
    var included = Object.create(null);
    var greetingDone = false;
    return {
      phase: function () { return phase; },
      is: function (p) { return phase === p; },
      to: function (next) {
        if (!TRANSITIONS[phase] || !TRANSITIONS[phase][next]) return false;
        phase = next;
        return true;
      },
      excludeItem: function (id) { if (id) excluded[id] = true; },
      noteItem: function (id) {
        if (!id) return phase === PHASES.ACTIVE_INTERVIEW;
        if (excluded[id]) return false;
        if (included[id]) return true;
        if (phase === PHASES.ACTIVE_INTERVIEW) { included[id] = true; return true; }
        excluded[id] = true;
        return false;
      },
      noteGreetingDone: function () { if (phase === PHASES.AUDIO_CHECK) greetingDone = true; },
      isGreetingDone: function () { return greetingDone; },
      noteUserCommitted: function (itemId) {
        if (phase === PHASES.ACTIVE_INTERVIEW) {
          if (itemId && !excluded[itemId]) included[itemId] = true;
          return 'committed';
        }
        if (itemId) excluded[itemId] = true;
        if (phase === PHASES.AUDIO_CHECK && greetingDone) {
          phase = PHASES.ACTIVE_INTERVIEW;
          return 'begin_interview';
        }
        return 'excluded';
      },
      shouldCommit: function (itemId) {
        if (itemId) {
          if (excluded[itemId]) return false;
          if (included[itemId]) return true;
        }
        return phase === PHASES.ACTIVE_INTERVIEW;
      },
      noteReconnect: function () { if (phase === PHASES.AUDIO_CHECK) greetingDone = false; }
    };
  }

  // Hand-synced copy of isClosingAnnouncement for the module-missing case:
  // without it, the wrap-up would once again leave the mic live and the
  // interview resumable — the exact live defect this pass fixes.
  function fallbackIsClosingAnnouncement(text) {
    if (typeof text !== 'string' || text.length < 12) return false;
    if (text.indexOf('?') >= 0) return false;
    var lower = text.toLowerCase();
    var closingThanks = /\bthank(?:s|\s+you)\b[^]{0,60}\b(?:your time|for talking|for speaking|for joining|for the conversation|for sitting down|for meeting|for coming|today)\b/.test(lower);
    var wrapSignal = /\b(?:that(?:'s| is) (?:all|everything)|that (?:concludes|wraps)|this (?:concludes|wraps)|we(?:'re| are) (?:done|finished|at time|out of time)|no (?:further|more) questions)\b/.test(lower);
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

  // Lazily created so a realtime event arriving before startInterview (never
  // observed, but events are events) cannot throw on a null lifecycle.
  function lifecycle() {
    if (!state.lifecycle) state.lifecycle = newInterviewLifecycle();
    return state.lifecycle;
  }

  // Realtime transcripts arrive out of order; itemId places each turn in the
  // slot its conversation item reserved (see voice-transcript-order.js).
  // Persistence is gated per item by the lifecycle: only turns that belong to
  // the official interview reach the stored transcript, history, or scoring.
  // The live caption is ephemeral UI, so the audio-check exchange still
  // captions while it is happening — it just never persists.
  function recordTurn(speaker, text, itemId) {
    text = String(text || '').trim();
    if (!text) return;
    var lc = lifecycle();
    if (lc.is(PHASES.AUDIO_CHECK) || lc.is(PHASES.ACTIVE_INTERVIEW)) {
      var caption = $('vi-caption');
      if (caption) {
        caption.textContent = (speaker === 'assistant' ? 'Interviewer: ' : 'You: ') + text;
      }
    }
    if (!lc.shouldCommit(itemId || null)) return;
    if (!state.order) state.order = newTranscriptOrder();
    state.order.setText(itemId || null, speaker, text);
  }

  // ---------- realtime sends ----------

  // The only outbound traffic this client sends. Everything else is inbound.
  function sendRealtime(payload) {
    try {
      if (!state.dc || state.dc.readyState !== 'open') return false;
      state.dc.send(JSON.stringify(payload));
      return true;
    } catch (err) {
      console.warn('[VOICE] realtime send failed:', err && err.message);
      return false;
    }
  }

  // A tool call the model makes stays unresolved in the conversation until the
  // client answers it with a function_call_output. Leaving it dangling can stall
  // or derail the following turns — which matters most for a conduct WARNING,
  // the one case where the interview is meant to carry on afterwards.
  //
  // Deliberately no response.create afterwards: the interviewer already spoke
  // her line in the response that made this call, so triggering another
  // response here would have her say a second one. The resolved output is
  // picked up on the next natural turn instead.
  // Exactly once per call_id: Realtime surfaces the same call twice, and a
  // duplicate function_call_output for one call_id is its own protocol error.
  function answerToolCall(callId, output) {
    if (!callId) {
      console.warn('[VOICE] tool call had no call_id; cannot answer it');
      return false;
    }
    if (!state.answeredCalls) state.answeredCalls = Object.create(null);
    if (state.answeredCalls[callId]) return false;
    state.answeredCalls[callId] = true;
    return sendRealtime({
      type: 'conversation.item.create',
      item: {
        type: 'function_call_output',
        call_id: callId,
        output: JSON.stringify(output)
      }
    });
  }

  // ---------- conduct + safety ----------

  // If js/voice-conduct.js failed to execute, the old fallbacks silently
  // no-opped EVERYTHING: warnings never ended sessions and safety calls were
  // dropped outright — a module-load failure reproduced both live blockers with
  // zero console evidence. The fallbacks below are minimal but functional, and
  // the failure is loud so a dev session can actually diagnose it.
  var conductModuleMissingReported = false;
  function reportConductModuleMissing() {
    if (conductModuleMissingReported) return;
    conductModuleMissingReported = true;
    console.error('[VOICE] js/voice-conduct.js did not load; using built-in fallbacks. Conduct/safety behavior is degraded — report this.');
    track('voice_module_missing', { module: 'voice-conduct' });
  }

  // Reading the call is in js/voice-conduct.js so the two-tool disambiguation is
  // unit-tested. The fallback handles NAMED calls only — no guessing.
  function readToolCall(evt) {
    if (typeof window.readVoiceToolCall === 'function') return window.readVoiceToolCall(evt);
    reportConductModuleMissing();
    if (!evt) return null;
    function fromParts(name, args, callId, responseId) {
      if (name !== 'conduct_action' && name !== 'end_for_safety') return null;
      var stage = '';
      try {
        var parsed = typeof args === 'object' && args ? args : JSON.parse(args || '{}');
        if (parsed && typeof parsed.stage === 'string') stage = parsed.stage;
      } catch (_) {}
      return {
        tool: name === 'end_for_safety' ? 'safety' : 'conduct',
        stage: name === 'conduct_action' ? stage : '',
        callId: callId || '',
        dedupeId: callId || responseId || '',
        responseId: responseId || ''
      };
    }
    if (evt.type === 'response.function_call_arguments.done') {
      return fromParts(evt.name, evt.arguments, evt.call_id, evt.response_id);
    }
    var out = evt.response && evt.response.output;
    if (!out || !out.length) return null;
    for (var i = 0; i < out.length; i++) {
      var item = out[i];
      if (!item || item.type !== 'function_call') continue;
      var found = fromParts(item.name, item.arguments, item.call_id, evt.response && evt.response.id);
      if (found) return found;
    }
    return null;
  }

  // Fallback gate: same policy as js/voice-conduct.js (one warning, then end;
  // escalation needs new live candidate speech; replays are inert), kept in
  // sync by hand. Better a duplicated 30 lines than a session that cannot end.
  function newConductGate() {
    if (typeof window.createConductGate === 'function') return window.createConductGate();
    reportConductModuleMissing();
    var warned = false, deviated = false, spoke = false, ended = false;
    var warnResponseId = '';
    var seen = Object.create(null);
    return {
      decide: function (stage, callId, responseId) {
        if (ended) return 'ignore';
        if (callId) {
          if (seen[callId]) return 'ignore';
          seen[callId] = true;
        }
        if (stage === 'end' || stage === 'warning') {
          if (!warned) {
            warned = true;
            spoke = false;
            warnResponseId = responseId || '';
            if (stage === 'end') { deviated = true; return 'warn_instead'; }
            return 'warn';
          }
          // Response identity first; speech guard only when ids are missing
          if (responseId && warnResponseId) {
            if (responseId === warnResponseId) return 'ignore';
          } else if (!spoke) {
            return 'ignore';
          }
          ended = true;
          return 'end';
        }
        return 'ignore';
      },
      noteSpokenWarning: function (responseId) {
        if (ended) return 'ignore';
        if (!warned) {
          warned = true;
          spoke = false;
          warnResponseId = responseId || '';
          return 'warn';
        }
        if (responseId && warnResponseId && responseId === warnResponseId) return 'ignore';
        if (!(responseId && warnResponseId) && !spoke) return 'ignore';
        ended = true;
        return 'end';
      },
      noteCandidateSpoke: function (eventType) {
        if (eventType !== 'input_audio_buffer.speech_started' &&
            eventType !== 'input_audio_buffer.committed') return;
        if (warned) spoke = true;
      },
      endReason: function () { return deviated ? 'ended_by_interviewer_unwarned' : 'ended_by_interviewer'; },
      wasWarned: function () { return warned; },
      reset: function () { warned = false; deviated = false; spoke = false; ended = false; warnResponseId = ''; seen = Object.create(null); }
    };
  }

  function handleToolCall(call) {
    if (!call) return;
    if (call.tool === 'safety') {
      handleSafetyCall(call);
      return;
    }
    if (call.tool === 'conduct') handleConductCall(call);
  }

  // A candidate in danger has done nothing wrong, so this deliberately bypasses
  // the conduct gate: no warning is recorded, nothing is refused, and the end
  // reason is not a conduct outcome. It still goes through the closing-turn gate
  // — the line she just spoke is the one pointing them at emergency help, and
  // cutting that off would be the worst possible moment to do it.
  function handleSafetyCall(call) {
    console.warn('[VOICE] session closing for candidate safety');
    track('voice_safety_end', { via: 'tool' });
    answerToolCall(call.callId, { ok: true, closing: true });
    requestGuardedEnd('safety', call.responseId);
  }

  // The safety close must not depend on the model remembering the tool: live,
  // the interviewer spoke the 988 referral, never called end_for_safety, and
  // then went back to interview questions — the exact outcome the safety rule
  // exists to prevent. The referral line itself is the decision; if it was
  // spoken, the session closes whether or not the tool call arrives. Harmless
  // alongside a real tool call: requestGuardedEnd is first-wins.
  // Hand-synced copy of isSafetyReferral for the module-missing case: the
  // backstop is the piece that must survive that failure, because "model skips
  // the tool" is exactly the live blocker it exists for.
  function fallbackIsSafetyReferral(text) {
    if (typeof text !== 'string' || text.length < 8) return false;
    var sentences = text.replace(/([.!?])/g, '$1\n').split('\n');
    for (var i = 0; i < sentences.length; i++) {
      var t = sentences[i].toLowerCase();
      if (!t || t.indexOf('?') >= 0) continue;
      if (/^\s*(?:please\s+)?(?:describe|tell|walk|talk|share|give|explain)\b/.test(t)) continue;
      if (/\b(?:had to|used to|ever)\s+(?:call|text|dial|contact|reach)\b/.test(t)) continue;
      if (/\b(?:call|text|dial|contact|reach)\b[^]{0,30}\b988\b/.test(t)) return true;
      if (/\b(?:call|contact|reach)\b[^]{0,25}\bemergency services\b/.test(t) &&
          (/^\s*(?:please\s+)?(?:contact|call|reach)\b/.test(t) ||
           /\b(?:please|you should|you need to|i need you to|i want you to|now|right now|immediately|right away|as soon as)\b/.test(t))) return true;
    }
    return false;
  }

  // Hand-synced copy of isConductWarningLine for the module-missing case.
  function fallbackIsConductWarningLine(text) {
    if (typeof text !== 'string' || text.length < 12) return false;
    var sentences = text.replace(/([.!?])/g, '$1\n').split('\n');
    var keepProfessional = false;
    var stopYouThere = false;
    for (var i = 0; i < sentences.length; i++) {
      var t = sentences[i].toLowerCase();
      if (!t || t.indexOf('?') >= 0) continue;
      if (/\bnot language\b/.test(t)) return true;
      if (/\b(?:won'?t|will not|would not|wouldn'?t|not going to|refuse to|cannot|can'?t)\b[^]{0,30}\b(?:continue|tolerate|accept|take|allow|put up with|listen to)\b[^]{0,40}\b(?:language|kind of talk|talk like that)\b/.test(t)) return true;
      if (/\b(?:that|this|such) (?:language|kind of talk)\b[^]{0,50}\b(?:no place|doesn'?t belong|does not belong|not acceptable|isn'?t acceptable|not appropriate|isn'?t appropriate)\b[^]{0,40}\b(?:interview|professional|here)\b/.test(t)) return true;
      if (/\b(?:won'?t|will not|not going to) (?:be )?(?:spoken|talked) to\b/.test(t)) return true;
      if (/\bkeep (?:it|this|things) professional\b/.test(t)) keepProfessional = true;
      if (/\bstop you (?:right )?there\b/.test(t)) stopYouThere = true;
    }
    return keepProfessional && stopYouThere;
  }

  // The conduct twin of the safety backstop, and the fix for the live failure:
  // the interviewer spoke the warning register repeatedly and never called
  // conduct_action once, so the gate never heard about any of it and the
  // session could not end. The spoken line now counts. Detection alone never
  // ends a session — the first hit records the one warning, and only a second
  // conduct signal from a DIFFERENT response closes it, after which her line
  // finishes playing and the session tears down: no further question is
  // possible.
  function maybeConductBackstop(transcript, responseId) {
    if (state.ending || state.conductEnd) return;
    var check;
    if (typeof window.isConductWarningLine === 'function') {
      check = window.isConductWarningLine;
    } else {
      reportConductModuleMissing();
      check = fallbackIsConductWarningLine;
    }
    if (!check(String(transcript || ''))) return;
    if (!state.conduct) state.conduct = newConductGate();
    var decision = state.conduct.noteSpokenWarning(responseId || '');
    if (decision === 'warn') {
      console.warn('[VOICE] spoken conduct warning noted (no tool call)');
      track('voice_conduct_action', { stage: 'warning_spoken' });
      return;
    }
    if (decision === 'end') {
      console.warn('[VOICE] second conduct violation; closing the session');
      track('voice_conduct_action', { stage: 'end', via: 'spoken_warning' });
      requestGuardedEnd('conduct', responseId || '');
    }
  }

  function maybeSafetyBackstop(transcript, responseId) {
    if (state.ending || state.conductEnd) return;
    var check;
    if (typeof window.isSafetyReferral === 'function') {
      check = window.isSafetyReferral;
    } else {
      reportConductModuleMissing();
      check = fallbackIsSafetyReferral;
    }
    if (!check(String(transcript || ''))) return;
    console.warn('[VOICE] crisis referral spoken without end_for_safety; closing the session anyway');
    track('voice_safety_end', { via: 'transcript_backstop' });
    requestGuardedEnd('safety', responseId || '');
  }

  // "One warning, then end" is enforced in state by the gate, not trusted to
  // the prompt (see js/voice-conduct.js).
  function handleConductCall(call) {
    if (!call.stage) return;
    if (!state.conduct) state.conduct = newConductGate();
    var decision = state.conduct.decide(call.stage, call.dedupeId, call.responseId);
    if (decision === 'ignore') {
      // Refusing to act on a call is not the same as leaving it unresolved. A
      // real-but-refused call — an end the model asked for before the candidate
      // said anything more, say — still has to be answered or it dangles and can
      // stall the turns that follow. Replays are absorbed by the ledger above.
      answerToolCall(call.callId, {
        ok: false,
        error: 'Duplicate or unactionable call; no action taken.',
        interview_continues: true
      });
      return;
    }

    if (decision === 'warn') {
      console.warn('[VOICE] conduct warning issued by the interviewer');
      track('voice_conduct_action', { stage: 'warning' });
      // The interview continues from here, so this call in particular must not
      // be left dangling.
      answerToolCall(call.callId, { ok: true, warned: true, interview_continues: true });
      return;
    }
    if (decision === 'warn_instead') {
      console.warn('[VOICE] conduct end requested with no prior warning; refused and counted as the warning');
      track('voice_conduct_action', { stage: 'end_refused_unwarned' });
      answerToolCall(call.callId, {
        ok: false,
        error: 'A warning must be given before the session can be ended. This has been recorded as that warning; continue the interview.',
        warned: true,
        interview_continues: true
      });
      return;
    }
    if (decision === 'end') {
      track('voice_conduct_action', { stage: 'end' });
      answerToolCall(call.callId, { ok: true, closing: true });
      requestGuardedEnd('conduct', call.responseId);
    }
  }

  // The closing line is still being generated and spoken when the tool call
  // arrives. Ending here would cut the interviewer off mid-sentence, drop the
  // response's token usage, and lose the utterance that triggered the end.
  // So: record the intent, then wait for the turn to actually finish
  // (js/voice-conduct.js owns that timing).
  function newClosingTurnGate() {
    if (typeof window.createClosingTurnGate === 'function') {
      return window.createClosingTurnGate({
        timeoutMs: CONDUCT_END_MAX_WAIT_MS,
        graceMs: CONDUCT_END_AUDIO_GRACE_MS,
        onDone: finishConductEnd
      });
    }
    // Degraded: end after the response completes rather than never ending.
    return {
      start: function () { return true; },
      noteResponseDone: function () { finishConductEnd('no_module'); },
      noteAudioStarted: function () {},
      noteAudioStopped: function () {},
      cancel: function () {},
      isActive: function () { return false; }
    };
  }

  // cause is 'conduct', 'safety', or 'closing' — it decides the reason and the
  // wording, not the timing, which is identical for all three.
  function requestGuardedEnd(cause, responseId) {
    if (state.ending || state.conductEnd) return;
    state.endCause = cause;
    state.conductEnd = newClosingTurnGate();
    if (cause === 'closing') {
      setStatus('Wrapping up. Your report is on its way.', 'vi-live');
    } else {
      setStatus(
        cause === 'safety' ? 'Ending this session.' : 'The interviewer is ending this session.',
        'vi-error'
      );
    }
    // Whether the closing line is already mid-playback. This has to fail SAFE,
    // and safe means "assume it is". Over-waiting costs at most the backstop and
    // nothing is lost; under-waiting cuts the interviewer off — and on the safety
    // path the sentence being cut is the one naming emergency services. So audio
    // counts unless we can positively attribute it to a DIFFERENT response:
    // requiring a positive id match instead meant an event without a response id
    // read as "no audio" and the grace path tore the session down mid-sentence.
    var closingAudioLive = state.audioPlaying && (
      !responseId || !state.audioResponseId || state.audioResponseId === responseId
    );
    state.conductEnd.start(closingAudioLive);
  }

  function finishConductEnd(reason) {
    if (!state.conductEnd) return;
    state.conductEnd = null;
    // Read the cause before clearing it, so nothing downstream can act on a
    // stale one.
    var cause = state.endCause;
    state.endCause = null;
    if (reason === 'timeout') {
      console.warn('[VOICE] guarded end: closing turn never completed, ending anyway');
    }
    if (cause === 'safety') {
      setStatus('This session has ended. Please reach out for help.', 'vi-error');
      endInterview('ended_for_safety');
      return;
    }
    if (cause === 'closing') {
      setStatus('Interview complete. Preparing your report...', 'vi-live');
      endInterview('completed');
      return;
    }
    setStatus('The interviewer ended this session.', 'vi-error');
    endInterview(state.conduct ? state.conduct.endReason() : 'ended_by_interviewer');
  }

  function setSpeaking(on) {
    var ind = $('vi-speaking');
    if (ind) ind.classList.toggle('vi-speaking-on', !!on);
  }

  // ---------- turn-start latency + waiting cue ----------

  function clearTurnWait() {
    if (state.turnWait && state.turnWait.cueTimer) clearTimeout(state.turnWait.cueTimer);
    state.turnWait = null;
  }

  // The candidate's turn was committed; the clock on the interviewer's reply
  // starts now. ~200ms is a human conversational benchmark, not a realtime
  // pipeline promise — this pipeline routinely needs 1-3s, which is why the
  // one truthful cue waits WAITING_CUE_MS and a 2-2.5s pause never triggers
  // anything: no cue, no reprompt, no forced turn.
  function beginTurnWait() {
    clearTurnWait();
    var wait = { committedAtMs: Date.now(), cueTimer: null };
    wait.cueTimer = setTimeout(function () {
      // Re-check the world before touching UI: the session may have ended,
      // begun closing, or a guarded end may own the screen by now.
      if (state.turnWait !== wait) return;
      if (state.ending || state.conductEnd) return;
      if (!lifecycle().is(PHASES.ACTIVE_INTERVIEW)) return;
      var caption = $('vi-caption');
      if (caption) caption.textContent = 'One moment — the interviewer is thinking.';
      track('voice_turn_wait_cue', { waited_ms: Date.now() - wait.committedAtMs });
    }, WAITING_CUE_MS);
    state.turnWait = wait;
  }

  // The interviewer's audio began: that is the human-perceived turn start.
  function noteTurnStarted() {
    var wait = state.turnWait;
    if (!wait) return;
    clearTurnWait();
    var ms = Date.now() - wait.committedAtMs;
    console.log('[VOICE] agent turn-start latency: ' + ms + 'ms');
    track('voice_turn_start_latency', { latency_ms: ms });
  }

  // ---------- normal wrap-up ----------

  // The interviewer announced the normal wrap-up (thanks + report being
  // prepared). Same spoken-line pattern as the safety and conduct backstops,
  // and for the same reason: lifecycle decisions cannot depend on the model
  // remembering a tool. The application owns the boundary from here:
  // entering CLOSING stops candidate speech from being committed or routed
  // (the mic stops), blocks new interviewer questions (racing responses are
  // cancelled), and hands completion to the same guarded-end pipeline the
  // conduct/safety closes use — the closing audio finishes, then the session
  // completes exactly once and the report opens.
  function maybeClosingAnnouncement(transcript, responseId) {
    if (state.ending || state.conductEnd) return;
    if (!lifecycle().is(PHASES.ACTIVE_INTERVIEW)) return;
    var check;
    if (typeof window.isClosingAnnouncement === 'function') {
      check = window.isClosingAnnouncement;
    } else {
      reportLifecycleModuleMissing();
      check = fallbackIsClosingAnnouncement;
    }
    if (!check(String(transcript || ''))) return;
    lifecycle().to(PHASES.CLOSING);
    // Late chatter must never reach ASR/VAD or the model again. Outbound
    // only: the interviewer's closing audio keeps playing.
    stopMicrophone();
    clearTurnWait();
    console.log('[VOICE] wrap-up announced; closing the session');
    track('voice_closing_detected', {});
    requestGuardedEnd('closing', responseId || '');
  }

  // VAD committed a candidate turn. The lifecycle classifies the item once,
  // permanently — and the first commit after the audio-check greeting is the
  // acknowledgement that starts the official interview.
  function handleUserCommitted(itemId) {
    var action = lifecycle().noteUserCommitted(itemId || null);
    if (action === 'begin_interview') {
      setStatus('Live. The interviewer can hear you.', 'vi-live');
      track('voice_interview_begin', {});
      beginTurnWait();
      return;
    }
    if (action === 'committed') beginTurnWait();
  }

  function handleRealtimeEvent(evt) {
    var type = evt.type || '';

    // Items are announced in true conversation order and carry the id that
    // the (later, out-of-order) transcript events reference. The lifecycle
    // classifies each item exactly once; only official-interview items reach
    // the assembler, so excluded items never leave pending slots for a
    // teardown flush to wait on.
    if (type === 'conversation.item.created' || type === 'conversation.item.added') {
      if (!lifecycle().noteItem(evt.item && evt.item.id)) return;
      if (!state.order) state.order = newTranscriptOrder();
      // previous_item_id says which item this one follows, so an item inserted
      // out of band lands in the right place instead of at the end.
      state.order.noteItem(evt.item && evt.item.id, evt.previous_item_id);
      return;
    }

    // The candidate speaking again is what makes a warned incident a CONTINUED
    // one, and it is the guard that stops a duplicated tool call from ending the
    // session on a first offense. Only live speech events qualify, and the gate
    // enforces that itself — a whisper transcript can describe audio from before
    // the warning, so it must never count here.
    if (state.conduct) state.conduct.noteCandidateSpoke(type);

    if (type === 'conversation.item.input_audio_transcription.completed') {
      recordTurn('user', evt.transcript, evt.item_id);
      return;
    }
    if (type === 'input_audio_buffer.speech_started') {
      // The candidate is talking again; they are not waiting on a reply.
      clearTurnWait();
      return;
    }
    if (type === 'input_audio_buffer.committed') {
      handleUserCommitted(evt.item_id);
      return;
    }
    // GA + beta event names for assistant transcript
    if (type === 'response.output_audio_transcript.done' || type === 'response.audio_transcript.done') {
      recordTurn('assistant', evt.transcript, evt.item_id);
      maybeConductBackstop(evt.transcript, evt.response_id);
      maybeSafetyBackstop(evt.transcript, evt.response_id);
      maybeClosingAnnouncement(evt.transcript, evt.response_id);
      return;
    }

    if (type === 'response.function_call_arguments.done') {
      handleToolCall(readToolCall(evt));
      return;
    }

    // response.done does three jobs, in this order deliberately: usage is
    // counted even for the response that ends the session, the tool call is
    // picked up here on API versions that only surface it in the output, and
    // only then does the closing turn count as complete.
    if (type === 'response.done') {
      if (evt.response && evt.response.usage) {
        state.usage.input += Number(evt.response.usage.input_tokens || 0);
        state.usage.output += Number(evt.response.usage.output_tokens || 0);
      }
      handleToolCall(readToolCall(evt));
      setSpeaking(false);
      // The audio-check greeting finished generating; the next candidate
      // turn is the acknowledgement that begins the official interview.
      lifecycle().noteGreetingDone();
      if (state.conductEnd) state.conductEnd.noteResponseDone();
      return;
    }

    if (type === 'response.created') {
      // No new interviewer turns once the wrap-up is announced. Responses
      // are serial, so anything created during CLOSING is a new turn racing
      // the mic shutdown — cancel it before it speaks.
      if (lifecycle().is(PHASES.CLOSING)) {
        sendRealtime({ type: 'response.cancel' });
        return;
      }
      setSpeaking(true);
      return;
    }
    if (type === 'output_audio_buffer.started') {
      state.audioPlaying = true;
      // Which response is speaking, not merely that something is. A bare
      // "audio is playing" flag cannot tell the closing line apart from a
      // previous turn's, and seeding the gate from it is what made the stale
      // reads possible in the first place.
      state.audioResponseId = evt.response_id || '';
      if (state.conductEnd) state.conductEnd.noteAudioStarted();
      noteTurnStarted();
      setSpeaking(true);
      return;
    }
    // `cleared` is the interruption counterpart of `stopped` — a barge-in
    // truncates the turn and no `stopped` follows. Without handling it, the
    // playing flag stayed true for the rest of the session.
    if (type === 'output_audio_buffer.stopped' || type === 'output_audio_buffer.cleared') {
      state.audioPlaying = false;
      state.audioResponseId = '';
      setSpeaking(false);
      if (state.conductEnd) state.conductEnd.noteAudioStopped();
      return;
    }
    if (type === 'error') {
      console.error('[VOICE] Realtime error event:', evt);
    }
  }

  // ---------- connection ----------

  async function connectRealtime(clientSecret, model) {
    state.micStream = await navigator.mediaDevices.getUserMedia({ audio: MIC_CONSTRAINTS });

    var pc = new RTCPeerConnection();
    state.pc = pc;

    state.audioEl = $('vi-remote-audio') || document.createElement('audio');
    state.audioEl.autoplay = true;
    pc.ontrack = function (e) { state.audioEl.srcObject = e.streams[0]; };

    state.micStream.getTracks().forEach(function (t) { pc.addTrack(t, state.micStream); });

    var dc = pc.createDataChannel('oai-events');
    state.dc = dc;
    dc.onmessage = function (e) {
      try { handleRealtimeEvent(JSON.parse(e.data)); } catch (_) {}
    };
    dc.onopen = function () {
      // Realtime is ready. Before the official interview there is an audio
      // check: the interviewer speaks first, and with semantic VAD the model
      // only ever replies to candidate speech, so her opening line has to be
      // requested explicitly. The wording lives in the session instructions;
      // the app owns only the state.
      if (state.ending || state.conductEnd) return;
      var lc = lifecycle();
      if (lc.is(PHASES.CONNECTING)) {
        lc.to(PHASES.AUDIO_CHECK);
      } else if (lc.is(PHASES.AUDIO_CHECK)) {
        lc.noteReconnect();   // a drop during the check: the fresh session re-greets
      } else {
        return;               // reconnect mid-interview: the conversation resumes as before
      }
      setStatus('Connected. Quick audio check...', 'vi-connecting');
      sendRealtime({ type: 'response.create' });
    };

    pc.onconnectionstatechange = function () {
      if (!state.pc) return;
      var s = state.pc.connectionState;
      if (s === 'connected') {
        state.connected = true;
        // Truthful per phase: nothing is being scored yet during the audio
        // check, so the status must not claim the interview is running.
        if (lifecycle().is(PHASES.ACTIVE_INTERVIEW)) {
          setStatus('Live. The interviewer can hear you.', 'vi-live');
        } else if (!state.ending && !state.conductEnd) {
          setStatus('Connected. Quick audio check...', 'vi-connecting');
        }
      } else if ((s === 'disconnected' || s === 'failed') && !state.ending) {
        state.connected = false;
        // A pending "interviewer is thinking" cue would be a lie now.
        clearTurnWait();
        setStatus('Connection lost.', 'vi-error');
        offerReconnect();
      }
    };

    var offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    var sdpRes = await fetch(REALTIME_CALLS_URL + '?model=' + encodeURIComponent(model), {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + clientSecret, 'Content-Type': 'application/sdp' },
      body: offer.sdp
    });
    if (!sdpRes.ok) {
      var errText = await sdpRes.text().catch(function () { return ''; });
      throw new Error('realtime_connect_failed: ' + sdpRes.status + ' ' + errText.slice(0, 200));
    }
    var answerSdp = await sdpRes.text();
    await pc.setRemoteDescription({ type: 'answer', sdp: answerSdp });
  }

  // The mic is released on its own so the interview can stop listening the
  // instant it ends, while the data channel stays open long enough for
  // in-flight transcripts to land. Mic audio is outbound only, so this never
  // cuts the interviewer off mid-sentence.
  function stopMicrophone() {
    try {
      if (state.micStream) state.micStream.getTracks().forEach(function (t) { t.stop(); });
    } catch (_) {}
    state.micStream = null;
  }

  function teardownConnection() {
    try { if (state.dc) state.dc.close(); } catch (_) {}
    try { if (state.pc) state.pc.close(); } catch (_) {}
    stopMicrophone();
    state.pc = null; state.dc = null; state.connected = false;
  }

  // Whisper transcripts for the last turn routinely arrive after the turn is
  // over. Closing the data channel first threw them away, which is how the
  // utterance that ended a session went missing from its own report.
  function flushPendingTranscript() {
    if (!state.order || typeof state.order.flushTranscript !== 'function') {
      return Promise.resolve(false);
    }
    return state.order.flushTranscript({ timeoutMs: TRANSCRIPT_FLUSH_MS });
  }

  // ---------- timer ----------

  function startTimer(maxMinutes) {
    state.startedAtMs = Date.now();
    var timerEl = $('vi-timer');
    state.timerInterval = setInterval(function () {
      var elapsed = Math.floor((Date.now() - state.startedAtMs) / 1000);
      var remaining = maxMinutes * 60 - elapsed;
      if (timerEl) {
        var m = Math.floor(Math.abs(remaining) / 60);
        var s = Math.abs(remaining) % 60;
        timerEl.textContent = (remaining < 0 ? '-' : '') + m + ':' + (s < 10 ? '0' : '') + s;
      }
      if (remaining <= 0) {
        // endInterview defers to a pending conduct or safety close on its own;
        // checking here too just keeps this from logging that once a second.
        if (!state.conductEnd) endInterview('time_up');
      }
    }, 1000);
  }

  // ---------- lifecycle ----------

  async function startInterview() {
    var role = ($('vi-role') && $('vi-role').value || '').trim();
    var seniority = ($('vi-seniority') && $('vi-seniority').value || '').trim();
    var jd = ($('vi-jd') && $('vi-jd').value || '').trim();
    if (!role) { alert('Pick the role you are interviewing for.'); return; }

    var startBtn = $('vi-start-btn');
    if (startBtn) { startBtn.disabled = true; startBtn.textContent = 'Starting...'; }

    try {
      // Mic permission before consuming a session: fail cheap
      var probe = await navigator.mediaDevices.getUserMedia({ audio: MIC_CONSTRAINTS });
      probe.getTracks().forEach(function (t) { t.stop(); });
    } catch (micErr) {
      alert('JobHackAI needs microphone access for the voice interview. Allow the microphone and try again.');
      if (startBtn) { startBtn.disabled = false; startBtn.textContent = 'Start the interview'; }
      return;
    }

    try {
      var res = await api('/api/voice/session', {
        method: 'POST',
        body: JSON.stringify({ role: role, seniority: seniority, jd: jd })
      });

      if (!res.ok) {
        if (res.status === 403) {
          await loadEntitlement();
          show('vi-setup-view');
          if (res.data && res.data.error) alert(res.data.error);
        } else {
          alert((res.data && res.data.error) || 'Could not start the session. Please try again.');
        }
        if (startBtn) { startBtn.disabled = false; startBtn.textContent = 'Start the interview'; }
        return;
      }

      state.sessionId = res.data.sessionId;
      state.model = res.data.model;
      state.maxMinutes = res.data.maxMinutes || 20;
      state.order = newTranscriptOrder();
      state.usage = { input: 0, output: 0 };
      state.ending = false;
      state.audioPlaying = false;
      state.audioResponseId = '';
      state.answeredCalls = null;
      // A fresh session starts with a clean conduct slate. A reconnect must not
      // reset the gate, or dropping the connection would clear a warning.
      state.conduct = newConductGate();
      state.conductEnd = null;
      state.endCause = null;
      // Fresh lifecycle: CONNECTING until realtime is ready, then the audio
      // check. Nothing is committed to transcript or scoring before the
      // official interview begins.
      state.lifecycle = newInterviewLifecycle();
      clearTurnWait();

      show('vi-live-view');
      setStatus('Connecting...', 'vi-connecting');
      track('voice_session_start', { mode: res.data.mode });
      historyLiveStart(role, seniority);

      await connectRealtime(res.data.clientSecret, state.model);
      startTimer(state.maxMinutes);
    } catch (err) {
      console.error('[VOICE] start failed:', err);
      alert('Could not connect the voice session. Check your connection and try again.');
      teardownConnection();
      historyLiveClear(false);
      show('vi-setup-view');
      if (startBtn) { startBtn.disabled = false; startBtn.textContent = 'Start the interview'; }
    }
  }

  function offerReconnect() {
    // Nothing to reconnect to when the session is already closing — offering it
    // would be misleading, and taking it would be a way out of a conduct end.
    if (state.conductEnd || state.ending) return;
    var btn = $('vi-reconnect-btn');
    if (btn) btn.style.display = '';
  }

  async function reconnect() {
    // A pending conduct or safety close survives the connection dropping. Its
    // gate is waiting on events from a link that no longer exists, so letting it
    // run on into a fresh session would kill that session with a stale reason.
    // Finish the end instead: the interviewer already decided, and dropping the
    // connection must not become a way to dodge it (the same reason the conduct
    // warning itself survives a reconnect).
    if (state.conductEnd) {
      console.warn('[VOICE] reconnect requested while a session close was pending; completing the close');
      finishConductEnd('connection_lost');
      return;
    }
    var btn = $('vi-reconnect-btn');
    if (btn) { btn.disabled = true; btn.textContent = 'Reconnecting...'; }
    try {
      teardownConnection();
      // Send the local transcript tail so the fresh realtime session resumes
      // the conversation instead of restarting the interview from scratch.
      var res = await api('/api/voice/session', {
        method: 'POST',
        body: JSON.stringify({
          resumeSessionId: state.sessionId,
          transcript: getTranscript().slice(-20)
        })
      });
      if (!res.ok) throw new Error((res.data && res.data.error) || 'resume_failed');
      setStatus('Reconnecting...', 'vi-connecting');
      await connectRealtime(res.data.clientSecret, res.data.model || state.model);
      if (btn) { btn.style.display = 'none'; btn.disabled = false; btn.textContent = 'Reconnect'; }
    } catch (err) {
      console.error('[VOICE] reconnect failed:', err);
      setStatus('Could not reconnect. Ending the session.', 'vi-error');
      endInterview('connection_lost');
    }
  }

  function toggleMute() {
    if (!state.micStream) return;
    var btn = $('vi-mute-btn');
    var enabled = null;
    state.micStream.getAudioTracks().forEach(function (t) {
      t.enabled = !t.enabled;
      enabled = t.enabled;
    });
    if (btn && enabled !== null) btn.textContent = enabled ? 'Mute' : 'Unmute';
  }

  async function endInterview(reason) {
    if (state.ending) return;
    // A conduct or safety close already in flight owns the ending and the reason
    // it will be recorded under. Anything else arriving mid-flight — the End
    // button, the clock — would cancel that close and persist its own reason
    // instead, filing a conduct termination or a safety close as `user_ended`
    // or `time_up`. finishConductEnd clears the gate before it calls in here, so
    // the guarded close itself is never blocked by this.
    if (state.conductEnd) {
      console.warn('[VOICE] end requested (' + reason + ') while a session close was pending; deferring to it');
      return;
    }
    state.ending = true;
    // Terminal for every path — manual, time up, conduct, safety, connection
    // lost, or the natural close. COMPLETE is reachable from any phase, and
    // from here no late event can commit a turn, reopen the session, or start
    // another completion (state.ending makes this function run once).
    lifecycle().to(PHASES.COMPLETE);
    clearTurnWait();
    if (state.timerInterval) { clearInterval(state.timerInterval); state.timerInterval = null; }

    var durationSeconds = state.startedAtMs ? Math.round((Date.now() - state.startedAtMs) / 1000) : 0;
    stopMicrophone();

    show('vi-done-view');
    var doneStatus = $('vi-done-status');
    var isSafetyEnd = reason === 'ended_for_safety';
    if (isSafetyEnd) {
      // The safety view goes up immediately: no S+A=O copy, no scoring state,
      // whatever happens to the save below.
      renderSafetyEnd(null);
    } else {
      if (doneStatus) doneStatus.textContent = 'We\'re reviewing your conversation using our S + A = O formula and interview rubric. This usually takes a few seconds.';
      historyLiveScoring();
    }

    // Let any transcript still in flight land before the channel closes; the
    // wait is bounded and a timeout just means we store what we already have.
    await flushPendingTranscript();
    teardownConnection();

    try {
      await api('/api/voice/session/' + encodeURIComponent(state.sessionId) + '/complete', {
        method: 'POST',
        body: JSON.stringify({
          transcript: getTranscript(),
          durationSeconds: durationSeconds,
          inputTokens: state.usage.input,
          outputTokens: state.usage.output,
          reason: reason || 'user_ended'
        })
      });
      track('voice_session_complete', { duration_seconds: durationSeconds, reason: reason || 'user_ended' });
      if (isSafetyEnd) {
        // Already showing the safety view; no polling for a scorecard the
        // server deliberately never generates.
        historyLiveClear(true);
        return;
      }
      pollScorecard(0);
    } catch (err) {
      console.error('[VOICE] complete failed:', err);
      if (isSafetyEnd) {
        // The safety view stays up regardless — never replace it with
        // score-oriented error copy.
        historyLiveClear(false);
        return;
      }
      if (doneStatus) doneStatus.textContent = 'The session ended but saving failed. Your session is recorded; check back shortly.';
      historyLiveClear(false);
    }
  }

  function pollScorecard(attempt) {
    if (attempt > 20) {
      var doneStatus = $('vi-done-status');
      if (doneStatus) doneStatus.textContent = 'Your report is taking longer than usual. Refresh this page in a minute.';
      // The session IS completed server-side; swap the local Scoring… row
      // for the server's own scoring row so the rail stays truthful.
      historyLiveClear(true);
      return;
    }
    setTimeout(async function () {
      try {
        var res = await api('/api/voice/session/' + encodeURIComponent(state.sessionId), { method: 'GET' });
        if (res.ok && res.data && res.data.endReason === 'ended_for_safety') {
          renderScorecard(res.data);
          historyOnScorecardReady();
          return;
        }
        if (res.ok && res.data && res.data.scorecardReady) {
          renderScorecard(res.data);
          historyOnScorecardReady();
          return;
        }
      } catch (_) {}
      pollScorecard(attempt + 1);
    }, attempt === 0 ? 2500 : 3500);
  }

  // ---------- scorecard rendering ----------

  function dimensionRow(label, value) {
    // Band colors make honest scores legible at a glance: red <40, amber 40-69, green >=70
    var band = value >= 70 ? '' : value >= 40 ? ' vi-dim-fill--mid' : ' vi-dim-fill--low';
    return '<div class="vi-dim"><span class="vi-dim-label">' + label + '</span>' +
      '<span class="vi-dim-bar"><span class="vi-dim-fill' + band + '" style="width:' + Math.max(2, Math.min(100, value)) + '%"></span></span>' +
      '<span class="vi-dim-num">' + value + '</span></div>';
  }

  // Most recent OTHER scored session, for the "vs your last session" delta.
  function previousOverall(currentSessionId) {
    for (var i = 0; i < historyState.items.length; i++) {
      var item = historyState.items[i];
      if (item.sessionId === currentSessionId) continue;
      var v = Number(item.overall);
      if (item.overall != null && isFinite(v)) return Math.round(v);
    }
    return null;
  }

  function escapeHtml(s) {
    var div = document.createElement('div');
    div.textContent = String(s == null ? '' : s);
    return div.innerHTML;
  }

  // One row of the S + A = O balance block: green fill at the actual share,
  // a dark goal tick at the 5/10/85 target, and a colored note. Over-goal is
  // a warning, Outcome under-goal is the real error, on/near goal is success.
  function saoBalanceRow(label, actual, goal, isOutcome) {
    actual = Math.max(0, Math.min(100, Math.round(Number(actual) || 0)));
    var noteClass = 'vi-sao-bal-note--ok';
    if (isOutcome && actual < goal - 5) noteClass = 'vi-sao-bal-note--under';
    else if (!isOutcome && actual > goal + 5) noteClass = 'vi-sao-bal-note--over';
    return '<div class="vi-sao-bal-row"><span class="vi-sao-bal-label">' + label + '</span>' +
      '<span class="vi-sao-bal-track"><span class="vi-sao-bal-fill" style="width:' + actual + '%"></span>' +
      '<span class="vi-sao-bal-goal" style="left:' + goal + '%"></span></span>' +
      '<span class="vi-sao-bal-note ' + noteClass + '">' + actual + '% · goal ≈ ' + goal + '%</span></div>';
  }

  function savedLine(data) {
    var parts = ['Saved to history'];
    var when = formatHistoryWhen(data.createdAt || data.startedAt);
    if (when) parts.push(when);
    if (data.role) parts.push(String(data.role));
    if (data.seniority) parts.push(String(data.seniority));
    return '<p class="vi-sc-saved">' + escapeHtml(parts.join(' · ')) + '</p>';
  }

  // The report view for a safety-ended session. Deliberately scoreless: the
  // candidate disclosed a crisis, not interview performance, and a real dev
  // session's report framed the disclosure as unprofessional behavior. Never
  // again — no score, no coaching, no professionalism framing.
  function renderSafetyEnd(data) {
    var doneStatus = $('vi-done-status');
    if (doneStatus) doneStatus.style.display = 'none';
    var wrap = $('vi-scorecard');
    if (!wrap) return;
    var html = '<h2 class="vi-sc-title">Interview ended early for safety</h2>';
    html += '<p class="vi-sc-block">This session closed so you could reach real help, and that was the right way for it to end. No score is given for a safety-ended session, and nothing about it counts against you.</p>';
    html += '<p class="vi-sc-block">If you are in immediate danger, contact emergency services now, or call or text 988 in the US.</p>';
    html += '<p class="vi-sc-block">You are welcome back to practice whenever you are ready.</p>';
    if (data) html += savedLine(data);
    wrap.innerHTML = html;
  }

  function renderScorecard(data) {
    // A safety-ended session never renders as a scorecard, even if one was
    // stored before suppression existed — that legacy report is the one that
    // misframed the safety statement.
    if (data && data.endReason === 'ended_for_safety') {
      renderSafetyEnd(data);
      return;
    }
    var wrap = $('vi-scorecard');
    var doneStatus = $('vi-done-status');
    if (doneStatus) doneStatus.style.display = 'none';
    if (!wrap) return;
    var sc = data.scorecard || {};
    var html = '';

    html += '<h2 class="vi-sc-title">Your interview report</h2>';
    if (!data.expired) html += savedLine(data);

    if (data.fullAccess) {
      html += '<div class="vi-sc-overall"><div class="vi-sc-score">' + escapeHtml(sc.overall) + '</div><div class="vi-sc-overall-label">Overall</div></div>';
      // Session-over-session delta; downward trends are muted, not error-red —
      // practice is never punished (same rule as the history progress strip).
      var prevOverall = previousOverall(data.sessionId);
      if (prevOverall != null && sc.overall != null && isFinite(Number(sc.overall))) {
        var scDelta = Math.round(Number(sc.overall)) - prevOverall;
        html += '<p class="vi-sc-delta' + (scDelta < 0 ? ' vi-sc-delta--down' : '') + '">' +
          (scDelta >= 0 ? '▲ +' : '▼ −') + Math.abs(scDelta) + ' vs your last session</p>';
      }
      if (sc.dimensions) {
        html += '<div class="vi-sc-dims">';
        html += dimensionRow('Communication', sc.dimensions.communication);
        html += dimensionRow('S + A = O structure', sc.dimensions.structure);
        html += dimensionRow('Content depth', sc.dimensions.contentDepth);
        html += dimensionRow('Role fit', sc.dimensions.roleFit);
        html += '</div>';
      }
      // Additive scorecard fields: old sessions have no saoBalance, so the
      // whole balance block hides gracefully when it is absent.
      if (sc.saoBalance) {
        html += '<div class="vi-sc-block"><h3>How you balanced Situation, Action, and Outcome</h3>';
        html += '<div class="vi-sao-bal">';
        html += saoBalanceRow('Situation', sc.saoBalance.situation, 5, false);
        html += saoBalanceRow('Action', sc.saoBalance.action, 10, false);
        html += saoBalanceRow('Outcome', sc.saoBalance.outcome, 85, true);
        html += '</div></div>';
        if (sc.saoCoaching && sc.saoCoaching.length) {
          html += '<div class="vi-sc-block vi-sc-improve"><h3>Next time, focus on</h3><ul class="vi-sc-coach">';
          sc.saoCoaching.forEach(function (tip) {
            html += '<li>' + escapeHtml(tip) + '</li>';
          });
          html += '</ul></div>';
        }
      }
    }

    if (!data.expired) {
      html += '<div class="vi-sc-block vi-sc-strength"><h3>Top strength</h3><p>' + escapeHtml(sc.topStrength) + '</p></div>';
      html += '<div class="vi-sc-block vi-sc-improve"><h3>Improve this first</h3><p>' + escapeHtml(sc.topImprovement) + '</p></div>';
    }

    if (data.fullAccess) {
      if (sc.moments && sc.moments.length) {
        html += '<div class="vi-sc-block"><h3>Moments from your interview</h3>';
        sc.moments.forEach(function (m) {
          html += '<div class="vi-sc-moment"><p class="vi-sc-quote">"' + escapeHtml(m.quote) + '"</p><p>' + escapeHtml(m.comment) + '</p></div>';
        });
        html += '</div>';
      }
      if (sc.summary) {
        html += '<div class="vi-sc-block"><h3>Summary</h3><p>' + escapeHtml(sc.summary) + '</p></div>';
      }
      if (data.transcript && data.transcript.length) {
        html += '<details class="vi-sc-transcript"><summary>Full transcript</summary>';
        data.transcript.forEach(function (t) {
          html += '<p><strong>' + (t.speaker === 'assistant' ? 'Interviewer' : 'You') + ':</strong> ' + escapeHtml(t.text) + '</p>';
        });
        html += '</details>';
      }
      html += '<div class="vi-sc-actions">' +
        '<a class="vi-btn-primary" href="voice-interview.html">Run another interview</a>' +
        '<a class="vi-btn-secondary" href="mock-interview.html">Practice typed questions</a>' +
        '<a class="vi-sc-actions-link" href="dashboard.html">Back to Dashboard</a>' +
        '</div>';
    } else {
      // Free taste: partial scorecard, blurred full report, one upgrade CTA.
      // Expired sessions (past the 90-day retention window) share the same
      // locked view with retention-specific copy.
      track('paywall_view', { surface: 'voice_scorecard' });
      var unlockHeading = data.expired ? 'This report has expired.' : 'Your full report is ready.';
      var unlockBody = data.expired
        ? 'Upgrade to keep every report, transcript, and your progress across sessions.'
        : 'Unlock every score, the moment by moment feedback, and your transcript. Then keep practicing until the answers are automatic.';
      html += '<div class="vi-sc-locked">';
      html += '<div class="vi-sc-blur" aria-hidden="true">';
      html += '<div class="vi-sc-overall"><div class="vi-sc-score">??</div><div class="vi-sc-overall-label">Overall</div></div>';
      html += '<div class="vi-sc-dims">' + dimensionRow('Communication', 70) + dimensionRow('Structure', 55) + dimensionRow('Content depth', 62) + dimensionRow('Role fit', 75) + '</div>';
      html += '<p>The full report includes your scores, specific moments from your answers, a summary, and the complete transcript.</p>';
      html += '</div>';
      html += '<div class="vi-sc-unlock"><h3>' + unlockHeading + '</h3><p>' + unlockBody + '</p><a class="vi-btn-primary" href="/pricing" data-cta="voice-scorecard-unlock">See plans</a></div>';
      html += '</div>';
    }

    wrap.innerHTML = html;
    wrap.style.display = '';
  }

  // ---------- history rail ----------
  // Mirrors the typed mock interview's history rail (mock-interview.html):
  // same fetch/render/manage/delete/clear flow with vi- prefixed elements.
  // The rail is gated on the same voice.enabled signal as the rest of the
  // page: with the flag off none of this runs and the markup stays hidden.

  var historyState = {
    voice: null,               // voice entitlement payload from /api/plan/me
    items: [],                 // rows from GET /api/voice/sessions
    liveRow: null,             // { role, seniority, phase: 'live'|'scoring' }
    manageMode: false,
    selectedIds: {},           // id -> true
    pendingDeleteIds: [],
    pendingClearAll: false,
    bound: false
  };

  function historySelectedCount() {
    return Object.keys(historyState.selectedIds).length;
  }

  function initHistory(voice) {
    historyState.voice = voice || null;
    if (!voice || !voice.enabled) return;
    var panel = $('vi-history-panel');
    if (!panel) return;
    var wrap = document.querySelector('.vi-wrap');
    if (wrap) wrap.classList.add('vi-has-rail');
    panel.style.display = '';
    bindHistoryEvents();
    fetchHistory();
  }

  function showHistoryError(message) {
    var errEl = $('vi-history-error');
    if (!errEl) return;
    var span = errEl.querySelector('[data-default-message]');
    if (span) span.textContent = (message || span.getAttribute('data-default-message')) + ' ';
    errEl.hidden = false;
  }

  async function fetchHistory() {
    var loading = $('vi-history-loading');
    var errEl = $('vi-history-error');
    if (errEl) errEl.hidden = true;
    if (loading && !historyState.items.length) loading.classList.add('is-visible');
    try {
      var res = await api('/api/voice/sessions', { method: 'GET' });
      if (!res.ok || !res.data || !Array.isArray(res.data.sessions)) throw new Error('history_failed');
      historyState.items = res.data.sessions;
    } catch (err) {
      console.warn('[VOICE] history load failed:', err && err.message);
      showHistoryError(null);
    }
    if (loading) loading.classList.remove('is-visible');
    renderHistory();
    renderProgressStrip();
    renderLastFocus();
  }

  // "Last time we said: ..." on the setup view for returning users — pairs
  // with the scorer's continuity coaching so the loop feels closed.
  function renderLastFocus() {
    var el = $('vi-last-focus');
    if (!el) return;
    var focus = null;
    for (var i = 0; i < historyState.items.length; i++) {
      if (historyState.items[i].topImprovement) { focus = historyState.items[i].topImprovement; break; }
    }
    if (!focus) { el.hidden = true; return; }
    el.innerHTML = '<strong>Last time we said:</strong> ';
    el.appendChild(document.createTextNode('“' + String(focus) + '”'));
    el.hidden = false;
  }

  function formatHistoryWhen(createdAt) {
    if (!createdAt) return '';
    var s = String(createdAt);
    if (s.indexOf('T') === -1) s = s.replace(' ', 'T');
    if (!/Z|[+-]\d\d:?\d\d$/.test(s)) s += 'Z';
    var d = new Date(s);
    if (isNaN(d.getTime())) return '';
    var now = new Date();
    var startOfDay = function (x) { return new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime(); };
    var dayDiff = Math.round((startOfDay(now) - startOfDay(d)) / 86400000);
    if (dayDiff <= 0) return 'Today';
    if (dayDiff === 1) return 'Yesterday';
    var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return months[d.getMonth()] + ' ' + d.getDate();
  }

  function historyMetaLine(item) {
    var parts = [];
    var when = formatHistoryWhen(item.createdAt);
    if (when) parts.push(when);
    if (item.durationSeconds != null && isFinite(Number(item.durationSeconds))) {
      parts.push(Math.max(1, Math.round(Number(item.durationSeconds) / 60)) + ' min');
    }
    return parts.join(' · ');
  }

  var HISTORY_LOCK_SVG = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="3" y="11" width="18" height="8" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>';

  function historyChip(item) {
    // Expired rows are locked whatever their status says: the stripped
    // carve-out row reports 'scoring' (no stored scorecard) forever.
    if (!item.reportAvailable) {
      return '<span class="vi-history-chip vi-history-chip--partial">' + HISTORY_LOCK_SVG + 'Partial</span>';
    }
    // A safety-ended session has no report by design: never show it as
    // scoring, never show a score.
    if (item.status === 'safety' || item.endReason === 'ended_for_safety') {
      return '<span class="vi-history-chip vi-history-chip--partial">Safety</span>';
    }
    // A report still being scored is 'Scoring…' even without full access —
    // the Partial lock only applies once there is a report to lock.
    if (item.status === 'scoring') {
      return '<span class="vi-history-chip vi-history-chip--scoring">Scoring…</span>';
    }
    if (!item.fullAccess) {
      return '<span class="vi-history-chip vi-history-chip--partial">' + HISTORY_LOCK_SVG + 'Partial</span>';
    }
    if (item.overall != null && isFinite(Number(item.overall))) {
      return '<span class="vi-history-chip vi-history-chip--score">' + Math.round(Number(item.overall)) + '</span>';
    }
    return '<span class="vi-history-chip vi-history-chip--scoring">Scoring…</span>';
  }

  function historyRowLine1(role, seniority) {
    var text = String(role || 'Untitled role');
    if (seniority) text += ' · ' + seniority;
    return escapeHtml(text);
  }

  function renderHistory() {
    var listEl = $('vi-history-list');
    var emptyEl = $('vi-history-empty');
    if (!listEl) return;

    var html = '';
    if (historyState.liveRow) {
      var live = historyState.liveRow;
      var liveChip = live.phase === 'scoring'
        ? '<span class="vi-history-chip vi-history-chip--scoring">Scoring…</span>'
        : '<span class="vi-history-chip vi-history-chip--live">Live</span>';
      html += '<div class="vi-history-item vi-history-item--live">' +
        '<div class="vi-history-text">' +
        '<div class="vi-history-line1">' + historyRowLine1(live.role, live.seniority) + '</div>' +
        '<div class="vi-history-line2">' + (live.phase === 'scoring' ? 'Scoring your report…' : 'Live now') + '</div>' +
        '</div>' + liveChip + '</div>';
    }

    html += historyState.items.map(function (item) {
      var id = String(item.sessionId || '');
      var isSelected = !!historyState.selectedIds[id];
      return '<div class="vi-history-item' + (isSelected ? ' is-selected' : '') + '" data-id="' + escapeHtml(id) + '" tabindex="0" data-history-row>' +
        '<span class="vi-history-checkbox-wrap" aria-hidden="' + (historyState.manageMode ? 'false' : 'true') + '">' +
        '<input class="vi-history-checkbox" type="checkbox" data-action="toggle-select" data-id="' + escapeHtml(id) + '" aria-label="Select ' + historyRowLine1(item.role, item.seniority) + '"' + (isSelected ? ' checked' : '') + '/>' +
        '</span>' +
        '<div class="vi-history-text">' +
        '<div class="vi-history-line1">' + historyRowLine1(item.role, item.seniority) + '</div>' +
        '<div class="vi-history-line2">' + escapeHtml(historyMetaLine(item)) + '</div>' +
        '</div>' +
        historyChip(item) +
        '</div>';
    }).join('');

    listEl.innerHTML = html;
    if (emptyEl) emptyEl.hidden = !!(html || historyState.liveRow);
  }

  function renderProgressStrip() {
    var strip = $('vi-history-progress');
    var locked = $('vi-history-progress-locked');
    if (!strip || !locked) return;
    strip.hidden = true;
    locked.hidden = true;

    var voice = historyState.voice || {};
    var paid = !!(voice.unlimited || (voice.mode === 'pack' && voice.sessionsRemaining > 0));

    // Chronological order (list is newest first), last 3 scored sessions
    var scored = historyState.items.filter(function (item) {
      return item.overall != null && isFinite(Number(item.overall));
    }).slice(0, 3).reverse();

    if (paid && scored.length >= 2) {
      var values = scored.map(function (item) { return Math.round(Number(item.overall)); });
      var delta = values[values.length - 1] - values[0];
      var valueEl = $('vi-history-progress-value');
      var deltaEl = $('vi-history-progress-delta');
      if (valueEl) valueEl.textContent = values.join(' → ');
      if (deltaEl) {
        // A downward trend is muted, not error-red: practice is never punished
        deltaEl.textContent = (delta >= 0 ? '▲ +' : '▼ −') + Math.abs(delta) + ' overall';
        deltaEl.className = 'vi-history-progress-delta' + (delta >= 0 ? '' : ' vi-history-progress-delta--down');
      }
      strip.hidden = false;
    } else if (!paid && historyState.items.length >= 1) {
      locked.hidden = false;
    }
  }

  function setHistoryManageMode(next) {
    var panel = $('vi-history-panel');
    var titleEl = $('vi-history-header-title');
    historyState.manageMode = !!next;
    if (panel) panel.classList.toggle('vi-history-panel--manage', historyState.manageMode);
    if (titleEl) titleEl.textContent = historyState.manageMode ? 'Select items' : 'History';
    if (!historyState.manageMode) historyState.selectedIds = {};
    syncBulkDeleteState();
    renderHistory();
  }

  function syncBulkDeleteState() {
    var btn = $('vi-history-delete-selected');
    if (btn) btn.disabled = historySelectedCount() < 1;
  }

  function openDeleteModalFor(ids, clearAll) {
    historyState.pendingDeleteIds = ids.slice();
    historyState.pendingClearAll = !!clearAll;
    var backdrop = $('vi-history-modal-backdrop');
    var modal = $('vi-history-delete-modal');
    if (backdrop) backdrop.hidden = false;
    if (modal) {
      modal.hidden = false;
      var confirmBtn = $('vi-history-delete-confirm');
      if (confirmBtn) confirmBtn.focus();
    }
  }

  function closeDeleteModal() {
    historyState.pendingDeleteIds = [];
    historyState.pendingClearAll = false;
    var backdrop = $('vi-history-modal-backdrop');
    var modal = $('vi-history-delete-modal');
    if (backdrop) backdrop.hidden = true;
    if (modal) modal.hidden = true;
  }

  async function handleDeleteConfirm() {
    var ids = historyState.pendingDeleteIds.slice();
    var clearAll = historyState.pendingClearAll;
    closeDeleteModal();
    if (!ids.length) return;

    var failed = 0;
    try {
      if (clearAll) {
        var res = await api('/api/voice/sessions/clear', { method: 'POST' });
        if (!res.ok) failed = ids.length;
        else track('voice_history_clear', { count: ids.length });
      } else {
        var results = await Promise.allSettled(ids.map(function (id) {
          return api('/api/voice/session/' + encodeURIComponent(id), { method: 'DELETE' });
        }));
        failed = results.filter(function (r) { return r.status !== 'fulfilled' || !r.value.ok; }).length;
        if (failed < ids.length) track('voice_history_delete', { count: ids.length - failed });
      }
    } catch (err) {
      console.warn('[VOICE] history delete failed:', err && err.message);
      failed = ids.length;
    }
    if (failed > 0) {
      showHistoryError('Some selected entries could not be deleted. History refreshed to reflect the current state.');
    }
    setHistoryManageMode(false);
    fetchHistory();
  }

  function bindHistoryEvents() {
    if (historyState.bound) return;
    historyState.bound = true;

    var refreshBtn = $('vi-history-refresh');
    if (refreshBtn) refreshBtn.addEventListener('click', function (e) {
      e.preventDefault();
      if (historyState.manageMode) return;
      fetchHistory();
    });

    var manageBtn = $('vi-history-manage');
    if (manageBtn) manageBtn.addEventListener('click', function (e) {
      e.preventDefault();
      setHistoryManageMode(true);
    });

    var cancelBtn = $('vi-history-cancel-manage');
    if (cancelBtn) cancelBtn.addEventListener('click', function (e) {
      e.preventDefault();
      setHistoryManageMode(false);
    });

    var deleteSelectedBtn = $('vi-history-delete-selected');
    if (deleteSelectedBtn) deleteSelectedBtn.addEventListener('click', function (e) {
      e.preventDefault();
      var ids = Object.keys(historyState.selectedIds);
      if (!ids.length) return;
      openDeleteModalFor(ids, false);
    });

    var clearBtn = $('vi-history-clear');
    if (clearBtn) clearBtn.addEventListener('click', function (e) {
      e.preventDefault();
      var ids = historyState.items.map(function (item) { return String(item.sessionId || ''); }).filter(Boolean);
      if (!ids.length) return;
      if (!historyState.manageMode) setHistoryManageMode(true);
      historyState.selectedIds = {};
      ids.forEach(function (id) { historyState.selectedIds[id] = true; });
      syncBulkDeleteState();
      renderHistory();
      openDeleteModalFor(ids, true);
    });

    var retryBtn = $('vi-history-retry');
    if (retryBtn) retryBtn.addEventListener('click', function (e) {
      e.preventDefault();
      fetchHistory();
    });

    var listEl = $('vi-history-list');
    if (listEl) listEl.addEventListener('click', function (e) {
      var checkbox = e.target.closest ? e.target.closest('[data-action="toggle-select"]') : null;
      var row = e.target.closest ? e.target.closest('[data-history-row]') : null;
      if (!row) return;
      var id = row.getAttribute('data-id');
      if (!id) return;
      if (historyState.manageMode) {
        if (historyState.selectedIds[id]) delete historyState.selectedIds[id];
        else historyState.selectedIds[id] = true;
        if (!checkbox) renderHistory();
        else row.classList.toggle('is-selected', !!historyState.selectedIds[id]);
        syncBulkDeleteState();
        return;
      }
      track('voice_history_open', { session: id });
      window.location = 'voice-interview.html?session=' + encodeURIComponent(id);
    });
    if (listEl) listEl.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      var row = e.target.closest ? e.target.closest('[data-history-row]') : null;
      if (!row) return;
      e.preventDefault();
      row.click();
    });

    var backdrop = $('vi-history-modal-backdrop');
    if (backdrop) backdrop.addEventListener('click', closeDeleteModal);
    var deleteCancel = $('vi-history-delete-cancel');
    if (deleteCancel) deleteCancel.addEventListener('click', closeDeleteModal);
    var deleteConfirm = $('vi-history-delete-confirm');
    if (deleteConfirm) deleteConfirm.addEventListener('click', handleDeleteConfirm);

    // Focus trap + ESC close for the confirm modal (typed precedent)
    var modal = $('vi-history-delete-modal');
    if (modal && !modal.dataset.bound) {
      modal.dataset.bound = '1';
      modal.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') {
          e.preventDefault();
          closeDeleteModal();
          return;
        }
        if (e.key !== 'Tab') return;
        var focusables = modal.querySelectorAll('button,[href],input,select,textarea,[tabindex]:not([tabindex="-1"])');
        var list = Array.prototype.filter.call(focusables, function (el) { return !el.disabled && el.offsetParent !== null; });
        if (!list.length) return;
        var first = list[0];
        var last = list[list.length - 1];
        var active = document.activeElement;
        if (e.shiftKey && active === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && active === last) {
          e.preventDefault();
          first.focus();
        }
      });
    }
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        var backdropEl = $('vi-history-modal-backdrop');
        if (backdropEl && !backdropEl.hidden) closeDeleteModal();
      }
    });
  }

  function historyLiveStart(role, seniority) {
    if (!historyState.voice || !historyState.voice.enabled) return;
    historyState.liveRow = { role: role, seniority: seniority, phase: 'live' };
    renderHistory();
  }

  function historyLiveScoring() {
    if (!historyState.liveRow) return;
    historyState.liveRow.phase = 'scoring';
    renderHistory();
  }

  // Failure paths: drop the live row so the rail never shows Live/Scoring…
  // for a session that is no longer going anywhere. Pass refresh=true when
  // the session was completed server-side (poll timeout): the refetch swaps
  // the local row for the server's real 'scoring' row instead.
  function historyLiveClear(refresh) {
    if (!historyState.liveRow) return;
    historyState.liveRow = null;
    if (refresh && historyState.voice && historyState.voice.enabled) fetchHistory();
    else renderHistory();
  }

  function historyOnScorecardReady() {
    if (!historyState.voice || !historyState.voice.enabled) return;
    historyState.liveRow = null;
    fetchHistory();
  }

  // Deep-link path (?session=...): loadEntitlement() never runs, so fetch the
  // same plan payload once here purely to gate + fill the rail.
  async function initHistoryFromPlan() {
    try {
      var res = await api('/api/plan/me', { method: 'GET' });
      initHistory(res.data && res.data.voice);
    } catch (err) {
      console.warn('[VOICE] history plan load failed:', err && err.message);
    }
  }

  // ---------- view a past session (?session=...) ----------

  async function maybeShowPastSession() {
    var params = new URLSearchParams(window.location.search);
    var sessionId = params.get('session');
    if (!sessionId) return false;
    state.sessionId = sessionId;
    show('vi-done-view');
    var doneStatus = $('vi-done-status');
    if (doneStatus) doneStatus.textContent = 'Loading your report...';
    try {
      var res = await api('/api/voice/session/' + encodeURIComponent(sessionId), { method: 'GET' });
      if (res.ok && res.data && res.data.endReason === 'ended_for_safety') {
        renderScorecard(res.data);   // renders the safety view, never polls
      } else if (res.ok && res.data && res.data.scorecardReady) {
        renderScorecard(res.data);
      } else if (res.ok) {
        pollScorecard(0);
      } else {
        if (doneStatus) doneStatus.textContent = 'Could not load that session.';
      }
    } catch (_) {
      if (doneStatus) doneStatus.textContent = 'Could not load that session.';
    }
    return true;
  }

  // ---------- init ----------

  // Same canonical role typeahead as mock-interview/resume-feedback/cover-letter
  // pages (js/role-selector.js, backed by /api/roles). Free-typed roles keep
  // working (showCustomOption), and the submit path is unchanged — the
  // component writes the chosen string into #vi-role's value.
  function initRoleSelector() {
    var input = $('vi-role');
    if (!input) return;
    if (window.RoleSelector && !input.dataset.roleSelectorInitialized) {
      try {
        new window.RoleSelector(input, {
          minChars: 2,
          maxResults: 8,
          showCustomOption: true
        });
        input.dataset.roleSelectorInitialized = 'true';
      } catch (e) {
        console.warn('[VOICE] RoleSelector init failed:', e);
      }
    } else if (!input.dataset.roleSelectorInitialized) {
      setTimeout(initRoleSelector, 200); // module script may not have loaded yet
    }
  }

  document.addEventListener('DOMContentLoaded', async function () {
    var startBtn = $('vi-start-btn');
    var endBtn = $('vi-end-btn');
    var muteBtn = $('vi-mute-btn');
    var reconnectBtn = $('vi-reconnect-btn');
    initRoleSelector();
    if (startBtn) startBtn.addEventListener('click', startInterview);
    if (endBtn) endBtn.addEventListener('click', function () { endInterview('user_ended'); });
    if (muteBtn) muteBtn.addEventListener('click', toggleMute);
    if (reconnectBtn) reconnectBtn.addEventListener('click', reconnect);

    window.addEventListener('beforeunload', function (e) {
      if (state.connected && !state.ending) {
        e.preventDefault();
        e.returnValue = '';
      }
    });

    var shown = await maybeShowPastSession();
    if (!shown) {
      show('vi-setup-view');
      loadEntitlement();
    } else {
      initHistoryFromPlan();
    }
  });
})();
