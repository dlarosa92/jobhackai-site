/**
 * Unit tests for AI feedback validation utilities
 */

import { validateAIFeedback, validateFeedbackResult } from '../feedback-validator.js';

// Test data helpers
function createValidAIFeedback() {
  return {
    atsRubric: [
      { category: 'Keyword Match', score: 8, max: 10, feedback: 'Good', suggestions: [] },
      { category: 'ATS Formatting', score: 9, max: 10, feedback: 'Excellent', suggestions: [] }
    ],
    roleSpecificFeedback: {
      targetRoleUsed: 'Software Engineer',
      sections: [
        { section: 'Header & Contact', fitLevel: 'strong', diagnosis: 'Good', tips: ['tip1', 'tip2', 'tip3'], rewritePreview: 'Preview' },
        { section: 'Professional Summary', fitLevel: 'tunable', diagnosis: 'OK', tips: ['tip1', 'tip2', 'tip3'], rewritePreview: 'Preview' },
        { section: 'Experience', fitLevel: 'big_impact', diagnosis: 'Needs work', tips: ['tip1', 'tip2', 'tip3'], rewritePreview: 'Preview' },
        { section: 'Skills', fitLevel: 'strong', diagnosis: 'Good', tips: ['tip1', 'tip2', 'tip3'], rewritePreview: 'Preview' },
        { section: 'Education', fitLevel: 'tunable', diagnosis: 'OK', tips: ['tip1', 'tip2', 'tip3'], rewritePreview: 'Preview' }
      ]
    },
    atsIssues: [
      { id: 'missing_keywords', severity: 'medium', details: ['keyword1'] }
    ]
  };
}

function createInvalidAIFeedback(missingField) {
  const valid = createValidAIFeedback();
  if (missingField === 'atsRubric') {
    delete valid.atsRubric;
  } else if (missingField === 'roleSpecificFeedback') {
    delete valid.roleSpecificFeedback;
  } else if (missingField === 'atsIssues') {
    delete valid.atsIssues;
  }
  return valid;
}

