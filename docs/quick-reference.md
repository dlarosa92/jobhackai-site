# 🚀 JobHackAI Quick Reference Guide

## **For Autonomous Agents & Developers**

### **🎯 Essential Commands (Console)**

```javascript
// 🚨 ALWAYS START HERE - Full site analysis
agentInterface.analyze()

// 🔧 Quick health check
siteHealth.checkAll()

// 📋 View recent audit trail
auditTrail.getRecentEntries(10)

// 🧪 Run smoke tests
smokeTests.runAll()

// 🔍 View error reports
errorReporter.getRecentReports(5)
```

---

## **🔧 Troubleshooting Systems**

### **1. Error Reporting (`errorReporter`)**
- **Captures**: Unhandled errors, health issues, agent actions
- **Storage**: localStorage + optional endpoint
- **Commands**:
  ```javascript
  errorReporter.getReports()           // All reports
  errorReporter.getRecentReports(10)   // Recent 10
  errorReporter.generateSummary()      // Summary stats
  errorReporter.exportReports()        // Download JSON
  errorReporter.clearReports()         // Clear all
  ```

### **2. Self-Healing (`selfHealing`)**
- **Auto-fixes**: Navigation, localStorage, DOM issues
- **User alerts**: Friendly notifications with "Fix Now" button
- **Commands**:
  ```javascript
  selfHealing.checkForIssues()         // Manual check
  selfHealing.manualFix()              // Trigger fix
  selfHealing.getStatus()              // System status
  selfHealing.reset()                  // Reset attempts
  ```

### **3. Audit Trail (`auditTrail`)**
- **Tracks**: All agent actions, plan changes, backups, errors
- **Auto-saves**: Every 5 seconds
- **Commands**:
  ```javascript
  auditTrail.getEntries()              // All entries
  auditTrail.getRecentEntries(10)      // Recent 10
  auditTrail.getEntriesByType('agent_action')  // Filter by type
  auditTrail.generateSummary()         // Summary stats
  auditTrail.exportEntries()           // Download JSON
  auditTrail.searchEntries('error')    // Search entries
  ```

### **4. Smoke Tests (`smokeTests`)**
- **Tests**: DOM, navigation, plans, features, health, all systems
- **Auto-runs**: On page load and errors
- **Commands**:
  ```javascript
  smokeTests.runAll()                  // Run all tests
  smokeTests.runTest('navigation')     // Run specific test
  smokeTests.getResults()              // All results
  smokeTests.getLatestResult()         // Latest run
  smokeTests.exportResults()           // Download JSON
  ```

### **5. Health Check (`siteHealth`)**
- **Checks**: Navigation, DOM, localStorage, scripts, styles
- **Auto-fix**: Common issues
- **Commands**:
  ```javascript
  siteHealth.checkAll()                // Full health check
  siteHealth.generateReport()          // Detailed report
  siteHealth.autoFix()                 // Auto-fix issues
  ```

### **6. State Management (`stateManager`)**
- **Backups**: Automatic before risky operations
- **Recovery**: Manual and emergency restore
- **Commands**:
  ```javascript
  stateManager.backup('my-backup')     // Create backup
  stateManager.restore('my-backup')    // Restore backup
  stateManager.list()                  // List backups
  stateManager.delete('my-backup')     // Delete backup
  ```

---

## **🤖 Autonomous Agent Workflow**

### **1. Before Making Changes**
```javascript
// Step 1: Analyze site health
const analysis = agentInterface.analyze();
if (!analysis.safeToProceed) {
  console.error('❌ Site not healthy - aborting');
  return;
}

// Step 2: Create recovery point
const recoveryPoint = agentInterface.recovery.createPoint('Before changes');

// Step 3: Run smoke tests
const testResults = smokeTests.runAll();
if (testResults.failed > 0) {
  console.warn('⚠️ Some tests failed:', testResults.results.filter(r => !r.passed));
}
```

### **2. During Changes**
```javascript
// Use safe operations
const result = agentInterface.safe.execute(() => {
  // Your risky operation here
  return 'operation result';
}, 'Description of what you are doing');

// Log agent actions
auditTrail.logAgentAction('feature_update', result, { feature: 'resume-scoring' });
```

### **3. After Changes**
```javascript
// Verify changes worked
const health = siteHealth.checkAll();
if (!health.navigation.healthy || !health.dom.healthy) {
  console.error('❌ Changes caused issues');
  agentInterface.recovery.restore(recoveryPoint);
}

// Run smoke tests
const finalTests = smokeTests.runAll();
console.log(`✅ Final tests: ${finalTests.passed}/${finalTests.total} passed`);
```

---

## **🚨 Emergency Procedures**

