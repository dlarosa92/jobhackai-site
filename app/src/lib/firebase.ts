import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';

export const firebaseConfig = {
  // Use env vars when present; fall back to known QA project values to avoid build-time injection issues
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY || 'AIzaSyCDZksp8XpRJaYnoihiuXT5Uvd0YrbLdfw',
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || 'jobhackai-90558.firebaseapp.com',
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || 'jobhackai-90558',
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || 'jobhackai-90558.firebasestorage.app',
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || '40538124818',
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID || '1:40538124818:web:cd61fc1d120ec79d4ddecb',
};

// Avoid initializing Firebase Auth during SSR/static build to prevent build-time errors
const isBrowser = typeof window !== 'undefined';
const app = isBrowser ? (getApps().length ? getApp() : initializeApp(firebaseConfig)) : undefined;

// Export auth only on client; on server it will be a benign null (typed as any)
export const auth: any = isBrowser && app ? getAuth(app) : null;

export default app;
