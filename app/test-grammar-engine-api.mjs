// Test script to verify grammar engine is working via API endpoints
// Tests /api/ats-score and /api/resume-feedback with three test resumes

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

// Base URL - adjust for your environment
const BASE_URL = process.env.API_BASE_URL || 'https://dev.jobhackai.io';
const AUTH_TOKEN = process.env.AUTH_TOKEN || ''; // You'll need to provide a valid Firebase token

// Note: For testing, you can get a token by:
// 1. Logging into dev.jobhackai.io in your browser
// 2. Opening DevTools Console
// 3. Running: window.FirebaseAuthManager?.getCurrentUser()?.getIdToken().then(t => console.log(t))
// 4. Copy the token and set: export AUTH_TOKEN="your-token-here"

async function testEndpoint(endpoint, resumeText, resumeName) {
  const url = `${BASE_URL}${endpoint}`;
  
  console.log(`\n📝 Testing ${resumeName} on ${endpoint}`);
  console.log(`   Resume preview: ${resumeText.substring(0, 60)}...`);
  
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(AUTH_TOKEN && { 'Authorization': `Bearer ${AUTH_TOKEN}` })
      },
      body: JSON.stringify({
        resumeText,
        jobTitle: 'Software Engineer'
      })
    });

    const data = await response.json();
    
    if (!response.ok) {
      console.error(`   ❌ Error ${response.status}:`, data);
      return null;
    }

    // Extract grammar score
    let grammarScore = null;
    if (endpoint === '/api/ats-score') {
      grammarScore = data.breakdown?.grammarScore;
    } else if (endpoint === '/api/resume-feedback') {
      // Find grammar score in feedback sections
      const grammarSection = data.feedback?.find(f => 
        f.category?.toLowerCase().includes('grammar') || 
        f.category?.toLowerCase().includes('spelling')
      );
      grammarScore = grammarSection?.score;
    }

    console.log(`   ✅ Success! Grammar Score: ${grammarScore}/10`);
    if (data.breakdown) {
      console.log(`   📊 Full breakdown:`, JSON.stringify(data.breakdown, null, 2));
    }
    
    return { grammarScore, fullResponse: data };
  } catch (error) {
    console.error(`   ❌ Request failed:`, error.message);
    return null;
  }
}

async function runTests() {
  console.log('🧪 Testing Grammar Engine via API Endpoints');
  console.log('=' .repeat(60));
  
  const results = {
    good: { atsScore: null, feedback: null },
    bad: { atsScore: null, feedback: null },
    technical: { atsScore: null, feedback: null }
  };

  // Test GOOD_RESUME (should get 8-10)
  console.log('\n\n📋 TEST 1: Polished Resume (Expected: 8-10)');
  results.good.atsScore = await testEndpoint('/api/ats-score', GOOD_RESUME, 'Polished');
  results.good.feedback = await testEndpoint('/api/resume-feedback', GOOD_RESUME, 'Polished');

  // Test BAD_RESUME (should get 3-6)
  console.log('\n\n📋 TEST 2: Sloppy Resume (Expected: 3-6)');
  results.bad.atsScore = await testEndpoint('/api/ats-score', BAD_RESUME, 'Sloppy');
  results.bad.feedback = await testEndpoint('/api/resume-feedback', BAD_RESUME, 'Sloppy');

  // Test TECHNICAL_RESUME (should get 8-10)
  console.log('\n\n📋 TEST 3: Technical Resume (Expected: 8-10)');
  results.technical.atsScore = await testEndpoint('/api/ats-score', TECHNICAL_RESUME, 'Technical');
  results.technical.feedback = await testEndpoint('/api/resume-feedback', TECHNICAL_RESUME, 'Technical');

  // Summary
  console.log('\n\n' + '='.repeat(60));
  console.log('📊 TEST RESULTS SUMMARY');
  console.log('='.repeat(60));

  const checkResult = (name, score, expectedMin, expectedMax) => {
    const passed = score !== null && score >= expectedMin && score <= expectedMax;
    const status = passed ? '✅ PASS' : '❌ FAIL';
    console.log(`${status} ${name}: ${score !== null ? score : 'N/A'}/10 (Expected: ${expectedMin}-${expectedMax})`);
    return passed;
  };

  let allPassed = true;

  console.log('\n/api/ats-score results:');
  allPassed &= checkResult('Polished', results.good.atsScore?.grammarScore, 8, 10);
  allPassed &= checkResult('Sloppy', results.bad.atsScore?.grammarScore, 3, 6);
  allPassed &= checkResult('Technical', results.technical.atsScore?.grammarScore, 8, 10);

  console.log('\n/api/resume-feedback results:');
  allPassed &= checkResult('Polished', results.good.feedback?.grammarScore, 8, 10);
  allPassed &= checkResult('Sloppy', results.bad.feedback?.grammarScore, 3, 6);
  allPassed &= checkResult('Technical', results.technical.feedback?.grammarScore, 8, 10);

  console.log('\n' + '='.repeat(60));
  if (allPassed) {
    console.log('✅ ALL TESTS PASSED - Grammar engine is fully online!');
  } else {
    console.log('❌ SOME TESTS FAILED - Review results above');
  }
  console.log('='.repeat(60));
  
  process.exit(allPassed ? 0 : 1);
}

// Run tests
runTests().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});

