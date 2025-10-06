/**
 * Firebase Authentication Module for JobHackAI
 * Handles secure user authentication with Firebase Auth
 * Supports: Email/Password, Google Sign-In
 */

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
  browserLocalPersistence
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";

import { initializeApp } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-app.js";

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

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
  }

  setupAuthStateListener() {
    onAuthStateChanged(auth, async (user) => {
      this.currentUser = user;
      
      if (user) {
        // User is signed in
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
        
        // CRITICAL: Retrieve user's actual plan from Firestore
        const profileResult = await UserProfileManager.getProfile(user.uid);
        let actualPlan = 'free'; // default fallback
        
        if (profileResult.success && profileResult.profile) {
          actualPlan = profileResult.profile.plan || 'free';
          console.log('✅ Retrieved user plan from Firestore:', actualPlan);
        } else {
          console.warn('⚠️ Could not retrieve profile from Firestore, using local data');
          // Fallback to local database if Firestore fails
          const userRecord = UserDatabase.getUser(user.email);
          if (userRecord) {
            actualPlan = userRecord.plan || 'free';
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
        
        // Store auth state (synchronously to avoid race conditions)
        localStorage.setItem('auth-user', JSON.stringify({
          email: user.email,
          uid: user.uid,
          displayName: user.displayName
        }));
        localStorage.setItem('user-email', user.email || '');
        localStorage.setItem('user-authenticated', 'true');
        
        // Notify listeners
        this.notifyAuthStateChange(user, userRecord);
      } else {
        // User is signed out
        localStorage.removeItem('auth-user');
        localStorage.removeItem('user-email');
        localStorage.setItem('user-authenticated', 'false');
        
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

      // Create user record in local database
      const userData = {
        uid: user.uid,
        firstName: firstName || '',
        lastName: lastName || '',
        plan: this.getSelectedPlan() || 'free'
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
        plan: this.getSelectedPlan() || 'free',
        signupSource: 'email_password'
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

      // CRITICAL: Retrieve user's actual plan from Firestore
      const profileResult = await UserProfileManager.getProfile(user.uid);
      let actualPlan = 'free'; // default fallback
      
      if (profileResult.success && profileResult.profile) {
        actualPlan = profileResult.profile.plan || 'free';
        console.log('✅ Retrieved user plan from Firestore during sign-in:', actualPlan);
      } else {
        console.warn('⚠️ Could not retrieve profile from Firestore during sign-in, using local data');
        // Fallback to local database if Firestore fails
        const userRecord = UserDatabase.getUser(email);
        if (userRecord) {
          actualPlan = userRecord.plan || 'free';
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
      
      // CRITICAL: Retrieve user's actual plan from Firestore
      const profileResult = await UserProfileManager.getProfile(user.uid);
      let actualPlan = 'free'; // default fallback
      
      if (profileResult.success && profileResult.profile) {
        actualPlan = profileResult.profile.plan || 'free';
        console.log('✅ Retrieved user plan from Firestore during Google sign-in:', actualPlan);
      } else {
        console.warn('⚠️ Could not retrieve profile from Firestore during Google sign-in, using selected plan');
        actualPlan = this.getSelectedPlan() || 'free';
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
        plan: this.getSelectedPlan() || 'free',
        signupSource: 'google_oauth'
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
   * Get selected plan from URL or localStorage
   */
  getSelectedPlan() {
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get('plan') || localStorage.getItem('selected-plan') || null;
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
   * Check if user is authenticated
   */
  isAuthenticated() {
    return !!this.currentUser;
  }
}

// Create singleton instance
const authManager = new AuthManager();

// Export for use in pages
export default authManager;
export { auth, UserDatabase };

