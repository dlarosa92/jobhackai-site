// Firebase client initialization for JobHackAI
// This module uses the official Firebase CDN ESM builds so it can be imported
// from browser pages. For Wix/Velo, you may adapt imports per Wix docs later.

// Import the functions you need from the SDKs you need
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-app.js";
import { getAnalytics, setAnalyticsCollectionEnabled } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-analytics.js";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Environment-specific Firebase configs (hostname-based)
// DEV: jobhackai-qa (jobhackai-90558) — dev.jobhackai.io
// QA:  jobhackai-true-qa — qa.jobhackai.io
// PROD: jobhackai-prod — app.jobhackai.io (add when ready)
const configDev = {
  apiKey: "AIzaSyCDZksp8XpRJaYnoihiuXT5Uvd0YrbLdfw",
  authDomain: "jobhackai-90558.firebaseapp.com",
  projectId: "jobhackai-90558",
  storageBucket: "jobhackai-90558.firebasestorage.app",
  messagingSenderId: "40538124818",
  appId: "1:40538124818:web:cd61fc1d120ec79d4ddecb",
  measurementId: "G-X48E90B00S"
};

const configQA = {
  apiKey: "AIzaSyD5KLYGV0p6FJ_AcIocUcrBkk7WUjf_iQ0",
  authDomain: "jobhackai-true-qa.firebaseapp.com",
  projectId: "jobhackai-true-qa",
  storageBucket: "jobhackai-true-qa.firebasestorage.app",
  messagingSenderId: "556272888843",
  appId: "1:556272888843:web:bd77898b14234c55eaab0e"
  // measurementId optional — add if QA has Analytics
};

function selectFirebaseConfig() {
  if (typeof window === "undefined") return configDev;
  const h = window.location.hostname;
  if (h === "qa.jobhackai.io") return configQA;
  if (h === "app.jobhackai.io") return configDev; // TODO: swap for configProd when ready
  return configDev; // dev.jobhackai.io, localhost, etc.
}

const firebaseConfig = selectFirebaseConfig();

if (typeof window !== 'undefined') {
  window.firebaseConfig = firebaseConfig;
}

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Conditionally initialize Analytics only in browser environment and with consent
let analytics = null;

function initializeAnalyticsIfConsented() {
  if (typeof window === 'undefined' || analytics !== null) {
    return; // Already initialized or not in browser
  }
  
  try {
    // Only initialize if measurementId is valid AND user has granted analytics consent
    if (firebaseConfig.measurementId) {
      // Check for analytics consent before initializing
      // Use defensive check - cookie-consent.js might not be loaded yet
      const hasConsent = window.JHA?.cookieConsent?.hasAnalyticsConsent?.() === true;
      if (hasConsent) {
        analytics = getAnalytics(app);
        try {
          // Ensure collection is enabled when consent granted
          setAnalyticsCollectionEnabled(analytics, true);
        } catch (e) {
          // setAnalyticsCollectionEnabled may not be supported in some environments; ignore
        }
        console.log('✅ Firebase Analytics initialized');
      } else {
        console.log('ℹ️ Firebase Analytics not initialized - no consent');
      }
    }
  } catch (error) {
    // Analytics initialization failed - log but don't block app
    console.log('ℹ️ Firebase Analytics not available:', error.message);
    analytics = null;
  }
}

// Try to initialize immediately if in browser
if (typeof window !== 'undefined') {
  initializeAnalyticsIfConsented();
  
  // Also listen for consent changes (if cookie-consent.js loads later)
  // This allows analytics to initialize if user grants consent after page load
  window.addEventListener('cookie-consent-granted', initializeAnalyticsIfConsented);
  // When consent is revoked, disable analytics collection immediately
  window.addEventListener('cookie-consent-revoked', () => {
    try {
      if (analytics) {
        setAnalyticsCollectionEnabled(analytics, false);
        console.log('ℹ️ Firebase Analytics collection disabled due to consent revoke');
      }
    } catch (e) {
      console.warn('Could not disable analytics collection:', e);
    }

    // Replace gtag with a noop to prevent further data pushes until consent is re-granted.
    try {
      if (window.gtag && !window._original_gtag) {
        window._original_gtag = window.gtag;
      }
      if (window._original_gtag) {
        window.gtag = function() { console.log('[COOKIE-CONSENT] gtag call blocked due to revoked consent'); };
        window._gtag_blocked = true;
      }
    } catch (e) {
      /* ignore */
    }
  });

  // When consent is re-granted, re-enable collection and restore gtag if possible
  window.addEventListener('cookie-consent-granted', () => {
    try {
      if (analytics) {
        setAnalyticsCollectionEnabled(analytics, true);
        console.log('ℹ️ Firebase Analytics collection enabled due to consent grant');
      }
    } catch (e) {
      /* ignore */
    }

    try {
      if (window._gtag_blocked && window._original_gtag) {
        window.gtag = window._original_gtag;
        window._gtag_blocked = false;
        delete window._original_gtag;
      }
    } catch (e) {
      /* ignore */
    }
  });
}

// Export for use across the site (and future Wix integration)
export { app, analytics, firebaseConfig };
