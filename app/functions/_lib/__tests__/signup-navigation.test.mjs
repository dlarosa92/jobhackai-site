import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../../../../js/login-page.js', import.meta.url), 'utf8');
function section(start, end) {
  const a = source.indexOf(start);
  const b = source.indexOf(end, a);
  assert.ok(a >= 0 && b > a);
  return source.slice(a, b);
}
const deferred = () => {
  let resolve;
  const promise = new Promise(r => { resolve = r; });
  return { promise, resolve };
};

// Run the actual page handlers together. Firebase publishes the signed-in user
// before verification mail/profile work resolves, as it did in production.
function harness({ fail = false } = {}) {
  const signup = deferred(), flush = deferred(), authReady = deferred();
  const events = [], timers = [], redirects = [];
  let authListener, submit, signups = 0;
  const values = new Map();
  const storage = { getItem: k => values.get(k) ?? null, removeItem: k => values.delete(k) };
  const fields = Object.fromEntries(Object.entries({
    firstName: 'Staff', lastName: 'Test', signupEmail: 'staff@example.test',
    signupPassword: 'Test-only-password-1', signupContinueBtn: '', acceptTerms: ''
  }).map(([id, value]) => [id, { value, checked: true, style: {}, textContent: 'Sign Up' }]));
  const user = { uid: 'staff-fixture', email: 'staff@example.test' };
  const location = { replace: v => redirects.push(v) };
  Object.defineProperty(location, 'href', { get: () => 'https://app.jobhackai.io/login', set: v => redirects.push(v) });
  const ctx = {
    URL, console: { log() {}, warn() {}, error() {} },
    document: { getElementById: id => fields[id] ?? null, body: { style: {} } },
    window: { location, FirebaseAuthManager: { isAuthReady: () => true }, JHA: {
      trackEventSafe: (...args) => events.push(args),
      cookieConsent: { flushAnalyticsBeforeNavigate: () => flush.promise }
    } },
    location, sessionStorage: storage, localStorage: storage,
    setTimeout: callback => timers.push(callback),
    waitForAuthReady: () => authReady.promise, AUTH_PENDING: Symbol('pending'),
    authManager: {
      onAuthStateChange: callback => { authListener = callback; return () => {}; },
      getCurrentUser: () => user,
      signUp: async () => {
        signups++;
        authListener(user);
        await signup.promise;
        if (fail) throw new Error('signup failed');
        return { success: true, user, verificationEmailSent: true };
      }
    },
    signupForm: { addEventListener: (_event, callback) => { submit = callback; } },
    selectedPlan: null, signupError: {},
    hideError() {}, showError: (_target, message) => events.push(['error', message]),
    isValidEmail: () => true, isStrongPassword: () => true,
    planRequiresPayment: () => false,
    recordTermsAcceptance: async () => events.push(['terms']),
    identifyUser: uid => events.push(['identity', uid])
  };
  vm.createContext(ctx);
  vm.runInContext('let loginInProgress = false;\n' +
    section('  const checkAuth = async () => {', '  // UX FIX: Run auth check') +
    section('  const unsubscribe = authManager.onAuthStateChange', '  // ===== FORM TOGGLING') +
    section('  signupForm?.addEventListener', '  // ===== FORGOT PASSWORD') +
    '\nthis.backgroundCheck = checkAuth;', ctx);
  return { signup, flush, authReady, events, redirects, fields,
    submit: () => submit({ preventDefault() {} }),
    publishAuth: () => authListener(user),
    runTimers: () => timers.splice(0).forEach(fn => fn()),
    backgroundCheck: ctx.backgroundCheck,
    get signups() { return signups; }, user };
}

test('signup owns navigation until account setup and analytics flush finish', async () => {
  const h = harness();
  const check = h.backgroundCheck(); // A restore check already waiting on Firebase.
  h.publishAuth(); // A passive redirect already queued before the submission.
  const attempt = h.submit();
  const duplicate = h.submit(); // A duplicate submit must not create a second account.
  h.authReady.resolve(h.user);
  await check;
  h.runTimers();
  assert.deepEqual(h.redirects, []);
  assert.equal(h.signups, 1);
  h.signup.resolve();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.events.filter(x => x[0] === 'sign_up').length, 1);
  assert.deepEqual(h.redirects, []); // Even after signup, wait for consented flush.
  h.flush.resolve();
  await Promise.all([attempt, duplicate]);
  assert.equal(h.redirects.length, 1);
  assert.match(h.redirects[0], /^\/verify-email\.html\?email=staff%40example\.test&sent=1$/);
});

test('failed signup unlocks retry and produces no signup conversion', async () => {
  const h = harness({ fail: true });
  const attempt = h.submit();
  h.signup.resolve();
  await attempt;
  h.runTimers();
  assert.deepEqual(h.redirects, []);
  assert.equal(h.events.filter(x => x[0] === 'sign_up').length, 0);
  assert.equal(h.fields.signupContinueBtn.disabled, false);
  await h.submit();
  assert.equal(h.signups, 2);
});

test('an ordinary restored login still redirects without reporting a signup', () => {
  const h = harness();
  h.publishAuth();
  h.runTimers();
  assert.deepEqual(h.redirects, ['dashboard.html']);
  assert.equal(h.events.filter(x => x[0] === 'sign_up').length, 0);
});

function initialFormFor(search) {
  const shown = [];
  const storage = { getItem: () => null, setItem() {}, removeItem() {} };
  const ctx = {
    URLSearchParams, Date,
    window: { location: { search } },
    sessionStorage: storage, localStorage: storage,
    resetPasswordSuccess: null,
    console: { log() {}, warn() {} },
    hideSelectedPlanBanner: () => {},
    showSelectedPlanBanner: () => {},
    showSignupForm: (...args) => shown.push(['signup', ...args]),
    showLoginForm: () => shown.push(['login']),
    getStoredFirebaseAuthRecord: () => null
  };
  vm.runInNewContext(section('  // === PLAN DETECTION', '  // === AUTH CHECK'), ctx);
  return shown;
}

test('signup CTA mode opens signup without a plan, preserving plan precedence', () => {
  assert.deepEqual(initialFormFor('?mode=signup&utm_source=pinterest'), [['signup']]);
  assert.deepEqual(initialFormFor('?mode=signup&plan=free'), [['signup', 'free', true]]);
  assert.deepEqual(initialFormFor('?mode=login'), [['login']]);
  assert.deepEqual(initialFormFor(''), [['login']]);
});
