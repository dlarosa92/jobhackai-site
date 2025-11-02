// Bugbot validation for JobHackAI QA Rules
const fs = require('fs');
const path = require('path');

const checks = [
  { name: 'Build output is static export', file: 'app/next.config.js', contains: "output: 'export'", severity: 'critical' },
  { name: 'Auth guard inclusion (Dashboard)', file: 'dashboard.html', contains: 'static-auth-guard.js', severity: 'critical' },
  { name: 'Auth guard inclusion (Account Settings)', file: 'account-setting.html', contains: 'static-auth-guard.js', severity: 'critical' },
  { name: 'Auth guard inclusion (Billing Management)', file: 'billing-management.html', contains: 'static-auth-guard.js', severity: 'major' },
  { name: 'Auth guard inclusion (Resume Feedback Pro)', file: 'resume-feedback-pro.html', contains: 'static-auth-guard.js', severity: 'major' },
  { name: 'Auth guard inclusion (Mock Interview)', file: 'mock-interview.html', contains: 'static-auth-guard.js', severity: 'major' },
  { name: 'Auth guard inclusion (LinkedIn Optimizer)', file: 'linkedin-optimizer.html', contains: 'static-auth-guard.js', severity: 'major' },
  { name: 'Auth guard inclusion (Interview Questions)', file: 'interview-questions.html', contains: 'static-auth-guard.js', severity: 'major' },
  { name: 'Auth guard inclusion (Cover Letter Generator)', file: 'cover-letter-generator.html', contains: 'static-auth-guard.js', severity: 'major' },
  { name: 'Stripe webhook handlers present', file: 'functions/api/stripe-webhook.js', contains: ['customer.subscription.updated', 'verifyStripeWebhook'], severity: 'critical' },
  { name: 'Functions export handler present (middleware)', file: 'functions/_middleware.js', contains: 'export async function onRequest', severity: 'major' },
  { name: 'KV binding present in Wrangler config (local)', file: 'app/wrangler.local.toml', contains: 'JOBHACKAI_KV', severity: 'major' },
  { name: 'Postbuild copies static assets', file: 'app/package.json', contains: 'cp -r ../*.html out/', severity: 'major' },
];

const root = path.join(__dirname, '..');
let passed = 0;
let failed = 0;
const failures = [];

for (const check of checks) {
  const filePath = path.join(root, check.file);
  if (!fs.existsSync(filePath)) {
    console.log(`❌ [${check.severity.toUpperCase()}] ${check.name}: File ${check.file} not found`);
    failed++;
    failures.push({ check, reason: 'file not found' });
    continue;
  }
  
  const content = fs.readFileSync(filePath, 'utf-8');
  const contains = Array.isArray(check.contains) 
    ? check.contains.every(c => content.includes(c))
    : content.includes(check.contains);
  
  if (contains) {
    console.log(`✅ [${check.severity.toUpperCase()}] ${check.name}`);
    passed++;
  } else {
    console.log(`❌ [${check.severity.toUpperCase()}] ${check.name}: Missing required content in ${check.file}`);
    failed++;
    failures.push({ check, reason: 'missing content' });
  }
}

console.log(`\n📊 Summary: ${passed}/${checks.length} passed, ${failed} failed`);
if (failures.length > 0) {
  console.log('\n❌ Failures:');
  failures.forEach(f => console.log(`  - ${f.check.name}: ${f.reason}`));
  process.exit(1);
}

console.log('\n✅ All Bugbot checks passed!');

