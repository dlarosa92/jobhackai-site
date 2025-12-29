// Firebase client initialization for JobHackAI
// This module provides a lazy, idempotent initializer so importing it
// does not cause network requests or side-effects during first paint.

const firebaseConfig = {
  apiKey: "AIzaSyCDZksp8XpRJaYnoihiuXT5Uvd0YrbLdfw",
  authDomain: "jobhackai-90558.firebaseapp.com",
  projectId: "jobhackai-90558",
  storageBucket: "jobhackai-90558.firebasestorage.app",
  messagingSenderId: "40538124818",
  appId: "1:40538124818:web:cd61fc1d120ec79d4ddecb",
  measurementId: "G-X48E90B00S"
};

// Lazy, idempotent initialization helper that dynamically imports Firebase SDKs.
let _appPromise = null;
export default function initializeFirebase(options = { enableAnalytics: false }) {
  if (_appPromise) return _appPromise;

  _appPromise = (async () => {
    const { initializeApp, getApps, getApp } = await import("https://www.gstatic.com/firebasejs/12.1.0/firebase-app.js");
    const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

    if (options.enableAnalytics && typeof window !== 'undefined') {
      try {
        const { getAnalytics } = await import("https://www.gstatic.com/firebasejs/12.1.0/firebase-analytics.js");
        getAnalytics(app);
        console.debug('Deferred firebase analytics initialized');
      } catch (e) {
        console.debug('Deferred firebase analytics failed:', e && e.message);
      }
    }

    return app;
  })();

  return _appPromise;
}

// Export the static config for other modules that may need it (non-init use).
export { firebaseConfig };
