# Autonomous Agent Guide for JobHackAI

## 🚨 **CRITICAL SAFETY PROTOCOLS**

### **ALWAYS Start with Analysis**
```javascript
// Step 1: Run comprehensive analysis
const analysis = agentInterface.analyze();

// Step 2: Check if safe to proceed
if (!analysis.safeToProceed) {
  console.error('❌ Site is not healthy - aborting operation');
  return;
}
```

### **ALWAYS Use Safe Operations**
```javascript
// Use safe.execute() for any risky operations
const result = agentInterface.safe.execute(() => {
  // Your operation here
  return 'operation result';
}, 'Description of what you are doing');
```

### **ALWAYS Create Recovery Points**
```javascript
// Before making changes
const recoveryPoint = agentInterface.recovery.createPoint('Before making changes');
```

## 🔧 **Available Tools**

### **Health Monitoring**
- `agentInterface.health.check()` - Quick health check
- `agentInterface.health.fix()` - Auto-fix issues
- `agentInterface.health.report()` - Generate detailed report

### **Navigation Operations**
- `agentInterface.navigation.getState()` - Get current state
- `agentInterface.navigation.setPlan(plan)` - Safely change plan
- `agentInterface.navigation.update()` - Safely update navigation
- `agentInterface.navigation.test()` - Test navigation changes

### **Recovery Operations**
- `agentInterface.recovery.createPoint(description)` - Create recovery point
- `agentInterface.recovery.list()` - List available points
- `agentInterface.recovery.restore(name)` - Restore to point
- `agentInterface.recovery.emergency()` - Emergency restore

### **Safe Operations**
- `agentInterface.safe.execute(operation, description)` - Execute with backup
- `agentInterface.safe.batch(operations)` - Execute multiple operations safely

### **Validation**
- `agentInterface.validate.plan(plan)` - Validate plan exists
- `agentInterface.validate.feature(feature)` - Validate feature exists
- `agentInterface.validate.navConfig(plan)` - Validate navigation config

### **Information**
- `agentInterface.info.plans()` - Get available plans
- `agentInterface.info.features()` - Get all features
- `agentInterface.info.planFeatures(plan)` - Get plan features
- `agentInterface.info.navItems(plan)` - Get navigation items

## 📋 **Standard Operating Procedures**

### **1. Site Analysis**
```javascript
// Always start here
const analysis = agentInterface.analyze();
console.log('Analysis complete:', analysis);
```

### **2. Making Changes**
```javascript
// Create recovery point
const recoveryPoint = agentInterface.recovery.createPoint('Before changes');

// Use safe execution
const result = agentInterface.safe.execute(() => {
  // Your changes here
  agentInterface.navigation.setPlan('premium');
  return 'Changes completed';
}, 'Updating user plan');

// Check if successful
if (result.success) {
  console.log('✅ Changes successful');
} else {
  console.log('❌ Changes failed, restored automatically');
}
```

### **3. Batch Operations**
```javascript
const operations = [
  () => agentInterface.navigation.setPlan('trial'),
  () => agentInterface.navigation.update(),
  () => agentInterface.health.check()
];

const result = agentInterface.safe.batch(operations);
console.log('Batch completed:', result.completed);
```

### **4. Emergency Recovery**
```javascript
// If something goes wrong
const restored = agentInterface.recovery.emergency();
if (restored) {
  console.log('✅ Emergency recovery successful');
} else {
  console.log('❌ No backup available');
}
```

## 🚨 **Common Pitfalls to Avoid**

### **❌ DON'T:**
- Make changes without analysis
- Skip recovery points
- Use direct functions instead of safe.execute()
- Ignore health check results
- Make multiple changes without testing between them

### **✅ DO:**
- Always run analysis first
- Create recovery points before changes
- Use safe.execute() for all operations
- Check health after each change
- Test navigation after changes
- Use batch operations for multiple changes

## 🔍 **Troubleshooting Guide**

### **Site Not Healthy**
```javascript
// Run analysis
const analysis = agentInterface.analyze();

// Check specific issues
console.log('Navigation issues:', analysis.health.navigation.issues);
console.log('DOM issues:', analysis.health.dom.missing);

// Try auto-fix
const fixResult = agentInterface.health.fix();
console.log('Fixes applied:', fixResult.fixes);
```

### **Navigation Broken**
```javascript
// Check navigation state
const navState = agentInterface.navigation.getState();
console.log('Navigation state:', navState);

// Test navigation
const testResult = agentInterface.navigation.test();
console.log('Test result:', testResult);

// Update if needed
if (!testResult.improved) {
  agentInterface.navigation.update();
}
```

### **Plan Issues**
```javascript
// Validate plan
const isValid = agentInterface.validate.plan('premium');
console.log('Plan valid:', isValid);

// Get plan info
const features = agentInterface.info.planFeatures('premium');
console.log('Plan features:', features);
```

## 📊 **Monitoring and Reporting**

### **Generate Health Report**
```javascript
const report = agentInterface.health.report();
console.log('Health report:', report);
```

### **Check Performance**
```javascript
const health = agentInterface.health.check();
console.log('Performance:', health.performance);
```

### **Monitor Errors**
```javascript
const health = agentInterface.health.check();
console.log('Errors:', health.errors);
```

## 🎯 **Best Practices**

1. **Always analyze first** - Never skip the analysis step
2. **Create recovery points** - Before any changes
3. **Use safe operations** - Always use safe.execute()
4. **Test after changes** - Verify everything works
5. **Monitor health** - Check health after operations
6. **Document changes** - Use descriptive recovery point names
7. **Handle failures gracefully** - Use emergency recovery if needed

## 🚨 **Emergency Procedures**

### **Site Completely Broken**
```javascript
// Emergency restore
const restored = agentInterface.recovery.emergency();

// If no backup, reset to defaults
if (!restored) {
  agentInterface.safe.execute(() => {
    localStorage.clear();
    location.reload();
  }, 'Emergency reset');
}
```

### **Navigation Not Working**
```javascript
// Force navigation update
agentInterface.safe.execute(() => {
  updateNavigation();
  location.reload();
}, 'Force navigation reset');
```

### **Plan System Broken**
```javascript
// Reset plan system
agentInterface.safe.execute(() => {
  localStorage.removeItem('user-plan');
  localStorage.removeItem('dev-plan');
  localStorage.setItem('user-authenticated', 'false');
  updateNavigation();
}, 'Reset plan system');
```

## 📞 **Getting Help**

If you encounter issues:
1. Run `agentInterface.analyze()` and check the report
2. Try `agentInterface.health.fix()` for auto-fixes
3. Use `agentInterface.recovery.emergency()` if needed
4. Check the console for detailed error messages
5. Use `navDebug.help()` for available commands

Remember: **Safety first, always use the provided tools and never make direct changes without proper safeguards.** 