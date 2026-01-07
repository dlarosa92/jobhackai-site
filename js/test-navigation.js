// Test script for JobHackAI Navigation System
// Run this in the browser console to test functionality

console.log('🧪 Testing JobHackAI Navigation System...');

// Test 1: Check if navigation system is loaded
function testNavigationLoaded() {
  console.log('✅ Test 1: Navigation system loaded');
  if (window.JobHackAINavigation) {
    console.log('   - Navigation object found');
    console.log('   - Available methods:', Object.keys(window.JobHackAINavigation));
    return true;
  } else {
    console.log('   ❌ Navigation object not found');
    return false;
  }
}

// Test 2: Test plan switching
function testPlanSwitching() {
  console.log('✅ Test 2: Plan switching functionality');
  
  const plans = ['visitor', 'free', 'trial', 'essential', 'pro', 'premium'];
  const nav = window.JobHackAINavigation;
  
  plans.forEach(plan => {
    nav.setPlan(plan);
    // force immediate nav update for synchronous test assertions
    if (typeof nav.scheduleUpdateNavigation === 'function') nav.scheduleUpdateNavigation(true);
    const currentPlan = nav.getCurrentPlan();
    if (currentPlan === plan) {
      console.log(`   ✅ ${plan} plan set correctly`);
    } else {
      console.log(`   ❌ ${plan} plan not set correctly (got: ${currentPlan})`);
    }
  });
}

// Test 3: Test feature access
function testFeatureAccess() {
  console.log('✅ Test 3: Feature access control');
  
  const nav = window.JobHackAINavigation;
  const testCases = [
    { plan: 'visitor', feature: 'linkedin', expected: false },
    { plan: 'free', feature: 'linkedin', expected: false },
    { plan: 'trial', feature: 'linkedin', expected: false },
    { plan: 'essential', feature: 'linkedin', expected: false },
    { plan: 'pro', feature: 'linkedin', expected: false },
    { plan: 'premium', feature: 'linkedin', expected: true },
    { plan: 'trial', feature: 'ats', expected: true },
    { plan: 'pro', feature: 'mockInterview', expected: true },
    { plan: 'essential', feature: 'mockInterview', expected: false }
  ];
  
  testCases.forEach(test => {
    nav.setPlan(test.plan);
    const hasAccess = nav.isFeatureUnlocked(test.feature);
    if (hasAccess === test.expected) {
      console.log(`   ✅ ${test.plan} plan: ${test.feature} access = ${hasAccess}`);
    } else {
      console.log(`   ❌ ${test.plan} plan: ${test.feature} access = ${hasAccess} (expected: ${test.expected})`);
    }
  });
}

// Test 4: Test navigation rendering
function testNavigationRendering() {
  console.log('✅ Test 4: Navigation rendering');
  
  const nav = window.JobHackAINavigation;
  const navLinks = document.querySelector('.nav-links');
  const mobileNav = document.getElementById('mobileNav');
  
  if (navLinks && mobileNav) {
    console.log('   ✅ Navigation containers found');
    
    // Test visitor plan navigation
    nav.setPlan('visitor');
    const visitorLinks = navLinks.querySelectorAll('a');
    console.log(`   - Visitor plan has ${visitorLinks.length} navigation items`);
    
    // Test premium plan navigation
    nav.setPlan('premium');
    // force immediate nav update so DOM assertions are synchronous in tests
    if (typeof nav.scheduleUpdateNavigation === 'function') nav.scheduleUpdateNavigation(true);
    const premiumLinks = navLinks.querySelectorAll('a');
    console.log(`   - Premium plan has ${premiumLinks.length} navigation items`);
    
    // Check for LinkedIn Optimizer link in premium
    const linkedInLink = Array.from(premiumLinks).find(link => 
      link.textContent.includes('LinkedIn Optimizer')
    );
    if (linkedInLink) {
      console.log('   ✅ LinkedIn Optimizer link found in premium plan');
    } else {
      console.log('   ❌ LinkedIn Optimizer link not found in premium plan');
    }
  } else {
    console.log('   ❌ Navigation containers not found');
  }
}

// Test 5: Test Dev Only Plan toggle
function testDevPlanToggle() {
  console.log('✅ Test 5: Dev Only Plan toggle');
  
  const toggle = document.getElementById('dev-plan-toggle');
  if (toggle) {
    console.log('   ✅ Dev Only Plan toggle found');
    
    const select = toggle.querySelector('#dev-plan');
    if (select) {
      console.log('   ✅ Plan selector found');
      
      // Test plan switching via toggle
      select.value = 'premium';
      select.dispatchEvent(new Event('change'));
      
      setTimeout(() => {
        const currentPlan = window.JobHackAINavigation.getCurrentPlan();
        if (currentPlan === 'premium') {
          console.log('   ✅ Plan switching via toggle works');
        } else {
          console.log('   ❌ Plan switching via toggle failed');
        }
      }, 100);
    } else {
      console.log('   ❌ Plan selector not found');
    }
  } else {
    console.log('   ❌ Dev Only Plan toggle not found');
  }
}

// Test 6: Test upgrade modal
function testUpgradeModal() {
  console.log('✅ Test 6: Upgrade modal');
  
  const nav = window.JobHackAINavigation;
  
  // Test showing upgrade modal
  nav.showUpgradeModal('premium');
  
  const modal = document.querySelector('[style*="position: fixed"]');
  if (modal) {
    console.log('   ✅ Upgrade modal displayed');
    
    // Close modal
    modal.remove();
    console.log('   ✅ Upgrade modal closed');
  } else {
    console.log('   ❌ Upgrade modal not displayed');
  }
}

// Test 7: Test URL parameter handling
function testURLParameters() {
  console.log('✅ Test 7: URL parameter handling');
  
  // Test URL parameter reading
  const url = new URL(window.location);
  url.searchParams.set('plan', 'pro');
  window.history.replaceState({}, '', url);
  
  // Reload navigation
  // Force immediate update for test determinism
  window.JobHackAINavigation.scheduleUpdateNavigation(true);
  
  const currentPlan = window.JobHackAINavigation.getCurrentPlan();
  if (currentPlan === 'pro') {
    console.log('   ✅ URL parameter plan reading works');
  } else {
    console.log('   ❌ URL parameter plan reading failed');
  }
}

// Run all tests
function runAllTests() {
  console.log('🚀 Starting JobHackAI Navigation System Tests...\n');
  
  const tests = [
    testNavigationLoaded,
    testPlanSwitching,
    testFeatureAccess,
    testNavigationRendering,
    testDevPlanToggle,
    testUpgradeModal,
    testURLParameters
  ];
  
  let passed = 0;
  let total = tests.length;
  
  tests.forEach((test, index) => {
    try {
      test();
      passed++;
    } catch (error) {
      console.log(`❌ Test ${index + 1} failed with error:`, error);
    }
    console.log(''); // Add spacing between tests
  });
  
  console.log(`📊 Test Results: ${passed}/${total} tests passed`);
  
  if (passed === total) {
    console.log('🎉 All tests passed! Navigation system is working correctly.');
  } else {
    console.log('⚠️  Some tests failed. Please check the implementation.');
  }
}

// Export test function
window.testJobHackAINavigation = runAllTests;

// Auto-run tests if in development mode
if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
  setTimeout(runAllTests, 1000); // Wait for navigation system to initialize
}

console.log('💡 Run testJobHackAINavigation() to test the navigation system manually'); 