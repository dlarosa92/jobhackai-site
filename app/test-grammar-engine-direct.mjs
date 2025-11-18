// Direct test of grammar engine via function imports (no HTTP/auth needed)
// Tests the actual scoring logic with three test resumes

import { scoreResume } from './functions/_lib/ats-scoring-engine.js';
import { createTestEnv } from './functions/_lib/__tests__/test-env-helper.mjs';

const GOOD_RESUME = `
Experienced Software Engineer with a strong background in building scalable platforms.
Led cross-functional teams to deliver cloud-native solutions and improve system reliability.
Implemented automated testing pipelines and reduced deployment failures by 35 percent.
`;

const BAD_RESUME = `
i am good worker i work hard and do alot of thing and it was done and it is being made and
the the code was write good and things was fixed and fixed and there is no problem but i dont
use punctuation and i dont stop ever because this sentence never really ends and we just keep going
and going without periods and is being made and was testeded.
`;

const TECHNICAL_RESUME = `
Senior Data Engineer with expertise in Snowflake, Kubernetes, and AWS.
Built ETL pipelines using Python and SQL. Managed infrastructure with Terraform.
Led team of 5 engineers to deliver ML models in production.
`;

async function testResume(name, resumeText, expectedMin, expectedMax) {
  console.log(`\n📝 Testing ${name} Resume`);
  console.log(`   Preview: ${resumeText.substring(0, 80).replace(/\n/g, ' ')}...`);
  
  try {
    const testEnv = createTestEnv();
    const result = await scoreResume(resumeText, 'Software Engineer', {}, testEnv);
    
    const grammarScore = result.grammarScore?.score;
    const overallScore = result.overallScore;
    
    console.log(`   ✅ Grammar Score: ${grammarScore}/10`);
    console.log(`   📊 Overall ATS Score: ${overallScore}/100`);
    console.log(`   📋 Full Breakdown:`);
    console.log(`      - Keyword: ${result.keywordScore.score}/${result.keywordScore.max}`);
    console.log(`      - Formatting: ${result.formattingScore.score}/${result.formattingScore.max}`);
    console.log(`      - Structure: ${result.structureScore.score}/${result.structureScore.max}`);
    console.log(`      - Tone: ${result.toneScore.score}/${result.toneScore.max}`);
    console.log(`      - Grammar: ${result.grammarScore.score}/${result.grammarScore.max}`);
    
    const passed = grammarScore >= expectedMin && grammarScore <= expectedMax;
    const status = passed ? '✅ PASS' : '❌ FAIL';
    console.log(`   ${status} Expected grammar score: ${expectedMin}-${expectedMax}, got ${grammarScore}`);
    
    return { name, grammarScore, overallScore, passed, result };
  } catch (error) {
    console.error(`   ❌ Error: ${error.message}`);
    console.error(`   Stack: ${error.stack}`);
    return { name, grammarScore: null, passed: false, error: error.message };
  }
}

async function runTests() {
  console.log('🧪 Testing Grammar Engine Directly (via function imports)');
  console.log('='.repeat(70));
  
  const results = {
    polished: await testResume('Polished', GOOD_RESUME, 8, 10),
    sloppy: await testResume('Sloppy', BAD_RESUME, 3, 6),
    technical: await testResume('Technical', TECHNICAL_RESUME, 8, 10)
  };

  // Summary
  console.log('\n\n' + '='.repeat(70));
  console.log('📊 TEST RESULTS SUMMARY');
  console.log('='.repeat(70));
  
  const allPassed = results.polished.passed && results.sloppy.passed && results.technical.passed;
  
  console.log(`\n✅ Polished Resume: ${results.polished.grammarScore}/10 (Expected: 8-10) ${results.polished.passed ? '✅' : '❌'}`);
  console.log(`✅ Sloppy Resume: ${results.sloppy.grammarScore}/10 (Expected: 3-6) ${results.sloppy.passed ? '✅' : '❌'}`);
  console.log(`✅ Technical Resume: ${results.technical.grammarScore}/10 (Expected: 8-10) ${results.technical.passed ? '✅' : '❌'}`);
  
  console.log('\n' + '='.repeat(70));
  if (allPassed) {
    console.log('✅ ALL TESTS PASSED - Grammar engine is fully online!');
  } else {
    console.log('❌ SOME TESTS FAILED - Review results above');
    if (results.polished.error) console.log(`   Polished error: ${results.polished.error}`);
    if (results.sloppy.error) console.log(`   Sloppy error: ${results.sloppy.error}`);
    if (results.technical.error) console.log(`   Technical error: ${results.technical.error}`);
  }
  console.log('='.repeat(70));
  
  process.exit(allPassed ? 0 : 1);
}

// Run tests
runTests().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});

