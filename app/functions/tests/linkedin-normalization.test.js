const assert = require('assert');

function normalizeTo100(n) {
  const num = Number(n);
  if (!Number.isFinite(num)) return null;
  // Match production heuristic: only scale values strictly less than 10 (treat 10 as 10/100)
  if (num < 10) return Math.round(num * 10);
  return Math.round(Math.max(0, Math.min(100, num)));
}

const WEIGHTS = {
  headline: 20,
  summary: 30,
  experience: 25,
  skills: 15,
  recommendations: 10
};

function computeOverall(sections) {
  let weightSum = 0;
  let weightedSum = 0;
  for (const [k, v] of Object.entries(sections)) {
    if (!WEIGHTS[k]) continue;
    const norm = normalizeTo100(v);
    if (norm === null) continue;
    weightSum += WEIGHTS[k];
    weightedSum += norm * WEIGHTS[k];
  }
  if (weightSum === 0) return null;
  return Math.round(weightedSum / weightSum);
}

// Tests
(() => {
  // 0-10 scaling detection
  const sectionsA = { headline: 9, summary: 8, experience: 9, skills: 9 };
  const overallA = computeOverall(sectionsA);
  assert.strictEqual(overallA, Math.round(((90*20)+(80*30)+(90*25)+(90*15))/(20+30+25+15)));

  // 0-100 input
  const sectionsB = { headline: 80, summary: 70, experience: 75, skills: 60, recommendations: 90 };
  const overallB = computeOverall(sectionsB);
  assert.strictEqual(overallB, Math.round(((80*20)+(70*30)+(75*25)+(60*15)+(90*10))/100));

  // Missing recommendations rescale behavior (weightSum < 100)
  const sectionsC = { headline: 100, summary: 100, experience: 100, skills: 100 };
  const overallC = computeOverall(sectionsC);
  assert.strictEqual(overallC, 100);

  console.log('LinkedIn normalization tests passed');
})();


