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
    if (doneStatus) doneStatus.textContent = 'Interview finished. Preparing your report...';

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

  function renderScorecard(data) {
    var wrap = $('vi-scorecard');
    var doneStatus = $('vi-done-status');
    if (doneStatus) doneStatus.style.display = 'none';
    if (!wrap) return;
    var sc = data.scorecard || {};
    var html = '';

    html += '<h2 class="vi-sc-title">Your interview report</h2>';

    if (data.fullAccess) {
      html += '<div class="vi-sc-overall"><div class="vi-sc-score">' + escapeHtml(sc.overall) + '</div><div class="vi-sc-overall-label">Overall</div></div>';
      if (sc.dimensions) {
        html += '<div class="vi-sc-dims">';
        html += dimensionRow('Communication', sc.dimensions.communication);
        html += dimensionRow('Structure', sc.dimensions.structure);
        html += dimensionRow('Content depth', sc.dimensions.contentDepth);
        html += dimensionRow('Role fit', sc.dimensions.roleFit);
        html += '</div>';
      }
    }

    html += '<div class="vi-sc-block vi-sc-strength"><h3>Top strength</h3><p>' + escapeHtml(sc.topStrength) + '</p></div>';
    html += '<div class="vi-sc-block vi-sc-improve"><h3>Improve this first</h3><p>' + escapeHtml(sc.topImprovement) + '</p></div>';

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
      html += '<div class="vi-sc-actions"><a class="vi-btn-secondary" href="voice-interview.html">Run another interview</a></div>';
    } else {
      // Free taste: partial scorecard, blurred full report, one upgrade CTA
      track('paywall_view', { surface: 'voice_scorecard' });
      html += '<div class="vi-sc-locked">';
      html += '<div class="vi-sc-blur" aria-hidden="true">';
      html += '<div class="vi-sc-overall"><div class="vi-sc-score">??</div><div class="vi-sc-overall-label">Overall</div></div>';
      html += '<div class="vi-sc-dims">' + dimensionRow('Communication', 70) + dimensionRow('Structure', 55) + dimensionRow('Content depth', 62) + dimensionRow('Role fit', 75) + '</div>';
      html += '<p>The full report includes your scores, specific moments from your answers, a summary, and the complete transcript.</p>';
      html += '</div>';
      html += '<div class="vi-sc-unlock"><h3>Your full report is ready.</h3><p>Unlock every score, the moment by moment feedback, and your transcript. Then keep practicing until the answers are automatic.</p><a class="vi-btn-primary" href="/pricing" data-cta="voice-scorecard-unlock">See plans</a></div>';
      html += '</div>';
    }

    wrap.innerHTML = html;
    wrap.style.display = '';
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
    }
  });
})();
