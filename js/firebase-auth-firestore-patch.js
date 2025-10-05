// Add these lines after successful user creation in signUp method (around line 198):

      // Create Firestore profile
      const firestoreData = {
        email: email,
        displayName: `${firstName} ${lastName}`.trim(),
        firstName: firstName || '',
        lastName: lastName || '',
        plan: this.getSelectedPlan() || 'free',
        signupSource: 'email_password'
      };
      
      UserProfileManager.createProfile(user.uid, firestoreData).catch(err => {
        console.warn('Could not create Firestore profile (will retry on next login):', err);
      });

// Add this line after successful Google sign-in (around line 249):

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
      
      UserProfileManager.upsertProfile(user.uid, firestoreData).catch(err => {
        console.warn('Could not sync Firestore profile:', err);
      });

// Add this line in auth state listener (around line 126):

        // Sync with Firestore (update last login)
        UserProfileManager.updateLastLogin(user.uid).catch(err => {
          console.warn('Could not update last login in Firestore:', err);
        });