// Test cases
const tests = [
  {
    name: 'Valid AI feedback (new format)',
    fn: () => {
      const feedback = createValidAIFeedback();
      const result = validateAIFeedback(feedback, false);
      if (!result.valid) {
        throw new Error(`Expected valid, got invalid. Missing: ${result.missing.join(', ')}`);
      }
      if (result.missing.length > 0) {
        throw new Error(`Expected no missing fields, got: ${result.missing.join(', ')}`);
      }
      if (result.details.roleSpecificFeedbackFormat !== 'new') {
        throw new Error(`Expected new format, got: ${result.details.roleSpecificFeedbackFormat}`);
      }
      return true;
    }
  },
  {
    name: 'Valid AI feedback (old format, when allowed)',
    fn: () => {
      const feedback = createValidAIFeedback();
      // Convert to old format
      feedback.roleSpecificFeedback = [
        { section: 'Header & Contact', score: '8/10', feedback: 'Good' },
        { section: 'Professional Summary', score: '7/10', feedback: 'OK' }
      ];
      const result = validateAIFeedback(feedback, true); // allowOldFormat = true
      if (!result.valid) {
        throw new Error(`Expected valid with old format, got invalid. Missing: ${result.missing.join(', ')}`);
      }
      if (result.details.roleSpecificFeedbackFormat !== 'old') {
        throw new Error(`Expected old format, got: ${result.details.roleSpecificFeedbackFormat}`);
      }
      return true;
    }
  },
  {
    name: 'Invalid AI feedback - missing atsRubric',
    fn: () => {
      const feedback = createInvalidAIFeedback('atsRubric');
      const result = validateAIFeedback(feedback, false);
      if (result.valid) {
        throw new Error('Expected invalid, got valid');
      }
      if (!result.missing.includes('atsRubric')) {
        throw new Error(`Expected atsRubric in missing, got: ${result.missing.join(', ')}`);
      }
      return true;
    }
  },
  {
    name: 'Invalid AI feedback - missing roleSpecificFeedback',
    fn: () => {
      const feedback = createInvalidAIFeedback('roleSpecificFeedback');
      const result = validateAIFeedback(feedback, false);
      if (result.valid) {
        throw new Error('Expected invalid, got valid');
      }
      if (!result.missing.includes('roleSpecificFeedback')) {
        throw new Error(`Expected roleSpecificFeedback in missing, got: ${result.missing.join(', ')}`);
      }
      return true;
    }
  },
  {
    name: 'Invalid AI feedback - missing atsIssues',
    fn: () => {
      const feedback = createInvalidAIFeedback('atsIssues');
      const result = validateAIFeedback(feedback, false);
      if (result.valid) {
        throw new Error('Expected invalid, got valid');
      }
      if (!result.missing.includes('atsIssues')) {
        throw new Error(`Expected atsIssues in missing, got: ${result.missing.join(', ')}`);
      }
      return true;
    }
  },
  {
    name: 'Valid AI feedback - partial sections (1-5 sections allowed)',
    fn: () => {
      // The schema allows 1-5 sections, so 3 sections should be valid
      const feedback = createValidAIFeedback();
      feedback.roleSpecificFeedback.sections = feedback.roleSpecificFeedback.sections.slice(0, 3); // Only 3 sections
      const result = validateAIFeedback(feedback, false);
      if (!result.valid) {
        throw new Error(`Expected valid (1-5 sections allowed), got invalid. Missing: ${result.missing.join(', ')}`);
      }
      return true;
    }
  },
  {
    name: 'Invalid AI feedback - empty sections array',
    fn: () => {
      // 0 sections should be invalid (minItems: 1 in schema)
      const feedback = createValidAIFeedback();
      feedback.roleSpecificFeedback.sections = [];
      const result = validateAIFeedback(feedback, false);
      if (result.valid) {
        throw new Error('Expected invalid (empty sections), got valid');
      }
      if (!result.missing.includes('roleSpecificFeedback')) {
        throw new Error(`Expected roleSpecificFeedback in missing, got: ${result.missing.join(', ')}`);
      }
      return true;
    }
  },
  {
    name: 'Invalid AI feedback - roleSpecificFeedback missing targetRoleUsed',
    fn: () => {
      const feedback = createValidAIFeedback();
      delete feedback.roleSpecificFeedback.targetRoleUsed;
      const result = validateAIFeedback(feedback, false);
      if (result.valid) {
        throw new Error('Expected invalid (missing targetRoleUsed), got valid');
      }
      if (!result.missing.includes('roleSpecificFeedback')) {
        throw new Error(`Expected roleSpecificFeedback in missing, got: ${result.missing.join(', ')}`);
      }
      return true;
    }
  },
  {
    name: 'validateFeedbackResult rejects old format',
    fn: () => {
      const feedback = createValidAIFeedback();
      // Convert to old format
      feedback.roleSpecificFeedback = [
        { section: 'Header & Contact', score: '8/10', feedback: 'Good' }
      ];
      const result = validateFeedbackResult(feedback);
      if (result.valid) {
        throw new Error('Expected invalid (old format not allowed in cache), got valid');
      }
      if (!result.missing.includes('roleSpecificFeedback')) {
        throw new Error(`Expected roleSpecificFeedback in missing, got: ${result.missing.join(', ')}`);
      }
      return true;
    }
  },
  {
    name: 'validateFeedbackResult accepts valid new format',
    fn: () => {
      const feedback = createValidAIFeedback();
      const result = validateFeedbackResult(feedback);
      if (!result.valid) {
        throw new Error(`Expected valid, got invalid. Missing: ${result.missing.join(', ')}`);
      }
      return true;
    }
  },
  {
    name: 'Empty atsRubric array is invalid',
    fn: () => {
      const feedback = createValidAIFeedback();
      feedback.atsRubric = [];
      const result = validateAIFeedback(feedback, false);
      if (result.valid) {
        throw new Error('Expected invalid (empty atsRubric), got valid');
      }
      if (!result.missing.includes('atsRubric')) {
        throw new Error(`Expected atsRubric in missing, got: ${result.missing.join(', ')}`);
      }
      return true;
    }
  },
  {
    name: 'Null/undefined feedback is invalid',
    fn: () => {
      const result1 = validateAIFeedback(null, false);
      const result2 = validateAIFeedback(undefined, false);
      if (result1.valid || result2.valid) {
        throw new Error('Expected invalid for null/undefined, got valid');
      }
      return true;
    }
  },
  {
    name: 'allowMissingRoleFeedback=true accepts missing roleSpecificFeedback (no role scenario)',
    fn: () => {
      const feedback = createValidAIFeedback();
      // Remove role-specific feedback to simulate no-role scenario
      delete feedback.roleSpecificFeedback;
      
      // Should be invalid when not allowed to miss role feedback
      const resultNotAllowed = validateAIFeedback(feedback, false, false);
      if (resultNotAllowed.valid) {
        throw new Error('Expected invalid when allowMissingRoleFeedback=false, got valid');
      }
      if (!resultNotAllowed.missing.includes('roleSpecificFeedback')) {
        throw new Error(`Expected roleSpecificFeedback in missing, got: ${resultNotAllowed.missing.join(', ')}`);
      }
      
      // Should be valid when allowed to miss role feedback (no role provided)
      const resultAllowed = validateAIFeedback(feedback, false, true);
      if (!resultAllowed.valid) {
        throw new Error(`Expected valid when allowMissingRoleFeedback=true, got invalid. Missing: ${resultAllowed.missing.join(', ')}`);
      }
      if (resultAllowed.details.roleSpecificFeedbackSkipped !== true) {
        throw new Error('Expected roleSpecificFeedbackSkipped=true in details');
      }
      
      return true;
    }
  },
  {
    name: 'allowMissingRoleFeedback=true still requires atsRubric and atsIssues',
    fn: () => {
      // Test that even with allowMissingRoleFeedback=true, other fields are still required
      const feedbackNoRubric = createValidAIFeedback();
      delete feedbackNoRubric.roleSpecificFeedback;
      delete feedbackNoRubric.atsRubric;
      
      const result1 = validateAIFeedback(feedbackNoRubric, false, true);
      if (result1.valid) {
        throw new Error('Expected invalid when atsRubric missing, even with allowMissingRoleFeedback=true');
      }
      if (!result1.missing.includes('atsRubric')) {
        throw new Error(`Expected atsRubric in missing, got: ${result1.missing.join(', ')}`);
      }
      
      const feedbackNoIssues = createValidAIFeedback();
      delete feedbackNoIssues.roleSpecificFeedback;
      delete feedbackNoIssues.atsIssues;
      
      const result2 = validateAIFeedback(feedbackNoIssues, false, true);
      if (result2.valid) {
        throw new Error('Expected invalid when atsIssues missing, even with allowMissingRoleFeedback=true');
      }
      if (!result2.missing.includes('atsIssues')) {
        throw new Error(`Expected atsIssues in missing, got: ${result2.missing.join(', ')}`);
      }
      
      return true;
    }
  },
  {
    name: 'validateFeedbackResult passes allowMissingRoleFeedback parameter correctly',
    fn: () => {
      const feedback = createValidAIFeedback();
      delete feedback.roleSpecificFeedback;
      
      // Should be invalid when not allowed
      const result1 = validateFeedbackResult(feedback, false);
      if (result1.valid) {
        throw new Error('Expected invalid when allowMissingRoleFeedback=false, got valid');
      }
      
      // Should be valid when allowed
      const result2 = validateFeedbackResult(feedback, true);
      if (!result2.valid) {
        throw new Error(`Expected valid when allowMissingRoleFeedback=true, got invalid. Missing: ${result2.missing.join(', ')}`);
      }
      
      return true;
    }
  }
];

// Run tests
async function runTests() {
  console.log('🧪 Running feedback validator tests...\n');
  
  let passed = 0;
  let failed = 0;
  const failures = [];
  
  for (const test of tests) {
    try {
      const result = test.fn();
      if (result === true) {
        console.log(`✅ ${test.name}`);
        passed++;
      } else {
        console.log(`❌ ${test.name} - Test returned unexpected value`);
        failed++;
        failures.push({ name: test.name, error: 'Test returned unexpected value' });
      }
    } catch (error) {
      console.log(`❌ ${test.name}`);
      console.log(`   Error: ${error.message}`);
      failed++;
      failures.push({ name: test.name, error: error.message });
    }
  }
  
  console.log(`\n📊 Results: ${passed} passed, ${failed} failed`);
  
  if (failures.length > 0) {
    console.log('\n❌ Failures:');
    failures.forEach(f => {
      console.log(`   - ${f.name}: ${f.error}`);
    });
    process.exit(1);
  } else {
    console.log('\n✅ All tests passed!');
    process.exit(0);
  }
}

runTests();

