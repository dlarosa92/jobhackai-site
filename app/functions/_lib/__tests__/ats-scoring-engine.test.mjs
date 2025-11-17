import assert from 'node:assert';
import { scoreResume } from '../ats-scoring-engine.js';
import { createTestEnv } from './test-env-helper.mjs';

const testEnv = createTestEnv();

const SAMPLE_RESUME = `
John Doe
Email: john@example.com
Phone: (555) 123-4567

EXPERIENCE
Software Engineer | Tech Corp | 2020-2024
- Developed scalable web applications using React and Node.js
- Led team of 3 engineers to deliver features on time
- Improved system performance by 40%

EDUCATION
BS Computer Science | State University | 2020
`;

export async function testScoreResumeIsAsync() {
  const result = await scoreResume(SAMPLE_RESUME, 'Software Engineer', {}, testEnv);

  assert.ok(result, 'scoreResume should return a result object');
  assert.ok(typeof result.overallScore === 'number', 'Should have overallScore');
  assert.ok(result.grammarScore, 'Should have grammarScore');
  assert.ok(
    typeof result.grammarScore.score === 'number',
    'grammarScore should have numeric score'
  );
  assert.ok(
    result.grammarScore.score >= 0 && result.grammarScore.score <= 10,
    'grammarScore should be 0–10'
  );
}

export async function testScoreResumeDeterministic() {
  const r1 = await scoreResume(SAMPLE_RESUME, 'Software Engineer', {}, testEnv);
  const r2 = await scoreResume(SAMPLE_RESUME, 'Software Engineer', {}, testEnv);

  assert.strictEqual(
    r1.overallScore,
    r2.overallScore,
    'Same resume should produce same overall score'
  );
  assert.strictEqual(
    r1.grammarScore.score,
    r2.grammarScore.score,
    'Same resume should produce same grammar score'
  );
}

export async function testScoreResumeWithJobTitle() {
  const withTitle = await scoreResume(SAMPLE_RESUME, 'Software Engineer', {}, testEnv);
  const withoutTitle = await scoreResume(SAMPLE_RESUME, '', {}, testEnv);

  assert.ok(
    withTitle.keywordScore.score >= withoutTitle.keywordScore.score,
    'Job title should not hurt keyword score and generally should improve it'
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  (async () => {
    try {
      await testScoreResumeIsAsync();
      await testScoreResumeDeterministic();
      await testScoreResumeWithJobTitle();
      console.log('\\n✅ All ATS scoring tests passed.');
    } catch (err) {
      console.error('\\n❌ ATS scoring tests failed:', err);
      process.exit(1);
    }
  })();
}


