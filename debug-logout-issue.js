// Debug snippets for logout redirect issue
// Copy and paste these into the browser console on the login page after logout

// 1. Check logout-intent flag
console.log('=== DEBUG: Logout Intent Check ===');
console.log('sessionStorage.getItem("logout-intent"):', sessionStorage.getItem('logout-intent'));
console.log('Expected: "1" if logout just happened');

// 2. Check Firebase auth manager state
console.log('\n=== DEBUG: Firebase Auth Manager ===');
console.log('window.FirebaseAuthManager.currentUser:', window.FirebaseAuthManager?.currentUser);
console.log('Expected: null if logout worked, UserImpl {...} if still logged in');

// 3. Check localStorage auth flags
console.log('\n=== DEBUG: LocalStorage Auth State ===');
console.log('localStorage.getItem("user-authenticated"):', localStorage.getItem('user-authenticated'));
console.log('localStorage.getItem("user-email"):', localStorage.getItem('user-email'));
console.log('localStorage.getItem("auth-user"):', localStorage.getItem('auth-user'));
console.log('Expected: null for all if logout worked');

// 4. Check Firebase auth persistence keys
console.log('\n=== DEBUG: Firebase Auth Persistence Keys ===');
let firebaseKeys = [];
for (let i = 0; i < localStorage.length; i++) {
  const key = localStorage.key(i);
  if (key && key.startsWith('firebase:authUser:')) {
    firebaseKeys.push(key);
  }
}
console.log('Firebase auth keys found:', firebaseKeys);
console.log('Expected: [] (empty array) if logout worked');

// 5. Check if auth state listener is respecting logout-intent
console.log('\n=== DEBUG: Auth State Listener Check ===');
console.log('Current URL:', window.location.href);
console.log('Page title:', document.title);
console.log('If on login page but see user above, logout-intent check failed');

// 6. Manual logout-intent check function
console.log('\n=== DEBUG: Manual Logout Intent Check Function ===');
window.debugLogoutIntent = function() {
  const logoutIntent = sessionStorage.getItem('logout-intent');
  const currentUser = window.FirebaseAuthManager?.currentUser;
  const userAuthenticated = localStorage.getItem('user-authenticated');
  
  console.log('Logout Intent:', logoutIntent);
  console.log('Current User:', currentUser);
  console.log('User Authenticated:', userAuthenticated);
  
  if (logoutIntent === '1' && currentUser) {
    console.error('❌ BUG: Logout intent is set but user is still authenticated!');
    console.log('This means the logout-intent check in onAuthStateChanged is failing');
  } else if (logoutIntent === '1' && !currentUser) {
    console.log('✅ Logout intent is set and user is null - working correctly');
  } else if (!logoutIntent && currentUser) {
    console.log('⚠️ No logout intent, user is authenticated - normal login state');
  } else {
    console.log('✅ No logout intent, no user - normal logged out state');
  }
};

console.log('\n✅ Run window.debugLogoutIntent() to check logout state');
console.log('✅ All debug info printed above');



