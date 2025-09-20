import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';

export const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY!,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || '',
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || '',
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || '',
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || '',
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID || '',
};

// Avoid initializing Firebase Auth during SSR/static build to prevent build-time errors
const isBrowser = typeof window !== 'undefined';
const app = isBrowser ? (getApps().length ? getApp() : initializeApp(firebaseConfig)) : undefined;

// Export auth only on client; on server it will be a benign null (typed as any)
export const auth: any = isBrowser && app ? getAuth(app) : null;

export default app;
