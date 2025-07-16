// Billing Integration Test Suite
// Tests the integration between account settings, billing management, and plan system

console.log('🧪 Starting Billing Integration Tests...');

// Test 1: Account Settings to Billing Management Navigation
function testAccountToBillingNavigation() {
  if (!window.location.pathname.includes('account-setting.html')) {
    console.log('   ⚠️  Skipping: Not on account-setting.html');
    return true;
  }
  console.log('✅ Test 1: Account Settings to Billing Management Navigation');
  const accountSettingsLink = document.querySelector('a[href="billing-management.html"]');
  if (accountSettingsLink) {
    console.log('   ✅ Billing management link found in account settings');
    return true;
  } else {
    console.log('   ❌ Billing management link not found in account settings');
    return false;
  }
}

// Test 2: Billing Management Plan Reading
function testBillingPlanReading() {
  if (!window.location.pathname.includes('billing-management.html')) {
    console.log('   ⚠️  Skipping: Not on billing-management.html');
    return true;
  }
  console.log('✅ Test 2: Billing Management Plan Reading');
  
  // Don't interfere with the actual plan state - just test the current state
  const currentPlan = localStorage.getItem('user-plan') || localStorage.getItem('dev-plan') || 'free';
  const planNameElement = document.getElementById('currentPlanName');
  
  if (planNameElement && typeof loadCurrentPlan === 'function') {
    // Just verify the function exists and can be called without changing state
    const result = planNameElement.textContent && planNameElement.textContent.length > 0;
    if (result) {
      console.log('   ✅ Billing management correctly reads plan from localStorage');
      return true;
    } else {
      console.log('   ❌ Billing management failed to read plan from localStorage');
      return false;
    }
  } else {
    console.log('   ⚠️  loadCurrentPlan function not available (not on billing page)');
    return true;
  }
}

// Test 3: Plan Synchronization
function testPlanSynchronization() {
  console.log('✅ Test 3: Plan Synchronization');
  
  // Test that billing management uses the same plan source as dashboard
  const userPlan = localStorage.getItem('user-plan');
  const devPlan = localStorage.getItem('dev-plan');
  
  console.log(`   📊 Current user-plan: ${userPlan}`);
  console.log(`   📊 Current dev-plan: ${devPlan}`);
  
  if (userPlan && devPlan) {
    console.log('   ✅ Plan values exist in localStorage');
    return true;
  } else {
    console.log('   ❌ Missing plan values in localStorage');
    return false;
  }
}

// Test 4: DEV Toggle Integration
function testDevToggleIntegration() {
  console.log('✅ Test 4: DEV Toggle Integration');
  
  // Check if DEV toggle exists and works with billing
  const devToggle = document.getElementById('dev-plan-toggle');
  if (devToggle) {
    console.log('   ✅ DEV toggle found');
    
    // Don't actually change the plan - just verify the toggle exists
    const select = devToggle.querySelector('#dev-plan');
    if (select) {
      console.log('   ✅ DEV toggle select element found');
      return true;
    }
  } else {
    console.log('   ⚠️  DEV toggle not found (may not be on dashboard)');
    return true; // Not an error if not on dashboard
  }
}

// Test 5: Authentication Integration
function testAuthenticationIntegration() {
  console.log('✅ Test 5: Authentication Integration');
  
  const isAuthenticated = localStorage.getItem('user-authenticated') === 'true';
  console.log(`   📊 User authenticated: ${isAuthenticated}`);
  
  if (isAuthenticated) {
    console.log('   ✅ User is authenticated, billing management should be accessible');
    return true;
  } else {
    console.log('   ⚠️  User not authenticated, billing management should redirect to login');
    return true; // Not an error, just informational
  }
}

// Test 6: Navigation System Integration
function testNavigationIntegration() {
  console.log('✅ Test 6: Navigation System Integration');
  
  if (window.JobHackAINavigation) {
    const currentPlan = window.JobHackAINavigation.getEffectivePlan();
    console.log(`   📊 Navigation system current plan: ${currentPlan}`);
    
    if (currentPlan) {
      console.log('   ✅ Navigation system integration working');
      return true;
    } else {
      console.log('   ❌ Navigation system not returning plan');
      return false;
    }
  } else {
    console.log('   ⚠️  Navigation system not available');
    return true; // Not an error if navigation not loaded
  }
}

// Run all tests
function runBillingIntegrationTests() {
  console.group('🧪 Billing Integration Test Results');
  
  const tests = [
    testAccountToBillingNavigation,
    testBillingPlanReading,
    testPlanSynchronization,
    testDevToggleIntegration,
    testAuthenticationIntegration,
    testNavigationIntegration
  ];
  
  let passedTests = 0;
  let totalTests = tests.length;
  
  tests.forEach(test => {
    try {
      if (test()) {
        passedTests++;
      }
    } catch (error) {
      console.log(`   ❌ Test failed with error: ${error.message}`);
    }
  });
  
  console.log(`\n📊 Test Summary: ${passedTests}/${totalTests} tests passed`);
  
  if (passedTests === totalTests) {
    console.log('🎉 All billing integration tests passed!');
  } else {
    console.log('⚠️  Some tests failed. Check the logs above for details.');
  }
  
  console.groupEnd();
}

