// Voice Mock Interview client
// WebRTC directly to OpenAI Realtime using a server-minted ephemeral secret.
// The entitlement gate, consumption, and transcript/cost persistence all live
// server-side; this file is the connection + UI state machine.
(function () {
  'use strict';

  var REALTIME_CALLS_URL = 'https://api.openai.com/v1/realtime/calls';

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
    transcript: [],            // [{speaker:'user'|'assistant', text}]
    usage: { input: 0, output: 0 },
    ending: false,
    connected: false
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

  function appendTranscript(speaker, text) {
    text = String(text || '').trim();
    if (!text) return;
    var last = state.transcript[state.transcript.length - 1];
    if (last && last.speaker === speaker && last.text === text) return; // dedupe replays
    state.transcript.push({ speaker: speaker, text: text });
    var caption = $('vi-caption');
    if (caption) {
      caption.textContent = (speaker === 'assistant' ? 'Interviewer: ' : 'You: ') + text;
    }
  }

  function handleRealtimeEvent(evt) {
    var type = evt.type || '';

    if (type === 'conversation.item.input_audio_transcription.completed') {
      appendTranscript('user', evt.transcript);
      return;
    }
    // GA + beta event names for assistant transcript
    if (type === 'response.output_audio_transcript.done' || type === 'response.audio_transcript.done') {
      appendTranscript('assistant', evt.transcript);
      return;
    }
    if (type === 'response.done' && evt.response && evt.response.usage) {
      state.usage.input += Number(evt.response.usage.input_tokens || 0);
      state.usage.output += Number(evt.response.usage.output_tokens || 0);
      return;
    }
    if (type === 'output_audio_buffer.started' || type === 'response.created') {
      var ind = $('vi-speaking');
      if (ind) ind.classList.add('vi-speaking-on');
      return;
    }
    if (type === 'output_audio_buffer.stopped' || type === 'response.done') {
      var ind2 = $('vi-speaking');
      if (ind2) ind2.classList.remove('vi-speaking-on');
      return;
    }
    if (type === 'error') {
      console.error('[VOICE] Realtime error event:', evt);
    }
  }

  // ---------- connection ----------

  async function connectRealtime(clientSecret, model) {
    state.micStream = await navigator.mediaDevices.getUserMedia({ audio: true });

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

    pc.onconnectionstatechange = function () {
      if (!state.pc) return;
      var s = state.pc.connectionState;
      if (s === 'connected') {
        state.connected = true;
        setStatus('Live. The interviewer can hear you.', 'vi-live');
      } else if ((s === 'disconnected' || s === 'failed') && !state.ending) {
        state.connected = false;
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

  function teardownConnection() {
    try { if (state.dc) state.dc.close(); } catch (_) {}
    try { if (state.pc) state.pc.close(); } catch (_) {}
    try {
      if (state.micStream) state.micStream.getTracks().forEach(function (t) { t.stop(); });
    } catch (_) {}
    state.pc = null; state.dc = null; state.micStream = null; state.connected = false;
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
        endInterview('time_up');
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
      var probe = await navigator.mediaDevices.getUserMedia({ audio: true });
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
      state.transcript = [];
      state.usage = { input: 0, output: 0 };
      state.ending = false;

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
      show('vi-setup-view');
      if (startBtn) { startBtn.disabled = false; startBtn.textContent = 'Start the interview'; }
    }
  }

  function offerReconnect() {
    var btn = $('vi-reconnect-btn');
    if (btn) btn.style.display = '';
  }

  async function reconnect() {
    var btn = $('vi-reconnect-btn');
    if (btn) { btn.disabled = true; btn.textContent = 'Reconnecting...'; }
    try {
      teardownConnection();
      var res = await api('/api/voice/session', {
        method: 'POST',
        body: JSON.stringify({ resumeSessionId: state.sessionId })
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
    state.ending = true;
    if (state.timerInterval) { clearInterval(state.timerInterval); state.timerInterval = null; }

    var durationSeconds = state.startedAtMs ? Math.round((Date.now() - state.startedAtMs) / 1000) : 0;
    teardownConnection();

    show('vi-done-view');
    var doneStatus = $('vi-done-status');
    if (doneStatus) doneStatus.textContent = 'We\'re reviewing your conversation using our S + A = O formula and interview rubric. This usually takes a few seconds.';
    historyLiveScoring();

    try {
      await api('/api/voice/session/' + encodeURIComponent(state.sessionId) + '/complete', {
        method: 'POST',
        body: JSON.stringify({
          transcript: state.transcript,
          durationSeconds: durationSeconds,
          inputTokens: state.usage.input,
          outputTokens: state.usage.output,
          reason: reason || 'user_ended'
        })
      });
      track('voice_session_complete', { duration_seconds: durationSeconds, reason: reason || 'user_ended' });
      pollScorecard(0);
    } catch (err) {
      console.error('[VOICE] complete failed:', err);
      if (doneStatus) doneStatus.textContent = 'The session ended but saving failed. Your session is recorded; check back shortly.';
    }
  }

  function pollScorecard(attempt) {
    if (attempt > 20) {
      var doneStatus = $('vi-done-status');
      if (doneStatus) doneStatus.textContent = 'Your report is taking longer than usual. Refresh this page in a minute.';
      return;
    }
    setTimeout(async function () {
      try {
        var res = await api('/api/voice/session/' + encodeURIComponent(state.sessionId), { method: 'GET' });
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
    return '<div class="vi-dim"><span class="vi-dim-label">' + label + '</span>' +
      '<span class="vi-dim-bar"><span class="vi-dim-fill" style="width:' + Math.max(2, Math.min(100, value)) + '%"></span></span>' +
      '<span class="vi-dim-num">' + value + '</span></div>';
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

  function renderScorecard(data) {
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
    if (!item.reportAvailable || !item.fullAccess) {
      return '<span class="vi-history-chip vi-history-chip--partial">' + HISTORY_LOCK_SVG + 'Partial</span>';
    }
    if (item.status === 'scoring') {
      return '<span class="vi-history-chip vi-history-chip--scoring">Scoring…</span>';
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
      if (res.ok && res.data && res.data.scorecardReady) {
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

  document.addEventListener('DOMContentLoaded', async function () {
    var startBtn = $('vi-start-btn');
    var endBtn = $('vi-end-btn');
    var muteBtn = $('vi-mute-btn');
    var reconnectBtn = $('vi-reconnect-btn');
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
