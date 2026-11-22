// Only public tool entry pages may be resumed after authentication.
// Never accept an external URL, query string, hash, or arbitrary app endpoint.
const TOOL_PATH = /^\/(?:linkedin-optimizer|interview-questions|resume-feedback-pro|cover-letter-generator|mock-interview|voice-interview)(?:\.html)?$/;
const STORAGE_KEY = 'jha-auth-tool-return-v1';
const MAX_AGE_MS = 30 * 60 * 1000;

export function safeToolReturnPath(value) {
  return typeof value === 'string' && value === value.trim() && TOOL_PATH.test(value) ? value : null;
}

export function createAuthToolReturn(location, storage, now = Date.now()) {
  if (storage === undefined) {
    try { storage = window.sessionStorage; } catch (_) { storage = null; }
  }
  const params = new URLSearchParams(location.search || '');
  let path = null;
  if (params.has('redirect')) {
    path = safeToolReturnPath(params.get('redirect'));
    try {
      if (path) storage?.setItem(STORAGE_KEY, JSON.stringify({ path, createdAt: now }));
      else storage?.removeItem(STORAGE_KEY);
    } catch (_) {}
  } else {
    try {
      const saved = JSON.parse(storage?.getItem(STORAGE_KEY) || 'null');
      if (saved && Number.isFinite(saved.createdAt) && now >= saved.createdAt && now - saved.createdAt < MAX_AGE_MS) {
        path = safeToolReturnPath(saved.path);
      }
      if (!path) storage?.removeItem(STORAGE_KEY);
    } catch (_) {}
  }
  return {
    hasDestination: Boolean(path),
    // Keep the resolved path in this document so concurrent auth callbacks
    // cannot replace a tool redirect with the dashboard after consumption.
    destination() {
      try { storage?.removeItem(STORAGE_KEY); } catch (_) {}
      return path || '/dashboard.html';
    },
    carryTo(target) {
      const url = new URL(target, location.href);
      if (path) url.searchParams.set('redirect', path);
      return url.pathname + url.search + url.hash;
    }
  };
}

// Firebase places ActionCodeSettings.url in the email link's continueUrl.
// Recover only our own verification route, never navigate to the supplied URL.
export function createVerificationToolReturn(location, storage, now = Date.now()) {
  const params = new URLSearchParams(location.search || '');
  if (params.get('mode') !== 'verifyEmail' || params.has('redirect') || !params.has('continueUrl')) {
    return createAuthToolReturn(location, storage, now);
  }
  let path = null;
  try {
    const current = new URL(location.href);
    const continuation = new URL(params.get('continueUrl'));
    if (['http:', 'https:'].includes(current.protocol)
        && continuation.origin === current.origin
        && !continuation.username && !continuation.password && !continuation.hash
        && /^\/auth\/action(?:\.html|\/|\/index\.html)?$/.test(continuation.pathname)) {
      path = safeToolReturnPath(continuation.searchParams.get('redirect'));
    }
  } catch (_) {}
  // An invalid explicit continuation must not revive an older saved intent.
  params.set('redirect', path || '');
  return createAuthToolReturn({ href: location.href, search: '?' + params.toString() }, storage, now);
}
