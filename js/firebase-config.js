// Firebase client initialization for JobHackAI
// This module uses the official Firebase CDN ESM builds so it can be imported
// from browser pages. For Wix/Velo, you may adapt imports per Wix docs later.

// Import the functions you need from the SDKs you need
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-app.js";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Environment-specific Firebase configs (hostname-based)
// DEV & QA: jobhackai-90558 — dev.jobhackai.io, qa.jobhackai.io (QA uses dev project for now)
// PROD: jobhackai-prod — app.jobhackai.io (add when ready)
const configDev = {
  apiKey: "AIzaSyCDZksp8XpRJaYnoihiuXT5Uvd0YrbLdfw",
  authDomain: "jobhackai-90558.firebaseapp.com",
  projectId: "jobhackai-90558",
  storageBucket: "jobhackai-90558.firebasestorage.app",
  messagingSenderId: "40538124818",
  appId: "1:40538124818:web:cd61fc1d120ec79d4ddecb",
};

// Reserved for when QA uses its own Firebase project again
const configQA = {
  apiKey: "AIzaSyD5KLYGVOp6FJ_AcIocUcrBkk7WUjf_iQ0",
  authDomain: "jobhackai-true-qa.firebaseapp.com",
  projectId: "jobhackai-true-qa",
  storageBucket: "jobhackai-true-qa.firebasestorage.app",
  messagingSenderId: "556272888843",
  appId: "1:556272888843:web:bd77898b14234c55eaab0e"
};

// Production Firebase project: jobhackai-prod-510a4
const configProd = {
  apiKey: "AIzaSyB8YGpNFIhg_YBPiinNKZYcFHItlrsLFXA",
  authDomain: "jobhackai-prod-510a4.firebaseapp.com",
  projectId: "jobhackai-prod-510a4",
  storageBucket: "jobhackai-prod-510a4.firebasestorage.app",
  messagingSenderId: "580141511991",
  appId: "1:580141511991:web:986f9745b72f1e81d816b2",
  measurementId: "G-SQYSWPFM5X"
};

function selectFirebaseConfig() {
  if (typeof window === "undefined") return configDev;
  const h = window.location.hostname;
  if (h === "qa.jobhackai.io") return configDev;
  if (h === "app.jobhackai.io" || h === "jobhackai.io" || h === "www.jobhackai.io") return configProd;
  return configDev; // dev.jobhackai.io, localhost, etc.
}

const firebaseConfig = selectFirebaseConfig();

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// cookie-consent.js is the only analytics loader. Initializing Firebase
// Analytics here would configure a second tag/page view and bypass the
// hostname destination guard. Keep the export for legacy imports.
const analytics = null;

// Export for use across the site (and future Wix integration)
export { app, analytics, firebaseConfig };
