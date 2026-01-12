/**
 * Firebase Authentication Module for JobHackAI
 * Handles secure user authentication with Firebase Auth
 * Supports: Email/Password, Google Sign-In
 */

// Version stamp for deployment verification
console.log('🔧 firebase-auth.js VERSION: auth-tri-state-v1 - ' + new Date().toISOString());

import { firebaseConfig } from './firebase-config.js';

import UserProfileManager from './firestore-profiles.js';
import { storeTokens, clearTokens, isAuthenticated as tokenManagerIsAuthenticated, getIdTokenSync } from './token-manager.js';
import { apiFetchJSON } from './api-fetch.js';
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
  confirmPasswordReset,
  OAuthProvider,
  signInWithCredential
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";

import { initializeApp } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-app.js";

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

// --- DIRECT PLAN FETCH FROM D1 VIA API (navigation-independent) ---
async function fetchPlanFromAPI() {
  try {
    const user = auth.currentUser;
    if (!user) {
      console.log('🔍 fetchPlanFromAPI: no currentUser');
      return null;
    }
    const idToken = await user.getIdToken();
    if (!idToken) {
      console.log('🔍 fetchPlanFromAPI: no idToken');
      return null;
    }
    console.log(`🔍 fetchPlanFromAPI: calling /api/plan/me for uid=${user.uid}`);
    const res = await fetch('/api/plan/me', { headers: { Authorization: `Bearer ${idToken}` } });
    if (!res.ok) {
      console.log(`🔍 fetchPlanFromAPI: API returned ${res.status}`);
      return null;
    }
    const data = await res.json();
    console.log(`📊 fetchPlanFromAPI: API returned plan="${data?.plan}"`);
    return data?.plan || null;
  } catch (e) {
    // API fetch failed - this is non-critical, will fallback to 'free'
    console.log('ℹ️ Direct plan API fetch unavailable, will use fallback:', e.message || 'network error');
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
 * Decode JWT token to extract payload (for LinkedIn token restoration)
 */
function decodeJwtPayload(token) {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payload = parts[1];
    // Base64URL decode - add padding before calling atob()
    let base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    // Add padding (Base64URL doesn't include padding, but atob() requires it)
    while (base64.length % 4) {
      base64 += '=';
    }
    const decoded = atob(base64);
    return JSON.parse(decoded);
  } catch (e) {
    console.error('Failed to decode JWT:', e);
    return null;
  }
}

/**
 * Authentication Manager
 */
class AuthManager {
  constructor() {
    this.currentUser = null;
    this.authStateListeners = [];
    // Tri-state auth pattern: null = unknown, user object = authenticated, false = explicitly unauthenticated
    this._authReady = false; // Flag indicating Firebase has resolved initial auth state
    this._authReadyPromise = null;
    this._authReadyResolver = null;
    this._initializeAuthReady();
    this.setupAuthStateListener();
    // Expose globally for consumers that can't import modules
    try { 
      window.FirebaseAuthManager = this;
      // Also expose currentUser directly for easier access
      window.FirebaseAuthManager.currentUser = this.currentUser;
    } catch (_) { /* no-op */ }
  }

  /**
   * Initialize the auth ready promise/resolver for tri-state pattern
   */
  _initializeAuthReady() {
    this._authReadyPromise = new Promise((resolve) => {
      this._authReadyResolver = resolve;
    });
  }

  /**
   * Mark auth as ready and resolve waiting promises
   * Called when Firebase onAuthStateChanged fires for the first time
   */
  _markAuthReady(user) {
    if (this._authReady) {
      // Already marked as ready, just update currentUser
      return;
    }
    this._authReady = true;
    this.currentUser = user || null;
    if (window.FirebaseAuthManager) {
      window.FirebaseAuthManager.currentUser = this.currentUser;
    }
    // Resolve the promise
    if (this._authReadyResolver) {
      this._authReadyResolver(user || null);
      this._authReadyResolver = null; // Clear resolver after resolving
    }
  }

  /**
   * Check if auth state has been resolved (tri-state pattern)
   * @returns {boolean} true if Firebase has determined auth state (even if no user)
   */
  isAuthReady() {
    return this._authReady;
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
      
      // ✅ CRITICAL: Check for logout-intent FIRST before setting currentUser or dispatching event
      // This prevents race conditions where Firebase auth persistence restores user during logout
      let effectiveUser = user;
      if (user) {
        const logoutIntent = sessionStorage.getItem('logout-intent');
        if (logoutIntent === '1') {
          console.log('🚫 Logout in progress, ignoring auth state change and preventing user restoration');
          effectiveUser = null; // Treat as logged out for this callback
        }
      }
      
      // ✅ LinkedIn token restoration: If Firebase SDK sees no user but LinkedIn tokens exist, restore session
      // Check logout-intent FIRST to prevent restoration during logout
      // Note: If SDK sign-in succeeded during initial auth, Firebase SDK auth persistence will handle restoration automatically
      // This fallback is only for cases where SDK sign-in wasn't used (legacy) or failed
      if (!effectiveUser && tokenManagerIsAuthenticated()) {
        const logoutIntent = sessionStorage.getItem('logout-intent');
        if (logoutIntent === '1') {
          console.log('🚫 Logout in progress, skipping LinkedIn token restoration');
        } else {
          // Try to restore SDK auth state using stored LinkedIn OIDC id_token if available
          const storedOidcToken = sessionStorage.getItem('linkedin_oidc_id_token');
          if (storedOidcToken) {
            // Attempt SDK sign-in asynchronously
            // onAuthStateChanged will fire again when SDK sign-in completes
            const provider = new OAuthProvider('oidc.linkedin.com');
            const credential = provider.credential({ idToken: storedOidcToken });
            signInWithCredential(auth, credential).then((result) => {
              console.log('✅ Signed into Firebase SDK using stored LinkedIn OIDC token');
              // onAuthStateChanged will fire again with the SDK user
            }).catch((err) => {
              console.warn('Could not restore SDK auth with stored OIDC token:', err);
              // SDK sign-in failed - fallback to plain object by checking tokens
              const idToken = getIdTokenSync();
              if (idToken) {
                const payload = decodeJwtPayload(idToken);
                if (payload && (payload.user_id || payload.sub)) {
                  const uid = payload.user_id || payload.sub;
                  const email = payload.email || '';
                  if (email && email.trim() !== '') {
                    // Set currentUser directly since onAuthStateChanged won't fire again
                    this.currentUser = { uid, email };
                    if (window.FirebaseAuthManager) {
                      window.FirebaseAuthManager.currentUser = this.currentUser;
                    }
                    console.log('✅ Restored LinkedIn session from sessionStorage tokens (fallback)');
                  }
                }
              }
            });
            // Don't set effectiveUser here - wait for SDK sign-in result
            // If SDK sign-in fails, the catch handler will set currentUser directly
          } else {
            // No OIDC token stored - fall back to plain object (legacy behavior)
            const idToken = getIdTokenSync();
            if (idToken) {
              const payload = decodeJwtPayload(idToken);
              if (payload && (payload.user_id || payload.sub)) {
                const uid = payload.user_id || payload.sub;
                const email = payload.email || '';
                if (email && email.trim() !== '') {
                  effectiveUser = { uid, email };
                  console.log('✅ Restored LinkedIn session from sessionStorage tokens (plain object fallback)');
                }
              }
            }
          }
        }
      }
      
      // ✅ CRITICAL FIX: Set currentUser BEFORE dispatching event to prevent race condition
      // This ensures getCurrentUser() returns the correct value when navigation event handler runs
      this.currentUser = effectiveUser;
      // Update the exposed currentUser property immediately
      if (window.FirebaseAuthManager) {
        window.FirebaseAuthManager.currentUser = effectiveUser;
        console.log('🔥 Updated window.FirebaseAuthManager.currentUser:', effectiveUser ? `User: ${effectiveUser.email}` : 'null');
      }
      
      // ✅ TRI-STATE PATTERN: Mark auth as ready on first onAuthStateChanged call
      // This ensures waitForAuthReady() resolves even if user is null
      if (!authReadyDispatched) {
        this._markAuthReady(effectiveUser);
      }
      
      // ✅ CRITICAL: Dispatch firebase-auth-ready event AFTER currentUser is set
      // This ensures pages waiting for this event (like navigation.js) can reliably call getCurrentUser()
      // The event represents "auth state is ready", not necessarily "user is logged in".
      if (!authReadyDispatched) {
        authReadyDispatched = true;
        console.log('🔥 Dispatching firebase-auth-ready event');
        // CRITICAL FIX: Set flag on window before dispatching event
        // This allows navigation.js fallback to detect if event fired before script loaded
        window.__firebaseAuthReadyFired = true;
        // Dispatch event with effectiveUser (already null if logout-intent detected)
        document.dispatchEvent(new CustomEvent("firebase-auth-ready", {
          detail: { user: effectiveUser || null }
        }));
      }
      
      // If logout-intent was detected, stop processing here
      if (effectiveUser === null && user !== null) {
        // Event already dispatched above with null user, so pages can proceed
        return;
      }
      
      // effectiveUser is now guaranteed to match this.currentUser
      
      if (effectiveUser && typeof effectiveUser.reload === 'function') {
        // Firebase SDK user (Google/Email auth)
        const user = effectiveUser;
        
        // ✅ CRITICAL: Set localStorage IMMEDIATELY (sync, before any await)
        // This prevents race conditions with static-auth-guard.js
        localStorage.setItem('user-authenticated', 'true');
        // SECURITY: Do NOT store email, uid, or auth-user object in localStorage
        // Email/UID available via Firebase auth.currentUser when needed
        // Cache user name for account settings page performance
        if (user.displayName) {
          localStorage.setItem('user-name', user.displayName);
        }
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
        
        
        // Sync with Firestore (update last login) - non-blocking, errors handled internally
        UserProfileManager.updateLastLogin(user.uid).catch(() => {
          // Error already handled in updateLastLogin - silence this to reduce console noise
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
            
            if (window.JobHackAINavigation && typeof window.JobHackAINavigation.fetchPlanFromAPI === 'function') {
              kvPlan = await window.JobHackAINavigation.fetchPlanFromAPI();
              if (kvPlan) console.log('✅ Fetched plan via navigation system:', kvPlan);
            }
            // Fallback: fetch directly from API if navigation not ready
            if (!kvPlan) {
              kvPlan = await fetchPlanFromAPI();
              if (kvPlan) console.log('✅ Fetched plan directly from API (navigation not ready):', kvPlan);
            }
          } catch (e) {
            console.warn('Could not fetch plan from API:', e);
            // Add retry mechanism for failed API fetches
            try {
              console.log('🔄 Retrying plan fetch after 1 second...');
              await new Promise(resolve => setTimeout(resolve, 1000));
              if (window.JobHackAINavigation && typeof window.JobHackAINavigation.fetchPlanFromAPI === 'function') {
                kvPlan = await window.JobHackAINavigation.fetchPlanFromAPI();
              }
              if (!kvPlan) {
                kvPlan = await fetchPlanFromAPI();
              }
              if (kvPlan) console.log('✅ Retry successful, fetched plan:', kvPlan);
            } catch (retryError) {
              console.warn('Retry also failed:', retryError);
            }
          }
          
          if (kvPlan && kvPlan !== 'free') {
            actualPlan = kvPlan;
            console.log('✅ Retrieved user plan from D1 (via API):', actualPlan);
          } else {
            // API fetch returned null or 'free' - try Firestore as fallback (but NOT email-based lookup)
            const profileResult = await UserProfileManager.getProfile(user.uid);
            if (profileResult.success && profileResult.profile) {
              actualPlan = profileResult.profile.plan || 'free';
              console.log('✅ Retrieved user plan from Firestore (API fallback):', actualPlan);
            } else {
              // All sources unavailable - default to 'free' (D1 is source of truth, no email-based fallback)
              actualPlan = 'free';
              console.log('ℹ️ Using default plan (API/Firestore unavailable). D1 is source of truth - no email-based fallback.');
              // FIX: Add delayed retry for plan reconciliation
              console.log('🔄 Scheduling delayed plan reconciliation in 5 seconds...');
              setTimeout(async () => {
                try {
                  console.log('🔄 Attempting delayed plan reconciliation...');
                  const delayedPlan = await window.JobHackAINavigation?.fetchPlanFromAPI?.();
                    if (delayedPlan && delayedPlan !== 'free') {
                    console.log('✅ Delayed reconciliation successful:', delayedPlan);
                    localStorage.setItem('user-plan', delayedPlan);
                    localStorage.setItem('dev-plan', delayedPlan);
                    if (window.JobHackAINavigation && typeof window.JobHackAINavigation.scheduleUpdateNavigation === 'function') {
                      window.JobHackAINavigation.scheduleUpdateNavigation(true);
                    } else if (window.JobHackAINavigation && typeof window.JobHackAINavigation.updateNavigation === 'function') {
                      // fallback
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
      } else if (effectiveUser) {
        // LinkedIn token-based user (plain object, not Firebase SDK user)
        // Set localStorage and navigation state
        localStorage.setItem('user-authenticated', 'true');
        
        // Check if this is a same-window fallback that needs user initialization
        const pendingInit = sessionStorage.getItem('linkedin_pending_init');
        if (pendingInit === '1') {
          // Same-window fallback: perform full user initialization
          sessionStorage.removeItem('linkedin_pending_init');
          const uid = effectiveUser.uid;
          const email = effectiveUser.email;
          
          try {
            // CRITICAL: Prioritize newly selected plan over existing plans (same as popup flow)
            const selectedPlan = this.getSelectedPlan();
            let actualPlan = 'free';

            if (selectedPlan && selectedPlan !== 'free') {
              actualPlan = selectedPlan === 'trial' ? 'pending' : selectedPlan;
              console.log('✅ Using newly selected plan for LinkedIn sign-in (same-window):', actualPlan);
            } else {
              // Fetch plan from API using token
              const kvPlan = await apiFetchJSON('/api/plan/me');
              if (kvPlan?.plan) {
                actualPlan = kvPlan.plan;
                console.log('✅ Fetched plan from API during LinkedIn sign-in (same-window):', actualPlan);
              }
            }
            
            // Extract name from email (LinkedIn doesn't provide displayName in REST response)
            const emailParts = email.split('@')[0].split('.');
            const firstName = emailParts[0] || '';
            const lastName = emailParts.slice(1).join(' ') || '';
            
            const userData = {
              uid,
              firstName,
              lastName,
              plan: actualPlan
            };
            
            // Update local database
            UserDatabase.createOrUpdateUser(email, userData);
            
            // Initialize free account tracking for new free users
            if (actualPlan === 'free') {
              if (window.freeAccountManager) {
                window.freeAccountManager.initializeForNewUser();
              }
            }
            
            // Create or update Firestore profile
            const firestoreData = {
              email,
              displayName: `${firstName} ${lastName}`.trim() || email,
              firstName,
              lastName,
              photoURL: null,
              plan: selectedPlan === 'trial' ? 'pending' : (selectedPlan || 'free'),
              signupSource: 'linkedin_oauth',
              pendingPlan: selectedPlan === 'trial' ? 'trial' : null
            };
            
            try {
              await UserProfileManager.upsertProfile(uid, firestoreData);
            } catch (err) {
              console.warn('Could not sync Firestore profile:', err);
            }
            
            if (window.JobHackAINavigation) {
              window.JobHackAINavigation.setAuthState(true, actualPlan);
            }
            this.notifyAuthStateChange(effectiveUser, null);
          } catch (e) {
            console.warn('Could not initialize LinkedIn user:', e);
            if (window.JobHackAINavigation) {
              window.JobHackAINavigation.setAuthState(true, 'free');
            }
            this.notifyAuthStateChange(effectiveUser, null);
          }
        } else {
          // Normal token restoration (page refresh) - just fetch plan and set state
          try {
            const kvPlan = await apiFetchJSON('/api/plan/me');
            const actualPlan = kvPlan?.plan || 'free';
            if (window.JobHackAINavigation) {
              window.JobHackAINavigation.setAuthState(true, actualPlan);
            }
            this.notifyAuthStateChange(effectiveUser, null);
          } catch (e) {
            console.warn('Could not fetch plan for LinkedIn user:', e);
            if (window.JobHackAINavigation) {
              window.JobHackAINavigation.setAuthState(true, 'free');
            }
            this.notifyAuthStateChange(effectiveUser, null);
          }
        }
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
      // Note: UserDatabase.getUser is only for non-plan data (name, etc.)
      // Plan data comes from D1 via API, not from email-based lookup
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
        await sendEmailVerification(user);
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

      // Create Firestore profile
      const firestoreData = {
        email: email,
        displayName: `${firstName} ${lastName}`.trim(),
        firstName: firstName || '',
        lastName: lastName || '',
        plan: selectedPlan === 'trial' ? 'pending' : (selectedPlan || 'free'), // Don't set trial immediately, wait for webhook
        signupSource: 'email_password',
        pendingPlan: selectedPlan === 'trial' ? 'trial' : null // Track what they selected
      };

      try {
        await UserProfileManager.createProfile(user.uid, firestoreData);
      } catch (err) {
        console.warn('Could not create Firestore profile (will retry on next login):', err);
      }

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
        
        if (window.JobHackAINavigation && typeof window.JobHackAINavigation.fetchPlanFromAPI === 'function') {
          kvPlan = await window.JobHackAINavigation.fetchPlanFromAPI();
          if (kvPlan) console.log('✅ Fetched plan via navigation system during sign-in:', kvPlan);
        }
        // Fallback: fetch directly from API if navigation not ready
        if (!kvPlan) {
          kvPlan = await fetchPlanFromAPI();
          if (kvPlan) console.log('✅ Fetched plan directly from API during sign-in:', kvPlan);
        }
      } catch (e) {
        console.warn('Could not fetch plan from API during sign-in:', e);
        // Add retry mechanism for failed API fetches
        try {
          console.log('🔄 Retrying plan fetch during sign-in after 1 second...');
          await new Promise(resolve => setTimeout(resolve, 1000));
          if (window.JobHackAINavigation && typeof window.JobHackAINavigation.fetchPlanFromAPI === 'function') {
            kvPlan = await window.JobHackAINavigation.fetchPlanFromAPI();
          }
          if (!kvPlan) {
            kvPlan = await fetchPlanFromAPI();
          }
          if (kvPlan) console.log('✅ Retry successful during sign-in, fetched plan:', kvPlan);
        } catch (retryError) {
          console.warn('Retry also failed during sign-in:', retryError);
        }
      }
      
      if (kvPlan && kvPlan !== 'free') {
        actualPlan = kvPlan;
        console.log('✅ Retrieved user plan from D1 (via API) during sign-in:', actualPlan);
      } else {
        // API fetch returned null or 'free' - try Firestore as fallback (but NOT email-based lookup)
        const profileResult = await UserProfileManager.getProfile(user.uid);
        if (profileResult.success && profileResult.profile) {
          actualPlan = profileResult.profile.plan || 'free';
          console.log('✅ Retrieved user plan from Firestore during sign-in (API fallback):', actualPlan);
        } else {
          // All sources unavailable - default to 'free' (D1 is source of truth, no email-based fallback)
          actualPlan = 'free';
          console.log('ℹ️ All plan sources failed during sign-in, defaulting to free. D1 is source of truth - no email-based fallback.');
        }
      }

      // Update local database with correct plan
      UserDatabase.createOrUpdateUser(email, { 
        uid: user.uid,
        plan: actualPlan
      });

      // Persist auth state immediately
      localStorage.setItem('user-authenticated', 'true');
      // SECURITY: Do NOT store email in localStorage
      if (user.displayName) {
        localStorage.setItem('user-name', user.displayName);
      }
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
          
          if (window.JobHackAINavigation && typeof window.JobHackAINavigation.fetchPlanFromAPI === 'function') {
            kvPlan = await window.JobHackAINavigation.fetchPlanFromAPI();
            if (kvPlan) console.log('✅ Fetched plan via navigation system during Google sign-in:', kvPlan);
          }
          // Fallback: fetch directly from API if navigation not ready
          if (!kvPlan) {
            kvPlan = await fetchPlanFromAPI();
            if (kvPlan) console.log('✅ Fetched plan directly from API during Google sign-in:', kvPlan);
          }
        } catch (e) {
          console.warn('Could not fetch plan from API during Google sign-in:', e);
          // Add retry mechanism for failed API fetches
          try {
            console.log('🔄 Retrying plan fetch during Google sign-in after 1 second...');
            await new Promise(resolve => setTimeout(resolve, 1000));
            if (window.JobHackAINavigation && typeof window.JobHackAINavigation.fetchPlanFromAPI === 'function') {
              kvPlan = await window.JobHackAINavigation.fetchPlanFromAPI();
            }
            if (!kvPlan) {
              kvPlan = await fetchPlanFromAPI();
            }
            if (kvPlan) console.log('✅ Retry successful during Google sign-in, fetched plan:', kvPlan);
          } catch (retryError) {
            console.warn('Retry also failed during Google sign-in:', retryError);
          }
        }
        
        if (kvPlan && kvPlan !== 'free') {
          actualPlan = kvPlan;
          console.log('✅ Retrieved user plan from D1 (via API) during Google sign-in:', actualPlan);
        } else {
          // API fetch returned null or 'free' - try Firestore as fallback (but NOT email-based lookup)
          const profileResult = await UserProfileManager.getProfile(user.uid);
          if (profileResult.success && profileResult.profile) {
            actualPlan = profileResult.profile.plan || 'free';
            console.log('✅ Retrieved user plan from Firestore during Google sign-in (API fallback):', actualPlan);
          } else {
            // All sources unavailable - default to 'free' (D1 is source of truth, no email-based fallback)
            actualPlan = 'free';
            console.log('ℹ️ All plan sources failed during Google sign-in, defaulting to free. D1 is source of truth - no email-based fallback.');
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
        localStorage.setItem('user-authenticated', 'true');
        // SECURITY: Do NOT store email in localStorage
        if (user.displayName) {
          localStorage.setItem('user-name', user.displayName);
        }
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
   * Sign in with LinkedIn
   * Opens LinkedIn OAuth popup via server-side start endpoint and handles callback via postMessage
   * Uses token-based authentication (no Firebase SDK auth state)
   */
  async signInWithLinkedIn() {
    return new Promise((resolve, reject) => {
      // Call server-side start endpoint which generates state, signs it, stores in cookie, and redirects to LinkedIn
      // Use host (includes port) instead of hostname to match server-side redirect_uri construction
      const startUrl = `${window.location.protocol}//${window.location.host}/api/auth/linkedin/start`;

      // Open popup window to start endpoint
      const popup = window.open(
        startUrl,
        'linkedin-auth',
        'width=600,height=700,scrollbars=yes,resizable=yes'
      );

      // Handle popup blocked - provide same-window fallback
      if (!popup) {
        // Same-window fallback
        const useSameWindow = confirm('Popup was blocked. Click OK to continue in this window, or Cancel to allow popups and try again.');
        if (useSameWindow) {
          window.location.href = startUrl;
          return resolve({ success: false, error: 'Redirecting to authentication...' });
        } else {
          return resolve({ success: false, error: 'Popup blocked. Please allow popups for this site and try again.' });
        }
      }

      let messageReceived = false;
      let timeoutId = null;
      let checkClosedInterval = null;

      // Listen for message from popup (when callback completes)
      const messageListener = async (event) => {
        // Verify origin matches our frontend
        const allowedOrigins = [
          'https://dev.jobhackai.io',
          'https://qa.jobhackai.io',
          'https://app.jobhackai.io',
          'http://localhost:8787',
          'http://localhost:8788'
        ];
        
        if (!allowedOrigins.includes(event.origin)) {
          console.warn('Ignored message from unauthorized origin:', event.origin);
          return;
        }

        if (event.data?.type === 'linkedin-auth-success') {
          messageReceived = true;
          window.removeEventListener('message', messageListener);
          if (timeoutId) clearTimeout(timeoutId);
          if (checkClosedInterval) clearInterval(checkClosedInterval);
          if (!popup.closed) popup.close();

          try {
            // Store tokens from postMessage
            const { idToken, refreshToken, expiresIn, user } = event.data;
            if (!idToken || !refreshToken) {
              return resolve({ success: false, error: 'Missing authentication tokens' });
            }

            // Validate user data
            if (!user || !user.uid || typeof user.uid !== 'string' || user.uid.trim() === '') {
              return resolve({ success: false, error: 'Invalid user data in authentication response' });
            }

            const uid = user.uid;
            const email = user.email || '';

            // Validate email is not empty before storing tokens or using as database key
            if (!email || email.trim() === '') {
              return resolve({ success: false, error: 'Email is required for authentication' });
            }

            // Store tokens in sessionStorage (after validation)
            storeTokens(idToken, refreshToken, parseInt(expiresIn || '3600', 10));
            
            // Store LinkedIn OIDC id_token for SDK sign-in restoration (if available)
            const linkedinOidcIdToken = event.data.linkedinOidcIdToken;
            if (linkedinOidcIdToken) {
              try {
                sessionStorage.setItem('linkedin_oidc_id_token', linkedinOidcIdToken);
              } catch (e) {
                console.warn('Failed to store LinkedIn OIDC id_token:', e);
              }
            }

            // CRITICAL: Prioritize newly selected plan over existing plans (same as Google)
            const selectedPlan = this.getSelectedPlan();
            let actualPlan = 'free';

            if (selectedPlan && selectedPlan !== 'free') {
              actualPlan = selectedPlan === 'trial' ? 'pending' : selectedPlan;
              console.log('✅ Using newly selected plan for LinkedIn sign-in:', actualPlan);
            } else {
              // Fetch plan from API using token
              let kvPlan = null;
              try {
                kvPlan = await apiFetchJSON('/api/plan/me');
                if (kvPlan?.plan) {
                  actualPlan = kvPlan.plan;
                  console.log('✅ Fetched plan from API during LinkedIn sign-in:', actualPlan);
                }
              } catch (e) {
                console.warn('Could not fetch plan from API during LinkedIn sign-in:', e);
                // Try Firestore as fallback
                try {
                  const profileResult = await UserProfileManager.getProfile(uid);
                  if (profileResult.success && profileResult.profile) {
                    actualPlan = profileResult.profile.plan || 'free';
                    console.log('✅ Retrieved user plan from Firestore during LinkedIn sign-in (API fallback):', actualPlan);
                  }
                } catch (firestoreError) {
                  console.warn('Could not fetch plan from Firestore:', firestoreError);
                }
              }
            }
            
            // Extract name from email (LinkedIn doesn't provide displayName in REST response)
            const emailParts = email.split('@')[0].split('.');
            const firstName = emailParts[0] || '';
            const lastName = emailParts.slice(1).join(' ') || '';
            
            const userData = {
              uid,
              firstName,
              lastName,
              plan: actualPlan
            };

            // Update local database
            UserDatabase.createOrUpdateUser(email, userData);

            // Persist auth state immediately
            try {
              localStorage.setItem('user-authenticated', 'true');
              if (window.JobHackAINavigation) {
                window.JobHackAINavigation.setAuthState(true, actualPlan);
              }
            } catch (e) {
              console.warn('auth state persist failed during LinkedIn sign-in:', e);
            }

            // Initialize free account tracking for new free users
            if (userData.plan === 'free') {
              if (window.freeAccountManager) {
                window.freeAccountManager.initializeForNewUser();
              }
            }

            // Create or update Firestore profile
            const firestoreData = {
              email,
              displayName: `${firstName} ${lastName}`.trim() || email,
              firstName,
              lastName,
              photoURL: null,
              plan: selectedPlan === 'trial' ? 'pending' : (selectedPlan || 'free'),
              signupSource: 'linkedin_oauth',
              pendingPlan: selectedPlan === 'trial' ? 'trial' : null
            };
            
            try {
              await UserProfileManager.upsertProfile(uid, firestoreData);
            } catch (err) {
              console.warn('Could not sync Firestore profile:', err);
            }

            // Sign into Firebase SDK using LinkedIn OIDC id_token for proper SDK auth state
            // This enables Firestore permissions and user.getIdToken() to work
            try {
              const linkedinOidcIdToken = event.data.linkedinOidcIdToken;
              if (linkedinOidcIdToken) {
                const provider = new OAuthProvider('oidc.linkedin.com');
                const credential = provider.credential({ idToken: linkedinOidcIdToken });
                const userCredential = await signInWithCredential(auth, credential);
                // Set currentUser synchronously from result to avoid race condition
                this.currentUser = userCredential.user;
                if (window.FirebaseAuthManager) {
                  window.FirebaseAuthManager.currentUser = this.currentUser;
                }
                // onAuthStateChanged will also fire, but we've already set currentUser
                console.log('✅ Signed into Firebase SDK with LinkedIn OIDC credential');
              } else {
                console.warn('⚠️ LinkedIn OIDC id_token not available, falling back to plain object');
                // Fallback to plain object if OIDC token unavailable
                this.currentUser = { uid, email };
                if (window.FirebaseAuthManager) {
                  window.FirebaseAuthManager.currentUser = this.currentUser;
                }
              }
            } catch (sdkSignInError) {
              console.warn('Could not sign into Firebase SDK, falling back to plain object:', sdkSignInError);
              // Fallback to plain object if SDK sign-in fails
              this.currentUser = { uid, email };
              if (window.FirebaseAuthManager) {
                window.FirebaseAuthManager.currentUser = this.currentUser;
              }
            }

            return resolve({ success: true, user: { uid, email } });
          } catch (error) {
            console.error('Error processing LinkedIn auth success:', error);
            return resolve({ success: false, error: error.message || 'Failed to complete sign-in' });
          }
        }

        if (event.data?.type === 'linkedin-auth-error') {
          messageReceived = true;
          window.removeEventListener('message', messageListener);
          if (timeoutId) clearTimeout(timeoutId);
          if (checkClosedInterval) clearInterval(checkClosedInterval);
          if (!popup.closed) popup.close();
          return resolve({ success: false, error: event.data.error || 'Authentication failed' });
        }
      };

      window.addEventListener('message', messageListener);

      // Cleanup if popup is closed manually (before message received)
      checkClosedInterval = setInterval(() => {
        if (popup.closed && !messageReceived) {
          clearInterval(checkClosedInterval);
          window.removeEventListener('message', messageListener);
          if (timeoutId) clearTimeout(timeoutId);
          resolve({ success: false, error: 'Popup was closed. Please try again.' });
        }
      }, 500);

      // Timeout after 5 minutes
      timeoutId = setTimeout(() => {
        if (!messageReceived) {
          clearInterval(checkClosedInterval);
          window.removeEventListener('message', messageListener);
          if (!popup.closed) {
            popup.close();
          }
          resolve({ success: false, error: 'Authentication timeout. Please try again.' });
        }
      }, 5 * 60 * 1000);
    });
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
      // Clear any pending plan selections from both storages
      try { sessionStorage.removeItem('selectedPlan'); } catch (_) {}
      try { localStorage.removeItem('selectedPlan'); } catch (_) {}

      // Remove Firebase SDK cached user keys to avoid automatic re-login from persistence
      try {
        for (let i = localStorage.length - 1; i >= 0; i--) {
          const key = localStorage.key(i);
          if (key && key.startsWith('firebase:authUser:')) {
            localStorage.removeItem(key);
          }
        }
      } catch (_) { /* no-op */ }

      // Clear LinkedIn tokens from sessionStorage
      clearTokens();

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
      await sendPasswordResetEmail(auth, email);
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
   * Wait for auth state to be ready (tri-state pattern)
   * Resolves to user object if authenticated, null if unauthenticated, or times out
   * @param {number} timeoutMs - Maximum time to wait in milliseconds
   * @returns {Promise<User|null>} Resolves with user if authenticated, null otherwise
   */
  async waitForAuthReady(timeoutMs = 10000) {
    console.log('🔥 waitForAuthReady started, authReady:', this._authReady, 'currentUser:', this.currentUser);
    
    // Check logout-intent immediately - if logout is in progress, return null
    const logoutIntent = sessionStorage.getItem('logout-intent');
    if (logoutIntent === '1') {
      console.log('🚫 Logout in progress, waitForAuthReady returning null');
      return null;
    }
    
    // If already ready, return immediately
    if (this._authReady) {
      const finalLogoutIntent = sessionStorage.getItem('logout-intent');
      if (finalLogoutIntent === '1') {
        console.log('🚫 Logout in progress, waitForAuthReady returning null');
        return null;
      }
      console.log('🔥 waitForAuthReady finished (already ready), currentUser:', this.currentUser);
      return this.currentUser;
    }
    
    // Wait for auth to be ready with timeout
    try {
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Auth ready timeout')), timeoutMs)
      );
      
      const user = await Promise.race([
        this._authReadyPromise,
        timeoutPromise
      ]);
      
      // Final check before returning
      const finalLogoutIntent = sessionStorage.getItem('logout-intent');
      if (finalLogoutIntent === '1') {
        console.log('🚫 Logout in progress, waitForAuthReady returning null (final check)');
        return null;
      }
      
      console.log('🔥 waitForAuthReady finished, currentUser:', user);
      return user;
    } catch (error) {
      // Timeout occurred - Firebase hasn't resolved auth state yet
      console.warn('🔥 waitForAuthReady timeout after', timeoutMs, 'ms, Firebase not ready yet');
      // Return currentUser if available (may be null if Firebase still initializing)
      const finalLogoutIntent = sessionStorage.getItem('logout-intent');
      if (finalLogoutIntent === '1') {
        return null;
      }
      return this.currentUser; // May be null if Firebase hasn't resolved
    }
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
      await sendEmailVerification(user);
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
      
      // Handle plain object users (LinkedIn token-based auth) vs Firebase SDK users
      if (typeof user.reload === 'function') {
        // Firebase SDK user - reload to get latest verification status
        await user.reload();
        if (!user.emailVerified) {
          console.log('User not verified, redirecting to verify-email');
          window.location.href = `/verify-email.html?email=${encodeURIComponent(user.email || '')}`;
          return false;
        }
      } else {
        // Plain object user (LinkedIn token-based) - check token payload for email_verified
        // For LinkedIn users, assume verified (LinkedIn requires verified emails)
        // If verification is required, we'd need to store emailVerified in sessionStorage
        console.log('LinkedIn token-based user, allowing access (LinkedIn emails are verified)');
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
export async function waitForAuthReady(timeoutMs = 10000) {
  return authManager.waitForAuthReady(timeoutMs);
}

