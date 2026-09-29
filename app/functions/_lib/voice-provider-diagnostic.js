const MAX_BYTES = 8192;
const MAX_READ_MS = 1000;
const CODES = new Set(['call_not_found', 'call_id_not_found', 'session_not_found', 'resource_not_found', 'not_found',
  'invalid_api_key', 'insufficient_permissions', 'permission_denied', 'invalid_request_error',
  'model_not_found', 'rate_limit_exceeded']);
const TYPES = new Set(['invalid_request_error', 'authentication_error', 'permission_error',
  'server_error', 'rate_limit_error']);

/** Fixed diagnostic categories only. Never return a provider body/message,
 * credential, SDP, request header, transcript or arbitrary error-code string.
 * This is evidence collection, never a decision to release a closure hold. */
export async function voiceProviderFailureDiagnostic(response) {
  let reader, timer, bytes = 0;
  const chunks = [];
  const read = async () => {
    reader = response.body?.getReader();
    if (!reader) return '';
    for (;;) {
      const {done, value} = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_BYTES) throw Error('oversized');
      chunks.push(value);
    }
    const body = new Uint8Array(bytes);
    let offset = 0;
    for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
    return new TextDecoder().decode(body);
  };
  try {
    const text = await Promise.race([read(), new Promise((_, reject) => {
      timer = setTimeout(() => reject(Error('timeout')), MAX_READ_MS);
    })]);
    let parsed;
    try { parsed = JSON.parse(text); } catch { /* Non-JSON never leaves this function. */ }
    const error = parsed?.error;
    const message = typeof error?.message === 'string' ? error.message : typeof error === 'string' ? error : text;
    const normalized = message.toLowerCase();
    const messageClass = /\b(call|session)\b/.test(normalized) &&
      /\b(not found|does not exist|not active|already (closed|ended)|expired|unknown)\b/.test(normalized)
      ? 'call_unavailable'
      : /\b(api key|authentication|authorization|permission)\b/.test(normalized)
        ? 'authorization' : 'unclassified';
    return {bodyFormat: parsed !== undefined ? 'json' : text.trim() ? 'non_json' : 'empty',
      errorCode: CODES.has(error?.code) ? error.code : error?.code ? 'other' : null,
      errorType: TYPES.has(error?.type) ? error.type : error?.type ? 'other' : null,
      messageClass};
  } catch {
    return {bodyFormat:'unavailable', errorCode:null, errorType:null, messageClass:'unclassified'};
  } finally {
    clearTimeout(timer);
    // Cancellation must not extend this diagnostic's deadline. Its failure
    // cannot replace the original provider result or keep a request alive.
    if (reader) {
      try { void Promise.resolve(reader.cancel()).catch(() => {}); } catch { /* Diagnostic cleanup only. */ }
      try { reader.releaseLock(); } catch { /* Never replace the provider result. */ }
    }
  }
}
