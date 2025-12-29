// Firebase client initialization for JobHackAI
// This module uses the official Firebase CDN ESM builds so it can be imported
// from browser pages. For Wix/Velo, you may adapt imports per Wix docs later.

// Import the functions you need from the SDKs you need
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-app.js";
import { getAnalytics } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-analytics.js";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyCDZksp8XpRJaYnoihiuXT5Uvd0YrbLdfw",
  authDomain: "jobhackai-90558.firebaseapp.com",
  projectId: "jobhackai-90558",
  storageBucket: "jobhackai-90558.firebasestorage.app",
  messagingSenderId: "40538124818",
  appId: "1:40538124818:web:cd61fc1d120ec79d4ddecb",
  measurementId: "G-X48E90B00S"
};

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
}

// Export for use across the site (and future Wix integration)
export { app, analytics, firebaseConfig };
