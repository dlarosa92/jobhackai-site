import assert from 'node:assert';
import { getGrammarScore } from '../grammar-engine.js';
import { createTestEnv } from './test-env-helper.js';

const testEnv = createTestEnv();

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

export async function testGoodResumeHighScore() {
  const score = await getGrammarScore(testEnv, GOOD_RESUME);
  console.log('GOOD_RESUME grammar score:', score);
  assert.ok(score >= 8 && score <= 10, `Expected good resume grammar 8–10, got ${score}`);
}

export async function testBadResumeLowerScore() {
  const score = await getGrammarScore(testEnv, BAD_RESUME);
  console.log('BAD_RESUME grammar score:', score);
  assert.ok(score <= 7, `Expected bad resume grammar <= 7, got ${score}`);
}

export async function testTechnicalResumeToleratesProperNouns() {
  const score = await getGrammarScore(testEnv, TECHNICAL_RESUME);
  console.log('TECHNICAL_RESUME grammar score:', score);
  assert.ok(score >= 8 && score <= 10, `Expected technical resume grammar 8–10, got ${score}`);
}

export async function testEmptyTextReturnsMaxScore() {
  const score = await getGrammarScore(testEnv, '');
  assert.strictEqual(score, 10, 'Empty text should return max score');
}

export async function testWhitespaceOnlyReturnsMaxScore() {
  const score = await getGrammarScore(testEnv, '   \\n\\n  ');
  assert.ok(score >= 9 && score <= 10, 'Whitespace-only text should not be penalized heavily');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  (async () => {
    try {
      await testEmptyTextReturnsMaxScore();
      await testWhitespaceOnlyReturnsMaxScore();
      await testGoodResumeHighScore();
      await testBadResumeLowerScore();
      await testTechnicalResumeToleratesProperNouns();
      console.log('\\n✅ All grammar engine tests passed.');
    } catch (err) {
      console.error('\\n❌ Grammar engine tests failed:', err);
      process.exit(1);
    }
  })();
}


