// Generates the checked-in transcript fixture dataset (transcripts.jsonl).
// Deterministic: same inputs always produce the same 100 fixtures.
//
// Regenerate with:  node app/tests/voice-transcripts/fixtures/generate-fixtures.mjs

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { QUESTIONS, ROLES, ROLE_SCENARIOS } from './content-banks.mjs';
import { ARCHETYPES, QUALITY_LEVELS, composeAnswer } from './archetypes.mjs';

const SENIORITY_LABELS = { entry: 'Entry-level', mid: 'Mid-level', senior: 'Senior' };

export function generateFixtures() {
  const fixtures = [];

  ARCHETYPES.forEach((archetype, ai) => {
    QUALITY_LEVELS.forEach((quality, qi) => {
      // Rotate roles across the matrix so every role appears in every
      // quality level somewhere, unless the archetype pins a role.
      const role = archetype.fixedRole || ROLES[(ai + qi) % ROLES.length];
      const scenarios = ROLE_SCENARIOS[role];
      const plan = archetype.plans[qi];

      const transcript = [];
      QUESTIONS.forEach((question, questionIndex) => {
        const answer = composeAnswer(
          plan,
          scenarios[questionIndex],
          questionIndex,
          scenarios,
          { nervous: archetype.nervous === true }
        );
        transcript.push({ speaker: 'interviewer', text: question });
        transcript.push({ speaker: 'candidate', text: answer });
      });

      const exp = archetype.expect(qi);
      fixtures.push({
        id: `${archetype.id}--${quality}`,
        archetype: archetype.id,
        archetypeDescription: archetype.description,
        qualityLevel: quality,
        role,
        seniority: SENIORITY_LABELS[archetype.seniority] || 'Mid-level',
        transcript,
        expectations: {
          overallScore: exp.overall,
          structureScore: exp.structure,
          sao: {
            situation: exp.sao.situation || [0, 100],
            action: exp.sao.action || [0, 100],
            outcome: exp.sao.outcome || [0, 100]
          },
          ...(exp.roleFit ? { roleFitScore: exp.roleFit } : {}),
          feedbackMustMention: exp.must || [],
          feedbackMustNotMention: exp.mustNot || []
        }
      });
    });
  });

  return fixtures;
}

const isMain = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const fixtures = generateFixtures();
  const outPath = join(dirname(fileURLToPath(import.meta.url)), 'transcripts.jsonl');
  writeFileSync(outPath, fixtures.map(f => JSON.stringify(f)).join('\n') + '\n');
  console.log(`Wrote ${fixtures.length} fixtures to ${outPath}`);
}
