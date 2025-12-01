/**
 * ATS Scoring Test Suite
 * 
 * Tests the rule-based ATS scoring engine against the official test resume suite.
 * OpenAI-free by default - only runs local scoring.
 * 
 * Usage:
 *   node ats-test-suite.test.mjs              # Run all tests (OpenAI-free)
 *   node ats-test-suite.test.mjs --verbose    # Show detailed output
 *   node ats-test-suite.test.mjs --with-openai  # Include OpenAI feedback test (requires API key)
 * 
 * Test Resumes Location:
 *   docs/Test Resumes/ATS-Test-Suite/*.txt
 */

import assert from 'node:assert';
import { readFileSync, readdirSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { scoreResume } from '../ats-scoring-engine.js';
import { createTestEnv } from './test-env-helper.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Parse CLI args
const args = process.argv.slice(2);
const VERBOSE = args.includes('--verbose') || args.includes('-v');
const WITH_OPENAI = args.includes('--with-openai');

// Test environment
const testEnv = createTestEnv();

// Path to test resumes
const TEST_RESUMES_DIR = join(__dirname, '../../../../docs/Test Resumes/ATS-Test-Suite');

/**
 * Expected score ranges for each test resume
 * These are reasonable ranges - not strict equality checks
 * Format: { min: number, max: number } for overallScore (0-100)
 */
/**
 * Expected score ranges for each test resume
 * These are calibrated against actual engine behavior as of 2025-01
 * Format: { min: number, max: number } for each score component
 * 
 * IMPORTANT: These ranges serve as regression baselines.
 * If a test fails, either the engine changed (investigate!) or the 
 * expected range needs updating with justification.
 */
const EXPECTED_SCORE_RANGES = {
  'resume-01-excellent-baseline': {
    description: 'Well-formatted resume with good keywords, structure, and metrics',
    targetRole: 'Software Engineer',
    overallScore: { min: 85, max: 100 },
    keywordScore: { min: 35, max: 40 },
    formattingScore: { min: 18, max: 20 },
    structureScore: { min: 10, max: 15 },
    toneScore: { min: 12, max: 15 },
    grammarScore: { min: 6, max: 10 }
  },
  'resume-02-keyword-stuffing': {
    description: 'Resume with repeated keywords (stuffing detected but still scores well)',
    targetRole: 'Software Engineer',
    overallScore: { min: 75, max: 95 }, // Stuffed resumes can still score high on keywords
    keywordScore: { min: 35, max: 40 },
    formattingScore: { min: 18, max: 20 },
    structureScore: { min: 8, max: 15 },
    toneScore: { min: 5, max: 12 }, // Lower tone due to repetition
    grammarScore: { min: 6, max: 10 }
  },
  'resume-03-formatting-issues': {
    description: 'Resume with tables - missing keywords (skills table not parsed well)',
    targetRole: 'Software Engineer',
    overallScore: { min: 30, max: 60 },
    keywordScore: { min: 0, max: 15 }, // Table-based skills may not parse
    formattingScore: { min: 8, max: 18 }, // Tables detected
    structureScore: { min: 8, max: 15 },
    toneScore: { min: 8, max: 15 },
    grammarScore: { min: 6, max: 10 }
  },
  'resume-04-structure-tone-issues': {
    description: 'Resume with poor structure and run-on sentences',
    targetRole: 'Software Engineer',
    overallScore: { min: 40, max: 65 },
    keywordScore: { min: 0, max: 15 }, // Missing standard keywords
    formattingScore: { min: 15, max: 20 },
    structureScore: { min: 8, max: 15 }, // Education before Experience
    toneScore: { min: 5, max: 12 }, // Run-on sentences
    grammarScore: { min: 6, max: 10 }
  },
  'resume-05-grammar-edge-cases': {
    description: 'Resume with encoding edge cases (non-standard keywords)',
    targetRole: 'Software Engineer',
    overallScore: { min: 35, max: 60 },
    keywordScore: { min: 0, max: 10 }, // Keywords may be non-standard
    formattingScore: { min: 18, max: 20 },
    structureScore: { min: 8, max: 15 },
    toneScore: { min: 5, max: 12 },
    grammarScore: { min: 6, max: 10 }
  },
  'resume-06-role-specific-platform': {
    description: 'Platform Engineer resume with role-specific keywords',
    targetRole: 'Platform Engineer',
    overallScore: { min: 85, max: 100 },
    keywordScore: { min: 35, max: 40 },
    formattingScore: { min: 18, max: 20 },
    structureScore: { min: 10, max: 15 },
    toneScore: { min: 8, max: 15 },
    grammarScore: { min: 6, max: 10 }
  },
  'resume-07-alternative-operators': {
    description: 'Data Engineer resume testing or/slash phrase matching',
    targetRole: 'Data Engineer',
    overallScore: { min: 85, max: 100 },
    keywordScore: { min: 35, max: 40 },
    formattingScore: { min: 18, max: 20 },
    structureScore: { min: 10, max: 15 },
    toneScore: { min: 10, max: 15 },
    grammarScore: { min: 6, max: 10 }
  },
  'resume-08-non-english-spanish': {
    description: 'Spanish-language resume (non-English detection)',
    targetRole: 'Software Engineer',
    overallScore: { min: 35, max: 65 },
    keywordScore: { min: 0, max: 15 }, // English keywords missing
    formattingScore: { min: 12, max: 20 },
    structureScore: { min: 10, max: 15 },
    toneScore: { min: 5, max: 12 },
    grammarScore: { min: 4, max: 8 } // Low confidence for non-English
  },
  'resume-09-very-long': {
    description: 'Very long resume (stress test, may have grammar issues)',
    targetRole: 'Software Engineer',
    overallScore: { min: 65, max: 90 },
    keywordScore: { min: 25, max: 40 },
    formattingScore: { min: 18, max: 20 },
    structureScore: { min: 10, max: 15 },
    toneScore: { min: 5, max: 12 },
    grammarScore: { min: 3, max: 8 } // Long text may have more issues
  },
  'resume-10-very-short': {
    description: 'Minimal resume with very little content',
    targetRole: 'Software Engineer',
    overallScore: { min: 35, max: 60 },
    keywordScore: { min: 0, max: 10 }, // Almost no keywords
    formattingScore: { min: 15, max: 20 }, // Simple format OK
    structureScore: { min: 10, max: 15 }, // Basic sections present
    toneScore: { min: 5, max: 12 }, // Minimal bullets
    grammarScore: { min: 4, max: 8 }
  },
  'resume-11-scanned-pdf-simulation': {
    description: 'Simulates OCR output from scanned PDF',
    targetRole: 'Software Engineer',
    overallScore: { min: 55, max: 80 },
    keywordScore: { min: 8, max: 25 },
    formattingScore: { min: 18, max: 20 },
    structureScore: { min: 8, max: 15 },
    toneScore: { min: 10, max: 15 },
    grammarScore: { min: 6, max: 10 }
  }
};

/**
 * Load all .txt test resumes from the test suite directory
 */
function loadTestResumes() {
  if (!existsSync(TEST_RESUMES_DIR)) {
    throw new Error(`Test resumes directory not found: ${TEST_RESUMES_DIR}`);
  }

  const files = readdirSync(TEST_RESUMES_DIR);
  const txtFiles = files.filter(f => f.endsWith('.txt'));

  if (txtFiles.length === 0) {
    throw new Error('No .txt test resume files found');
  }

  return txtFiles.map(filename => {
    const baseName = filename.replace('.txt', '');
    const filePath = join(TEST_RESUMES_DIR, filename);
    const content = readFileSync(filePath, 'utf8');
    const expected = EXPECTED_SCORE_RANGES[baseName] || {
      description: 'Unknown test case',
      targetRole: 'Software Engineer',
      overallScore: { min: 0, max: 100 }
    };

    return {
      filename,
      baseName,
      content,
      targetRole: expected.targetRole,
      description: expected.description,
      expected
    };
  });
}

/**
 * Test a single resume
 */
async function testResume(resume) {
  const startTime = Date.now();
  let result;
  let error = null;

  try {
    result = await scoreResume(
      resume.content,
      resume.targetRole,
      { isMultiColumn: false },
      testEnv
    );
  } catch (err) {
    error = err;
  }

  const duration = Date.now() - startTime;

  return {
    resume,
    result,
    error,
    duration
  };
}

/**
 * Validate score against expected range
 */
function validateScore(actual, expected, scoreName) {
  if (expected === undefined) return { valid: true };
  
  const value = typeof actual === 'object' ? actual.score : actual;
  const min = expected.min ?? 0;
  const max = expected.max ?? 100;

  const valid = value >= min && value <= max;
  return {
    valid,
    value,
    min,
    max,
    message: valid 
      ? `✓ ${scoreName}: ${value} (range: ${min}-${max})`
      : `✗ ${scoreName}: ${value} OUT OF RANGE (expected: ${min}-${max})`
  };
}

/**
 * Run all tests
 */
async function runTests() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  ATS SCORING TEST SUITE');
  console.log('  OpenAI-free rule-based scoring validation');
  console.log('═══════════════════════════════════════════════════════════════\n');

  // Load test resumes
  let resumes;
  try {
    resumes = loadTestResumes();
    console.log(`📂 Loaded ${resumes.length} test resumes from:`);
    console.log(`   ${TEST_RESUMES_DIR}\n`);
  } catch (err) {
    console.error('❌ Failed to load test resumes:', err.message);
    process.exit(1);
  }

  // Run tests
  const results = [];
  let passed = 0;
  let failed = 0;

  for (const resume of resumes) {
    process.stdout.write(`Testing: ${resume.baseName}... `);
    
    const testResult = await testResume(resume);
    results.push(testResult);

    if (testResult.error) {
      console.log('❌ CRASHED');
      failed++;
      console.error(`   Error: ${testResult.error.message}`);
      continue;
    }

    // Validate scores
    const validations = [];
    const { result, resume: r } = testResult;
    
    validations.push(validateScore(result.overallScore, r.expected.overallScore, 'Overall'));
    validations.push(validateScore(result.keywordScore, r.expected.keywordScore, 'Keyword'));
    validations.push(validateScore(result.formattingScore, r.expected.formattingScore, 'Formatting'));
    validations.push(validateScore(result.structureScore, r.expected.structureScore, 'Structure'));
    validations.push(validateScore(result.toneScore, r.expected.toneScore, 'Tone'));
    validations.push(validateScore(result.grammarScore, r.expected.grammarScore, 'Grammar'));

    const allValid = validations.every(v => v.valid);
    
    if (allValid) {
      console.log(`✅ PASS (${testResult.duration}ms) - Score: ${result.overallScore}`);
      passed++;
    } else {
      console.log(`⚠️ SCORE OUT OF RANGE (${testResult.duration}ms)`);
      failed++;
    }

    // Verbose output
    if (VERBOSE || !allValid) {
      console.log(`   📋 ${r.description}`);
      console.log(`   🎯 Target Role: ${r.targetRole}`);
      validations.forEach(v => {
        if (v.message) console.log(`      ${v.message}`);
      });
      
      if (VERBOSE && result.roleSkillSummary) {
        const summary = result.roleSkillSummary;
        console.log(`   📊 Keywords: ${summary.matchedMustHave?.length || 0}/${summary.expectedMustHaveCount || 0} must-have, ${summary.matchedNiceToHave?.length || 0}/${summary.expectedNiceToHaveCount || 0} nice-to-have`);
        if (summary.stuffedMustHave?.length > 0) {
          console.log(`   ⚠️ Keyword stuffing detected: ${summary.stuffedMustHave.join(', ')}`);
        }
      }
      console.log('');
    }
  }

  // Summary
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('  SUMMARY');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`  Total:  ${resumes.length} tests`);
  console.log(`  Passed: ${passed} ✅`);
  console.log(`  Failed: ${failed} ❌`);
  console.log(`  Rate:   ${((passed / resumes.length) * 100).toFixed(1)}%`);
  
  const totalDuration = results.reduce((sum, r) => sum + r.duration, 0);
  const avgDuration = Math.round(totalDuration / results.length);
  console.log(`  Time:   ${totalDuration}ms total, ${avgDuration}ms avg`);
  console.log('═══════════════════════════════════════════════════════════════\n');

  // Score distribution
  if (VERBOSE) {
    console.log('SCORE DISTRIBUTION:\n');
    results.forEach(r => {
      if (r.result) {
        const score = r.result.overallScore;
        const bar = '█'.repeat(Math.round(score / 5)) + '░'.repeat(20 - Math.round(score / 5));
        console.log(`  ${r.resume.baseName.padEnd(35)} ${bar} ${score}`);
      }
    });
    console.log('');
  }

  // OpenAI integration test (optional)
  if (WITH_OPENAI) {
    console.log('\n⚠️ --with-openai flag detected');
    console.log('   OpenAI integration tests are not implemented in this harness.');
    console.log('   The scoring engine is designed to be OpenAI-free for cost control.');
    console.log('   For OpenAI feedback testing, use the /api/resume-feedback endpoint manually.\n');
  }

  return failed === 0;
}

// Run tests when executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runTests()
    .then(success => {
      process.exit(success ? 0 : 1);
    })
    .catch(err => {
      console.error('❌ Test suite failed:', err);
      process.exit(1);
    });
}

// Export for programmatic use
export { runTests, loadTestResumes, testResume, EXPECTED_SCORE_RANGES };

