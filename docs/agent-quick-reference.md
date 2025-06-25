# 🤖 Autonomous Agent Quick Reference

## 🚨 **MANDATORY STARTUP SEQUENCE**
```javascript
// 1. ALWAYS analyze first
const analysis = agentInterface.analyze();

// 2. Check if safe to proceed
if (!analysis.safeToProceed) {
  console.error('❌ ABORT: Site not healthy');
  return;
}

// 3. Create recovery point
const recoveryPoint = agentInterface.recovery.createPoint('Agent operation started');
```

## 🔧 **ESSENTIAL COMMANDS**

### **Health & Safety**
- `agentInterface.analyze()` - **START HERE** - Full site analysis
- `agentInterface.health.check()` - Quick health check
- `agentInterface.health.fix()` - Auto-fix issues
- `agentInterface.recovery.emergency()` - Emergency restore

### **Safe Operations**
- `agentInterface.safe.execute(operation, description)` - **USE THIS** for all changes
- `agentInterface.safe.batch([op1, op2, op3])` - Multiple operations safely

### **Navigation**
- `agentInterface.navigation.getState()` - Get current state
- `agentInterface.navigation.setPlan(plan)` - Change plan safely
- `agentInterface.navigation.update()` - Update navigation
- `agentInterface.navigation.test()` - Test navigation

### **Recovery**
- `agentInterface.recovery.createPoint(description)` - Create backup
- `agentInterface.recovery.list()` - List backups
- `agentInterface.recovery.restore(name)` - Restore to backup

## 📋 **STANDARD WORKFLOW**

### **Making Changes**
```javascript
// 1. Analyze
const analysis = agentInterface.analyze();
if (!analysis.safeToProceed) return;

// 2. Create recovery point
const recoveryPoint = agentInterface.recovery.createPoint('Before changes');

// 3. Make changes safely
const result = agentInterface.safe.execute(() => {
  // Your changes here
  agentInterface.navigation.setPlan('premium');
  return 'Changes completed';
}, 'Updating user plan');

// 4. Check result
if (result.success) {
  console.log('✅ Success');
} else {
  console.log('❌ Failed, restored automatically');
}
```

### **Multiple Changes**
```javascript
const operations = [
  () => agentInterface.navigation.setPlan('trial'),
  () => agentInterface.navigation.update(),
  () => agentInterface.health.check()
];

const result = agentInterface.safe.batch(operations);
console.log('Batch completed:', result.completed);
```

## 🚨 **EMERGENCY COMMANDS**

### **Site Broken**
```javascript
// Emergency restore
agentInterface.recovery.emergency();

// If that fails, reset everything
agentInterface.safe.execute(() => {
  localStorage.clear();
  location.reload();
}, 'Emergency reset');
```

### **Navigation Broken**
```javascript
agentInterface.safe.execute(() => {
  updateNavigation();
  location.reload();
}, 'Force navigation reset');
```

## ❌ **NEVER DO THIS**
- Make changes without `agentInterface.analyze()`
- Use direct functions instead of `agentInterface.safe.execute()`
- Skip recovery points
- Ignore health check results
- Make multiple changes without testing

## ✅ **ALWAYS DO THIS**
- Start with `agentInterface.analyze()`
- Use `agentInterface.safe.execute()` for changes
- Create recovery points before changes
- Check health after operations
- Test navigation after changes

## 🔍 **TROUBLESHOOTING**

### **Quick Diagnosis**
```javascript
// Check what's wrong
const health = agentInterface.health.check();
console.log('Issues:', health.navigation.issues);
console.log('Missing DOM:', health.dom.missing);

// Try to fix
agentInterface.health.fix();
```

### **Get Help**
```javascript
// Show all available commands
navDebug.help();

// Get detailed report
agentInterface.health.report();
```

## 📊 **MONITORING**

### **Check Performance**
```javascript
const health = agentInterface.health.check();
console.log('Performance:', health.performance);
```

### **Monitor Errors**
```javascript
const health = agentInterface.health.check();
console.log('Errors:', health.errors.count);
```

## 🎯 **REMEMBER**
1. **ALWAYS** analyze first
2. **ALWAYS** use safe operations
3. **ALWAYS** create recovery points
4. **NEVER** make direct changes
5. **ALWAYS** test after changes

**Safety first, always use the provided tools!** 