### **Site Broken - Quick Recovery**
```javascript
// 1. Emergency restore
agentInterface.recovery.emergency();

// 2. Force navigation update
updateNavigation();

// 3. Check health
siteHealth.checkAll();

// 4. Run tests
smokeTests.runAll();
```

### **Navigation Issues**
```javascript
// 1. Check navigation health
const navHealth = siteHealth.checkAll().navigation;

// 2. Force update
updateNavigation();

// 3. Check DOM elements
document.querySelector('.nav-group')?.innerHTML;
document.querySelector('.nav-links')?.innerHTML;
```

### **Plan/Auth Issues**
```javascript
// 1. Check current state
localStorage.getItem('user-authenticated');
localStorage.getItem('user-plan');

// 2. Reset to defaults
setAuthState(false, 'free');

// 3. Update navigation
updateNavigation();
```

---

## **📊 Debugging Commands**

### **Global Debug Interface (`navDebug`)**
```javascript
// Navigation
navDebug.getState()                    // Current state
navDebug.testNavigation()              // Test rendering
navDebug.setPlan('premium')            // Set plan
navDebug.resetState()                  // Reset all

// Health & Safety
navDebug.health()                      // Health check
navDebug.report()                      // Generate report
navDebug.fix()                         // Auto-fix

// State Management
navDebug.backup('debug-backup')        // Create backup
navDebug.restore('debug-backup')       // Restore backup
navDebug.list()                        // List backups

// Agent Interface
navDebug.analyze()                     // Full analysis
navDebug.agent()                       // Agent interface
navDebug.recovery()                    // Recovery tools

// Error Reporting
navDebug.errorReports()                // View errors
navDebug.errorSummary()                // Error summary
navDebug.exportErrors()                // Export errors

// Audit Trail
navDebug.auditTrail()                  // View audit log
navDebug.auditSummary()                // Audit summary
navDebug.exportAudit()                 // Export audit

// Smoke Tests
navDebug.smokeTests()                  // Run tests
navDebug.smokeResults()                // View results
navDebug.smokeStatus()                 // Test status

// Self-Healing
navDebug.selfHealingStatus()           // Healing status
navDebug.manualFix()                   // Trigger fix
```

---

## **🔍 Common Issues & Solutions**

### **Navigation Not Rendering**
```javascript
// Check if elements exist
document.querySelector('.nav-group');
document.querySelector('.nav-links');

// Force update
updateNavigation();

// Check for errors
errorReporter.getRecentReports(5);
```

### **Plan Toggle Not Working**
```javascript
// Check current plan
localStorage.getItem('user-plan');
localStorage.getItem('dev-plan');

// Test plan setting
setPlan('premium');
updateNavigation();

// Check feature access
isFeatureUnlocked('resume-scoring');
```

### **Page Not Loading Properly**
```javascript
// Run health check
siteHealth.checkAll();

// Check for missing elements
smokeTests.runTest('dom');

// Look for errors
errorReporter.getRecentReports(10);
```

---

## **📈 Performance Monitoring**

### **Check System Performance**
```javascript
// Health check performance
const start = Date.now();
siteHealth.checkAll();
console.log(`Health check took: ${Date.now() - start}ms`);

// Navigation update performance
const navStart = Date.now();
updateNavigation();
console.log(`Navigation update took: ${Date.now() - navStart}ms`);

// Smoke test performance
const testStart = Date.now();
smokeTests.runAll();
console.log(`Smoke tests took: ${Date.now() - testStart}ms`);
```

---

## **🎯 Best Practices**

### **For Agents**
1. **Always analyze first** - `agentInterface.analyze()`
2. **Create recovery points** - Before any changes
3. **Use safe operations** - `agentInterface.safe.execute()`
4. **Log your actions** - `auditTrail.logAgentAction()`
5. **Verify after changes** - Run smoke tests
6. **Handle errors gracefully** - Check error reports

### **For Developers**
1. **Test before committing** - Run smoke tests
2. **Check health regularly** - Monitor site health
3. **Review audit trail** - Track changes
4. **Export data for analysis** - Use export functions
5. **Use debugging tools** - Leverage navDebug interface

---

## **📞 Getting Help**

### **When Things Go Wrong**
1. **Check error reports** - `errorReporter.getRecentReports()`
2. **Review audit trail** - `auditTrail.getRecentEntries()`
3. **Run smoke tests** - `smokeTests.runAll()`
4. **Check health** - `siteHealth.checkAll()`
5. **Use emergency restore** - `agentInterface.recovery.emergency()`

### **For More Details**
- **Autonomous Agent Guide**: `docs/autonomous-agent-guide.md`
- **Agent Quick Reference**: `docs/agent-quick-reference.md`
- **Design System**: `docs/design-system.md`
- **Project Notes**: `docs/project-notes.md` 