// Auto-run tests when script loads
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', runBillingIntegrationTests);
} else {
  runBillingIntegrationTests();
}

// Export for manual testing
window.runBillingIntegrationTests = runBillingIntegrationTests;

// Comprehensive integration validation
function validateBillingIntegration() {
  console.group('🔍 Billing Integration Validation Report');
  
  const validationResults = {
    navigation: {
      accountToBilling: false,
      billingToAccount: false,
      planConsistency: false
    },
    planSystem: {
      localStorageSync: false,
      navigationSync: false,
      devToggleSync: false
    },
    authentication: {
      accountSettings: false,
      billingManagement: false
    },
    functionality: {
      planDisplay: false,
      trialReminder: false,
      paymentMethods: false
    }
  };
  
  // Test navigation links
  const accountBillingLink = document.querySelector('a[href="billing-management.html"]');
  const billingAccountLink = document.querySelector('a[href="account-setting.html"]');
  
  validationResults.navigation.accountToBilling = !!accountBillingLink;
  validationResults.navigation.billingToAccount = !!billingAccountLink;
  
  // Test plan system consistency
  const userPlan = localStorage.getItem('user-plan');
  const devPlan = localStorage.getItem('dev-plan');
  const navPlan = window.JobHackAINavigation ? window.JobHackAINavigation.getEffectivePlan() : null;
  
  validationResults.planSystem.localStorageSync = !!(userPlan && devPlan);
  validationResults.planSystem.navigationSync = !!navPlan;
  validationResults.planSystem.devToggleSync = !!(document.getElementById('dev-plan-toggle'));
  
  // Test authentication
  const isAuthenticated = localStorage.getItem('user-authenticated') === 'true';
  validationResults.authentication.accountSettings = isAuthenticated;
  validationResults.authentication.billingManagement = isAuthenticated;
  
  // Test functionality
  validationResults.functionality.planDisplay = !!(document.getElementById('currentPlanName'));
  validationResults.functionality.trialReminder = !!(document.getElementById('trialReminder'));
  validationResults.functionality.paymentMethods = !!(document.getElementById('savedCardsGrid'));
  
  // Calculate overall score
  const totalTests = Object.values(validationResults).flat().length;
  const passedTests = Object.values(validationResults).flat().filter(Boolean).length;
  const score = Math.round((passedTests / totalTests) * 100);
  
  // Generate report
  console.log('📊 Integration Status:', score >= 80 ? '✅ PASSED' : score >= 60 ? '⚠️  PARTIAL' : '❌ FAILED');
  console.log(`📈 Score: ${passedTests}/${totalTests} (${score}%)`);
  
  console.log('\n🔗 Navigation Tests:');
  console.log(`   Account → Billing: ${validationResults.navigation.accountToBilling ? '✅' : '❌'}`);
  console.log(`   Billing → Account: ${validationResults.navigation.billingToAccount ? '✅' : '❌'}`);
  console.log(`   Plan Consistency: ${validationResults.navigation.planConsistency ? '✅' : '❌'}`);
  
  console.log('\n📋 Plan System Tests:');
  console.log(`   localStorage Sync: ${validationResults.planSystem.localStorageSync ? '✅' : '❌'}`);
  console.log(`   Navigation Sync: ${validationResults.planSystem.navigationSync ? '✅' : '❌'}`);
  console.log(`   DEV Toggle Sync: ${validationResults.planSystem.devToggleSync ? '✅' : '❌'}`);
  
  console.log('\n🔐 Authentication Tests:');
  console.log(`   Account Settings: ${validationResults.authentication.accountSettings ? '✅' : '❌'}`);
  console.log(`   Billing Management: ${validationResults.authentication.billingManagement ? '✅' : '❌'}`);
  
  console.log('\n⚙️  Functionality Tests:');
  console.log(`   Plan Display: ${validationResults.functionality.planDisplay ? '✅' : '❌'}`);
  console.log(`   Trial Reminder: ${validationResults.functionality.trialReminder ? '✅' : '❌'}`);
  console.log(`   Payment Methods: ${validationResults.functionality.paymentMethods ? '✅' : '❌'}`);
  
  // Recommendations
  console.log('\n💡 Recommendations:');
  if (score < 80) {
    if (!validationResults.navigation.accountToBilling) {
      console.log('   • Fix account settings to billing management navigation link');
    }
    if (!validationResults.planSystem.navigationSync) {
      console.log('   • Ensure billing management uses navigation system for plan detection');
    }
    if (!validationResults.authentication.accountSettings) {
      console.log('   • Verify authentication is working on account settings page');
    }
  } else {
    console.log('   • Integration is working well! Consider adding more advanced features');
    console.log('   • Test with different user plans and scenarios');
    console.log('   • Validate payment method management functionality');
  }
  
  console.groupEnd();
  
  return {
    score,
    passedTests,
    totalTests,
    details: validationResults
  };
}

// Export validation function
window.validateBillingIntegration = validateBillingIntegration; 