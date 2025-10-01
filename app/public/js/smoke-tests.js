// JobHackAI Smoke Test System
// Quick tests to verify site functionality and catch regressions

// Ensure global smokeTests object exists
if (!window.smokeTests) window.smokeTests = {};

window.smokeTests = {
  // Configuration
  config: {
    enabled: true,
    autoRun: false, // Set to true to run tests automatically
    runOnLoad: true,
    runOnError: true,
    maxTestTime: 10000, // 10 seconds max per test
    verbose: false
  },
  
  // Test results
  results: [],
  isRunning: false,
  lastRunTime: 0,
  minRunInterval: 5000, // Minimum 5 seconds between test runs
  
  // Test definitions
  tests: {
    // Basic DOM tests
    dom: {
      name: 'DOM Structure',
      test: () => {
        const required = ['header', 'main', 'footer', '.site-header', '.site-footer'];
        const missing = required.filter(selector => !document.querySelector(selector));
        return {
          passed: missing.length === 0,
          details: missing.length > 0 ? `Missing: ${missing.join(', ')}` : 'All required elements present'
        };
      }
    },
    
    // Navigation tests
    navigation: {
      name: 'Navigation System',
      test: () => {
        const navElements = ['.nav-group', '.nav-links', '#mobileNav'];
        const missing = navElements.filter(selector => !document.querySelector(selector));
        
        if (missing.length > 0) {
          return {
            passed: false,
            details: `Missing navigation elements: ${missing.join(', ')}`
          };
        }
        
        // Check if navigation has content
        const navLinks = document.querySelector('.nav-links');
        if (navLinks && navLinks.children.length === 0) {
          return {
            passed: false,
            details: 'Navigation links not rendered'
          };
        }
        
        return {
          passed: true,
          details: 'Navigation system working correctly'
        };
      }
    },
    
    // Plan system tests
    plans: {
      name: 'Plan System',
      test: () => {
        const requiredKeys = ['user-authenticated', 'user-plan'];
        const missing = requiredKeys.filter(key => !localStorage.getItem(key));
        
        if (missing.length > 0) {
          return {
            passed: false,
            details: `Missing localStorage keys: ${missing.join(', ')}`
          };
        }
        
        // Test plan validation
        const currentPlan = localStorage.getItem('user-plan');
        if (!window.PLANS || !window.PLANS[currentPlan]) {
          return {
            passed: false,
            details: `Invalid plan: ${currentPlan}`
          };
        }
        
        return {
          passed: true,
          details: `Current plan: ${currentPlan}`
        };
      }
    },
    
    // Feature access tests
    features: {
      name: 'Feature Access',
      test: () => {
        if (!window.isFeatureUnlocked) {
          return {
            passed: false,
            details: 'Feature access function not available'
          };
        }
        
        // Test basic feature access using actual feature keys from PLANS
        const testFeatures = ['ats', 'feedback', 'interview'];
        const results = testFeatures.map(feature => ({
          feature: feature,
          unlocked: window.isFeatureUnlocked(feature)
        }));
        
        const unlockedCount = results.filter(r => r.unlocked).length;
        
        return {
          passed: unlockedCount > 0,
          details: `${unlockedCount}/${testFeatures.length} features unlocked`,
          featureResults: results
        };
      }
    },
    
    // Health check tests
    health: {
      name: 'Site Health',
      test: () => {
        if (!window.siteHealth) {
          return {
            passed: false,
            details: 'Health check system not available'
          };
        }
        
        try {
          const health = window.siteHealth.checkAll();
          const issues = [];
          
          if (!health.navigation.healthy) {
            issues.push(...health.navigation.issues);
          }
          if (!health.dom.healthy) {
            issues.push(...health.dom.missing.map(el => `Missing: ${el}`));
          }
          if (!health.localStorage.healthy) {
            issues.push(...health.localStorage.issues);
          }
          
          return {
            passed: issues.length === 0,
            details: issues.length > 0 ? `Issues: ${issues.join(', ')}` : 'Site is healthy',
            healthData: health
          };
        } catch (error) {
          return {
            passed: false,
            details: `Health check failed: ${error.message}`
          };
        }
      }
    },
    
    // Agent interface tests
    agentInterface: {
      name: 'Agent Interface',
      test: () => {
        if (!window.agentInterface) {
          return {
            passed: false,
            details: 'Agent interface not available'
          };
        }
        
        const requiredMethods = ['analyze', 'navigation', 'recovery', 'safe'];
        const missing = requiredMethods.filter(method => !window.agentInterface[method]);
        
        if (missing.length > 0) {
          return {
            passed: false,
            details: `Missing agent methods: ${missing.join(', ')}`
          };
        }
        
        return {
          passed: true,
          details: 'Agent interface fully functional'
        };
      }
    },
    
    // State management tests
    stateManagement: {
      name: 'State Management',
      test: () => {
        if (!window.stateManager) {
          return {
            passed: false,
            details: 'State manager not available'
          };
        }
        
        const requiredMethods = ['get', 'set', 'watch', 'unwatch'];
        const missing = requiredMethods.filter(method => !window.stateManager[method]);
        
        if (missing.length > 0) {
          return {
            passed: false,
            details: `Missing state manager methods: ${missing.join(', ')}`
          };
        }
        
        return {
          passed: true,
          details: 'State management working correctly'
        };
      }
    },
    
    // Billing integration tests
    billingIntegration: {
      name: 'Billing Integration',
      test: () => {
        // Test 1: Check if billing management link exists in account settings
        const billingLink = document.querySelector('a[href="billing-management.html"]');
        if (!billingLink) {
          return {
            passed: false,
            details: 'Billing management link not found in account settings'
          };
        }
        
        // Test 2: Check if navigation system is available
        if (!window.JobHackAINavigation) {
          return {
            passed: false,
            details: 'Navigation system not available for billing integration'
          };
        }
        
        // Test 3: Check if plan detection works
        const currentPlan = window.JobHackAINavigation.getEffectivePlan();
        if (!currentPlan) {
          return {
            passed: false,
            details: 'Plan detection not working'
          };
        }
        
        // Test 4: Check if billing management functions are available (if on billing page)
        if (window.location.pathname.includes('billing-management.html')) {
          if (typeof loadCurrentPlan !== 'function') {
            return {
              passed: false,
              details: 'Billing management functions not available'
            };
          }
        }
        
        return {
          passed: true,
          details: `Billing integration working, current plan: ${currentPlan}`
        };
      }
    },
    
    // Error reporting tests
    errorReporting: {
      name: 'Error Reporting',
      test: () => {
        if (!window.errorReporter) {
          return {
            passed: false,
            details: 'Error reporter not available'
          };
        }
        
        const requiredMethods = ['captureError', 'getReports', 'generateSummary'];
        const missing = requiredMethods.filter(method => !window.errorReporter[method]);
        
        if (missing.length > 0) {
          return {
            passed: false,
            details: `Missing error reporter methods: ${missing.join(', ')}`
          };
        }
        
        return {
          passed: true,
          details: 'Error reporting system working'
        };
      }
    },
    
    // Self-healing tests
    selfHealing: {
      name: 'Self-Healing',
      test: () => {
        if (!window.selfHealing) {
          return {
            passed: false,
            details: 'Self-healing system not available'
          };
        }
        
        const requiredMethods = ['checkForIssues', 'attemptAutoFix', 'getStatus'];
        const missing = requiredMethods.filter(method => !window.selfHealing[method]);
        
        if (missing.length > 0) {
          return {
            passed: false,
            details: `Missing self-healing methods: ${missing.join(', ')}`
          };
        }
        
        const status = window.selfHealing.getStatus();
        
        return {
          passed: status.enabled,
          details: `Self-healing ${status.enabled ? 'enabled' : 'disabled'}, ${status.fixAttempts} attempts made`
        };
      }
    },
    
    // Audit trail tests
    auditTrail: {
      name: 'Audit Trail',
      test: () => {
        if (!window.auditTrail) {
          return {
            passed: false,
            details: 'Audit trail not available'
          };
        }
        
        const requiredMethods = ['log', 'getEntries', 'generateSummary'];
        const missing = requiredMethods.filter(method => !window.auditTrail[method]);
        
        if (missing.length > 0) {
          return {
            passed: false,
            details: `Missing audit trail methods: ${missing.join(', ')}`
          };
        }
        
        const summary = window.auditTrail.generateSummary();
        
        return {
          passed: true,
          details: `Audit trail working, ${summary.total} entries logged`
        };
      }
    }
  },
  
  // Initialize smoke tests
  init: () => {
    if (!smokeTests.config.enabled) return;
    
    // Run tests on load if enabled
    if (smokeTests.config.runOnLoad) {
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
          setTimeout(() => smokeTests.runAll(), 2000);
        });
      } else {
        setTimeout(() => smokeTests.runAll(), 2000);
      }
    }
    
    // Run tests on error if enabled
    if (smokeTests.config.runOnError) {
      window.addEventListener('error', () => {
        setTimeout(() => smokeTests.runAll(), 1000);
      });
    }
    
    console.log('🧪 Smoke tests initialized');
  },
  
  // Run all tests
  runAll: () => {
    if (smokeTests.isRunning) {
      console.log('🧪 Smoke tests already running');
      return;
    }
    
    const now = Date.now();
    if (now - smokeTests.lastRunTime < smokeTests.minRunInterval) {
      console.log('🧪 Smoke tests rate limited - too frequent');
      return;
    }
    
    smokeTests.isRunning = true;
    smokeTests.lastRunTime = now;
    console.log('🧪 Running smoke tests...');
    
    const startTime = Date.now();
    const results = [];
    const testNames = Object.keys(smokeTests.tests);
    
    // Run tests sequentially
    const runTest = (index) => {
      if (index >= testNames.length) {
        smokeTests.completeTests(results, startTime);
        return;
      }
      
      const testName = testNames[index];
      const test = smokeTests.tests[testName];
      
      console.log(`🧪 Running test: ${test.name}`);
      
      try {
        const result = test.test();
        results.push({
          name: test.name,
          key: testName,
          passed: result.passed,
          details: result.details,
          data: result.data || result.featureResults || result.healthData,
          timestamp: new Date().toISOString()
        });
        
        if (smokeTests.config.verbose) {
          console.log(`🧪 ${test.name}: ${result.passed ? '✅ PASS' : '❌ FAIL'} - ${result.details}`);
        }
      } catch (error) {
        results.push({
          name: test.name,
          key: testName,
          passed: false,
          details: `Test error: ${error.message}`,
          error: error,
          timestamp: new Date().toISOString()
        });
        
        console.error(`🧪 ${test.name}: ❌ ERROR - ${error.message}`);
      }
      
      // Run next test after a short delay
      setTimeout(() => runTest(index + 1), 100);
    };
    
    runTest(0);
  },
  
  // Complete test run
  completeTests: (results, startTime) => {
    const duration = Date.now() - startTime;
    const passed = results.filter(r => r.passed).length;
    const total = results.length;
    
    const summary = {
      timestamp: new Date().toISOString(),
      duration: duration,
      total: total,
      passed: passed,
      failed: total - passed,
      successRate: (passed / total) * 100,
      results: results
    };
    
    smokeTests.results.push(summary);
    
    // Keep only last 10 test runs
    if (smokeTests.results.length > 10) {
      smokeTests.results = smokeTests.results.slice(-10);
    }
    
    console.log(`🧪 Smoke tests completed: ${passed}/${total} passed (${summary.successRate.toFixed(1)}%) in ${duration}ms`);
    
    // Log failures
    const failures = results.filter(r => !r.passed);
    if (failures.length > 0) {
      console.warn('🧪 Test failures:', failures.map(f => `${f.name}: ${f.details}`));
    }
    
    smokeTests.isRunning = false;
    
    // Trigger error reporting if tests failed
    if (failures.length > 0 && window.errorReporter) {
      window.errorReporter.captureError('smoke-test-failure', {
        failures: failures,
        summary: summary
      });
    }
    
    return summary;
  },
  
  // Run specific test
  runTest: (testName) => {
    if (!smokeTests.tests[testName]) {
      console.error(`🧪 Test not found: ${testName}`);
      return null;
    }
    
    const test = smokeTests.tests[testName];
    console.log(`🧪 Running single test: ${test.name}`);
    
    try {
      const result = test.test();
      const testResult = {
        name: test.name,
        key: testName,
        passed: result.passed,
        details: result.details,
        data: result.data || result.featureResults || result.healthData,
        timestamp: new Date().toISOString()
      };
      
      console.log(`🧪 ${test.name}: ${result.passed ? '✅ PASS' : '❌ FAIL'} - ${result.details}`);
      
      return testResult;
    } catch (error) {
      console.error(`🧪 ${test.name}: ❌ ERROR - ${error.message}`);
      return {
        name: test.name,
        key: testName,
        passed: false,
        details: `Test error: ${error.message}`,
        error: error,
        timestamp: new Date().toISOString()
      };
    }
  },
  
  // Get test results
  getResults: () => {
    return smokeTests.results;
  },
  
  // Get latest test result
  getLatestResult: () => {
    return smokeTests.results[smokeTests.results.length - 1];
  },
  
  // Clear results
  clearResults: () => {
    smokeTests.results = [];
    console.log('🧪 Smoke test results cleared');
  },
  
  // Export results
  exportResults: () => {
    const data = {
      timestamp: new Date().toISOString(),
      results: smokeTests.results,
      config: smokeTests.config
    };
    
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `smoke-tests-${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
  },
  
  // Get test status
  getStatus: () => {
    return {
      enabled: smokeTests.config.enabled,
      isRunning: smokeTests.isRunning,
      totalRuns: smokeTests.results.length,
      lastRun: smokeTests.results[smokeTests.results.length - 1]?.timestamp,
      availableTests: Object.keys(smokeTests.tests)
    };
  }
};

// Initialize smoke tests
smokeTests.init();

// Add to global debugging
if (window.navDebug) {
  window.navDebug.commands.smokeTests = () => smokeTests.runAll();
  window.navDebug.commands.smokeResults = () => smokeTests.getResults();
  window.navDebug.commands.smokeStatus = () => smokeTests.getStatus();
  window.navDebug.commands.exportSmokeTests = () => smokeTests.exportResults();
  window.navDebug.commands.clearSmokeTests = () => smokeTests.clearResults();
}

// At end of file, assign to window
window.smokeTests = smokeTests;