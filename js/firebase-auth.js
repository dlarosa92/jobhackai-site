/**
 * Firebase Authentication Module for JobHackAI
 * Handles secure user authentication with Firebase Auth
 * Supports: Email/Password, Google Sign-In
 */

// Version stamp for deployment verification
console.log('🔧 firebase-auth.js VERSION: redirect-fix-v3-CACHE-BUST-FIX - ' + new Date().toISOString());

import { firebaseConfig } from './firebase-config.js';

import UserProfileManager from './firestore-profiles.js';
// Import Firebase Auth functions
import { 
  getAuth, 
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword,
  signInWithPopup,
  GoogleAuthProvider,
  onAuthStateChanged,
  signOut,
  sendPasswordResetEmail,
  updateProfile,
  setPersistence,
  browserLocalPersistence,
  sendEmailVerification,
  applyActionCode,
  checkActionCode,
  verifyPasswordResetCode,
  confirmPasswordReset
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";

import { initializeApp } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-app.js";

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

// --- DIRECT KV PLAN FETCH (navigation-independent) ---
async function fetchPlanDirectFromKV() {
  try {
    const user = auth.currentUser;
    if (!user) {
      console.log('🔍 fetchPlanDirectFromKV: no currentUser');
      return null;
    }
    const idToken = await user.getIdToken();
    if (!idToken) {
      console.log('🔍 fetchPlanDirectFromKV: no idToken');
      return null;
    }
    console.log(`🔍 fetchPlanDirectFromKV: calling /api/plan/me for uid=${user.uid}`);
    const res = await fetch('/api/plan/me', { headers: { Authorization: `Bearer ${idToken}` } });
    if (!res.ok) {
      console.log(`🔍 fetchPlanDirectFromKV: API returned ${res.status}`);
      return null;
    }
    const data = await res.json();
    console.log(`📊 fetchPlanDirectFromKV: API returned plan="${data?.plan}"`);
    return data?.plan || null;
  } catch (e) {
    console.warn('❌ Direct KV fetch failed:', e);
    return null;
  }
}

// Set persistence to local (stays logged in across sessions)
setPersistence(auth, browserLocalPersistence).catch((error) => {
  console.error('Error setting persistence:', error);
});

// Google Auth Provider
const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({
  prompt: 'select_account'
});

/**
 * User Database Management
 * Integrates with existing localStorage user database
 */
class UserDatabase {
  static DB_KEY = 'user-db';
  static BACKUP_KEY = 'user-db-backup';

  static getDB() {
    try {
      const data = localStorage.getItem(this.DB_KEY);
      return data ? JSON.parse(data) : {};
    } catch (error) {
      console.error('Error loading user database:', error);
      return {};
    }
  }

  static saveDB(db) {
    try {
      localStorage.setItem(this.DB_KEY, JSON.stringify(db));
      localStorage.setItem(this.BACKUP_KEY, JSON.stringify(db));
    } catch (error) {
      console.error('Error saving user database:', error);
    }
  }

  static createOrUpdateUser(email, userData = {}) {
    const db = this.getDB();
    
    if (!db[email]) {
      // Create new user
      db[email] = {
        plan: userData.plan || 'free',
        firstName: userData.firstName || '',
        lastName: userData.lastName || '',
        cards: [],
        created: new Date().toISOString(),
        lastLogin: new Date().toISOString(),
        firebaseUid: userData.uid || null
      };
    } else {
      // Update existing user
      db[email].lastLogin = new Date().toISOString();
      if (userData.firstName) db[email].firstName = userData.firstName;
      if (userData.lastName) db[email].lastName = userData.lastName;
      if (userData.uid) db[email].firebaseUid = userData.uid;
      if (userData.plan) db[email].plan = userData.plan;
    }
    
    this.saveDB(db);
    return db[email];
  }

  static getUser(email) {
    const db = this.getDB();
    return db[email] || null;
  }
}

/**
 * Authentication Manager
 */
class AuthManager {
  constructor() {
    this.currentUser = null;
    this.authStateListeners = [];
    this.setupAuthStateListener();
    // Expose globally for consumers that can't import modules
    try { 
      window.FirebaseAuthManager = this;
      // Also expose currentUser directly for easier access
      window.FirebaseAuthManager.currentUser = this.currentUser;
    } catch (_) { /* no-op */ }
  }

  // Initialize free ATS credit for new users
  async initializeFreeATSCredit(uid) {
    try {
      // Check if credit already initialized
      const creditKey = `creditsByUid:${uid}`;
      const existing = localStorage.getItem(creditKey);
      
      if (existing) {
        console.log('✅ ATS credit already initialized');
        return JSON.parse(existing);
      }
      
      // Initialize 1 lifetime credit
      const credits = { ats_free_lifetime: 1 };
      localStorage.setItem(creditKey, JSON.stringify(credits));
      console.log('✅ Initialized 1 free lifetime ATS credit');
      
      return credits;
    } catch (e) {
      console.warn('Failed to initialize ATS credit:', e);
      return { ats_free_lifetime: 0 };
    }
  }

  setupAuthStateListener() {
    let authReadyDispatched = false;
    
    onAuthStateChanged(auth, async (user) => {
      console.log('🔥 Firebase auth state changed:', user ? `User: ${user.email}` : 'No user');
      this.currentUser = user;
      // Update the exposed currentUser property
      if (window.FirebaseAuthManager) {
        window.FirebaseAuthManager.currentUser = user;
        console.log('🔥 Updated window.FirebaseAuthManager.currentUser:', user ? `User: ${user.email}` : 'null');
      }
      
      // Dispatch firebase-auth-ready event on first auth state change
      if (!authReadyDispatched) {
        authReadyDispatched = true;
        console.log('🔥 Dispatching firebase-auth-ready event');
        document.dispatchEvent(new CustomEvent("firebase-auth-ready", {
          detail: { user: user || null }
        }));
      }
      
      if (user) {
        // ✅ CRITICAL: Set localStorage IMMEDIATELY (sync, before any await)
        // This prevents race conditions with static-auth-guard.js
        localStorage.setItem('user-authenticated', 'true');
        localStorage.setItem('user-email', user.email || '');
        localStorage.setItem('auth-user', JSON.stringify({
          email: user.email,
          uid: user.uid,
          displayName: user.displayName
        }));
        console.log('✅ localStorage synced immediately for auth guards');
        
        // User is signed in - now do async operations
        // Initialize free ATS credit for new users
        await this.initializeFreeATSCredit(user.uid);
        
        const userData = {
          uid: user.uid,
          email: user.email,
          firstName: user.displayName ? user.displayName.split(' ')[0] : '',
          lastName: user.displayName ? user.displayName.split(' ').slice(1).join(' ') : '',
        };
        
        
        // Sync with Firestore (update last login)
        UserProfileManager.updateLastLogin(user.uid).catch(err => {
          console.warn('Could not update last login in Firestore:', err);
        });
        
        // CRITICAL: Prioritize fresh plan selections over existing plans
        let pendingSelection = null;
        let pendingTs = 0;
        try {
          const stored = sessionStorage.getItem('selectedPlan');
          if (stored) {
            const data = JSON.parse(stored);
            pendingSelection = data.planId;
            pendingTs = data.timestamp || 0;
          }
        } catch (e) {
          console.warn('Failed to parse selectedPlan from sessionStorage:', e);
        }
        const isFreshSelection = Date.now() - pendingTs < 2 * 60 * 1000; // 2 minutes
        
        let actualPlan = 'free';
        
        if (pendingSelection && pendingSelection !== 'free' && isFreshSelection) {
          actualPlan = pendingSelection === 'trial' ? 'pending' : pendingSelection;
          console.log('✅ Using fresh plan selection in auth listener:', actualPlan);
        } else {
          // FIX: Wait for auth to be ready before fetching plan to prevent race condition
          let kvPlan = null;
          try {
            // Wait for Firebase auth to be fully ready (max 3 seconds)
            console.log('🔄 Waiting for Firebase auth to be ready before plan fetching...');
            await this.waitForAuthReady(3000);
            
            if (window.JobHackAINavigation && typeof window.JobHackAINavigation.fetchKVPlan === 'function') {
              kvPlan = await window.JobHackAINavigation.fetchKVPlan();
              if (kvPlan) console.log('✅ Fetched plan via navigation system:', kvPlan);
            }
            // Fallback: fetch directly from KV if navigation not ready
            if (!kvPlan) {
              kvPlan = await fetchPlanDirectFromKV();
              if (kvPlan) console.log('✅ Fetched plan directly from KV (navigation not ready):', kvPlan);
            }
          } catch (e) {
            console.warn('Could not fetch plan from KV:', e);
            // Add retry mechanism for failed KV fetches
            try {
              console.log('🔄 Retrying plan fetch after 1 second...');
              await new Promise(resolve => setTimeout(resolve, 1000));
              if (window.JobHackAINavigation && typeof window.JobHackAINavigation.fetchKVPlan === 'function') {
                kvPlan = await window.JobHackAINavigation.fetchKVPlan();
              }
              if (!kvPlan) {
                kvPlan = await fetchPlanDirectFromKV();
              }
              if (kvPlan) console.log('✅ Retry successful, fetched plan:', kvPlan);
            } catch (retryError) {
              console.warn('Retry also failed:', retryError);
            }
          }
          
          if (kvPlan && kvPlan !== 'free') {
            actualPlan = kvPlan;
            console.log('✅ Retrieved user plan from KV:', actualPlan);
          } else {
            console.log('⚠️ KV fetch failed, falling back to Firestore/local storage');
            const profileResult = await UserProfileManager.getProfile(user.uid);
            if (profileResult.success && profileResult.profile) {
              actualPlan = profileResult.profile.plan || 'free';
              console.log('✅ Retrieved user plan from Firestore (KV fallback):', actualPlan);
            } else {
              const userRecord = UserDatabase.getUser(user.email);
              if (userRecord) {
                actualPlan = userRecord.plan || 'free';
                console.log('✅ Retrieved user plan from local database (Firestore fallback):', actualPlan);
              } else {
                console.log('⚠️ All plan sources failed, defaulting to free');
                // FIX: Add delayed retry for plan reconciliation
                console.log('🔄 Scheduling delayed plan reconciliation in 5 seconds...');
                setTimeout(async () => {
                  try {
                    console.log('🔄 Attempting delayed plan reconciliation...');
                    const delayedKvPlan = await window.JobHackAINavigation?.fetchKVPlan?.();
                    if (delayedKvPlan && delayedKvPlan !== 'free') {
                      console.log('✅ Delayed reconciliation successful:', delayedKvPlan);
                      localStorage.setItem('user-plan', delayedKvPlan);
                      localStorage.setItem('dev-plan', delayedKvPlan);
                      if (window.JobHackAINavigation) {
                        window.JobHackAINavigation.updateNavigation();
                      }
                    }
                  } catch (e) {
                    console.warn('Delayed reconciliation failed:', e);
                  }
                }, 5000);
              }
            }
          }
        }
        
        // Update local database with correct plan
        const userRecord = UserDatabase.createOrUpdateUser(user.email, {
          ...userData,
          plan: actualPlan
        });
        
        // Update navigation state with correct plan
        if (window.JobHackAINavigation) {
          window.JobHackAINavigation.setAuthState(true, actualPlan);
        }
        
        // Notify listeners
        this.notifyAuthStateChange(user, userRecord);
      } else {
        // User is signed out - clear immediately
        localStorage.setItem('user-authenticated', 'false');
        localStorage.removeItem('user-email');
        localStorage.removeItem('auth-user');
        
        if (window.JobHackAINavigation) {
          window.JobHackAINavigation.setAuthState(false, 'visitor');
        }
        
        this.notifyAuthStateChange(null, null);
      }
    });
  }

  notifyAuthStateChange(user, userRecord) {
    this.authStateListeners.forEach(listener => {
      try {
        listener(user, userRecord);
      } catch (error) {
        console.error('Error in auth state listener:', error);
      }
    });
  }

  onAuthStateChange(callback) {
    this.authStateListeners.push(callback);
    
    // Immediately call with current state
    if (this.currentUser) {
      const userRecord = UserDatabase.getUser(this.currentUser.email);
      callback(this.currentUser, userRecord);
    }
  }

  /**
   * Sign up with email and password
   */
  async signUp(email, password, firstName, lastName) {
    try {
      // Create user account
      const userCredential = await createUserWithEmailAndPassword(auth, email, password);
      const user = userCredential.user;

      // Update profile with name
      if (firstName || lastName) {
        await updateProfile(user, {
          displayName: `${firstName} ${lastName}`.trim()
        });
      }

      // Send email verification for password-based signups
      try {
        // Get the base URL for action handler
        const actionUrl = `${window.location.protocol}//${window.location.host}/auth/action`;
        await sendEmailVerification(user, {
          url: actionUrl,
          handleCodeInApp: true
        });
        console.log('📧 Verification email sent to', user.email);
      } catch (e) {
        console.warn('Could not send verification email:', e);
      }

      // Create user record in local database
      const selectedPlan = this.getSelectedPlan();
      const userData = {
        uid: user.uid,
        firstName: firstName || '',
        lastName: lastName || '',
        plan: selectedPlan || 'free'
      };
      
      UserDatabase.createOrUpdateUser(email, userData);

      // Initialize free account tracking for new free users
      if (userData.plan === 'free') {
        if (window.freeAccountManager) {
          window.freeAccountManager.initializeForNewUser();
        }
      }

      // Create Firestore profile (non-blocking to prevent sign-up hanging)
      const firestoreData = {
        email: email,
        displayName: `${firstName} ${lastName}`.trim(),
        firstName: firstName || '',
        lastName: lastName || '',
        plan: selectedPlan === 'trial' ? 'pending' : (selectedPlan || 'free'), // Don't set trial immediately, wait for webhook
        signupSource: 'email_password',
        pendingPlan: selectedPlan === 'trial' ? 'trial' : null // Track what they selected
      };

      // Fire-and-forget with timeout to prevent hanging
      Promise.race([
        UserProfileManager.createProfile(user.uid, firestoreData),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Firestore profile creation timeout')), 5000))
      ]).catch(err => {
        console.warn('Could not create Firestore profile (will retry on next login):', err);
      });

      // Ensure navigation/auth state is in sync immediately to prevent race conditions
      if (window.JobHackAINavigation) {
        try {
          window.JobHackAINavigation.setAuthState(true, userData.plan || 'free');
        } catch (e) {
          console.warn('setAuthState failed during signUp:', e);
        }
      }
      return { success: true, user };
    } catch (error) {
      console.error('Sign up error:', error);
      return { success: false, error: this.getErrorMessage(error) };
    }
  }

  /**
   * Sign in with email and password
   */
  async signIn(email, password) {
    try {
      const userCredential = await signInWithEmailAndPassword(auth, email, password);
      const user = userCredential.user;

      // CRITICAL: Retrieve user's actual plan from KV first, then Firestore
      let actualPlan = 'free'; // default fallback
      
      // FIX: Wait for auth to be ready before fetching plan to prevent race condition
      let kvPlan = null;
      try {
        // Wait for Firebase auth to be fully ready (max 3 seconds)
        console.log('🔄 Waiting for Firebase auth to be ready during sign-in...');
        await this.waitForAuthReady(3000);
        
        if (window.JobHackAINavigation && typeof window.JobHackAINavigation.fetchKVPlan === 'function') {
          kvPlan = await window.JobHackAINavigation.fetchKVPlan();
          if (kvPlan) console.log('✅ Fetched plan via navigation system during sign-in:', kvPlan);
        }
        // Fallback: fetch directly from KV if navigation not ready
        if (!kvPlan) {
          kvPlan = await fetchPlanDirectFromKV();
          if (kvPlan) console.log('✅ Fetched plan directly from KV during sign-in:', kvPlan);
        }
      } catch (e) {
        console.warn('Could not fetch plan from KV during sign-in:', e);
        // Add retry mechanism for failed KV fetches
        try {
          console.log('🔄 Retrying plan fetch during sign-in after 1 second...');
          await new Promise(resolve => setTimeout(resolve, 1000));
          if (window.JobHackAINavigation && typeof window.JobHackAINavigation.fetchKVPlan === 'function') {
            kvPlan = await window.JobHackAINavigation.fetchKVPlan();
          }
          if (!kvPlan) {
            kvPlan = await fetchPlanDirectFromKV();
          }
          if (kvPlan) console.log('✅ Retry successful during sign-in, fetched plan:', kvPlan);
        } catch (retryError) {
          console.warn('Retry also failed during sign-in:', retryError);
        }
      }
      
      if (kvPlan && kvPlan !== 'free') {
        actualPlan = kvPlan;
        console.log('✅ Retrieved user plan from KV during sign-in:', actualPlan);
      } else {
        console.log('⚠️ KV fetch failed during sign-in, falling back to Firestore/local storage');
        const profileResult = await UserProfileManager.getProfile(user.uid);
        if (profileResult.success && profileResult.profile) {
          actualPlan = profileResult.profile.plan || 'free';
          console.log('✅ Retrieved user plan from Firestore during sign-in (KV fallback):', actualPlan);
        } else {
          console.warn('⚠️ Could not retrieve profile from Firestore during sign-in, using local data');
          // Fallback to local database if Firestore fails
          const userRecord = UserDatabase.getUser(email);
          if (userRecord) {
            actualPlan = userRecord.plan || 'free';
            console.log('✅ Retrieved user plan from local database during sign-in:', actualPlan);
          } else {
            console.log('⚠️ All plan sources failed during sign-in, defaulting to free');
          }
        }
      }

      // Update local database with correct plan
      UserDatabase.createOrUpdateUser(email, { 
        uid: user.uid,
        plan: actualPlan
      });

      // Persist auth state immediately
      localStorage.setItem('user-email', user.email || '');
      localStorage.setItem('user-authenticated', 'true');
      // Update navigation state with correct plan
      if (window.JobHackAINavigation) {
        window.JobHackAINavigation.setAuthState(true, actualPlan);
      }

      return { success: true, user };
    } catch (error) {
      console.error('Sign in error:', error);
      return { success: false, error: this.getErrorMessage(error) };
    }
  }

  /**
   * Sign in with Google
   */
  async signInWithGoogle() {
    try {
      const result = await signInWithPopup(auth, googleProvider);
      const user = result.user;

      // Extract name from display name
      const nameParts = user.displayName ? user.displayName.split(' ') : ['', ''];
      
      // CRITICAL: Prioritize newly selected plan over existing plans
      const selectedPlan = this.getSelectedPlan();
      let actualPlan = 'free';

      if (selectedPlan && selectedPlan !== 'free') {
        actualPlan = selectedPlan === 'trial' ? 'pending' : selectedPlan;
        console.log('✅ Using newly selected plan for Google sign-in:', actualPlan);
      } else {
        // FIX: Wait for auth to be ready before fetching plan to prevent race condition
        let kvPlan = null;
        try {
          // Wait for Firebase auth to be fully ready (max 3 seconds)
          console.log('🔄 Waiting for Firebase auth to be ready during Google sign-in...');
          await this.waitForAuthReady(3000);
          
          if (window.JobHackAINavigation && typeof window.JobHackAINavigation.fetchKVPlan === 'function') {
            kvPlan = await window.JobHackAINavigation.fetchKVPlan();
            if (kvPlan) console.log('✅ Fetched plan via navigation system during Google sign-in:', kvPlan);
          }
          // Fallback: fetch directly from KV if navigation not ready
          if (!kvPlan) {
            kvPlan = await fetchPlanDirectFromKV();
            if (kvPlan) console.log('✅ Fetched plan directly from KV during Google sign-in:', kvPlan);
          }
        } catch (e) {
          console.warn('Could not fetch plan from KV during Google sign-in:', e);
          // Add retry mechanism for failed KV fetches
          try {
            console.log('🔄 Retrying plan fetch during Google sign-in after 1 second...');
            await new Promise(resolve => setTimeout(resolve, 1000));
            if (window.JobHackAINavigation && typeof window.JobHackAINavigation.fetchKVPlan === 'function') {
              kvPlan = await window.JobHackAINavigation.fetchKVPlan();
            }
            if (!kvPlan) {
              kvPlan = await fetchPlanDirectFromKV();
            }
            if (kvPlan) console.log('✅ Retry successful during Google sign-in, fetched plan:', kvPlan);
          } catch (retryError) {
            console.warn('Retry also failed during Google sign-in:', retryError);
          }
        }
        
        if (kvPlan && kvPlan !== 'free') {
          actualPlan = kvPlan;
          console.log('✅ Retrieved user plan from KV during Google sign-in:', actualPlan);
        } else {
          console.log('⚠️ KV fetch failed during Google sign-in, falling back to Firestore');
          const profileResult = await UserProfileManager.getProfile(user.uid);
          if (profileResult.success && profileResult.profile) {
            actualPlan = profileResult.profile.plan || 'free';
            console.log('✅ Retrieved user plan from Firestore during Google sign-in (KV fallback):', actualPlan);
          } else {
            console.log('⚠️ All plan sources failed during Google sign-in, defaulting to free');
          }
        }
      }
      
      const userData = {
        uid: user.uid,
        firstName: nameParts[0] || '',
        lastName: nameParts.slice(1).join(' ') || '',
        plan: actualPlan
      };

      UserDatabase.createOrUpdateUser(user.email, userData);

      // Ensure navigation/auth state is updated immediately (avoid redirect race)
      try {
        localStorage.setItem('user-email', user.email || '');
        localStorage.setItem('user-authenticated', 'true');
        if (window.JobHackAINavigation) {
          window.JobHackAINavigation.setAuthState(true, actualPlan);
        }
      } catch (e) {
        console.warn('auth state persist failed during Google sign-in:', e);
      }

      // Initialize free account tracking for new free users
      if (userData.plan === 'free') {
        if (window.freeAccountManager) {
          window.freeAccountManager.initializeForNewUser();
        }
      }

      // Create or update Firestore profile
      const firestoreData = {
        email: user.email,
        displayName: user.displayName || '',
        firstName: nameParts[0] || '',
        lastName: nameParts.slice(1).join(' ') || '',
        photoURL: user.photoURL || null,
        plan: selectedPlan === 'trial' ? 'pending' : (selectedPlan || 'free'), // Don't set trial immediately, wait for webhook
        signupSource: 'google_oauth',
        pendingPlan: selectedPlan === 'trial' ? 'trial' : null // Track what they selected
      };
      
      try {
        await UserProfileManager.upsertProfile(user.uid, firestoreData);
      } catch (err) {
        console.warn('Could not sync Firestore profile:', err);
      }

      return { success: true, user };
    } catch (error) {
      console.error('Google sign in error:', error);
      
      // Handle popup closed by user
      if (error.code === 'auth/popup-closed-by-user' || error.code === 'auth/cancelled-popup-request') {
        return { success: false, error: null }; // Silent failure
      }
      
      return { success: false, error: this.getErrorMessage(error) };
    }
  }

  /**
   * Sign out
   */
  async signOut() {
    try {
      await signOut(auth);
      
      // Clear local storage
      localStorage.removeItem('auth-user');
      localStorage.removeItem('user-plan');
      localStorage.removeItem('user-email');
      localStorage.setItem('user-authenticated', 'false');

      // Remove Firebase SDK cached user keys to avoid automatic re-login from persistence
      try {
        for (let i = localStorage.length - 1; i >= 0; i--) {
          const key = localStorage.key(i);
          if (key && key.startsWith('firebase:authUser:')) {
            localStorage.removeItem(key);
          }
        }
      } catch (_) { /* no-op */ }

      // Sync navigation if available
      if (window.JobHackAINavigation && typeof window.JobHackAINavigation.setAuthState === 'function') {
        window.JobHackAINavigation.setAuthState(false, 'visitor');
      }
      
      return { success: true };
    } catch (error) {
      console.error('Sign out error:', error);
      return { success: false, error: this.getErrorMessage(error) };
    }
  }

  /**
   * Send password reset email
   */
  async resetPassword(email) {
    try {
      // Get the base URL for action handler
      const actionUrl = `${window.location.protocol}//${window.location.host}/auth/action`;
      await sendPasswordResetEmail(auth, email, {
        url: actionUrl,
        handleCodeInApp: true
      });
      return { success: true };
    } catch (error) {
      console.error('Password reset error:', error);
      return { success: false, error: this.getErrorMessage(error) };
    }
  }

  /**
   * Get selected plan from URL or sessionStorage
   */
  getSelectedPlan() {
    const urlParams = new URLSearchParams(window.location.search);
    const urlPlan = urlParams.get('plan');
    if (urlPlan) return urlPlan;
    
    // Check sessionStorage for plan (pricing page stores it here as JSON)
    try {
      const stored = sessionStorage.getItem('selectedPlan');
      if (stored) {
        const data = JSON.parse(stored);
        return data.planId || null;
      }
    } catch (e) {
      console.warn('Failed to parse selectedPlan from sessionStorage:', e);
    }
    
    return null;
  }

  /**
   * Convert Firebase error codes to user-friendly messages
   */
  getErrorMessage(error) {
    const errorMessages = {
      'auth/email-already-in-use': 'This email is already registered. Please sign in instead.',
      'auth/invalid-email': 'Please enter a valid email address.',
      'auth/operation-not-allowed': 'This sign-in method is not enabled. Please contact support.',
      'auth/weak-password': 'Password should be at least 8 characters long.',
      'auth/user-disabled': 'This account has been disabled. Please contact support.',
      'auth/user-not-found': 'No account found with this email. Please sign up.',
      'auth/wrong-password': 'Incorrect password. Please try again.',
      'auth/too-many-requests': 'Too many failed attempts. Please try again later.',
      'auth/network-request-failed': 'Network error. Please check your connection.',
      'auth/popup-blocked': 'Popup was blocked. Please allow popups for this site.',
      'auth/account-exists-with-different-credential': 'An account already exists with this email using a different sign-in method.',
    };

    return errorMessages[error.code] || 'An error occurred. Please try again.';
  }

  /**
   * Get current user
   */
  getCurrentUser() {
    return this.currentUser;
  }

  /**
   * Wait for auth state to be ready
   */
  async waitForAuthReady(timeoutMs = 5000) {
    const startTime = Date.now();
    console.log('🔥 waitForAuthReady started, currentUser:', this.currentUser);
    
    while (!this.currentUser && (Date.now() - startTime) < timeoutMs) {
      await new Promise(resolve => setTimeout(resolve, 100));
      if ((Date.now() - startTime) % 1000 < 100) { // Log every second
        console.log('🔥 waitForAuthReady waiting... currentUser:', this.currentUser);
      }
    }
    
    console.log('🔥 waitForAuthReady finished, currentUser:', this.currentUser);
    return this.currentUser;
  }

  /**
   * Check if user is authenticated
   */
  isAuthenticated() {
    return !!this.currentUser;
  }

  /**
   * Returns true if this Firebase user signed up with email/password
   * (vs google.com etc.)
   */
  isEmailPasswordUser(user) {
    if (!user || !user.providerData) return false;
    return user.providerData.some(p => p.providerId === 'password');
  }

  /**
   * Send (or resend) a verification email to the current user
   */
  async sendVerificationEmail() {
    try {
      const user = this.getCurrentUser();
      if (!user) {
        return { success: false, error: 'No authenticated user.' };
      }
      // Get the base URL for action handler
      const actionUrl = `${window.location.protocol}//${window.location.host}/auth/action`;
      await sendEmailVerification(user, {
        url: actionUrl,
        handleCodeInApp: true
      });
      return { success: true };
    } catch (err) {
      console.warn('sendVerificationEmail error:', err);
      return { success: false, error: this.getErrorMessage(err) || 'Could not send verification email.' };
    }
  }

  /**
   * Require verified email - redirects if not authenticated or not verified
   * Used to gate access to dashboard and other protected pages
   */
  async requireVerifiedEmail() {
    try {
      // Wait for auth to be ready
      const user = await this.waitForAuthReady(4000);
      
      if (!user) {
        console.log('No authenticated user, redirecting to login');
        window.location.href = '/login.html';
        return false;
      }
      
      // Reload user to get latest verification status
      await user.reload();
      
      if (!user.emailVerified) {
        console.log('User not verified, redirecting to verify-email');
        window.location.href = `/verify-email.html?email=${encodeURIComponent(user.email || '')}`;
        return false;
      }
      
      console.log('User verified, allowing access');
      return true;
    } catch (error) {
      console.error('requireVerifiedEmail error:', error);
      window.location.href = '/login.html';
      return false;
    }
  }
}

// Create singleton instance
const authManager = new AuthManager();

// Export for use in pages
export default authManager;
export { auth, UserDatabase };
// Back-compat: some modules import named waitForAuthReady; provide a proxy
export async function waitForAuthReady(timeoutMs = 5000) {
  return authManager.waitForAuthReady(timeoutMs);
}

