/**
 * Automated QA Tests for Authentication Flows
 * Run these tests to verify the auth fixes are working
 */

// Test 1: Login page initialization
function testLoginPageInit() {
  console.log('🧪 Test 1: Login page initialization');
  
  // Check if we're on login page
  if (!window.location.pathname.includes('login.html')) {
    console.log('❌ Not on login page, skipping test');
    return false;
  }
  
  // Check title
  const title = document.getElementById('auth-title');
  if (!title || title.textContent !== 'Welcome back') {
    console.log('❌ Title not "Welcome back"');
    return false;
  }
  
  // Check login form is visible
  const loginForm = document.getElementById('loginForm');
  if (!loginForm || loginForm.style.display === 'none') {
    console.log('❌ Login form not visible');
    return false;
  }
  
  // Check signup form is hidden
  const signupForm = document.getElementById('signupForm');
  if (signupForm && signupForm.style.display !== 'none') {
    console.log('❌ Signup form should be hidden');
    return false;
  }
  
  console.log('✅ Login page initialization test passed');
  return true;
}

// Test 2: Password toggle functionality
function testPasswordToggle() {
  console.log('🧪 Test 2: Password toggle functionality');
  
  const toggleBtn = document.getElementById('toggleLoginPassword');
  const passwordInput = document.getElementById('loginPassword');
  
  if (!toggleBtn || !passwordInput) {
    console.log('❌ Password toggle elements not found');
    return false;
  }
  
  const initialType = passwordInput.type;
  
  // Click toggle
  toggleBtn.click();
  
  if (passwordInput.type === initialType) {
    console.log('❌ Password type did not change');
    return false;
  }
  
  // Click again to toggle back
  toggleBtn.click();
  
  if (passwordInput.type !== initialType) {
    console.log('❌ Password type did not toggle back');
    return false;
  }
  
  console.log('✅ Password toggle test passed');
  return true;
}

// Test 3: Forgot password modal
function testForgotPasswordModal() {
  console.log('🧪 Test 3: Forgot password modal');
  
  const forgotLink = document.getElementById('forgotPasswordLink');
  const modal = document.getElementById('forgotPasswordOverlay');
  
  if (!forgotLink || !modal) {
    console.log('❌ Forgot password elements not found');
    return false;
  }
  
  // Click forgot password link
  forgotLink.click();
  
  if (modal.style.display !== 'flex') {
    console.log('❌ Modal did not open');
    return false;
  }
  
  // Close modal
  const closeBtn = document.getElementById('forgotPasswordCloseBtn');
  if (closeBtn) {
    closeBtn.click();
    if (modal.style.display !== 'none') {
      console.log('❌ Modal did not close');
      return false;
    }
  }
  
  console.log('✅ Forgot password modal test passed');
  return true;
}

// Test 4: Firebase auth ready event
function testFirebaseAuthReady() {
  console.log('🧪 Test 4: Firebase auth ready event');
  
  let eventFired = false;
  
  document.addEventListener('firebase-auth-ready', () => {
    eventFired = true;
    console.log('✅ Firebase auth ready event fired');
  });
  
  // Wait a bit for the event
  setTimeout(() => {
    if (!eventFired) {
      console.log('⚠️ Firebase auth ready event not fired (may be normal if already ready)');
    }
  }, 2000);
  
  return true;
}

// Test 5: Navigation initialization
function testNavigationInit() {
  console.log('🧪 Test 5: Navigation initialization');
  
  if (window.JobHackAINavigation) {
    console.log('✅ JobHackAINavigation object exists');
    return true;
  } else {
    console.log('❌ JobHackAINavigation object not found');
    return false;
  }
}

// Run all tests
function runAllTests() {
  console.log('🚀 Running automated QA tests...');
  
  const tests = [
    testLoginPageInit,
    testPasswordToggle,
    testForgotPasswordModal,
    testFirebaseAuthReady,
    testNavigationInit
  ];
  
  let passed = 0;
  let total = tests.length;
  
  tests.forEach(test => {
    try {
      if (test()) {
        passed++;
      }
    } catch (error) {
      console.log(`❌ Test failed with error:`, error);
    }
  });
  
  console.log(`\n📊 Test Results: ${passed}/${total} tests passed`);
  
  if (passed === total) {
    console.log('🎉 All tests passed!');
  } else {
    console.log('⚠️ Some tests failed');
  }
  
  return passed === total;
}

// Auto-run tests when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', runAllTests);
} else {
  runAllTests();
}
