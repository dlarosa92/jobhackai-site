// Test validation script for resume scoring improvements
// Tests the 4 golden resumes to validate scoring behavior

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import mammoth from 'mammoth';
import { scoreResume } from './functions/_lib/ats-scoring-engine.js';
import { createTestEnv } from './functions/_lib/__tests__/test-env-helper.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const testResumes = [
  {
    name: 'Good Tech Resume',
    path: '../docs/Test Resumes/54- Tech_Resume_Good.docx',
    jobTitle: 'Software Engineer',
    expectedGrammar: { min: 8, max: 10 },
    isDocx: true
  },
  {
    name: 'Tech Resume + Gibberish',
    path: '../docs/Test Resumes/54- withmispelling- Tech_Resume_Good.docx',
    jobTitle: 'Software Engineer',
    expectedGrammar: { min: 5, max: 7 },
    isDocx: true
  },
  {
    name: 'Product Owner Resume',
    path: '../docs/Test Resumes/64- Product Owner_LaRosa_Sebastiano_Resume.txt',
    jobTitle: 'Product Owner',
    expectedGrammar: { min: 7, max: 9 },
    isDocx: false
  }
];

async function extractTextFromFile(filePath, isDocx) {
  const fullPath = join(__dirname, filePath);
  if (isDocx) {
    const result = await mammoth.extractRawText({ path: fullPath });
    return result.value;
  } else {
    return readFileSync(fullPath, 'utf8');
  }
}

async function testResume(name, filePath, jobTitle, expectedGrammar, isDocx) {
  try {
    const text = await extractTextFromFile(filePath, isDocx);
    const env = createTestEnv();
    const result = await scoreResume(text, jobTitle, {}, env);
    
    const grammarScore = result.grammarScore.score;
    const passed = grammarScore >= expectedGrammar.min && grammarScore <= expectedGrammar.max;
    
    // Check for tables detected
    const tablesDetected = result.formattingScore.feedback.includes('Tables detected');
    
    console.log(`\n${name}:`);
    console.log(`  Grammar Score: ${grammarScore}/10 (Expected: ${expectedGrammar.min}-${expectedGrammar.max}) ${passed ? '✅' : '❌'}`);
    console.log(`  Grammar Feedback: "${result.grammarScore.feedback}"`);
    console.log(`  Formatting Score: ${result.formattingScore.score}/20`);
    console.log(`  Structure Score: ${result.structureScore.score}/15`);
    console.log(`  Overall ATS: ${result.overallScore}/100`);
    console.log(`  Tables Detected: ${tablesDetected ? 'Yes ❌' : 'No ✅'}`);
    
    return { name, grammarScore, passed, tablesDetected, result };
  } catch (error) {
    console.error(`  ❌ Error: ${error.message}`);
    console.error(`  Stack: ${error.stack}`);
    return { name, grammarScore: null, passed: false, error: error.message };
  }
}

async function runTests() {
  console.log('🧪 Testing Resume Scoring Validation');
  console.log('='.repeat(70));
  
  const results = [];
  for (const test of testResumes) {
    const result = await testResume(test.name, test.path, test.jobTitle, test.expectedGrammar, test.isDocx);
    results.push(result);
  }
  
  console.log('\n' + '='.repeat(70));
  console.log('📊 SUMMARY');
  console.log('='.repeat(70));
  
  const allPassed = results.every(r => r.passed);
  const allTablesCorrect = results.every(r => !r.tablesDetected);
  
  results.forEach(r => {
    console.log(`${r.passed ? '✅' : '❌'} ${r.name}: ${r.grammarScore !== null ? r.grammarScore : 'ERROR'}/10`);
  });
  
  console.log('\nTable Detection:');
  results.forEach(r => {
    console.log(`  ${r.name}: ${r.tablesDetected ? '❌ False positive' : '✅ Correct'}`);
  });
  
  console.log('\n' + '='.repeat(70));
  if (allPassed && allTablesCorrect) {
    console.log('✅ All tests passed!');
  } else {
    console.log('❌ Some tests failed');
    if (!allPassed) console.log('  - Grammar scores outside expected ranges');
    if (!allTablesCorrect) console.log('  - False table detection');
  }
  console.log('='.repeat(70));
  
  process.exit(allPassed && allTablesCorrect ? 0 : 1);
}

runTests().catch(console.error);

