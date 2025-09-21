import { FirebaseApp, getApp, getApps, initializeApp } from 'firebase/app';
import { Auth, getAuth } from 'firebase/auth';

export const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY || '',
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || '',
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || '',
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || '',
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || '',
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID || '',
};

let clientApp: FirebaseApp | undefined;
let clientAuth: Auth | null = null;

if (typeof window !== 'undefined') {
  const hasConfig = Boolean(firebaseConfig.apiKey);

  if (!hasConfig) {
    console.warn('Firebase configuration is missing NEXT_PUBLIC_* environment variables.');
  } else {
    clientApp = getApps().length ? getApp() : initializeApp(firebaseConfig);
    clientAuth = getAuth(clientApp);
  }
}

export const app = clientApp;
export const auth = clientAuth;

export default clientApp;
