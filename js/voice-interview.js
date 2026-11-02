// Voice Mock Interview client
// WebRTC media goes directly to OpenAI. The server selects the signalling
// transport; managed calls never expose a reusable provider credential.
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

  // With this much time left the interviewer is told to wrap up, so the
  // session closes through its normal closing line instead of the clock.
  var WRAP_UP_SECONDS = 120;
  var WRAP_UP_INSTRUCTION = 'About two minutes remain in this session. Let the candidate finish their current answer, ' +
    'ask at most one short follow-up, then give your normal closing statement. Do not start a new topic.';

  // How many recent turns the live view shows under the pinned question.
  var RECENT_TURNS = 12;

  var state = {
    micMuted: false,
    liveOrder: null,           // captions include setup; scoring still uses lifecycle-gated order
    captionDrafts: Object.create(null),
    userCaptionItemId: null,
    sessionId: null,
    startRequestId: null, // retained across failed starts to recover without spending twice
    managedTransport: false,
    audioSetup: false,
    audioConfirmed: false,
    microphoneConfirmed: false,
    microphoneLost: false,
    playbackReady: false,
    playbackBlocked: false,
    activating: false,
    activationEvent: null,
    audioContext: null,
    micMeterTimer: null,
    setupValues: null,
    providerAttemptId: null,
    closeRequest: null,
    deadlineAtMs: null,
    starting: false,
    canStart: false,           // last entitlement answer; a failed start never re-enables Start past it
    model: null,
    pc: null,
    dc: null,
    micStream: null,
    reconnecting: false,
    retiringConnection: null, // retained until managed replacement or End finishes
    connectionAttempt: null,   // cancellable setup; late async results never reopen an ended interview
    audioEl: null,
    startedAtMs: null,
    timerInterval: null,
    maxMinutes: 20,
    order: null,               // ordered transcript assembler (voice-transcript-order.js)
    usage: null,
    ending: false,
    pendingCompletion: null,
    completionSaved: false,
    reportPollingStarted: false,
    savingCompletion: false,
    audioCheckCancelled: false,
    connected: false,
    audioPlaying: false,       // interviewer's audio is mid-playback
    audioResponseId: '',       // which response that audio belongs to
    answeredCalls: null,       // call_id -> true; each tool call answered exactly once
    conduct: null,             // escalation gate (voice-conduct.js); survives a reconnect
    conductEnd: null,          // pending end, waiting for the closing turn
    endCause: null,            // 'conduct' | 'safety' | 'closing' — which reason the pending end carries
    lifecycle: null,           // interview lifecycle (voice-lifecycle.js); owns commit boundaries
    turnWait: null,            // { committedAtMs, cueTimer } — turn-start latency + waiting cue
    lastAssistantResponseId: '',  // most recent assistant response seen; straggler guard for the settling window
    interviewStartedAtMs: null,   // official interview start; enables the wrap-up cue
    wrapUpNoted: false,           // the 2-minute notice went out (screen and interviewer)
    audioEventsSeen: false,       // output_audio_buffer events drive the speaking indicator once seen
    heardInterviewer: false,      // "Your turn" only makes sense after the interviewer has spoken
    endConfirmOpen: false,
    graceNotedSessionId: null,
    analyticsReportSessionId: null
  };

  // Semantic VAD still detects turns and interrupts playback. The app requests
  // replies explicitly so it can apply a turn budget before audio is generated.
  var turnControl = { plan: null, ready: false, setupTimer: null, pending: null,
    busy: false, speaking: false, serial: 0, seen: Object.create(null), start: null,
    inputs: [], transcribed: Object.create(null),
    responseId: '', requestId: '', finished: Object.create(null), responseTimer: null };

  function resetTurnConnection() {
    clearTimeout(turnControl.setupTimer);
    clearTimeout(turnControl.responseTimer);
    turnControl.responseTimer = null;
    turnControl.responseId = '';
    turnControl.requestId = '';
    turnControl.setupTimer = null;
    turnControl.ready = false;
    turnControl.pending = null;
    turnControl.inputs = [];
    turnControl.transcribed = Object.create(null);
    turnControl.busy = false;
    turnControl.speaking = false;
    turnControl.start = null;
  }

  function turnControlFailed() {
    if (state.ending) return;
    resetTurnConnection();
    setStatus('Connection interrupted. Saving and closing this attempt.', 'vi-error');
    endInterview('connection_lost');
  }

  function drainTurn() {
    if (!turnControl.ready || turnControl.busy || turnControl.speaking || state.audioPlaying ||
        state.ending || state.conductEnd || state.playbackBlocked || state.microphoneLost || lifecycle().is(PHASES.CLOSING)) return;
    if (!turnControl.pending && turnControl.inputs.length) {
      // Wait for every committed fragment, including a possible spoken Finish.
      // Late ASR must neither interrupt continued speech nor generate separate
      // questions for fragments that were already committed together.
      if (turnControl.inputs.some(function (input) {
        return !turnControl.transcribed[input.id] || (state.liveOrder && state.liveOrder.hasPendingEchoContext(input.id));
      })) return;
      var inputs = turnControl.inputs;
      turnControl.inputs = [];
      inputs.forEach(function (input) {
        if (!input.opening && !lifecycle().shouldCommit(input.id)) return;
        if (state.liveOrder && typeof state.liveOrder.hasUsableUserItem === 'function' && state.liveOrder.hasUsableUserItem(input.id)) {
          turnControl.pending = { opening: input.opening };
        } else {
          // A filtered input must not become the last thing the model answers
          // when a real answer follows it. Retire it from both contexts.
          lifecycle().excludeItem(input.id);
          if (state.order) state.order.drop(input.id);
          if (state.liveOrder) state.liveOrder.drop(input.id);
          sendRealtime({ type: 'conversation.item.delete', item_id: input.id });
        }
      });
      if (!turnControl.pending) clearTurnWait();
    }
    if (!turnControl.pending) return;
    var pending = turnControl.pending;
    turnControl.pending = null;
    if (state.audioSetup && !pending.greeting) return;
    var plan = pending.greeting ? null : pending.repeat ? { kind: 'audio_recovery', instruction: 'Repeat the current interview question in the same words. Do not add a new question or follow-up.' } : turnControl.plan.next({ opening: pending.opening, wrapUp: state.wrapUpNoted });
    var id = 'jha_turn_' + (++turnControl.serial);
    turnControl.requestId = id;
    if (plan) {
      lifecycle().excludeItem(id);
      if (!sendRealtime({ type: 'conversation.item.create', event_id: id + '_context', item: {
        id: id, type: 'message', role: 'system', content: [{ type: 'input_text', text: plan.instruction }]
      } })) { turnControlFailed(); return; }
    }
    turnControl.busy = true;
    turnControl.responseId = '';
    turnControl.responseTimer = setTimeout(turnControlFailed, 45000);
    if (!sendRealtime({ type: 'response.create', event_id: id + '_response', response: {
      // Each sample starts with empty input. Microphone-test speech and prior
      // replays must not turn the next sample into a conversational reply.
      // The override also survives a lost interview-configuration receipt.
      ...(state.audioSetup ? {input:[],instructions:'This is only an audio check. Say only: "Can you hear this clearly? Say a few words to check your microphone, then choose I can hear you on the page." Do not ask interview questions, evaluate answers or continue the conversation.'} : {}),
      metadata: {
      jobhackai_purpose: pending.greeting ? 'audio_check' : plan.kind,
      jobhackai_turn: id,
      ...(plan ? { jobhackai_topic: String(plan.topic) } : {})
    } } })) turnControlFailed();
  }

  function queueTurn(itemId, opening) {
    if (!itemId || turnControl.seen[itemId]) return;
    turnControl.seen[itemId] = true;
    turnControl.inputs.push({ id: itemId, opening: opening });
    drainTurn();
  }

  function noteTranscriptionSettled(itemId) {
    if (itemId) turnControl.transcribed[itemId] = true;
    drainTurn();
  }

  function $(id) { return document.getElementById(id); }

  function show(viewId) {
    ['vi-setup-view', 'vi-live-view', 'vi-done-view', 'vi-disabled-view'].forEach(function (id) {
      var el = $(id);
      if (el) el.style.display = (id === viewId) ? '' : 'none';
    });
    // The live interview takes the whole page: no intro, no history rail.
    var wrap = document.querySelector('.vi-wrap');
    if (wrap && wrap.classList) {
      wrap.classList.toggle('vi-mode-live', viewId === 'vi-live-view');
      wrap.classList.toggle('vi-mode-done', viewId === 'vi-done-view');
    }
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
    var banner = $('vi-entitlement');
    var startBtn = $('vi-start-btn');
    var retryBtn = $('vi-entitlement-retry');
    state.canStart = false;
    if (retryBtn && retryBtn.style.display !== 'none') {
      retryBtn.style.display = 'none';
      if (banner) { banner.textContent = 'Checking your access...'; banner.className = 'vi-banner vi-banner-ok'; }
    }
    try {
      var res = await api('/api/plan/me', { method: 'GET' });
      // A failed lookup is not a disabled feature. Offer a retry instead.
      if (!res.ok || !res.data) throw new Error('plan_lookup_failed: ' + res.status);
      var voice = res.data.voice;
      if (!voice || !voice.enabled) { show('vi-disabled-view'); return; }
      state.managedTransport = voice.transport === 'managed';
      if ($('vi-audio-setup-hint')) $('vi-audio-setup-hint').hidden = !state.managedTransport;

      initHistory(voice);

      if (!banner || !startBtn) return;
      startBtn.textContent = state.managedTransport ? 'Check audio' : 'Start the interview';
      state.canStart = !!voice.canStart;

      if (voice.canStart) {
        startBtn.disabled = false;
        if (voice.unlimited) {
          banner.textContent = Number.isFinite(voice.monthlyRemaining) && Number.isFinite(voice.monthlyLimit)
            ? 'You have ' + voice.monthlyRemaining + ' of ' + voice.monthlyLimit + ' voice interviews left this calendar month (UTC), while your subscription is active.'
            : 'Your subscription includes voice interviews with a calendar-month session limit.';
        } else if (voice.mode === 'pack') {
          banner.textContent = 'You have ' + voice.sessionsRemaining + ' session' + (voice.sessionsRemaining === 1 ? '' : 's') + ' left in your Interview Pack.';
        } else {
          banner.textContent = 'Your first voice interview is free. Make it count.';
        }
        banner.className = 'vi-banner vi-banner-ok';
      } else if (voice.reason === 'limit_reached' || voice.mode === 'subscription' || voice.unlimited) {
        startBtn.disabled = true;
        banner.textContent = 'You have reached your voice interview limit for this calendar month. Your allowance resets on the first day of next month at 00:00 UTC, with an active subscription.';
        banner.className = 'vi-banner';
      } else {
        startBtn.disabled = true;
        banner.innerHTML = 'Your free voice interview is used. <a href="/pricing">See plans</a> to keep practicing.';
        banner.className = 'vi-banner vi-banner-paywall';
        track('paywall_view', { surface: 'voice_setup' });
      }
    } catch (err) {
      // Logged-out users get bounced by the page guard. Anything else must not
      // leave setup stuck on "Checking your access...", so offer a retry.
      console.warn('[VOICE] entitlement load failed:', err && err.message);
      state.canStart = false;
      if (startBtn) startBtn.disabled = true;
      if (banner) {
        banner.textContent = 'We could not check your access. Check your connection and try again.';
        banner.className = 'vi-banner vi-banner-error';
      }
      if (retryBtn) retryBtn.style.display = '';
    }
  }

  // After a failed start, Start is usable again only if the entitlement says so.
  function resetStartButton() {
    var startBtn = $('vi-start-btn');
    if (startBtn) { startBtn.disabled = !state.canStart; startBtn.textContent = state.managedTransport ? 'Check audio' : 'Start the interview'; }
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
    var droppedIds = Object.create(null);
    return {
      noteItem: function () {},
      setText: function (id, speaker, text) {
        if (id && droppedIds[id]) return;   // a dropped turn stays dropped
        arr.push({ id: id || null, speaker: speaker, text: text });
      },
      append: function (speaker, text) { arr.push({ id: null, speaker: speaker, text: text }); },
      drop: function (id) {
        if (!id) return;
        droppedIds[id] = true;
        arr = arr.filter(function (r) { return r.id !== id; });
      },
      list: function () {
        return arr.map(function (r) { return { speaker: r.speaker, text: r.text }; });
      },
      // Arrival-order collection reserves nothing, so there is never anything
      // in flight to wait for.
      pendingCount: function () { return 0; },
      flushTranscript: function () { return Promise.resolve(true); },
      reset: function () { arr = []; droppedIds = Object.create(null); }
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
    var spokeThisResponse = false;
    var greetingContentConfirmed = false;
    var awaitingOpening = false;
    var pendingSinceAck = [];
    var preAckResponseId = '';
    var lastDemotedItems = [];
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
      noteAudioCheckTranscript: function (transcript) {
        if (phase !== PHASES.AUDIO_CHECK) return;
        spokeThisResponse = true;
        if (fallbackIsHearingCheckTurn(typeof transcript === 'string' ? transcript : '')) {
          greetingDone = true;
          greetingContentConfirmed = true;
        } else if (greetingDone && !greetingContentConfirmed) {
          greetingDone = false;
        }
      },
      noteGreetingDone: function (confirmedAudioCheck) {
        if (phase !== PHASES.AUDIO_CHECK) return;
        if (confirmedAudioCheck === true) {
          greetingDone = true;
          greetingContentConfirmed = true;
        } else if (!spokeThisResponse) greetingDone = true;
        spokeThisResponse = false;
      },
      isGreetingDone: function () { return greetingDone; },
      noteUserCommitted: function (itemId, lastResponseId) {
        if (phase === PHASES.ACTIVE_INTERVIEW) {
          if (itemId && !excluded[itemId]) included[itemId] = true;
          if (awaitingOpening && itemId) pendingSinceAck.push(itemId);
          return 'committed';
        }
        if (itemId) excluded[itemId] = true;
        if (phase === PHASES.AUDIO_CHECK && greetingDone) {
          phase = PHASES.ACTIVE_INTERVIEW;
          awaitingOpening = true;
          pendingSinceAck = [];
          preAckResponseId = typeof lastResponseId === 'string' ? lastResponseId : '';
          return 'begin_interview';
        }
        return 'excluded';
      },
      noteAssistantTurn: function (itemId, transcript, responseId) {
        if (phase !== PHASES.ACTIVE_INTERVIEW || !awaitingOpening) return 'none';
        if (responseId && preAckResponseId && responseId === preAckResponseId) return 'none';
        var text = typeof transcript === 'string' ? transcript.trim() : '';
        if (!text) return 'none';
        if (!fallbackIsHearingCheckTurn(text)) {
          awaitingOpening = false;
          pendingSinceAck = [];
          return 'confirmed';
        }
        var dropped = [];
        if (itemId) { excluded[itemId] = true; dropped.push(itemId); }
        for (var i = 0; i < pendingSinceAck.length; i++) {
          excluded[pendingSinceAck[i]] = true;
          dropped.push(pendingSinceAck[i]);
        }
        lastDemotedItems = dropped;
        pendingSinceAck = [];
        awaitingOpening = false;
        phase = PHASES.AUDIO_CHECK;
        greetingDone = true;
        greetingContentConfirmed = true;
        return 'demoted';
      },
      demotedItems: function () { return lastDemotedItems.slice(); },
      isAwaitingOpening: function () { return awaitingOpening; },
      shouldCommit: function (itemId) {
        if (itemId) {
          if (excluded[itemId]) return false;
          if (included[itemId]) return true;
        }
        return phase === PHASES.ACTIVE_INTERVIEW;
      },
      noteReconnect: function () {
        if (phase === PHASES.AUDIO_CHECK) {
          greetingDone = false;
          greetingContentConfirmed = false;
        }
        spokeThisResponse = false;
      }
    };
  }

  // Hand-synced copy of isHearingCheckTurn for the module-missing case: the
  // "candidate could not hear the greeting" round must stay out of the
  // transcript even in degraded mode.
  function fallbackIsHearingCheckTurn(text) {
    if (typeof text !== 'string' || text.length < 8) return false;
    var sentences = text.toLowerCase().replace(/([.!?])/g, '$1\n').split('\n');
    for (var i = 0; i < sentences.length; i++) {
      var s = sentences[i];
      if (!s || s.indexOf('?') < 0) continue;
      if (/\b(?:can|could|do|are) you hear me\b/.test(s)) return true;
      if (/\bare you able to hear me\b/.test(s)) return true;
      if (/\bhear(?:ing)? me (?:now|okay|ok|clearly|better|alright|all right|this time)\b/.test(s)) return true;
      if (/\b(?:is|are) (?:my|the) (?:audio|sound|mic|microphone|voice)\b[^]{0,30}\b(?:coming through|working|clear(?:er)?|better|okay|ok|audible)\b/.test(s)) return true;
      if (/\bam i coming through\b/.test(s)) return true;
      if (/\bcoming through (?:okay|ok|clearly|clear|better|now|alright|all right)\b/.test(s)) return true;
    }
    return false;
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

  // Hand-synced copy of isExplicitEndRequest for the module-missing case:
  // without it, a spoken "end this interview" would once again be stored and
  // scored as if it were an interview answer.
  var FALLBACK_END_VERB = '(?:end|stop|finish|terminate|quit|wrap up)';
  var FALLBACK_END_CLOSER = '(?:\\s+(?:right now|now|here|please|early|for me|today|then|already|at this point|if (?:that\'?s )?(?:ok|okay|alright)|if you can|if possible|ok|okay|thanks|thank you))*';
  var FALLBACK_END_TARGET = new RegExp('\\b' + FALLBACK_END_VERB + '\\s+(?:this|the|our)\\s+(?:mock\\s+)?(?:interview|session|call)\\b' + FALLBACK_END_CLOSER, 'g');
  var FALLBACK_END_IMPERATIVE = new RegExp('^(?:(?:please|ok|okay|alright|all right|hey|so|well|um|uh|yeah|yes|actually|just|now)[\\s,]+)*' + FALLBACK_END_VERB + '\\b');
  var FALLBACK_END_HEAD = new RegExp('\\b(?:i (?:want|need|wanna) to|i(?: would|\'d) like to|let\'?s|can (?:you|we)|could (?:you|we)|would you|will you|please)\\s+(?:just |please |go ahead and )*' + FALLBACK_END_VERB + '\\b');
  var FALLBACK_END_NARRATIVE = /^(?:when|whenever|if|once|after|before|because|since|unless|although|though|while|as soon as|in order to|so that)\b/;
  var FALLBACK_END_REPORTED = /\b(?:usually|always|typically|normally|generally|sometimes|often|occasionally|rarely|seldom|never|tend to|used to|hypothetically|for example|for instance|they|he|she|told|asked|said)\b/;
  var FALLBACK_END_CONTINUATION = /^(?:with|without|by|on|in|into|at|about|around|over|under|using|through|as|like|after|before|for|to|from|so|and|or|but|then|while|\w+ly)\b/;

  function fallbackEndTailIsClean(rest) {
    var text = rest.replace(/[.!?]+\s*$/, '').trim();
    if (!text) return true;
    if (!/^[,;]/.test(text)) return false;
    var parts = text.split(/[,;]/);
    for (var i = 0; i < parts.length; i++) {
      var part = parts[i].trim();
      if (part && FALLBACK_END_CONTINUATION.test(part)) return false;
    }
    return true;
  }

  function fallbackIsExplicitEndRequest(text) {
    if (typeof text !== 'string') return false;
    var lower = text.toLowerCase().replace(/[‘’]/g, "'");
    if (lower.length < 8 || lower.length > 240) return false;
    // Keep the whole-utterance departure + farewell guard in sync with the module.
    if (/^(?:(?:ok|okay|alright|all right|sorry)[, ]+)?i (?:gotta|have to|need to) (?:go|leave)(?: now)?[,.!\s]+(?:bye(?:[- ]bye)?|goodbye)[.!]?$/i.test(lower.trim())) return true;
    // Keep the whole immediate or polite request in sync with voice-lifecycle.js.
    if (/^(?:(?:ok|okay|alright|all right)[, ]+)?i(?: would|'d) like to (?:end|stop|finish) this(?: (?:right now|now|here)(?:,? please)?|,? please)[.!?]?$/i.test(lower.trim())) return true;
    // A short, standalone stop command observed in live QA. Do not broaden
    // this to future-tense stories or instructions about how to finish.
    if (/^(?:(?:ok|okay|alright|all right)[, ]+)?i(?:'ll| will) end (?:this|the) interview(?: now| here| please)*[.!]?$/i.test(lower.trim())) return true;
    var sentences = lower.replace(/([.!?])/g, '$1\n').split('\n');
    for (var i = 0; i < sentences.length; i++) {
      var s = sentences[i].trim();
      if (!s) continue;
      if (FALLBACK_END_NARRATIVE.test(s)) continue;
      if (FALLBACK_END_REPORTED.test(s)) continue;
      if (!FALLBACK_END_IMPERATIVE.test(s) && !FALLBACK_END_HEAD.test(s)) continue;
      FALLBACK_END_TARGET.lastIndex = 0;
      var hit;
      while ((hit = FALLBACK_END_TARGET.exec(s)) !== null) {
        if (fallbackEndTailIsClean(s.slice(hit.index + hit[0].length))) return true;
      }
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
  // The pinned question is ephemeral UI, so the audio-check greeting still
  // shows while it is happening; it just never persists.
  function recordTurn(speaker, text, itemId) {
    text = String(text || '').trim();
    if (!text) return;
    var lc = lifecycle();
    var live = lc.is(PHASES.AUDIO_CHECK) || lc.is(PHASES.ACTIVE_INTERVIEW);
    // Whisper transcripts of the candidate routinely land after the next
    // question, so only the interviewer's own line can replace the pinned
    // question. Candidate turns join the recent conversation in item order.
    if (live) {
      if (speaker === 'assistant') showQuestion(text);
      if (!state.liveOrder) state.liveOrder = newTranscriptOrder();
      state.liveOrder.setText(itemId || null, speaker, text);
      if (speaker === 'user') {
        state.userCaptionItemId = itemId || null;
        var userTurns = state.liveOrder.list().filter(function (t) { return t.speaker === 'user'; });
        var answer = $('vi-your-answer');
        if (answer) answer.textContent = userTurns.length ? userTurns[userTurns.length - 1].text : text;
        setInputStatus('Transcript received');
      }
      if (itemId) delete state.captionDrafts[itemId];
    }
    if (lc.shouldCommit(itemId || null)) {
      if (!state.order) state.order = newTranscriptOrder();
      state.order.setText(itemId || null, speaker, text);
    }
    if (live) renderRecentTurns();
  }

  function showQuestion(text) {
    var question = $('vi-question');
    if (question) question.textContent = text;
    var caption = $('vi-caption');
    if (caption) caption.textContent = '';
  }

  // The last few committed turns in conversation order, not arrival order.
  function renderRecentTurns() {
    var box = $('vi-recent-turns');
    if (!box) return;
    var turns = state.liveOrder ? state.liveOrder.list().slice(-RECENT_TURNS) : [];
    var wrap = $('vi-recent');
    if (wrap) wrap.style.display = turns.length ? '' : 'none';
    box.innerHTML = turns.map(function (t) {
      var who = t.speaker === 'assistant' ? 'Interviewer' : 'You';
      return '<p class="vi-recent-turn"><strong>' + who + ':</strong> ' + escapeHtml(t.text) + '</p>';
    }).join('');
    if (typeof box.scrollHeight === 'number') box.scrollTop = box.scrollHeight;
  }

  function setInputStatus(text) {
    var label = $('vi-input-status');
    if (label) label.textContent = state.micMuted ? 'Microphone muted' : text;
  }

  function clearUncapturedAnswer(itemId, message) {
    if (itemId) delete state.captionDrafts[itemId];
    if (state.ending || !(lifecycle().is(PHASES.AUDIO_CHECK) || lifecycle().is(PHASES.ACTIVE_INTERVIEW))) return;
    // A late empty result must not replace a newer answer in progress.
    if (state.userCaptionItemId && itemId !== state.userCaptionItemId) return;
    var answer = $('vi-your-answer');
    if (answer) answer.textContent = 'No words captured for this turn. Please try speaking again.';
    setInputStatus(message);
  }

  // Captions are immediate visual feedback, separate from the scoring gate.
  // Partial text never reaches history/scoring; completed turns still do.
  function showCaptionDelta(speaker, evt) {
    if (state.ending || !(lifecycle().is(PHASES.AUDIO_CHECK) || lifecycle().is(PHASES.ACTIVE_INTERVIEW))) return;
    var id = evt.item_id;
    if (!id || typeof evt.delta !== 'string') return;
    var draft = state.captionDrafts[id] || '';
    draft = (draft + evt.delta).slice(0, 12000);
    state.captionDrafts[id] = draft;
    var el = $(speaker === 'assistant' ? 'vi-question' : 'vi-your-answer');
    if (el) el.textContent = draft;
    if (speaker === 'user') {
      state.userCaptionItemId = id;
      setInputStatus('Transcribing your answer…');
    }
  }

  // Fresh live view for a new session.
  function resetLiveView() {
    resetTurnConnection();
    turnControl.plan = window.createVoiceTurnPlan ? window.createVoiceTurnPlan() : null;
    turnControl.seen = Object.create(null);
    turnControl.finished = Object.create(null);
    state.micMuted = false;
    state.liveOrder = newTranscriptOrder();
    state.captionDrafts = Object.create(null);
    state.userCaptionItemId = null;
    if ($('vi-recent')) $('vi-recent').open = false;
    if ($('vi-answer-tip')) $('vi-answer-tip').open = false;
    var answer = $('vi-your-answer');
    if (answer) answer.textContent = 'Your words will appear here after you speak.';
    setInputStatus('Listening when you speak');
    var question = $('vi-question');
    if (question) question.textContent = 'The interviewer will start in a moment.';
    var caption = $('vi-caption');
    if (caption) caption.textContent = 'Speak naturally and take your time.';
    var note = $('vi-time-note');
    if (note) note.style.display = 'none';
    var recent = $('vi-recent');
    if (recent) recent.style.display = 'none';
    var turns = $('vi-recent-turns');
    if (turns) turns.innerHTML = '';
    var timerEl = $('vi-timer');
    if (timerEl) timerEl.textContent = formatClock(state.maxMinutes * 60);
    hideEndConfirm();
    state.interviewStartedAtMs = null;
    state.wrapUpNoted = false;
    state.audioEventsSeen = false;
    state.heardInterviewer = false;
    setSpeaking(false);
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

  // Color plus words, so the state never depends on color alone.
  function setSpeaking(on) {
    var ind = $('vi-speaking');
    if (ind) ind.classList.toggle('vi-speaking-on', !!on);
    var label = $('vi-speaking-label');
    if (label) {
      label.textContent = on ? 'Interviewer speaking'
        : (state.heardInterviewer && !state.ending ? 'Your turn' : 'Interviewer');
    }
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
      if (caption) caption.textContent = 'One moment. The interviewer is thinking.';
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

  // ---------- explicit spoken end request ----------

  // The candidate asked, in plain words, for the interview to end. Live, that
  // sentence ("I want to end this interview, can you end it for me?") was
  // committed to the transcript, persisted, and then quoted back as scored
  // feedback. It is a CONTROL utterance — the spoken equivalent of the End
  // button — so it routes through the normal manual end and never becomes
  // interview material.
  //
  // Returns true when it handled the utterance, in which case the caller must
  // NOT record it. The check runs before recordTurn on purpose: exclusion gates
  // future writes, it cannot unwrite one.
  function handleSpokenEndRequest(transcript, itemId) {
    var lc = lifecycle();
    if (!state.ending && !lc.is(PHASES.AUDIO_CHECK) && !lc.is(PHASES.ACTIVE_INTERVIEW) && !lc.is(PHASES.CLOSING)) return false;
    var check;
    if (typeof window.isExplicitEndRequest === 'function') {
      check = window.isExplicitEndRequest;
    } else {
      reportLifecycleModuleMissing();
      check = fallbackIsExplicitEndRequest;
    }
    if (!check(String(transcript || ''))) return false;

    // Exclude the item, then pull its reserved slot out of the assembler: a
    // slot that never receives a transcript would also hold the teardown flush
    // open for its full timeout.
    lc.excludeItem(itemId || null);
    if (itemId && state.order && typeof state.order.drop === 'function') {
      state.order.drop(itemId);
    }
    // Transcription may arrive after the interviewer has already wrapped up.
    // Exclude the control turn during the flush without restarting completion.
    if (state.ending || lc.is(PHASES.CLOSING)) return true;
    console.log('[VOICE] candidate asked to end the interview; ending it, and the request stays out of the transcript');
    track('voice_manual_end', { via: 'spoken_request' });
    // A conduct or safety close already in flight owns the ending; endInterview
    // defers to it by itself. Either way the control utterance is already out.
    endInterview('user_ended');
    return true;
  }

  // VAD committed a candidate turn. The lifecycle classifies the item once,
  // permanently — and the first commit after the audio-check greeting is the
  // acknowledgement that starts the official interview. The last-seen
  // assistant response id rides along so the settling window can tell that
  // response's late transcript apart from the turn that answers the ack.
  function handleUserCommitted(itemId) {
    var action = lifecycle().noteUserCommitted(itemId || null, state.lastAssistantResponseId);
    if (action === 'begin_interview') {
      setStatus('Live interview', 'vi-live');
      track('voice_interview_begin', {});
      state.interviewStartedAtMs = Date.now();
      tickTimer();
      beginTurnWait();
      queueTurn(itemId, true);
      return;
    }
    if (action === 'committed') { beginTurnWait(); queueTurn(itemId, false); }
  }

  function handleRealtimeEvent(evt) {
    var type = evt.type || '';
    // Setup is uncharged to the customer but still uses provider resources.
    if (state.usage && type === 'response.done') state.usage.add('response', evt.response && evt.response.id, evt.response && evt.response.usage);
    if (state.usage && type === 'conversation.item.input_audio_transcription.completed') state.usage.add('transcription', evt.item_id, evt.usage);
    if (state.activationEvent && type === 'session.updated' && evt.session &&
        evt.session.instructions === state.activationInstructions) {
      if (!state.ending) activateAudioReady();
      return;
    }
    if (state.audioSetup) {
      if ((type === 'conversation.item.created' || type === 'conversation.item.added') && evt.item) {
        lifecycle().excludeItem(evt.item.id);
        (state.audioSetupItems || (state.audioSetupItems = [])).push(evt.item.id);
      }
      if (type === 'input_audio_buffer.speech_started' && evt.item_id) lifecycle().excludeItem(evt.item_id);
      if (type === 'input_audio_buffer.committed') { lifecycle().excludeItem(evt.item_id); return; }
      if (type === 'conversation.item.input_audio_transcription.completed') {
        lifecycle().excludeItem(evt.item_id);
        if (handleSpokenEndRequest(evt.transcript, evt.item_id)) return;
        if (String(evt.transcript || '').trim() && !state.micMuted) state.microphoneConfirmed = true;
        updateAudioReadiness();
        return;
      }
    }
    if (type === 'session.updated' && !turnControl.ready && turnControl.start) {
      var detection = evt.session && evt.session.audio && evt.session.audio.input && evt.session.audio.input.turn_detection;
      if (!detection || detection.type !== 'semantic_vad' || detection.create_response !== false || detection.interrupt_response !== true) return;
      clearTimeout(turnControl.setupTimer);
      turnControl.setupTimer = null;
      turnControl.ready = true;
      var start = turnControl.start;
      turnControl.start = null;
      start();
      return;
    }
    // Items are announced in true conversation order and carry the id that
    // the (later, out-of-order) transcript events reference. The lifecycle
    // classifies each item exactly once; only official-interview items reach
    // the assembler, so excluded items never leave pending slots for a
    // teardown flush to wait on.
    if (type === 'conversation.item.created' || type === 'conversation.item.added') {
      // Tool calls/results and system instructions never produce captions.
      // Reserving them would make echo readiness and teardown wait forever.
      if (!evt.item || evt.item.role === 'system' || (evt.item.type && evt.item.type !== 'message')) return;
      if (!state.ending && state.liveOrder) {
        state.liveOrder.noteItem(evt.item.id, evt.previous_item_id, evt.item.role);
      }
      if (!lifecycle().noteItem(evt.item && evt.item.id)) return;
      if (!state.order) state.order = newTranscriptOrder();
      // previous_item_id says which item this one follows, so an item inserted
      // out of band lands in the right place instead of at the end.
      state.order.noteItem(evt.item && evt.item.id, evt.previous_item_id, evt.item && evt.item.role);
      return;
    }

    // The candidate speaking again is what makes a warned incident a CONTINUED
    // one, and it is the guard that stops a duplicated tool call from ending the
    // session on a first offense. Only live speech events qualify, and the gate
    // enforces that itself — a whisper transcript can describe audio from before
    // the warning, so it must never count here.
    if (state.conduct) state.conduct.noteCandidateSpoke(type);

    if (type === 'conversation.item.input_audio_transcription.delta') {
      showCaptionDelta('user', evt);
      return;
    }
    if (type === 'response.output_audio_transcript.delta' || type === 'response.audio_transcript.delta') {
      showCaptionDelta('assistant', evt);
      return;
    }
    if (type === 'conversation.item.input_audio_transcription.failed') {
      clearUncapturedAnswer(evt.item_id, 'Could not transcribe that. Please try saying it again.');
      noteTranscriptionSettled(evt.item_id);
      return;
    }
    if (type === 'conversation.item.input_audio_transcription.completed') {
      if (!String(evt.transcript || '').trim()) {
        clearUncapturedAnswer(evt.item_id, 'No words captured. Please try saying it again.');
        noteTranscriptionSettled(evt.item_id);
        return;
      }
      // An unambiguous "end this interview" is a control utterance, not an
      // answer: it ends the session through the manual-end path and is never
      // recorded, so it cannot reach the stored transcript or the evaluation.
      if (handleSpokenEndRequest(evt.transcript, evt.item_id)) return;
      recordTurn('user', evt.transcript, evt.item_id);
      noteTranscriptionSettled(evt.item_id);
      return;
    }
    if (type === 'input_audio_buffer.speech_started') {
      turnControl.speaking = true;
      // The candidate is talking again; they are not waiting on a reply.
      clearTurnWait();
      if (!state.ending) {
        state.userCaptionItemId = evt.item_id || null;
        setInputStatus('Hearing you…');
      }
      return;
    }
    if (type === 'input_audio_buffer.speech_stopped') {
      turnControl.speaking = false;
      if (!state.ending) setInputStatus('Transcribing your answer…');
      // A Play again click can arrive while the microphone is active. Setup
      // commits do not queue replies, so speech end must release that click.
      if (state.audioSetup) drainTurn();
      return;
    }
    if (type === 'input_audio_buffer.committed') {
      handleUserCommitted(evt.item_id);
      return;
    }
    // GA + beta event names for assistant transcript
    if (type === 'response.output_audio_transcript.done' || type === 'response.audio_transcript.done') {
      // Interrupted output can finish with no words. Retire its placeholder
      // so a candidate answer does not wait on a caption that is already final.
      if (!String(evt.transcript || '').trim()) {
        if (state.liveOrder) state.liveOrder.drop(evt.item_id);
        if (state.order) state.order.drop(evt.item_id);
        drainTurn();
        return;
      }
      // Settle a provisional acknowledgement BEFORE the turn can reach the
      // assembler: if the candidate had actually said they could not hear,
      // this turn is another hearing check — the lifecycle walks back to
      // AUDIO_CHECK and excludes the whole round, so the exclusion gates the
      // recordTurn below (writes cannot be unwritten afterwards).
      if (evt.response_id) state.lastAssistantResponseId = evt.response_id;
      var opening = 'none';
      if (!state.ending && !state.conductEnd) {
        opening = lifecycle().noteAssistantTurn(evt.item_id, evt.transcript, evt.response_id || '');
      }
      if (opening === 'demoted') {
        console.warn('[VOICE] candidate could not hear; audio check repeating — round excluded');
        setStatus('Connected. Quick audio check...', 'vi-connecting');
        // Back in the audio check; session time still follows the deadline.
        state.interviewStartedAtMs = null;
        tickTimer();
        track('voice_audio_check_repeat', {});
        // Exclusion gates future writes only. A whisper that landed inside
        // the settling window is already written into the assembler, and the
        // demoted check's reserved slot would otherwise hold the end-of-
        // session flush open — purge the round's items outright.
        if (state.order && typeof state.order.drop === 'function' &&
            typeof lifecycle().demotedItems === 'function') {
          var dropIds = lifecycle().demotedItems();
          for (var di = 0; di < dropIds.length; di++) state.order.drop(dropIds[di]);
        }
      }
      recordTurn('assistant', evt.transcript, evt.item_id);
      if (opening === 'demoted') turnControl.plan = window.createVoiceTurnPlan();
      // During the audio check (initial or re-entered via demotion) the
      // greeting arms by CONTENT: only the spoken hearing question makes the
      // next commit readable as its answer. A racing VAD auto-response that
      // said something else arms nothing.
      if (lifecycle().is(PHASES.AUDIO_CHECK) &&
          typeof lifecycle().noteAudioCheckTranscript === 'function') {
        lifecycle().noteAudioCheckTranscript(evt.transcript);
      }
      // A repeated hearing check is not interview material: no backstops, no
      // closing detection on it.
      if (opening === 'demoted') return;
      maybeConductBackstop(evt.transcript, evt.response_id);
      maybeSafetyBackstop(evt.transcript, evt.response_id);
      maybeClosingAnnouncement(evt.transcript, evt.response_id);
      drainTurn();
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
      handleToolCall(readToolCall(evt));
      // response.done means generation finished, while the audio can keep
      // playing for seconds. Only without audio buffer events is it the best
      // available signal that the interviewer stopped.
      if (!state.audioEventsSeen) setSpeaking(false);
      // The audio-check greeting finished generating; the next candidate
      // turn is the acknowledgement that begins the official interview.
      var response = evt.response || {};
      if (!response.status || response.status === 'completed') {
        lifecycle().noteGreetingDone(response.status === 'completed' &&
          response.metadata && response.metadata.jobhackai_purpose === 'audio_check');
      }
      if (state.conductEnd) state.conductEnd.noteResponseDone();
      // A duplicated or late done from the interrupted previous response must
      // not release a newer request and start a second concurrent response.
      var requestId = response.metadata && response.metadata.jobhackai_turn;
      if ((!requestId || requestId === turnControl.requestId) &&
          (!response.id || !turnControl.finished[response.id]) &&
          (!turnControl.responseId || !response.id || turnControl.responseId === response.id)) {
        if (response.id) turnControl.finished[response.id] = true;
        clearTimeout(turnControl.responseTimer);
        turnControl.responseTimer = null;
        turnControl.busy = false;
        turnControl.responseId = '';
        turnControl.requestId = '';
        if (response.status === 'failed') turnControlFailed();
        else drainTurn();
      }
      return;
    }

    if (type === 'response.created') {
      // An automatic response racing the configuration acknowledgement must
      // never speak outside the application-owned turn budget.
      if (!turnControl.ready) {
        if (evt.response && evt.response.id) turnControl.finished[evt.response.id] = true;
        sendRealtime({ type: 'response.cancel' });
        return;
      }
      if (evt.response && turnControl.finished[evt.response.id]) return;
      turnControl.busy = true;
      turnControl.responseId = evt.response && evt.response.id || '';
      if (evt.response && evt.response.id) state.lastAssistantResponseId = evt.response.id;
      // No new interviewer turns once the wrap-up is announced. Responses
      // are serial, so anything created during CLOSING is a new turn racing
      // the mic shutdown — cancel it before it speaks.
      if (state.ending || lifecycle().is(PHASES.CLOSING)) {
        sendRealtime({ type: 'response.cancel' });
        return;
      }
      if (!state.audioEventsSeen) { state.heardInterviewer = true; setSpeaking(true); }
      return;
    }
    if (type === 'output_audio_buffer.started') {
      if (state.ending) { stopRemotePlayback(); return; }
      if (evt.response_id) state.lastAssistantResponseId = evt.response_id;
      state.audioPlaying = true;
      // Which response is speaking, not merely that something is. A bare
      // "audio is playing" flag cannot tell the closing line apart from a
      // previous turn's, and seeding the gate from it is what made the stale
      // reads possible in the first place.
      state.audioResponseId = evt.response_id || '';
      if (state.conductEnd) state.conductEnd.noteAudioStarted();
      noteTurnStarted();
      state.audioEventsSeen = true;
      state.heardInterviewer = true;
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
      drainTurn();
      return;
    }
    if (type === 'error') {
      var failedEvent = evt.error && evt.error.event_id;
      if (turnControl.setupTimer || (turnControl.busy && failedEvent &&
          (failedEvent === turnControl.requestId + '_context' || failedEvent === turnControl.requestId + '_response'))) turnControlFailed();
      console.error('[VOICE] Realtime error event:', evt);
    }
  }

  // ---------- audio readiness ----------

  function updateAudioReadiness() {
    var wrap = document.querySelector('.vi-wrap');
    if (wrap && wrap.classList) wrap.classList.toggle('vi-mode-audio-setup', state.audioSetup);
    var panel = $('vi-audio-check');
    if (panel) panel.hidden = !(state.audioSetup || state.playbackBlocked || state.microphoneLost);
    var note = $('vi-audio-note');
    if (note) note.textContent = state.audioSetup
      ? state.activationUnconfirmed
        ? 'Your interview start is being confirmed. Retry Start recovers this same interview without using another.'
        : 'This audio check does not use an interview. Say a few words, then confirm you can hear the voice.'
      : state.microphoneLost ? 'Microphone disconnected. Questions are paused. Choose Reconnect to use an available microphone.'
      : 'Audio needs attention. Questions are paused. Retry audio to hear the current question again.';
    var confirm = $('vi-audio-confirm');
    if (confirm) {
      confirm.hidden = !state.audioSetup;
      confirm.disabled = state.activating || state.micMuted || state.microphoneLost || !state.microphoneConfirmed || !state.playbackReady || state.playbackBlocked || !turnControl.ready;
      confirm.textContent = state.activating ? 'Starting your interview...' : state.activationUnconfirmed ? 'Retry start' : 'I can hear you. Start interview';
    }
    var mic = $('vi-audio-mic-status');
    if (mic) mic.textContent = state.microphoneLost ? 'Microphone disconnected. Choose Reconnect.' : state.micMuted ? 'Unmute your microphone before starting.' : state.microphoneConfirmed ? 'Microphone checked. We received your words.' : 'Say a few words to check your microphone.';
    var output = $('vi-audio-output-status');
    if (output) output.textContent = state.playbackBlocked ? 'Sound could not play. Choose Enable audio, then check your volume and output device.'
      : state.playbackReady ? 'Can you hear the voice clearly?' : 'Waiting for the test voice...';
    var retry = $('vi-audio-retry');
    if (retry) retry.textContent = state.playbackBlocked ? 'Enable audio' : 'Play again';
    if ($('vi-timer')) $('vi-timer').setAttribute('aria-label', state.audioSetup ? state.activationUnconfirmed ? 'Interview start status' : 'Audio setup time remaining' : 'Session time remaining');
    if ($('vi-timer-label')) $('vi-timer-label').textContent = state.audioSetup ? state.activationUnconfirmed ? 'Interview start' : 'Audio setup time left' : 'Session time left';
    if ($('vi-end-btn')) $('vi-end-btn').textContent = state.audioSetup ? 'Cancel audio check' : 'Finish interview';
  }

  function playbackFailed(pc) {
    if (state.ending || (pc && state.pc !== pc)) return;
    state.playbackAttempt = (state.playbackAttempt || 0) + 1;
    state.playbackReady = false;
    state.playbackBlocked = true;
    updateAudioReadiness();
    setStatus('Sound needs attention.', 'vi-error');
    track('voice_audio_playback_blocked', { setup: state.audioSetup });
  }

  async function playRemoteAudio() {
    var pc = state.pc, el = state.audioEl;
    if (!el || !el.srcObject || state.ending) return false;
    var playbackAttempt = state.playbackAttempt = (state.playbackAttempt || 0) + 1;
    try {
      await el.play();
      if (state.pc !== pc || state.ending || state.playbackAttempt !== playbackAttempt) return false;
      state.playbackReady = true;
      state.playbackBlocked = false;
      updateAudioReadiness();
      if (!state.microphoneLost) setStatus(state.audioSetup ? 'Check your audio before starting.' : 'Live interview', state.audioSetup ? 'vi-connecting' : 'vi-live');
      return true;
    } catch (_) {
      if (state.playbackAttempt === playbackAttempt) playbackFailed(pc);
      return false;
    }
  }

  async function retryAudio() {
    // The play call runs directly from a click. No settings changes or assumed
    // autoplay permission. Repeat uses no question opportunity.
    if (state.audioContext) state.audioContext.resume().catch(function () {});
    if (!await playRemoteAudio() || state.ending || state.activating) return;
    turnControl.pending = state.audioSetup ? { greeting: true } : { repeat: true };
    drainTurn();
  }

  function stopMicMeter() {
    clearInterval(state.micMeterTimer); state.micMeterTimer = null;
    if (state.audioContext) state.audioContext.close().catch(function () {});
    state.audioContext = null;
    if ($('vi-audio-meter')) $('vi-audio-meter').value = 0;
  }

  function startMicMeter(stream) {
    if (!state.audioContext) return;
    try {
      var analyser = state.audioContext.createAnalyser();
      analyser.fftSize = 256;
      state.audioContext.createMediaStreamSource(stream).connect(analyser);
      var samples = new Uint8Array(analyser.fftSize);
      state.micMeterTimer = setInterval(function () {
        analyser.getByteTimeDomainData(samples);
        var peak = 0;
        for (var i = 0; i < samples.length; i++) peak = Math.max(peak, Math.abs(samples[i] - 128));
        if ($('vi-audio-meter')) $('vi-audio-meter').value = Math.min(100, peak * 3);
      }, 100);
    } catch (_) { /* Actual transcribed speech remains the readiness check. */ }
  }

  function confirmAudioReady() {
    if (!state.audioSetup || state.activating || state.micMuted || state.microphoneLost || !state.microphoneConfirmed || !state.playbackReady || state.playbackBlocked || !turnControl.ready || state.ending) return;
    if (!state.activationInstructions) { setStatus('Refresh this page to load the audio check.', 'vi-error'); return; }
    state.activating = true;
    updateAudioReadiness();
    // Configure the interviewer before spending credit. A missing/rejected
    // provider acknowledgement remains an uncharged setup failure.
    state.activationEvent = 'jha_activate_' + crypto.randomUUID();
    if (!sendRealtime({ type:'session.update', event_id:state.activationEvent,
      session:{type:'realtime',instructions:state.activationInstructions} })) {
      state.activating = false; state.activationEvent = null; updateAudioReadiness(); return;
    }
    state.activationTimer = setTimeout(function () {
      state.activating = false; state.activationEvent = null;
      updateAudioReadiness();
      setStatus(state.activationUnconfirmed
        ? 'Start could not be confirmed. Retry Start to recover the same interview, or cancel.'
        : 'Audio setup could not finish. Try Start again or cancel. No interview has started.', 'vi-error');
    }, 8000);
  }

  async function activateAudioReady() {
    if (!state.activationEvent || state.activationRequestPending) return;
    // The device can disappear while the configuration acknowledgement is in
    // flight. Require a fresh confirmation before sending a chargeable start.
    if (!state.audioSetup || state.ending || state.micMuted || state.microphoneLost || !state.microphoneConfirmed || !state.playbackReady || state.playbackBlocked) {
      clearTimeout(state.activationTimer);
      state.activating = false; state.activationEvent = null;
      updateAudioReadiness();
      if (!state.ending) setStatus('Audio changed during setup. Check it again before starting.', 'vi-error');
      return;
    }
    state.activationRequestPending = true;
    // Once sent, the server may have committed even if the response is lost.
    // Keep that uncertainty until an authoritative response resolves it.
    state.activationUnconfirmed = true;
    updateAudioReadiness();
    clearTimeout(state.activationTimer);
    var sessionId = state.sessionId, attemptId = state.providerAttemptId, pc = state.pc;
    var controller = new AbortController();
    var requestTimer = setTimeout(function () { controller.abort(); }, 10000);
    try {
      var result = await api('/api/voice/connection', { method:'POST', signal:controller.signal, body:JSON.stringify(Object.assign({
        action:'activate', sessionId:sessionId, attemptId:attemptId, audioReady:true
      },state.setupValues)) });
      if (state.ending || state.sessionId !== sessionId || state.providerAttemptId !== attemptId || state.pc !== pc) return;
      if (!result.ok || !result.data || result.data.activated !== true || result.data.sessionId !== sessionId || result.data.attemptId !== attemptId) {
        if (result.data && ['voice_connection_ended','voice_connection_expired','voice_connection_not_found',
          'voice_connection_history_removed','voice_connection_paywall','voice_connection_limit_reached',
          'voice_connection_reservation_unavailable'].indexOf(result.data.reason) !== -1) {
          await resetRejectedAudioCheck(result.data.reason);
          return;
        }
        throw new Error('activation_unconfirmed');
      }
      var deadline = result.data.deadlineAt;
      if (/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(deadline)) deadline = deadline.replace(' ', 'T') + 'Z';
      var deadlineMs = Date.parse(deadline);
      if (!Number.isFinite(deadlineMs)) throw new Error('activation_unconfirmed');
      state.deadlineAtMs = deadlineMs;
      finishAudioActivation();
    } catch (_) {
      if (state.ending || state.sessionId !== sessionId || state.providerAttemptId !== attemptId || state.pc !== pc) return;
      state.activating = false; state.activationEvent = null;
      updateAudioReadiness();
      setStatus('Start could not be confirmed. Retry Start to recover the same interview, or cancel.', 'vi-error');
    } finally {
      clearTimeout(requestTimer);
      if (state.sessionId === sessionId && state.providerAttemptId === attemptId && state.pc === pc) state.activationRequestPending = false;
    }
  }

  async function resetRejectedAudioCheck(reason) {
    // The server definitively rejected this ID. Release local devices and
    // refresh access before allowing a new check; retrying this ID cannot help.
    state.ending = true;
    state.activating = false; state.activationEvent = null;
    state.activationRequestPending = false; state.activationUnconfirmed = false;
    state.audioSetup = false; state.playbackBlocked = false; state.microphoneLost = false;
    if (state.timerInterval) { clearInterval(state.timerInterval); state.timerInterval = null; }
    teardownConnection();
    clearTurnWait();
    historyLiveClear(false);
    state.sessionId = null; state.startRequestId = null; state.providerAttemptId = null;
    state.startedAtMs = null; state.deadlineAtMs = null;
    state.canStart = false;
    updateAudioReadiness();
    resetStartButton();
    await loadEntitlement();
    show('vi-setup-view');
    resetStartButton();
    alert(reason === 'voice_connection_paywall' ? 'You have no voice interviews left. See plans to keep practicing.'
      : reason === 'voice_connection_limit_reached' ? 'You have reached this month\'s session limit. It resets at the start of next month.'
      : 'This audio check can no longer start an interview. Your access has been refreshed. Check your balance before starting a new audio check.');
  }

  function finishAudioActivation() {
    clearTimeout(state.activationTimer);
    state.activationEvent = null;
    state.activating = false;
    state.activationUnconfirmed = false;
    state.audioSetup = false;
    state.audioConfirmed = true;
    stopMicMeter();
    lifecycle().to(PHASES.ACTIVE_INTERVIEW);
    state.interviewStartedAtMs = Date.now();
    state.startedAtMs = Date.now();
    state.liveOrder = newTranscriptOrder();
    state.captionDrafts = Object.create(null);
    turnControl.plan = window.createVoiceTurnPlan();
    // Remove the test speech from the provider context too. Late setup ASR
    // still cannot reach scoring because its item IDs were excluded.
    (state.audioSetupItems || []).forEach(function (id) { sendRealtime({type:'conversation.item.delete',item_id:id}); });
    state.audioSetupItems = [];
    if ($('vi-your-answer')) $('vi-your-answer').textContent = 'Your words will appear here after you speak.';
    updateAudioReadiness();
    setStatus('Live interview', 'vi-live');
    if ($('vi-question')) { $('vi-question').setAttribute('tabindex', '-1'); $('vi-question').focus(); }
    track('voice_interview_begin', {});
    track('voice_session_start', {});
    tickTimer();
    turnControl.pending = { opening: true };
    drainTurn();
  }

  // ---------- connection ----------

  function cancelConnectionAttempt() {
    var attempt = state.connectionAttempt;
    if (!attempt) return;
    attempt.cancelled = true;
    attempt.controller.abort();
    state.connectionAttempt = null;
  }

  async function connectRealtime(clientSecret, model, managedBody) {
    if (state.ending) return false;
    cancelConnectionAttempt();
    state.playbackReady = false;
    state.playbackBlocked = false;
    if (state.audioSetup) {
      state.microphoneConfirmed = false;
      state.activating = false;
      state.activationEvent = null;
      state.activationRequestPending = false;
      clearTimeout(state.activationTimer);
      clearInterval(state.micMeterTimer);
    }
    updateAudioReadiness();
    var attempt = { cancelled: false, controller: new AbortController() };
    state.connectionAttempt = attempt;
    var stream = null, pc = null, dc = null, completed = false;
    function current() {
      return !attempt.cancelled && state.connectionAttempt === attempt && !state.ending;
    }
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: MIC_CONSTRAINTS });
      // Permission can resolve after End or teardown; release that stream in
      // finally without ever attaching it to a peer connection.
      if (!current()) return false;
      state.micStream = stream;
      state.microphoneLost = false;
      if (state.audioSetup) startMicMeter(stream);
      state.micMuted = false;
      if ($('vi-mute-btn')) {
        $('vi-mute-btn').textContent = 'Mute mic';
        $('vi-mute-btn').setAttribute('aria-pressed', 'false');
      }
      setInputStatus('Listening when you speak');

      pc = new RTCPeerConnection();
      state.pc = pc;

      state.audioEl = $('vi-remote-audio') || document.createElement('audio');
      state.audioEl.autoplay = true;
      state.audioEl.onerror = function () { playbackFailed(pc); };
      pc.ontrack = function (e) {
        if (state.ending || state.pc !== pc || !state.audioEl) return;
        state.audioEl.srcObject = e.streams[0];
        if (e.track) e.track.onended = function () { playbackFailed(pc); };
        playRemoteAudio();
      };
      stream.getAudioTracks().forEach(function (track) {
        track.onended = function () {
          if (state.ending || state.pc !== pc) return;
          state.microphoneConfirmed = false;
          state.microphoneLost = true;
          updateAudioReadiness();
          setStatus('Microphone disconnected. Reconnect to choose an available microphone.', 'vi-error');
          offerReconnect();
        };
      });

      state.micStream.getTracks().forEach(function (t) { pc.addTrack(t, state.micStream); });

      dc = pc.createDataChannel('oai-events');
      state.dc = dc;
      dc.onmessage = function (e) {
        // Keep the current channel's final transcripts during the bounded flush,
        // but never let a replaced channel act on the new interview.
        if (state.pc !== pc) return;
        try { handleRealtimeEvent(JSON.parse(e.data)); } catch (_) {}
      };
      dc.onopen = function () {
        if (state.pc !== pc || state.ending || state.conductEnd) return;
        resetTurnConnection();
        turnControl.start = function () {
          // Realtime is ready. Before the official interview there is an audio
          // check: the interviewer speaks first. Automatic replies are disabled,
          // so the app requests the greeting and subsequent candidate turns.
          // The greeting wording lives in the session instructions.
          if (state.pc !== pc || state.ending || state.conductEnd) return;
          var lc = lifecycle();
          var windowOpen = typeof lc.isAwaitingOpening === 'function' && lc.isAwaitingOpening();
          if (lc.is(PHASES.CONNECTING)) {
            lc.to(PHASES.AUDIO_CHECK);
          } else if (lc.is(PHASES.AUDIO_CHECK)) {
            lc.noteReconnect();   // a drop during the check: the fresh session re-greets
          } else if (lc.is(PHASES.ACTIVE_INTERVIEW) && windowOpen) {
            // A drop with the settling window open: the resume was minted
            // without interviewStarted, so the model's first turn is either the
            // re-check (the window demotes on it) or, with a transcript tail,
            // the resumed conversation (the window confirms). Either way the
            // interviewer speaks first.
            lc.noteReconnect();
          } else {
            // Reconnect mid-interview: the conversation resumes as before. A
            // fresh realtime session has not seen the wrap-up notice yet.
            if (state.wrapUpNoted) sendWrapUpInstruction();
            return;
          }
          if (!lc.is(PHASES.ACTIVE_INTERVIEW)) {
            if (state.playbackBlocked) setStatus('Sound needs attention.', 'vi-error');
            else setStatus('Connected. Quick audio check...', 'vi-connecting');
          }
          updateAudioReadiness();
          turnControl.pending = { greeting: true };
          drainTurn();
        };
        turnControl.setupTimer = setTimeout(turnControlFailed, 8000);
        if (!sendRealtime({ type: 'session.update', session: { type: 'realtime', audio: { input: {
          turn_detection: { type: 'semantic_vad', create_response: false, interrupt_response: true }
        } } } })) turnControlFailed();
      };

      pc.onconnectionstatechange = function () {
        if (state.pc !== pc) return;
        var s = pc.connectionState;
        if (s === 'connected') {
          state.connected = true;
          hideReconnect();
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
      if (!current()) return false;
      await pc.setLocalDescription(offer);
      if (!current()) return false;

      var answerSdp;
      if (managedBody) {
        var connection = await api('/api/voice/connection', {
          method: 'POST',
          body: JSON.stringify(Object.assign({}, managedBody, { action: 'open', sdp: offer.sdp, audioCheck: true })),
          signal: attempt.controller.signal
        });
        if (!current()) return false;
        if (!connection.ok) {
          // After a lost answer the server can identify the existing owned
          // attempt. Only the next explicit retry may replace it.
          if (connection.data && connection.data.reason === 'voice_connection_conflict') {
            state.providerAttemptId = connection.data.currentAttemptId || null;
          }
          var connectionError = new Error((connection.data && connection.data.error) || 'connection_failed');
          connectionError.status = connection.status;
          connectionError.reason = connection.data && connection.data.reason;
          throw connectionError;
        }
        var details = connection.data || {};
        if (details.sessionId !== managedBody.sessionId || typeof details.sdp !== 'string' ||
            !details.sdp.startsWith('v=0') || typeof details.attemptId !== 'string') {
          throw new Error('invalid_connection_response');
        }
        if (details.requiresAudioCheck === true && typeof details.interviewInstructions !== 'string') throw new Error('invalid_audio_setup');
        state.activationInstructions = details.interviewInstructions || null;
        state.audioSetup = details.requiresAudioCheck === true;
        updateAudioReadiness();
        state.providerAttemptId = details.attemptId;
        state.model = details.model;
        state.maxMinutes = details.maxMinutes || 20;
        var deadline = String(details.deadlineAt || '');
        if (/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(deadline)) deadline = deadline.replace(' ', 'T') + 'Z';
        state.deadlineAtMs = Date.parse(deadline);
        if (!Number.isFinite(state.deadlineAtMs)) throw new Error('invalid_connection_deadline');
        answerSdp = details.sdp;
        attempt.result = details;
      } else {
        var sdpRes = await fetch(REALTIME_CALLS_URL + '?model=' + encodeURIComponent(model), {
          method: 'POST',
          headers: { 'Authorization': 'Bearer ' + clientSecret, 'Content-Type': 'application/sdp' },
          body: offer.sdp,
          signal: attempt.controller.signal
        });
        if (!current()) return false;
        if (!sdpRes.ok) {
          var errText = await sdpRes.text().catch(function () { return ''; });
          throw new Error('realtime_connect_failed: ' + sdpRes.status + ' ' + errText.slice(0, 200));
        }
        answerSdp = await sdpRes.text();
      }
      if (!current()) return false;
      await pc.setRemoteDescription({ type: 'answer', sdp: answerSdp });
      if (!current()) return false;
      completed = true;
      return attempt.result || true;
    } catch (error) {
      if (!current()) return false;
      throw error;
    } finally {
      if (state.connectionAttempt === attempt) state.connectionAttempt = null;
      if (!completed) {
        // Clean up only resources owned by this attempt. An old response must
        // not tear down a replacement connection that has already taken over.
        // If End owns the current channel, let its bounded transcript flush
        // finish before teardown closes that channel. The microphone stops now.
        var flushing = pc && state.pc === pc && state.ending;
        if (pc && state.pc === pc && !flushing) {
          state.pc = null; state.dc = null; state.connected = false;
          stopRemotePlayback();
        }
        try { if (dc && !flushing) dc.close(); } catch (_) {}
        try { if (pc && !flushing) pc.close(); } catch (_) {}
        try { if (stream) stream.getTracks().forEach(function (t) { t.stop(); }); } catch (_) {}
        if (state.micStream === stream) state.micStream = null;
      }
    }
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

  function releaseRetiringConnection(connection) {
    if (!connection) return;
    try { if (connection.dc) connection.dc.close(); } catch (_) {}
    try { if (connection.pc) connection.pc.close(); } catch (_) {}
    if (state.retiringConnection === connection) state.retiringConnection = null;
  }

  function teardownConnection() {
    resetTurnConnection();
    releaseRetiringConnection(state.retiringConnection);
    cancelConnectionAttempt();
    stopRemotePlayback();
    try { if (state.dc) state.dc.close(); } catch (_) {}
    try { if (state.pc) state.pc.close(); } catch (_) {}
    stopMicrophone();
    stopMicMeter();
    clearTimeout(state.activationTimer);
    state.pc = null; state.dc = null; state.connected = false;
  }

  // Transcript delivery may still need the data channel for up to 1.5s.
  // Audible playback does not: once completion starts, a buffered or racing
  // response must not keep talking over the report view. Natural/conduct/
  // safety closes reach this point only after their guarded closing audio.
  function stopRemotePlayback() {
    if (state.audioEl) {
      try { state.audioEl.pause(); } catch (_) {}
      try { state.audioEl.srcObject = null; } catch (_) {}
    }
    state.audioPlaying = false;
    state.audioResponseId = '';
    setSpeaking(false);
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

  // Session time follows the last confirmed server deadline. An unconfirmed
  // activation can have replaced the setup deadline remotely; the server's
  // alarm owns that limit while the browser recovers its receipt.
  function startTimer(maxMinutes) {
    if (!state.startedAtMs || !state.managedTransport) state.startedAtMs = Date.now();
    tickTimer();
    state.timerInterval = setInterval(tickTimer, 1000);
  }

  function remainingSeconds() {
    var limitMs = state.managedTransport && Number.isFinite(state.deadlineAtMs)
      ? state.deadlineAtMs : (state.startedAtMs || Date.now()) + state.maxMinutes * 60000;
    return Math.ceil((limitMs - Date.now()) / 1000);
  }

  function formatClock(seconds) {
    var m = Math.floor(Math.abs(seconds) / 60);
    var s = Math.abs(seconds) % 60;
    return (seconds < 0 ? '-' : '') + m + ':' + (s < 10 ? '0' : '') + s;
  }

  function tickTimer() {
    if (!state.startedAtMs) return;
    var remaining = remainingSeconds();
    var counting = !!state.interviewStartedAtMs;
    var timerEl = $('vi-timer');
    if (state.audioSetup && state.activationUnconfirmed) {
      if (timerEl) timerEl.textContent = state.activationRequestPending ? 'Confirming...' : 'Retry start';
      return;
    }
    if (timerEl) {
      timerEl.textContent = formatClock(Math.max(0, remaining));
    }
    if (counting && remaining <= WRAP_UP_SECONDS) noteWrapUpTime();
    if (remaining <= 0) {
      // endInterview defers to a pending conduct or safety close on its own;
      // checking here too just keeps this from logging that once a second.
      if (!state.conductEnd) endInterview(state.audioSetup ? 'connection_lost' : 'time_up');
    }
  }

  // Two minutes left: tell the candidate on screen and tell the interviewer to
  // wrap up. The interviewer's closing line then ends the session through the
  // normal closing path, before the clock cuts anyone off mid-sentence.
  function noteWrapUpTime() {
    if (state.wrapUpNoted || state.ending || state.conductEnd) return;
    if (!lifecycle().is(PHASES.ACTIVE_INTERVIEW)) return;
    state.wrapUpNoted = true;
    var note = $('vi-time-note');
    if (note) note.style.display = '';
    sendWrapUpInstruction();
    track('voice_wrap_up_notice', {});
  }

  function sendWrapUpInstruction() {
    // A system item is not a turn. Excluding its id first keeps it out of the
    // transcript, so it never holds the end-of-session flush open.
    var id = 'jha_wrapup_' + Math.random().toString(36).slice(2, 10);
    lifecycle().excludeItem(id);
    sendRealtime({
      type: 'conversation.item.create',
      item: { id: id, type: 'message', role: 'system', content: [{ type: 'input_text', text: WRAP_UP_INSTRUCTION }] }
    });
  }

  // ---------- lifecycle ----------

  async function startInterview() {
    if (state.pendingCompletion) { show('vi-done-view'); return; }
    if (state.starting) return;
    var role = ($('vi-role') && $('vi-role').value || '').trim();
    var seniority = ($('vi-seniority') && $('vi-seniority').value || '').trim();
    var jd = ($('vi-jd') && $('vi-jd').value || '').trim();
    if (!role) { alert('Pick the role you are interviewing for.'); return; }
    if (typeof window.createVoiceTurnPlan !== 'function' || typeof window.createTranscriptOrder !== 'function' ||
        typeof window.createTranscriptOrder().hasUsableUserItem !== 'function' ||
        typeof window.createTranscriptOrder().hasPendingEchoContext !== 'function') {
      alert('The interview controls did not load. Refresh this page before starting.'); return;
    }
    if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function' || typeof RTCPeerConnection !== 'function') {
      alert('Voice audio is unavailable in this browser. Use an updated browser and try again. No interview was used.'); return;
    }
    if (state.managedTransport) return startManagedInterview(role, seniority, jd);

    var startBtn = $('vi-start-btn');
    if (startBtn) { startBtn.disabled = true; startBtn.textContent = 'Starting...'; }

    try {
      // Mic permission before consuming a session: fail cheap
      var probe = await navigator.mediaDevices.getUserMedia({ audio: MIC_CONSTRAINTS });
      probe.getTracks().forEach(function (t) { t.stop(); });
    } catch (micErr) {
      alert('JobHackAI needs microphone access for the voice interview. Allow the microphone and try again.');
      resetStartButton();
      return;
    }

    try {
      if (!state.startRequestId) state.startRequestId = crypto.randomUUID();
      var res = await api('/api/voice/session', {
        method: 'POST',
        body: JSON.stringify({ role: role, seniority: seniority, jd: jd, startRequestId: state.startRequestId })
      });

      if (!res.ok) {
        if (res.status === 409 && res.data &&
            (res.data.reason === 'session_expired' || res.data.reason === 'session_ended')) {
          state.startRequestId = null;
        }
        if (res.status === 403) {
          await loadEntitlement();
          show('vi-setup-view');
          if (res.data && res.data.error) alert(res.data.error);
        } else {
          alert((res.data && res.data.error) || 'Could not start the session. Please try again.');
        }
        resetStartButton();
        return;
      }

      state.sessionId = res.data.sessionId;
      state.model = res.data.model;
      state.maxMinutes = res.data.maxMinutes || 20;
      state.order = newTranscriptOrder();
      state.usage = typeof window.createVoiceUsage === 'function' ? window.createVoiceUsage() : null;
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
      state.lastAssistantResponseId = '';
      clearTurnWait();
      resetLiveView();

      show('vi-live-view');
      setStatus('Connecting...', 'vi-connecting');
      track('voice_session_start', { mode: res.data.mode });
      historyLiveStart(role, seniority);

      if (!await connectRealtime(res.data.clientSecret, state.model) || state.ending) return;
      state.startRequestId = null;
      startTimer(state.maxMinutes);
    } catch (err) {
      if (state.ending) return;
      console.error('[VOICE] start failed:', err);
      alert('Could not connect the voice session. Check your connection and try again.');
      teardownConnection();
      historyLiveClear(false);
      show('vi-setup-view');
      resetStartButton();
    }
  }

  async function startManagedInterview(role, seniority, jd) {
    state.starting = true;
    state.audioSetup = true;
    state.microphoneConfirmed = false;
    state.playbackReady = false;
    state.playbackBlocked = false;
    state.activating = false;
    state.activationEvent = null;
    state.activationRequestPending = false;
    state.activationUnconfirmed = false;
    state.audioSetupItems = [];
    state.setupValues = {role:role,seniority:seniority,jd:jd};
    stopMicMeter();
    try {
      var AudioContext = window.AudioContext || window.webkitAudioContext;
      if (AudioContext) { state.audioContext = new AudioContext(); state.audioContext.resume().catch(function () {}); }
    } catch (_) {}
    var startBtn = $('vi-start-btn');
    if (startBtn) { startBtn.disabled = true; startBtn.textContent = 'Starting...'; }
    try {
      if (!state.startRequestId) {
        state.startRequestId = crypto.randomUUID();
        state.providerAttemptId = null;
        state.startedAtMs = null;
        state.deadlineAtMs = null;
      }
      state.sessionId = state.startRequestId;
      state.order = newTranscriptOrder();
      state.usage = typeof window.createVoiceUsage === 'function' ? window.createVoiceUsage() : null;
      state.ending = false;
      state.closeRequest = null;
      state.audioPlaying = false;
      state.audioResponseId = '';
      state.answeredCalls = null;
      state.conduct = newConductGate();
      state.conductEnd = null;
      state.endCause = null;
      state.lifecycle = newInterviewLifecycle();
      state.lastAssistantResponseId = '';
      clearTurnWait();
      resetLiveView();
      show('vi-live-view');
      updateAudioReadiness();
      if ($('vi-audio-title')) { $('vi-audio-title').setAttribute('tabindex', '-1'); $('vi-audio-title').focus(); }
      setStatus('Connecting...', 'vi-connecting');
      historyLiveStart(role, seniority);
      // Permission is obtained inside connectRealtime before any server
      // setup or reservation. A single cancellable stream owns this attempt.
      var result = await connectRealtime(null, null, {
        sessionId: state.sessionId, role: role, seniority: seniority, jd: jd,
        replacesAttemptId: state.providerAttemptId
      });
      if (!result || state.ending) return;
      state.startRequestId = null;
      if (!state.audioSetup) track('voice_session_start', { mode: result.mode });
      else track('voice_audio_check_start', {});
      startTimer(state.maxMinutes);
    } catch (error) {
      if (state.ending) return;
      if (['voice_connection_ended', 'voice_connection_expired', 'voice_connection_history_removed'].indexOf(error.reason) !== -1) {
        state.startRequestId = null;
        state.providerAttemptId = null;
      }
      teardownConnection();
      historyLiveClear(false);
      if (error.status === 403) await loadEntitlement();
      show('vi-setup-view');
      var connectionMessage;
      if (error.status === 403) {
        connectionMessage = error.reason === 'voice_connection_limit_reached'
          ? 'You have reached this month\'s session limit. It resets at the start of next month.'
          : 'You have no voice interviews left. See plans to keep practicing.';
      } else if (error.reason === 'voice_connection_conflict') {
        connectionMessage = 'The previous connection is still open. Retry to replace it without using another interview.';
      } else if (['voice_connection_unconfirmed', 'voice_connection_pending', 'voice_call_close_unconfirmed'].indexOf(error.reason) !== -1) {
        connectionMessage = 'We could not confirm the interview connection. Please wait while we check it. Contact support if this continues.';
      } else if (error.reason === 'voice_connection_deadline_unavailable' || error.reason === 'voice_call_create_rejected') {
        connectionMessage = 'Voice interviews are temporarily unavailable. Please try again later.';
      } else if (error.reason === 'voice_connection_setup_limit') {
        connectionMessage = 'Audio setup has been tried several times. Wait 15 minutes, then try again. This attempt did not use an interview.';
      } else if (error.reason === 'voice_connection_audio_check_required') {
        connectionMessage = 'Refresh this page to load the audio check before starting.';
      } else if (error.name === 'NotAllowedError' || error.name === 'NotFoundError' || error.name === 'NotReadableError') {
        connectionMessage = error.name === 'NotFoundError' ? 'No microphone was found. Connect a microphone and try again. No interview was used.'
          : error.name === 'NotReadableError' ? 'Your microphone is unavailable. Close other apps using it and try again. No interview was used.'
          : 'Microphone access is blocked. Allow it for this site in your browser or system settings, then try again. No interview was used.';
      } else {
        connectionMessage = 'Could not connect the interview. Please try again later or contact support.';
      }
      alert(connectionMessage);
    } finally {
      state.starting = false;
      resetStartButton();
    }
  }

  function hideReconnect() {
    var btn = $('vi-reconnect-btn');
    if (btn) { btn.style.display = 'none'; btn.disabled = false; btn.textContent = 'Reconnect'; }
  }

  function offerReconnect() {
    // Nothing to reconnect to when the session is already closing — offering it
    // would be misleading, and taking it would be a way out of a conduct end.
    if (state.conductEnd || state.ending) return;
    var btn = $('vi-reconnect-btn');
    if (btn) btn.style.display = '';
  }

  async function reconnect() {
    if (state.ending || state.reconnecting) return;
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
    // A brief network outage may recover without replacing the provider call.
    // A stale button click must not tear down that recovered connection.
    if (!state.microphoneLost && state.pc && state.pc.connectionState === 'connected' && state.dc && state.dc.readyState === 'open') {
      hideReconnect();
      return;
    }
    state.reconnecting = true;
    var retiring = null;
    var btn = $('vi-reconnect-btn');
    if (btn) { btn.disabled = true; btn.textContent = 'Reconnecting...'; }
    try {
      if (state.managedTransport) {
        // The server closes the old call before admitting a replacement. Keep
        // its transport alive until that exchange returns, just as End does.
        // Stop audio immediately and detach ownership so stale events cannot
        // act on the replacement. End can still release the retained peer.
        cancelConnectionAttempt();
        stopMicrophone();
        stopRemotePlayback();
        retiring = { pc: state.pc, dc: state.dc };
        state.retiringConnection = retiring;
        state.pc = null; state.dc = null; state.connected = false;
      } else {
        teardownConnection();
      }
      // Send the local transcript tail so the fresh realtime session resumes
      // the conversation instead of restarting the interview from scratch.
      // The tail alone cannot distinguish "still in the audio check" from
      // "interview started, nothing committed yet" — both are empty. A drop
      // right after the acknowledgement therefore also sends the lifecycle
      // fact, or the server would rebuild audio-check instructions and the
      // interviewer would replay the greeting into a live, committing
      // interview.
      //
      // "Started" means SETTLED: while the provisional window is still open
      // the audio check has not concluded (the opening never arrived, and
      // the acknowledgement may yet turn out to be "I can't hear you"), so
      // the resumed session re-runs the check. The settling window survives
      // the reconnect and demotes on that re-check, so client and server
      // converge — and early-resume instructions can only ever be minted
      // with the window closed, where no demotion is possible.
      var windowOpen = typeof lifecycle().isAwaitingOpening === 'function' && lifecycle().isAwaitingOpening();
      if (state.managedTransport) {
        setStatus('Reconnecting...', 'vi-connecting');
        if (!await connectRealtime(null, null, {
          sessionId: state.sessionId, replacesAttemptId: state.providerAttemptId,
          ...(state.audioSetup ? state.setupValues : {}),
          transcript: getTranscript().slice(-20),
          interviewStarted: lifecycle().is(PHASES.ACTIVE_INTERVIEW) && !windowOpen
        }) || state.ending) return;
        if (btn) { btn.style.display = 'none'; btn.disabled = false; btn.textContent = 'Reconnect'; }
        return;
      }
      var res = await api('/api/voice/session', {
        method: 'POST',
        body: JSON.stringify({
          resumeSessionId: state.sessionId,
          transcript: getTranscript().slice(-20),
          interviewStarted: lifecycle().is(PHASES.ACTIVE_INTERVIEW) && !windowOpen
        })
      });
      if (state.ending) return;
      if (!res.ok) throw new Error((res.data && res.data.error) || 'resume_failed');
      setStatus('Reconnecting...', 'vi-connecting');
      if (!await connectRealtime(res.data.clientSecret, res.data.model || state.model) || state.ending) return;
      if (btn) { btn.style.display = 'none'; btn.disabled = false; btn.textContent = 'Reconnect'; }
    } catch (err) {
      if (state.ending) return;
      console.error('[VOICE] reconnect failed:', err);
      setStatus('Could not reconnect. Ending the session.', 'vi-error');
      endInterview('connection_lost');
    } finally {
      releaseRetiringConnection(retiring);
      state.reconnecting = false;
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
    if (btn && enabled !== null) {
      btn.textContent = enabled ? 'Mute mic' : 'Unmute mic';
      btn.setAttribute('aria-pressed', String(!enabled));
    }
    state.micMuted = enabled === false;
    updateAudioReadiness();
    setInputStatus('Listening when you speak');
  }

  // The End button asks first once the official interview is running, so an
  // accidental tap cannot close a session. Before that there is nothing said
  // yet, and every automatic end (time, closing line, spoken request) skips it.
  function requestEnd() {
    if (state.ending) return;
    var panel = $('vi-end-confirm');
    if (!panel || !lifecycle().is(PHASES.ACTIVE_INTERVIEW)) return endInterview('user_ended');
    if (state.endConfirmOpen) return;
    state.endConfirmOpen = true;
    track('end_confirm_shown', {});
    if (typeof panel.showModal !== 'function') {
      // Older browsers retain an explicit confirmation and never end merely
      // because the dialog API is unavailable.
      if (typeof window.confirm === 'function' && window.confirm('Finish this interview and save your conversation?')) {
        endInterview('user_ended');
      } else cancelEnd();
      return;
    }
    panel.showModal();
    var keep = $('vi-end-keep');
    if (keep && typeof keep.focus === 'function') keep.focus();
  }

  function hideEndConfirm() {
    state.endConfirmOpen = false;
    var panel = $('vi-end-confirm');
    if (panel && panel.open && typeof panel.close === 'function') panel.close();
  }

  function cancelEnd() {
    hideEndConfirm();
    track('end_confirm_cancel', {});
    var endBtn = $('vi-end-btn');
    if (endBtn && typeof endBtn.focus === 'function') endBtn.focus();
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
    var wasConnecting = !!state.connectionAttempt;
    state.audioCheckCancelled = false;
    if ($('vi-audio-restart')) $('vi-audio-restart').style.display = 'none';
    state.ending = true;
    hideEndConfirm();
    cancelConnectionAttempt();
    // Mark unsaved before the asynchronous transcript flush so closing the
    // tab during that interval receives the same warning as a failed save.
    state.pendingCompletion = { sessionId: state.sessionId };
    state.completionSaved = false;
    state.reportPollingStarted = false;
    // Terminal for every path — manual, time up, conduct, safety, connection
    // lost, or the natural close. COMPLETE is reachable from any phase, and
    // from here no late event can commit a turn, reopen the session, or start
    // another completion (state.ending makes this function run once).
    lifecycle().to(PHASES.COMPLETE);
    clearTurnWait();
    if (state.timerInterval) { clearInterval(state.timerInterval); state.timerInterval = null; }

    var durationSeconds = state.startedAtMs ? Math.round((Date.now() - state.startedAtMs) / 1000) : 0;
    stopMicrophone();
    stopRemotePlayback();
    if (state.managedTransport) {
      // Record End on the server before transcript/provider delays can move
      // it past the credit cutoff. A live call gets a bounded transcript
      // flush window before the server hangs up; a pending start closes now.
      state.closeRequest = requestManagedClose(!wasConnecting);
    }

    show('vi-done-view');
    var doneStatus = $('vi-done-status');
    var isSafetyEnd = reason === 'ended_for_safety';
    if (isSafetyEnd) {
      // The safety view goes up immediately: no S+A=O copy, no scoring state,
      // whatever happens to the save below.
      renderSafetyEnd(null);
    } else if (state.audioSetup) {
      if (doneStatus) doneStatus.textContent = 'Closing your audio check...';
      historyLiveClear(false);
    } else {
      if (doneStatus) doneStatus.textContent = 'We\'re reviewing your conversation against your role and the evidence in your answers. This usually takes a few seconds.';
      historyLiveScoring();
    }

    // Let any transcript still in flight land before the channel closes; the
    // wait is bounded and a timeout just means we store what we already have.
    await flushPendingTranscript();
    if (state.managedTransport) {
      // A live call retains its channel through the final transcript flush.
      // Ask the provider to hang up before closing our peer, so a browser-side
      // disconnect does not race the authoritative hangup request.
      if (!state.closeRequest) state.closeRequest = requestManagedClose();
      await state.closeRequest;
      state.closeRequest = null;
    }
    teardownConnection();

    // Keep the exact payload in memory until acknowledged. A retry must not
    // recompute duration or lose the transcript after the connection closes.
    state.pendingCompletion = {
      sessionId: state.sessionId,
      transcript: getTranscript(), durationSeconds: durationSeconds,
      usageEvidence: state.usage ? state.usage.snapshot() : null,
      reason: reason || 'user_ended'
    };
    await saveCompletion();
  }

  function requestManagedClose(flushTranscript) {
    var controller = new AbortController();
    var timeout = setTimeout(function () { controller.abort(); }, 15000);
    return api('/api/voice/connection', {
      method: 'POST', body: JSON.stringify({ action: 'close', sessionId: state.sessionId, flushTranscript: flushTranscript === true }), signal: controller.signal
    }).catch(function () { return null; }).finally(function () { clearTimeout(timeout); });
  }

  async function saveCompletion() {
    if (!state.pendingCompletion || state.savingCompletion) return;
    state.savingCompletion = true;
    var pending = state.pendingCompletion;
    var isSafetyEnd = pending.reason === 'ended_for_safety';
    var isAudioSetup = state.audioSetup;
    var retryBtn = $('vi-save-retry');
    var saveStatus = $('vi-save-status');
    if (retryBtn) { retryBtn.disabled = true; retryBtn.style.display = 'none'; }
    if (saveStatus) saveStatus.textContent = isAudioSetup ? 'Confirming the connection has closed...' : 'Saving interview...';
    try {
      if (state.closeRequest) { await state.closeRequest; state.closeRequest = null; }
      var saved = await api('/api/voice/session/' + encodeURIComponent(pending.sessionId) + '/complete', {
        method: 'POST', body: JSON.stringify(pending)
      });
      if (!saved.ok) throw new Error((saved.data && saved.data.error) || 'save_failed');
      noteCreditRestored(saved.data);
      if (saved.status === 202 || (saved.data && saved.data.connectionClosed === false)) {
        state.completionSaved = !!(saved.data && saved.data.saved);
        var closureNeedsReview = !!(saved.data && saved.data.closureNeedsReview);
        if (saveStatus) saveStatus.textContent = state.completionSaved
          ? (closureNeedsReview
            ? 'Your interview is saved. We couldn\'t confirm the connection ended, so it needs a technical review. You can leave this page.'
            : 'Interview saved. Connection closure still needs confirmation. Keep this page open and retry finishing.')
          : (closureNeedsReview
            ? 'No interview was saved. The connection needs a technical review; retrying here will not resolve it.'
            : 'Connection closure is still pending. Keep this page open and retry finishing.');
        if (!isSafetyEnd && $('vi-done-status')) $('vi-done-status').textContent = closureNeedsReview
          ? (state.completionSaved ? 'Interview saved. Preparing your report...' : 'Interview ended.')
          : (isAudioSetup ? 'Closing your audio check...' : 'Finishing the interview...');
        if (state.completionSaved && !isSafetyEnd && !state.reportPollingStarted) {
          // The saved report is useful even if operational call closure still
          // needs verification. Keep that pending status visible separately.
          state.reportPollingStarted = true;
          pollScorecard(0);
        }
        if (closureNeedsReview) {
          // The server has either saved the report or fenced an unreserved
          // startup. Its durable review hold does not depend on this page.
          // Do not trap the user with a retry that cannot make progress.
          state.pendingCompletion = null;
          state.startRequestId = null;
          if (!state.completionSaved) historyLiveClear(true);
        } else if (retryBtn) { retryBtn.textContent = 'Retry finishing'; retryBtn.style.display = ''; retryBtn.disabled = false; }
        return;
      }
      state.pendingCompletion = null;
      state.startRequestId = null;
      if (saveStatus) saveStatus.textContent = '';
      if (saved.data && saved.data.status === 'cancelled') {
        state.providerAttemptId = null;
        historyLiveClear(true);
        if (!isSafetyEnd) {
          if ($('vi-done-status')) $('vi-done-status').textContent = 'Interview stopped before it started. No interview credit was used.';
          state.audioCheckCancelled = true;
          if ($('vi-audio-restart')) { $('vi-audio-restart').style.display = ''; $('vi-audio-restart').focus(); }
        }
        return;
      }
      track('voice_session_complete', { duration_seconds: pending.durationSeconds, reason: pending.reason });
      if (isSafetyEnd) { historyLiveClear(true); return; }
      var doneStatus = $('vi-done-status');
      if (doneStatus) doneStatus.textContent = 'Interview saved. Preparing your report...';
      // A failed save removed the optimistic history row. Read the server's
      // acknowledged row after a successful retry while scoring continues.
      if (!historyState.liveRow && historyState.voice && historyState.voice.enabled) fetchHistory();
      if (!state.reportPollingStarted) { state.reportPollingStarted = true; pollScorecard(0); }
    } catch (err) {
      console.error('[VOICE] complete failed:', err);
      if (saveStatus) saveStatus.textContent = state.completionSaved
        ? 'Your interview is saved, but finishing still needs confirmation. Keep this page open and retry.'
        : (isAudioSetup ? 'We could not confirm that the audio check closed. Keep this page open and retry finishing.'
          : 'Your interview has not been saved. Keep this page open and retry saving.');
      if (!isSafetyEnd && $('vi-done-status')) $('vi-done-status').textContent = state.completionSaved
        ? 'Interview saved. Finishing needs another attempt.' : (isAudioSetup ? 'Audio check ended. Closing needs another attempt.' : 'Interview ended. Saving needs another attempt.');
      if (retryBtn) { retryBtn.textContent = isAudioSetup ? 'Retry finishing' : 'Retry saving interview'; retryBtn.style.display = ''; retryBtn.disabled = false; }
      historyLiveClear(false);
    } finally { state.savingCompletion = false; }
  }

  async function restartCancelledAudioCheck() {
    // Only the server's cancelled receipt permits a new attempt. A lost
    // activation or unfinished close must keep recovering the existing ID.
    if (!state.audioCheckCancelled || state.pendingCompletion || state.savingCompletion) return;
    state.audioCheckCancelled = false;
    if ($('vi-audio-restart')) $('vi-audio-restart').style.display = 'none';
    state.sessionId = null; state.startRequestId = null; state.providerAttemptId = null;
    state.startedAtMs = null; state.deadlineAtMs = null;
    state.canStart = false;
    show('vi-setup-view');
    resetStartButton();
    await loadEntitlement();
    if ($('vi-role')) $('vi-role').focus();
  }

  // The server gave this early-ended session's credit back (once per account).
  function noteCreditRestored(data) {
    if (!data || data.creditRestored !== true || state.graceNotedSessionId === state.sessionId) return;
    state.graceNotedSessionId = state.sessionId;
    var note = $('vi-grace-note');
    if (note) note.style.display = '';
    track('grace_credit_restored', {});
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

  // Baseline for "vs your last session": the newest earlier session scored by
  // the same rubric for the same role and level (the progress strip rule).
  // History is newest first; a just-finished session may not be listed yet,
  // and then every listed session is earlier.
  function previousOverall(data, sc) {
    var items = historyState.items;
    var version = sc.methodologyVersion || 1;
    var start = 0;
    for (var j = 0; j < items.length; j++) {
      if (items[j].sessionId === data.sessionId) { start = j + 1; break; }
    }
    for (var i = start; i < items.length; i++) {
      var item = items[i];
      var v = Number(item.overall);
      if (item.overall == null || !isFinite(v)) continue;
      if ((item.methodologyVersion || 1) !== version) continue;
      if (item.role !== data.role || item.seniority !== data.seniority) continue;
      return Math.round(v);
    }
    return null;
  }

  function escapeHtml(s) {
    var div = document.createElement('div');
    div.textContent = String(s == null ? '' : s);
    return div.innerHTML;
  }

  // Approximate content distribution; never a measured speaking-time target.
  function saoBalanceRow(label, actual) {
    actual = Math.max(0, Math.min(100, Math.round(Number(actual) || 0)));
    return '<div class="vi-sao-bal-row"><span class="vi-sao-bal-label">' + label + '</span>' +
      '<span class="vi-sao-bal-track"><span class="vi-sao-bal-fill" style="width:' + actual + '%"></span></span>' +
      '<span class="vi-sao-bal-note">≈ ' + actual + '% of answer content</span></div>';
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
    // #vi-scorecard ships hidden and renderScorecard unhides it on its last
    // line; this path never did, so a safety session wrote its explanation into
    // a hidden container and showed an empty panel — with the status line
    // hidden too, nothing at all. Reopening a Safety row from history hit that
    // every time. The safety state is deliberate and must be visible: scoreless
    // is the point, blank is a bug.
    wrap.style.display = '';
  }

  // ---------- free report ----------

  // The inline plan picker. Prices mirror pricing.html, which owns checkout.
  var PLAN_OPTIONS = [
    { id: 'weekly', name: 'Weekly', price: '$17', per: '/week', note: 'Cancel anytime' },
    { id: 'monthly', name: 'Monthly', price: '$34', per: '/month', note: 'Cancel anytime' },
    { id: 'pack', name: 'Interview Pack', price: '$39', per: 'for 5 sessions', note: 'One time payment. No subscription.' }
  ];
  var DEFAULT_PLAN = 'monthly';
  var DIMENSION_NAMES = ['Communication', 'Structure', 'Content depth', 'Role fit'];

  var CHECK_SVG = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><polyline points="20,6 9,17 4,12"/></svg>';
  var LOCK_SVG = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="3" y="11" width="18" height="10" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>';

  function planOption(id) {
    for (var i = 0; i < PLAN_OPTIONS.length; i++) if (PLAN_OPTIONS[i].id === id) return PLAN_OPTIONS[i];
    return null;
  }

  function pricingHref(planId) {
    return '/pricing?plan=' + encodeURIComponent(planId) + '#plans';
  }

  // "Senior · 1 min · 3 questions", from what the session actually has.
  function reportMeta(data) {
    var parts = [];
    if (data.seniority) parts.push(String(data.seniority));
    var seconds = Number(data.durationSeconds);
    if (data.durationSeconds != null && isFinite(seconds)) parts.push(Math.max(1, Math.round(seconds / 60)) + ' min');
    var questions = Number(data.questionCount);
    if (questions > 0) parts.push(questions + (questions === 1 ? ' question' : ' questions'));
    return parts.join(' · ');
  }

  // Dimension names only. Free and expired reports never show numbers here.
  function lockedDetailsHtml(teaserQuote, feedbackOnly) {
    var html = '<div class="vi-locked-details"><h3>In the full report</h3><ul class="vi-locked-dims">';
    var details = feedbackOnly ? ['Evidence from your answers', 'Practice suggestions', 'Full transcript'] : DIMENSION_NAMES;
    details.forEach(function (name) { html += '<li>' + LOCK_SVG + '<span>' + name + '</span></li>'; });
    html += '</ul>';
    if (teaserQuote) {
      // Close the sentence inside the quote unless the quote already ends one.
      var quote = String(teaserQuote) + (/[.!?]$/.test(teaserQuote) ? '' : '.');
      html += '<p class="vi-teaser">You said "' + escapeHtml(quote) + '" The full report shows what to say instead.</p>';
    }
    return html + '</div>';
  }

  function planPickerHtml() {
    var selected = planOption(DEFAULT_PLAN);
    var html = '<div class="vi-plan-picker"><h3 id="vi-plan-heading">Keep practicing until this answer is automatic</h3>' +
      '<div class="vi-plan-options" role="radiogroup" aria-labelledby="vi-plan-heading">';
    PLAN_OPTIONS.forEach(function (plan) {
      var on = plan.id === selected.id;
      html += '<label class="vi-plan-option' + (on ? ' is-selected' : '') + '">' +
        '<input type="radio" name="vi-plan" value="' + plan.id + '"' + (on ? ' checked' : '') + '>' +
        '<span class="vi-plan-name">' + plan.name + '</span>' +
        '<span class="vi-plan-price">' + plan.price + '<small>' + plan.per + '</small></span></label>';
    });
    html += '</div><a id="vi-plan-continue" class="vi-btn-primary" href="' + pricingHref(selected.id) + '"' +
      ' data-cta="voice-scorecard-plan-continue" data-plan="' + selected.id + '">Continue with ' + selected.name + '</a>' +
      '<p id="vi-plan-note" class="vi-plan-note">' + selected.note + '</p></div>';
    return html;
  }

  // Lead with useful coaching; scores and the paid detail remain secondary.
  function renderFreeReport(data, sc, wrap) {
    track('paywall_view', { surface: 'voice_scorecard' });
    var html = '<div class="vi-result-head"><div class="vi-result-kicker">' + CHECK_SVG + '<span>Interview complete</span></div>' +
      '<h2 class="vi-result-role">' + escapeHtml(data.role || 'Your interview') + '</h2>';
    var meta = reportMeta(data);
    if (meta) html += '<p class="vi-result-meta">' + escapeHtml(meta) + '</p>';
    html += '</div>';
    if (sc.feedbackOnly) html += limitedFeedbackHtml(sc);

    if (sc.topImprovement) {
      html += '<section class="vi-feedback-section"><h3 class="vi-feedback-eyebrow">Your next step</h3><p class="vi-feedback-priority">' + escapeHtml(sc.topImprovement) + '</p>';
      if (!sc.tooShort) {
        html += '<div class="vi-fix-actions">';
        if (data.retry && data.retry.eligible) {
          html += '<button type="button" id="vi-retry-btn" class="vi-btn-primary" data-cta="voice-retry-question">Retry this question, free</button>';
        }
        html += '<a class="vi-btn-secondary vi-btn-locked" href="' + pricingHref(DEFAULT_PLAN) + '" data-cta="voice-strong-answer-locked">' +
          LOCK_SVG + '<span>Hear a strong answer</span></a></div>';
      }
      html += '</section>';
    }

    if (sc.tooShort) {
      html += '<p class="vi-sc-block">There is no full report for this session. Run a full interview to get your scores, moment by moment feedback, and transcript.</p>';
    } else {
      if (sc.topStrength) html += '<section class="vi-feedback-section"><h3 class="vi-feedback-eyebrow">What worked</h3><p class="vi-feedback-strength">' + escapeHtml(sc.topStrength) + '</p></section>';
      html += practiceDetailsHtml(data, sc);
      html += lockedDetailsHtml(sc.teaserQuote, sc.feedbackOnly);
    }

    html += planPickerHtml();
    wrap.innerHTML = html;
    wrap.style.display = '';
    bindFreeReport(wrap);
  }

  // Delegated once on the report container, which outlives each render.
  function bindFreeReport(wrap) {
    if (wrap.dataset && wrap.dataset.freeReportBound === 'true') return;
    if (wrap.dataset) wrap.dataset.freeReportBound = 'true';
    wrap.addEventListener('change', function (e) {
      var input = e && e.target;
      if (!input || input.name !== 'vi-plan') return;
      selectPlan(input.value, wrap);
    });
    wrap.addEventListener('click', function (e) {
      var target = e && e.target;
      var retry = target && (target.id === 'vi-retry-btn' ? target
        : (typeof target.closest === 'function' ? target.closest('#vi-retry-btn') : null));
      if (retry) startQuestionRetry();
    });
  }

  function selectPlan(planId, wrap) {
    var plan = planOption(planId);
    if (!plan) return;
    var link = $('vi-plan-continue');
    if (link) {
      link.setAttribute('href', pricingHref(plan.id));
      link.setAttribute('data-plan', plan.id);
      link.textContent = 'Continue with ' + plan.name;
    }
    var note = $('vi-plan-note');
    if (note) note.textContent = plan.note;
    var options = wrap && typeof wrap.querySelectorAll === 'function' ? wrap.querySelectorAll('.vi-plan-option') : [];
    for (var i = 0; i < options.length; i++) {
      var input = options[i].querySelector('input');
      options[i].classList.toggle('is-selected', !!(input && input.value === plan.id));
    }
    track('plan_option_selected', { plan: plan.id, surface: 'voice_scorecard' });
  }

  // The retry voice session (a 3-minute single-question call) is not built
  // yet. The server only offers this button with VOICE_RETRY_ENABLED on, and
  // that flag must stay off until the session exists.
  function startQuestionRetry() {
    track('retry_start', {});
    alert('Retrying a question is not available yet.');
  }

  // One report_view per session, whichever report variant renders.
  function trackReportView(data) {
    if (!data || state.analyticsReportSessionId === data.sessionId) return;
    state.analyticsReportSessionId = data.sessionId;
    var sc = data.scorecard || {};
    track('report_view', {
      access: data.endReason === 'ended_for_safety' ? 'safety'
        : data.fullAccess ? 'full' : data.expired ? 'expired' : 'free',
      too_short: !!sc.tooShort,
      has_score: sc.overall != null
    });
  }

  function practiceDetailsHtml(data, sc) {
    if (sc.feedbackOnly) return '';
    var score = sc.overall != null && isFinite(Number(sc.overall)) ? Math.round(Number(sc.overall)) : null;
    if (score === null && !(data.fullAccess && (sc.dimensions || sc.saoBalance))) return '';
    var html = '<details class="vi-feedback-details"><summary>Practice score details</summary>' +
      '<p class="vi-sc-block">These estimates reflect the answers captured in this session. Use the feedback and examples to guide your next practice.</p>';
    if (score !== null) {
      html += '<div class="vi-sc-overall"><div class="vi-sc-score">' + score + '</div><div class="vi-sc-overall-label">Practice sample · out of 100</div></div>';
      var previous = previousOverall(data, sc);
      if (previous != null) {
        var delta = score - previous;
        html += '<p class="vi-sc-delta' + (delta < 0 ? ' vi-sc-delta--down' : '') + '">' +
          (delta >= 0 ? '▲ +' : '▼ −') + Math.abs(delta) + ' vs your last session for this role</p>';
      }
    }
    if (data.fullAccess && sc.dimensions) {
      html += '<div class="vi-sc-dims">' + dimensionRow('Communication', sc.dimensions.communication) +
        dimensionRow('Answer structure', sc.dimensions.structure) + dimensionRow('Content depth', sc.dimensions.contentDepth) +
        dimensionRow('Role fit', sc.dimensions.roleFit) + '</div>';
    }
    if (data.fullAccess && sc.saoBalance) {
      html += '<h3>Answer content</h3><p>Approximate content breakdown. There is no ideal percentage for every answer.</p><div class="vi-sao-bal">' +
        saoBalanceRow('Situation', sc.saoBalance.situation) + saoBalanceRow('Action', sc.saoBalance.action) +
        saoBalanceRow('Outcome', sc.saoBalance.outcome) + '</div>';
    }
    return html + '</details>';
  }

  function limitedFeedbackHtml(sc) {
    if (sc.evidenceLimited) return '<p class="vi-sc-block">We could not verify all of the supporting evidence for this report, so no practice score is shown. This is a report limitation, not a judgment of your ability.</p>';
    return '<p class="vi-sc-block">Feedback only for this sample. We need more substantive answers before giving a practice score. Your feedback below is based on what was captured.</p>';
  }

  function renderFullFeedback(data, sc, wrap) {
    var html = '<h2 class="vi-sc-title">Your practice feedback</h2>' + savedLine(data);
    if (sc.feedbackOnly) html += limitedFeedbackHtml(sc);
    var priority = sc.topImprovement || (sc.saoCoaching && sc.saoCoaching[0]);
    if (priority) html += '<section class="vi-feedback-section"><h3 class="vi-feedback-eyebrow">Your next step</h3>' +
      '<p class="vi-feedback-priority">' + escapeHtml(priority) + '</p></section>';
    if (sc.topStrength) html += '<section class="vi-feedback-section"><h3 class="vi-feedback-eyebrow">What worked</h3>' +
      '<p class="vi-feedback-strength">' + escapeHtml(sc.topStrength) + '</p></section>';
    html += '<details class="vi-feedback-details"><summary>Evidence and limits of this feedback</summary>';
    html += '<p>' + escapeHtml(sc.assessmentScope || 'This feedback is based on the answers captured in this practice session.') + '</p>';
    if (sc.competencies && sc.competencies.length) {
      sc.competencies.forEach(function (c) {
        var label = { demonstrated: 'Demonstrated in this sample', needs_practice: 'Needs practice', not_assessed: 'Not assessed' }[c.status] || 'Not assessed';
        html += '<h4>' + escapeHtml(c.name) + ' · ' + label + '</h4>';
        if (c.quote) html += '<p class="vi-sc-quote">' + escapeHtml(c.quote) + '</p>';
        html += '<p>' + escapeHtml(c.feedback) + '</p>';
      });
    }
    if (sc.moments && sc.moments.length) {
      html += '<h3>Moments from your interview</h3>';
      sc.moments.forEach(function (m) {
        html += '<div class="vi-sc-moment"><p class="vi-sc-quote">“' + escapeHtml(m.quote) + '”</p><p>' + escapeHtml(m.comment) + '</p></div>';
      });
    }
    if (sc.summary) {
      html += '<h3>Summary</h3><p>' + escapeHtml(sc.summary) + '</p>';
    }
    html += '</details>' + practiceDetailsHtml(data, sc);
    if (data.transcript && data.transcript.length) {
      html += '<details class="vi-feedback-details vi-sc-transcript"><summary>Full transcript</summary>';
      data.transcript.forEach(function (t) {
        html += '<p><strong>' + (t.speaker === 'assistant' ? 'Interviewer' : 'You') + ':</strong> ' + escapeHtml(t.text) + '</p>';
      });
      html += '</details>';
    }
    html += '<div class="vi-sc-actions"><a class="vi-btn-primary" href="voice-interview.html">Start another interview</a>' +
      '<a class="vi-sc-actions-link" href="dashboard.html">Back to Dashboard</a></div>';
    wrap.innerHTML = html;
    wrap.style.display = '';
  }

  function renderScorecard(data) {
    trackReportView(data);
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
    if (!data.fullAccess && !data.expired && !sc.tooShort) {
      renderFreeReport(data, sc, wrap);
      return;
    }
    var html = '';

    html += '<h2 class="vi-sc-title">Your interview report</h2>';
    if (!data.expired) html += savedLine(data);

    if (sc.tooShort && !data.expired) {
      html += '<div class="vi-sc-block"><h3>Not enough captured speech for feedback</h3>' +
        '<p>We saved this session, but the transcript does not contain enough of your answers to give useful feedback.</p>' +
        '<p>On your next interview, check the “You” caption to confirm your words are appearing as you speak.</p></div>';
      if (data.transcript && data.transcript.length) {
        html += '<details class="vi-sc-transcript"><summary>Captured conversation</summary>';
        data.transcript.forEach(function (t) {
          html += '<p><strong>' + (t.speaker === 'assistant' ? 'Interviewer' : 'You') + ':</strong> ' + escapeHtml(t.text) + '</p>';
        });
        html += '</details>';
      }
      html += '<div class="vi-sc-actions"><a class="vi-btn-primary" href="voice-interview.html">Start another interview</a>' +
        '<a class="vi-btn-secondary" href="dashboard.html">Back to Dashboard</a></div>';
      wrap.innerHTML = html;
      wrap.style.display = '';
      return;
    }
    if (data.fullAccess && !data.expired) {
      renderFullFeedback(data, sc, wrap);
      return;
    } else {
      // Expired (past the 90-day retention window): locked for every plan, so
      // an active plan is pointed at a new interview rather than an upgrade.
      var activePlan = !!data.activePlan;
      if (!activePlan) track('paywall_view', { surface: 'voice_scorecard' });
      html += lockedDetailsHtml(null);
      html += '<div class="vi-sc-unlock vi-sc-unlock--inline"><h3>This report has expired.</h3><p>' +
        (activePlan
          ? 'Reports are kept for 90 days. Your plan is still active. Run a new interview for a fresh report.'
          : 'Reports are kept for 90 days. Pick a plan to keep practicing and track your progress.') + '</p>' +
        (activePlan
          ? '<a class="vi-btn-primary" href="voice-interview.html" data-cta="voice-scorecard-expired-new">Start a new interview</a>'
          : '<a class="vi-btn-primary" href="/pricing" data-cta="voice-scorecard-unlock">See plans</a>') + '</div>';
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
    if (item.status === 'ready') {
      return '<span class="vi-history-chip vi-history-chip--partial">Not scored</span>';
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

    // Compare only scores produced by the same rubric, role and level.
    var latest = historyState.items.find(function (item) { return item.overall != null; });
    // Chronological order (list is newest first), last 3 comparable sessions
    var scored = historyState.items.filter(function (item) {
      return item.overall != null && isFinite(Number(item.overall)) && latest &&
        (item.methodologyVersion || 1) === (latest.methodologyVersion || 1) &&
        item.role === latest.role && item.seniority === latest.seniority;
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
    if (endBtn) endBtn.addEventListener('click', requestEnd);
    if ($('vi-end-keep')) $('vi-end-keep').addEventListener('click', cancelEnd);
    if ($('vi-end-confirm')) $('vi-end-confirm').addEventListener('cancel', function (event) {
      event.preventDefault();
      cancelEnd();
    });
    if ($('vi-end-confirm-btn')) $('vi-end-confirm-btn').addEventListener('click', function () {
      hideEndConfirm();
      return endInterview('user_ended');
    });
    if ($('vi-save-retry')) $('vi-save-retry').addEventListener('click', saveCompletion);
    if ($('vi-audio-restart')) $('vi-audio-restart').addEventListener('click', restartCancelledAudioCheck);
    if ($('vi-entitlement-retry')) $('vi-entitlement-retry').addEventListener('click', function () { loadEntitlement(); });
    if (muteBtn) muteBtn.addEventListener('click', toggleMute);
    if ($('vi-audio-confirm')) $('vi-audio-confirm').addEventListener('click', confirmAudioReady);
    if ($('vi-audio-retry')) $('vi-audio-retry').addEventListener('click', retryAudio);
    if ($('vi-audio-help')) $('vi-audio-help').addEventListener('click', function () { playbackFailed(state.pc); });
    if (reconnectBtn) reconnectBtn.addEventListener('click', reconnect);

    window.addEventListener('beforeunload', function (e) {
      if (((state.connected || state.connectionAttempt) && !state.ending) || state.pendingCompletion) {
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
