// Explicitly enabled, local-only development trace. Never records speech,
// credentials, SDP, device labels, account identifiers or raw provider events.
export function createVoiceAudioDiagnostics(env, readState) {
    var location = env.location || {};
    if (!['dev.jobhackai.io', 'localhost', '127.0.0.1'].includes(location.hostname) ||
        new URLSearchParams(location.search || '').get('voiceAudioDebug') !== '1') return null;
    var started = Date.now(), rows = [], dropped = 0, cleanup = function () {};
    var types = new Set(['session.created', 'session.updated', 'session.update', 'response.create',
      'response.cancel', 'response.created', 'response.done', 'response.output_audio.done', 'response.audio.done',
      'response.output_audio_transcript.done', 'response.audio_transcript.done',
      'output_audio_buffer.started', 'output_audio_buffer.stopped', 'output_audio_buffer.cleared', 'output_audio_buffer.clear',
      'input_audio_buffer.speech_started', 'input_audio_buffer.speech_stopped', 'input_audio_buffer.committed',
      'conversation.item.input_audio_transcription.completed', 'conversation.item.input_audio_transcription.failed', 'error']);
    var statuses = ['completed', 'cancelled', 'failed', 'incomplete', 'in_progress'];
    var reasons = ['turn_detected', 'client_cancelled', 'max_output_tokens', 'content_filter', 'error'];
    function add(kind, data) {
      if (rows.length === 3000) { rows.shift(); dropped++; }
      rows.push({ ms: Date.now() - started, kind: kind, ...data });
    }
    function choice(value, values) { return values.includes(value) ? value : null; }
    function number(value) { return typeof value === 'number' && Number.isFinite(value) ? value : null; }
    function detection(session) {
      var d = session && session.audio && session.audio.input && session.audio.input.turn_detection;
      return d ? { vad: choice(d.type, ['semantic_vad', 'server_vad']),
        interrupt: typeof d.interrupt_response === 'boolean' ? d.interrupt_response : null,
        autoResponse: typeof d.create_response === 'boolean' ? d.create_response : null } : {};
    }
    function event(direction, evt) {
      try {
        if (!evt || !types.has(evt.type)) return;
        var response = evt.response || {}, details = response.status_details || {};
        add(direction === 'send' ? 'send' : 'receive', { type: evt.type,
          ...detection(evt.session), status: choice(response.status, statuses), reason: choice(details.reason, reasons),
          // Counts establish whether a full caption arrived, without its words.
          textLength: typeof evt.transcript === 'string' ? evt.transcript.length : null });
      } catch (_) {}
    }
    function mark(name) {
      if (['play-request', 'play-resolved', 'play-rejected', 'stop-playback', 'retry-audio', 'teardown', 'mute-toggle', 'reconnect-request'].includes(name)) add(name, {});
    }
    function connectionFailure(stage, error) {
      error = error || {};
      add('connection-failed', {
        stage: choice(stage, ['microphone', 'offer', 'application_auth', 'application_request', 'remote_description']),
        status: Number.isInteger(error.status) && error.status >= 100 && error.status <= 599 ? error.status : null,
        reason: choice(error.reason, ['voice_connection_conflict', 'voice_connection_deadline_unavailable',
          'voice_connection_pending', 'voice_connection_unconfirmed', 'voice_connection_ended', 'voice_connection_expired',
          'voice_call_close_unconfirmed', 'voice_call_provider_changed', 'voice_connection_not_found',
          'voice_connection_history_removed', 'voice_call_create_rejected']),
        errorName: choice(error.name, ['TypeError', 'Error', 'AbortError', 'TimeoutError', 'NotAllowedError', 'NotFoundError', 'NotReadableError']),
        authCode: choice(error.code, ['auth/network-request-failed', 'auth/user-token-expired', 'auth/user-disabled']),
        online: typeof env.navigator.onLine === 'boolean' ? env.navigator.onLine : null
      });
    }
    function watch(pc, el, stream) {
      cleanup();
      var removers = [], stopped = false, pendingStats = false;
      function listen(target, name, handler) {
        if (!target || !target.addEventListener) return;
        target.addEventListener(name, handler);
        removers.push(function () { target.removeEventListener(name, handler); });
      }
      function snapshot(kind) {
        try {
          var state = readState(), context = state.audioContext;
          var tracks = el.srcObject ? el.srcObject.getAudioTracks() : [];
          var mic = stream.getAudioTracks()[0], remote = tracks[0];
          add(kind, { paused: el.paused === true, ended: el.ended === true, muted: el.muted === true,
            volume: number(el.volume), currentTime: number(el.currentTime), readyState: number(el.readyState),
            errorCode: el.error ? number(el.error.code) : null, hasStream: !!el.srcObject,
            remoteMuted: remote ? remote.muted === true : null,
            remoteEnded: remote ? remote.readyState === 'ended' : null,
            micEnabled: mic ? mic.enabled === true : null, micMuted: mic ? mic.muted === true : null,
            setup: state.audioSetup === true, playing: state.audioPlaying === true,
            blocked: state.playbackBlocked === true, ending: state.ending === true,
            context: context ? choice(context.state, ['running', 'suspended', 'interrupted', 'closed']) : null,
            audioSession: env.navigator.audioSession ? choice(env.navigator.audioSession.state, ['active', 'inactive', 'interrupted']) : null,
            hidden: env.document.hidden === true,
            focused: env.document.hasFocus ? env.document.hasFocus() : null,
            connection: choice(pc.connectionState, ['new', 'connecting', 'connected', 'disconnected', 'failed', 'closed']) });
        } catch (_) {}
      }
      ['play', 'playing', 'pause', 'waiting', 'stalled', 'ended', 'emptied', 'error', 'volumechange'].forEach(function (name) {
        listen(el, name, function () { snapshot('media-' + name); });
      });
      listen(pc, 'track', function (evt) {
        ['mute', 'unmute', 'ended'].forEach(function (name) {
          listen(evt.track, name, function () { snapshot('remote-' + name); });
        });
        snapshot('remote-track');
      });
      listen(pc, 'connectionstatechange', function () { snapshot('connection-change'); });
      listen(env.document, 'visibilitychange', function () { snapshot('visibility'); });
      listen(env, 'focus', function () { snapshot('focus'); });
      listen(env, 'blur', function () { snapshot('blur'); });
      listen(env, 'online', function () { add('network-online', {}); });
      listen(env, 'offline', function () { add('network-offline', {}); });
      listen(env.navigator.audioSession, 'statechange', function () { snapshot('audio-session-change'); });
      listen(readState().audioContext, 'statechange', function () { snapshot('audio-context-change'); });
      var timer = env.setInterval(function () {
        snapshot('sample');
        if (pendingStats || !pc.getStats) return;
        pendingStats = true;
        Promise.resolve().then(function () { return pc.getStats(); }).then(function (stats) {
          if (stopped) return;
          stats.forEach(function (stat) {
            if (stat.type !== 'inbound-rtp' || (stat.kind || stat.mediaType) !== 'audio') return;
            var safe = {};
            ['packetsReceived', 'packetsLost', 'bytesReceived', 'audioLevel', 'totalAudioEnergy',
              'totalSamplesDuration', 'totalSamplesReceived', 'concealedSamples', 'silentConcealedSamples',
              'jitter', 'jitterBufferDelay', 'jitterBufferEmittedCount'].forEach(function (key) { safe[key] = number(stat[key]); });
            add('inbound-audio', safe);
          });
        }).catch(function () { if (!stopped) add('stats-unavailable', {}); }).finally(function () { pendingStats = false; });
      }, 250);
      cleanup = function () {
        stopped = true;
        env.clearInterval(timer);
        removers.forEach(function (remove) { remove(); });
      };
      snapshot('watch');
    }
    function report() {
      return { version: '20261108-network-recovery-1', startedAt: new Date(started).toISOString(), dropped: dropped,
        events: rows.map(function (row) { return { ...row }; }) };
    }
    function mount() {
      var panel = env.document.createElement('div');
      panel.id = 'vi-audio-diagnostics';
      panel.style.cssText = 'padding:12px;text-align:center;background:#fff7df;color:#222';
      var button = env.document.createElement('button');
      button.type = 'button';
      button.textContent = 'Save audio diagnostics';
      button.className = 'vi-btn-secondary';
      button.addEventListener('click', function () {
        var url = env.URL.createObjectURL(new env.Blob([JSON.stringify(report(), null, 2)], { type: 'application/json' }));
        var link = env.document.createElement('a');
        link.href = url;
        link.download = 'jobhackai-audio-diagnostics-' + new Date(started).toISOString().replace(/[:.]/g, '-') + '.json';
        panel.appendChild(link);
        link.click();
        link.remove();
        env.setTimeout(function () { env.URL.revokeObjectURL(url); }, 10000);
      });
      panel.appendChild(button);
      env.document.body.appendChild(panel);
    }
    return { event: event, mark: mark, connectionFailure: connectionFailure, watch: watch, report: report, mount: mount, stop: function () { cleanup(); } };
}
if (typeof window !== 'undefined') window.createVoiceAudioDiagnostics = createVoiceAudioDiagnostics;
