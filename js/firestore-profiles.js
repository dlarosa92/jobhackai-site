/**
 * Firestore User Profile Management for JobHackAI
 * Handles user profile storage, retrieval, and updates
 */

import { initializeApp } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-app.js";
import { 
  getFirestore, 
  doc, 
  getDoc, 
  setDoc, 
  updateDoc,
  serverTimestamp,
  increment
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";

import { firebaseConfig } from './firebase-config.js';

// Initialize Firestore
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

/**
 * User Profile Manager
 * Manages user data in Firestore
 */
class UserProfileManager {
  /**
   * Create a new user profile in Firestore
   */
  static async createProfile(uid, userData) {
    try {
      const userRef = doc(db, 'users', uid);
      
      const profile = {
        uid,
        email: userData.email || '',
        displayName: userData.displayName || '',
        firstName: userData.firstName || '',
        lastName: userData.lastName || '',
        photoURL: userData.photoURL || null,
        
        // Plan information
        plan: userData.plan || 'free',
        planStartDate: serverTimestamp(),
        
        // Stripe integration
        stripeCustomerId: null,
        subscriptionId: null,
        
        // Trial information
        trialEndsAt: null,
        hasUsedTrial: false,
        
        // User preferences
        preferences: {
          emailNotifications: true,
          marketingEmails: true,
          theme: 'light'
        },
        
        // Feature usage tracking
        usage: {
          atsScans: 0,
          feedbackRequests: 0,
          interviewQuestions: 0,
          mockInterviews: 0,
          coverLetters: 0,
          linkedinOptimizations: 0,
          lastUsedFeature: null,
          lastUsedAt: null
        },
        
        // Metadata
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        lastLoginAt: serverTimestamp(),
        signupSource: userData.signupSource || 'direct'
      };
      
      await setDoc(userRef, profile);
      console.log('✅ User profile created in Firestore:', uid);
      
      return { success: true, profile };
    } catch (error) {
      console.error('❌ Error creating user profile:', error);
      return { success: false, error: error.message };
    }
  }
  
  /**
   * Get user profile from Firestore
   */
  static async getProfile(uid) {
    try {
      const userRef = doc(db, 'users', uid);
      const userSnap = await getDoc(userRef);
      
      if (userSnap.exists()) {
        console.log('✅ User profile retrieved:', uid);
        return { success: true, profile: userSnap.data() };
      } else {
        console.log('⚠️ Profile not found for:', uid);
        return { success: false, error: 'Profile not found' };
      }
    } catch (error) {
      console.error('❌ Error getting user profile:', error);
      return { success: false, error: error.message };
    }
  }
  
  /**
   * Update user profile
   */
  static async updateProfile(uid, updates) {
    try {
      const userRef = doc(db, 'users', uid);
      
      const updateData = {
        ...updates,
        updatedAt: serverTimestamp()
      };
      
      await updateDoc(userRef, updateData);
      console.log('✅ User profile updated:', uid);
      
      return { success: true };
    } catch (error) {
      console.error('❌ Error updating user profile:', error);
      return { success: false, error: error.message };
    }
  }
  
  /**
   * Update user's plan
   */
  static async updatePlan(uid, newPlan) {
    try {
      const userRef = doc(db, 'users', uid);
      
      await updateDoc(userRef, {
        plan: newPlan,
        planStartDate: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
      
      console.log('✅ User plan updated:', uid, '→', newPlan);
      
      return { success: true };
    } catch (error) {
      console.error('❌ Error updating user plan:', error);
      return { success: false, error: error.message };
    }
  }
  
  /**
   * Track feature usage
   */
  static async trackUsage(uid, feature) {
    try {
      const userRef = doc(db, 'users', uid);
      
      await updateDoc(userRef, {
        [`usage.${feature}`]: increment(1),
        'usage.lastUsedFeature': feature,
        'usage.lastUsedAt': serverTimestamp(),
        updatedAt: serverTimestamp()
      });
      
      console.log('✅ Usage tracked:', uid, feature);
      
      return { success: true };
    } catch (error) {
      console.error('❌ Error tracking usage:', error);
      return { success: false, error: error.message };
    }
  }
  
  /**
   * Update last login timestamp
   */
  static async updateLastLogin(uid) {
    try {
      const userRef = doc(db, 'users', uid);
      
      // Use setDoc with merge to create the document if it doesn't exist
      await setDoc(userRef, {
        lastLoginAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      }, { merge: true });
      
      console.log('✅ Last login updated:', uid);
      
      return { success: true };
    } catch (error) {
      console.error('❌ Error updating last login:', error);
      return { success: false, error: error.message };
    }
  }
  
  /**
   * Update Stripe customer ID
   */
  static async updateStripeCustomer(uid, customerId, subscriptionId = null) {
    try {
      const userRef = doc(db, 'users', uid);
      
      const updates = {
        stripeCustomerId: customerId,
        updatedAt: serverTimestamp()
      };
      
      if (subscriptionId) {
        updates.subscriptionId = subscriptionId;
      }
      
      await updateDoc(userRef, updates);
      console.log('✅ Stripe customer updated:', uid);
      
      return { success: true };
    } catch (error) {
      console.error('❌ Error updating Stripe customer:', error);
      return { success: false, error: error.message };
    }
  }
  
  /**
   * Check if profile exists
   */
  static async profileExists(uid) {
    try {
      const userRef = doc(db, 'users', uid);
      const userSnap = await getDoc(userRef);
      return userSnap.exists();
    } catch (error) {
      console.error('❌ Error checking profile existence:', error);
      return false;
    }
  }
  
  /**
   * Create or update profile (upsert)
   */
  static async upsertProfile(uid, userData) {
    const exists = await this.profileExists(uid);
    
    if (exists) {
      return await this.updateProfile(uid, userData);
    } else {
      return await this.createProfile(uid, userData);
    }
  }
}

// Export for use in other modules
export default UserProfileManager;
export { db };
