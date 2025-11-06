# Firestore Security Rules Setup Guide

## Issue
The application is experiencing Firestore permission errors when trying to access user profiles. The code has been updated to handle these errors gracefully, but you should configure Firestore security rules in Firebase Console to fully resolve the issue.

## Required Firestore Security Rules

You need to set up security rules in Firebase Console that allow authenticated users to:
1. Read their own user profile document
2. Create their own user profile document  
3. Update their own user profile document

## Steps to Configure

1. **Navigate to Firebase Console**
   - Go to https://console.firebase.google.com/
   - Select your project: `jobhackai-90558`

2. **Open Firestore Database**
   - Click on **Firestore Database** in the left menu
   - If you haven't created a database yet, click **Create database**
   - Choose **Start in test mode** (we'll add rules next) or **Start in production mode**

3. **Navigate to Rules Tab**
   - Click on the **Rules** tab at the top of the Firestore Database page

4. **Add the Following Rules**

Replace the default rules with these:

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // Users collection - users can read/write their own profile
    match /users/{userId} {
      // Allow read if user is authenticated and accessing their own document
      allow read: if request.auth != null && request.auth.uid == userId;
      
      // Allow create if user is authenticated and creating their own document
      allow create: if request.auth != null && request.auth.uid == userId;
      
      // Allow update if user is authenticated and updating their own document
      allow update: if request.auth != null && request.auth.uid == userId;
      
      // Allow delete if user is authenticated and deleting their own document
      allow delete: if request.auth != null && request.auth.uid == userId;
    }
    
    // Deny all other access by default
    match /{document=**} {
      allow read, write: if false;
    }
  }
}
```

5. **Publish Rules**
   - Click **Publish** button
   - Rules will be deployed immediately (usually within seconds)

## Verification

After publishing the rules, test by:
1. Logging into the application
2. Navigating to account settings page (`account-setting.html`)
3. Check browser console - you should see:
   - `✅ User profile retrieved:` instead of permission errors
   - `✅ Last login updated:` instead of permission errors

## Current Behavior (With Code Fixes)

Even without these rules configured, the application will:
- ✅ Continue to work (won't crash)
- ✅ Use Firebase Auth user data as fallback if Firestore access fails
- ✅ Log warnings instead of errors for permission issues
- ⚠️ Show warning messages in console (but not break functionality)

## Notes

- The rules above allow users to manage ONLY their own profile documents
- The `userId` in the document path must match the authenticated user's `uid`
- These rules are production-ready and follow security best practices
- You can extend these rules later for other collections (e.g., resumes, cover letters)

