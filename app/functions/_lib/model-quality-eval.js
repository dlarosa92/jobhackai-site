import { scoreResume } from './ats-scoring-engine.js';
import { generateCoverLetterText } from './cover-letter-generator.js';
import { generateLinkedInAnalysis } from '../api/linkedin/analyze.js';
import { generateLinkedInSection } from '../api/linkedin/regenerate.js';
import { preserveRecommendationText } from './linkedin-grounding.js';
import { generateATSFeedback, generateRoleTips, generateResumeRewrite } from './openai-client.js';
import { generateQuestions } from '../api/interview-questions/generate.js';
import { generateMockInterviewQuestions } from '../api/mock-interview/generate-questions.js';
import { scoreMockInterview } from '../api/mock-interview/score.js';
import { verifyGrammarWithAI } from './grammar-ai-check.js';
import { generateRoleTemplate } from './openai-template-generator.js';

export async function evaluateTextFixture(fixture, env, uid) {
  const { feature, profile: p, index } = fixture;
  // Remove caches; these are fresh model calls through production generation functions.
  env = { ...env, JOBHACKAI_KV: undefined };
  const input = { ...p, tone: 'Professional', company: 'Example Company', type: index % 2 ? 'technical' : 'behavioral',
    count: 10, interviewStyle: 'mixed', headline: p.role, summary: p.resumeText, experience: p.resumeText,
    skills: p.resumeText, jd: p.jobDescription };
  let result, output, section;
  const ruleScores = ['resume-feedback', 'role-tips'].includes(feature) ? await scoreResume(p.resumeText, p.role, {}, env) : null;
  const issues = [];
  switch (feature) {
    case 'cover-letter': result = await generateCoverLetterText(input, env, uid); output = result.content; break;
    case 'linkedin-analysis':
      result = await generateLinkedInAnalysis(input, uid, env); output = JSON.parse(result.content);
      preserveRecommendationText(output.sections?.recommendations, p.recommendations);
      if (!output.sections?.summary?.optimizedText || !Array.isArray(output.quickWins)) issues.push('missing profile structure');
      break;
    case 'linkedin-regeneration':
      section = ['headline', 'summary', 'experience', 'skills', 'recommendations'][index];
      result = await generateLinkedInSection(input, { sections: {} }, section, uid, env); output = JSON.parse(result.content);
      if (section === 'recommendations') preserveRecommendationText(output.data, p.recommendations);
      if (output.section !== section || !output.data?.optimizedText) issues.push('missing or wrong requested section');
      break;
    case 'resume-feedback': result = await generateATSFeedback(p.resumeText, ruleScores, p.role, env, { skipRoleTips: true }); output = JSON.parse(result.content); break;
    case 'role-tips': result = await generateRoleTips(p.resumeText, ruleScores, p.role, env); output = result.roleSpecificFeedback; if (!output) issues.push('missing role tips'); break;
    case 'resume-rewrite': result = await generateResumeRewrite(p.resumeText, null, p.role, null, null, env); output = JSON.parse(result.content); break;
    case 'interview-questions': output = await generateQuestions(input, env); break;
    case 'mock-questions': output = await generateMockInterviewQuestions(input, env); break;
    case 'mock-scoring':
      output = await scoreMockInterview({ ...input, qaPairs: [{ q: 'Describe your relevant experience and what you learned.', a: p.resumeText }], isPremium: false }, env);
      if (!Number.isFinite(output.overall_score) || output.overall_score < 0 || output.overall_score > 100 || output.per_question?.length !== 1) issues.push('invalid interview score contract');
      break;
    case 'grammar': {
      const sentences = ['I has experience with testing.', 'She write reports every day.', 'We was responsible for schedules.', 'They is tracking tasks.', 'He have strong SQL skills.'];
      output = { text: sentences[index], errors: await verifyGrammarWithAI(sentences[index], env) };
      if (output.errors !== true) issues.push('missed explicit grammar error or provider failed');
      break;
    }
    case 'role-template': output = await generateRoleTemplate(env, p.role); if (!output.must_have?.length) issues.push('missing core skills'); break;
    default: throw new Error('unknown_feature');
  }
  if (feature === 'resume-feedback') {
    const expected = [ruleScores.keywordScore, ruleScores.formattingScore, ruleScores.structureScore, ruleScores.toneScore, ruleScores.grammarScore];
    if (output.atsRubric?.length !== 5 || output.atsRubric.some((item, i) => item.score !== expected[i].score || item.max !== expected[i].max)) issues.push('feedback changed deterministic ATS scores');
  }
  if (feature.endsWith('questions')) {
    if (output.questions?.length !== 10) issues.push('expected ten questions');
    if (new Set(output.questions?.map(q => q.q || q.question || q.text)).size !== 10) issues.push('duplicate or empty questions');
  }
  if (result?.finishReason === 'length') issues.push('truncated response');
  return { feature, profile: p, section, issues, output, ruleScores, model: result?.model || null,
    usage: result?.usage || null, wordCount: result?.wordCount || null, fromCache: result?.fromCache || false };
}
