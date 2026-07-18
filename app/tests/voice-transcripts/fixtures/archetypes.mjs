// 20 candidate behavior archetypes x 5 quality levels = 100 fixtures.
//
// Each archetype defines:
//   - plans: for each quality level (0 = excellent .. 4 = poor), the list of
//     content tokens composed into each candidate answer.
//   - expect(q): score-range and feedback-concept expectations against the
//     voice scorecard shape (see app/functions/_lib/voice-scorecard.js):
//     overall 0-100, dimensions.structure 0-100 (scored BY the S+A=O
//     formula), dimensions.roleFit 0-100, saoBalance percents (~sum 100).
//     Ranges are deliberately wide — we validate reasonableness, not exact
//     scores.
//
// Tokens resolve against the question's scenario (see content-banks.mjs) or
// role-independent banks. Special tokens:
//   generic / hypothetical / blame / buzzword / minimal / ultraShort — banks
//   tangent0..2, buzzExtra, negExtra                                — banks
//   dodge:<field> — the named field from the NEXT question's scenario
//   team:<field>  — the named field rewritten in "we" voice

import {
  GENERIC, HYPOTHETICAL, BLAME, BUZZWORD, MINIMAL, ULTRA_SHORT,
  TANGENTS, BUZZ_EXTRA, NEG_EXTRA
} from './content-banks.mjs';

export const QUALITY_LEVELS = ['excellent', 'good', 'average', 'weak', 'poor'];

// Wide base ranges by quality index (0 = excellent .. 4 = poor).
// The scoring prompt calibrates: vague/rambling 40s-60s, strong 70s-80s,
// exceptional 90s — so even "poor" answers can land in the 40s.
const OVERALL = [[60, 100], [48, 95], [35, 88], [22, 78], [0, 68]];
// dimensions.structure is scored BY outcome share, so lower bounds stay low.
const STRUCT = [[30, 100], [20, 95], [10, 90], [5, 85], [0, 75]];

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

function overall(q, shift = 0, hiCap = 100) {
  const [lo, hi] = OVERALL[q];
  return [clamp(lo + shift, 0, 100), clamp(Math.min(hi + shift, hiCap), 0, 100)];
}

function structDim(q, shift = 0) {
  const [lo, hi] = STRUCT[q];
  return [clamp(lo + shift, 0, 100), clamp(hi + shift, 0, 100)];
}

const WIDE = [0, 100];

function teamify(text) {
  return text
    .replace(/\bI\b/g, 'we')
    .replace(/\bmy\b/g, 'our')
    .replace(/\bMy\b/g, 'Our')
    .replace(/\bme\b/g, 'us')
    .replace(/(^|[.!?]\s+)we\b/g, (m, p1) => `${p1}We`);
}

export function resolveToken(token, scen, qIndex, allScenarios) {
  const banks = {
    generic: GENERIC[qIndex],
    hypothetical: HYPOTHETICAL[qIndex],
    blame: BLAME[qIndex],
    buzzword: BUZZWORD[qIndex],
    minimal: MINIMAL[qIndex],
    ultraShort: ULTRA_SHORT[qIndex],
    tangent0: TANGENTS[0],
    tangent1: TANGENTS[1],
    tangent2: TANGENTS[2],
    buzzExtra: BUZZ_EXTRA,
    negExtra: NEG_EXTRA
  };
  if (token in banks) return banks[token];

  if (token.startsWith('dodge:')) {
    const other = allScenarios[(qIndex + 1) % allScenarios.length];
    return resolveToken(token.slice(6), other, qIndex, allScenarios);
  }
  if (token.startsWith('team:')) {
    return teamify(resolveToken(token.slice(5), scen, qIndex, allScenarios));
  }
  if (token === 'background0') return scen.background[0];
  if (token === 'background1') return scen.background[1];
  if (token === 'process0') return scen.process[0];
  if (token === 'process1') return scen.process[1];
  if (token === 'shortTieback') return `But to actually answer your question: ${scen.short}`;

  const value = scen[token];
  if (typeof value !== 'string') {
    throw new Error(`Unknown or non-string token "${token}"`);
  }
  return value;
}

export function composeAnswer(tokens, scen, qIndex, allScenarios, options = {}) {
  const parts = tokens.map(t => resolveToken(t, scen, qIndex, allScenarios));
  let answer = parts.join(' ');
  if (options.nervous) {
    answer = `Um, okay, so… ${answer.charAt(0).toLowerCase()}${answer.slice(1)}` +
      " Sorry, I'm rambling a bit — I get a little nervous in interviews, if that makes sense.";
  }
  return answer;
}

// Concept groups: each entry in `must` is an array of concept IDs, of which
// at least ONE must appear in the coaching-oriented feedback text.
// `mustNot` concepts must appear NOWHERE in the scorecard feedback.

export const ARCHETYPES = [
  {
    id: 'strong-star',
    description: 'Complete Situation + Action = Outcome answers',
    seniority: 'mid',
    plans: [
      ['situation', 'action', 'outcome', 'metric'],
      ['situation', 'action', 'outcome'],
      ['vague', 'action', 'outcome'],
      ['vague', 'outcome'],
      ['short']
    ],
    expect(q) {
      const e = { overall: overall(q), structure: structDim(q), sao: {} };
      if (q <= 1) {
        e.structure = [q === 0 ? 40 : 30, 100];
        e.sao.outcome = [30, 100];
        e.mustNot = ['claims-no-outcome'];
      }
      if (q >= 3) e.must = [['specificity', 'structure']];
      return e;
    }
  },
  {
    id: 'measurable-results',
    description: 'Quantified, metric-driven outcomes',
    seniority: 'mid',
    plans: [
      ['situation', 'action', 'metric'],
      ['action', 'metric'],
      ['vague', 'metric'],
      ['short', 'metric'],
      ['metric']
    ],
    expect(q) {
      const e = { overall: overall(q), structure: structDim(q), sao: {}, mustNot: ['claims-no-outcome'] };
      if (q <= 2) {
        e.structure = [q === 0 ? 40 : 25, 100];
        e.sao.outcome = [30, 100];
      }
      // A short answer WITH a strong metric is outcome-heavy — the S+A=O
      // formula legitimately rewards it (full run: overall 88, structure 90).
      if (q === 3) {
        e.overall = [22, 90];
        e.structure = [5, 95];
      }
      return e;
    }
  },
  {
    id: 'missing-outcome',
    description: 'Situation and action present, outcome never stated',
    seniority: 'mid',
    // NOTE: no 'vague' tokens here — the vague content strings contain
    // implicit outcomes ("it went fine in the end"), which contradicts this
    // archetype's premise and was over-crediting outcome share in real runs.
    plans: [
      ['situation', 'action', 'process0'],
      ['situation', 'action'],
      ['background0', 'action'],
      ['situation'],
      ['minimal']
    ],
    expect(q) {
      return {
        overall: overall(q, -5, 85),
        structure: [0, 65],
        sao: { outcome: [0, 35] },
        must: [['outcome-focus']]
      };
    }
  },
  {
    id: 'vague',
    description: 'Non-specific answers without concrete details',
    seniority: 'mid',
    plans: [
      ['vague', 'outcome'],
      ['vague', 'action'],
      ['vague'],
      ['minimal'],
      ['ultraShort']
    ],
    expect(q) {
      return {
        overall: overall(q, -10),
        structure: structDim(q, -5),
        sao: {},
        must: [['specificity']]
      };
    }
  },
  {
    id: 'excessive-background',
    description: 'Far too much situation/context before any substance',
    seniority: 'mid',
    plans: [
      ['background0', 'background1', 'situation', 'action', 'metric'],
      ['background0', 'background1', 'situation', 'action', 'outcome'],
      ['background0', 'background1', 'situation', 'action'],
      ['background0', 'background1', 'situation', 'vague'],
      ['background0', 'background1', 'tangent0', 'situation']
    ],
    expect(q) {
      const e = {
        overall: overall(q, -5),
        structure: q <= 1 ? [0, 85] : [0, 70],
        sao: { situation: [20, 100] },
        must: [['conciseness', 'outcome-focus', 'structure']]
      };
      if (q >= 2) e.sao.outcome = [0, 50];
      return e;
    }
  },
  {
    id: 'excessive-process',
    description: 'Drowning in step-by-step process detail',
    seniority: 'mid',
    plans: [
      ['situation', 'action', 'process0', 'process1', 'outcome'],
      ['situation', 'action', 'process0', 'process1'],
      ['action', 'process0', 'process1'],
      ['process0', 'process1'],
      ['process0']
    ],
    expect(q) {
      const e = {
        overall: overall(q, -5),
        structure: q === 0 ? [0, 85] : [0, 70],
        sao: { action: [20, 100] },
        must: [['outcome-focus', 'conciseness']]
      };
      if (q >= 1) e.sao.outcome = [0, 55];
      return e;
    }
  },
  {
    id: 'weak-generic',
    description: 'Platitudes and generic self-praise, no evidence',
    seniority: 'entry',
    plans: [
      ['situation', 'generic', 'outcome'],
      ['generic', 'outcome'],
      ['generic', 'vague'],
      ['generic'],
      ['minimal']
    ],
    expect(q) {
      const e = { overall: overall(q, -12), structure: structDim(q, -5), sao: {} };
      if (q >= 1) e.must = [['specificity', 'outcome-focus']];
      return e;
    }
  },
  {
    id: 'conflicting-claims',
    description: 'Claims an achievement then contradicts it',
    seniority: 'mid',
    plans: [
      ['situation', 'action', 'metric', 'conflict'],
      ['situation', 'action', 'outcome', 'conflict'],
      ['situation', 'action', 'conflict'],
      ['vague', 'conflict'],
      ['short', 'conflict']
    ],
    expect(q) {
      return {
        overall: overall(q, 0, OVERALL[q][1] - 10),
        structure: structDim(q, -5),
        sao: {},
        must: [['consistency', 'clarity-concern', 'outcome-focus']]
      };
    }
  },
  {
    id: 'short-answers',
    description: 'One-line answers with little to evaluate',
    seniority: 'entry',
    plans: [
      ['short', 'metric'],
      ['short', 'outcome'],
      ['short'],
      ['minimal'],
      ['ultraShort']
    ],
    expect(q) {
      const e = { overall: overall(q, -8), structure: structDim(q, -5), sao: {} };
      if (q >= 1) e.must = [['elaboration', 'specificity']];
      return e;
    }
  },
  {
    id: 'rambling',
    description: 'Long, meandering answers full of tangents',
    seniority: 'mid',
    plans: [
      ['background0', 'situation', 'tangent0', 'action', 'process0', 'outcome', 'metric'],
      ['background0', 'situation', 'tangent0', 'action', 'process0', 'outcome'],
      ['background0', 'tangent0', 'situation', 'background1', 'action', 'tangent1'],
      ['background0', 'tangent0', 'background1', 'tangent1', 'vague'],
      ['tangent0', 'background0', 'tangent2', 'background1']
    ],
    expect(q) {
      return {
        overall: overall(q, -5),
        structure: structDim(q, q >= 2 ? -10 : -5),
        sao: {},
        must: [['conciseness', 'structure']]
      };
    }
  },
  {
    id: 'senior-leadership',
    description: 'Strategy, delegation, and org-level framing',
    seniority: 'senior',
    plans: [
      ['situation', 'leadership', 'metric'],
      ['situation', 'leadership', 'outcome'],
      ['situation', 'leadership'],
      ['leadership', 'vague'],
      ['vague']
    ],
    expect(q) {
      const e = { overall: overall(q), structure: structDim(q), sao: {} };
      if (q <= 1) { e.sao.outcome = [25, 100]; e.mustNot = ['claims-no-outcome']; }
      if (q === 2 || q === 3) e.must = [['outcome-focus']];
      // The weak variant still contains a substantive leadership fragment;
      // the model scores it low-80s (full run: 82).
      if (q === 3) e.overall = [22, 85];
      if (q === 4) e.must = [['specificity']];
      return e;
    }
  },
  {
    id: 'technical-deep-dive',
    description: 'Heavy technical detail; business outcome varies',
    seniority: 'senior',
    fixedRole: 'Software Engineer',
    plans: [
      ['situation', 'technical', 'action', 'metric'],
      ['situation', 'technical', 'action', 'outcome'],
      ['situation', 'technical', 'action'],
      ['technical', 'action'],
      ['technical']
    ],
    expect(q) {
      const e = { overall: overall(q), structure: structDim(q), sao: {} };
      if (q >= 2) {
        e.structure = [0, 70];
        e.sao.outcome = [0, 55];
        e.must = [['outcome-focus', 'audience']];
      }
      // A bare deep-technical paragraph is still content-rich; the model
      // floors it in the low 70s (full run: 72).
      if (q === 4) e.overall = [0, 75];
      return e;
    }
  },
  {
    id: 'nervous',
    description: 'Filler words, hedging, apologizing',
    seniority: 'entry',
    nervous: true,
    plans: [
      ['situation', 'action', 'outcome', 'metric'],
      ['situation', 'action', 'outcome'],
      ['situation', 'action'],
      ['situation'],
      ['minimal']
    ],
    expect(q) {
      const e = { overall: overall(q, -5), structure: structDim(q, -3), sao: {} };
      if (q >= 2) e.must = [['confidence', 'conciseness', 'structure']];
      return e;
    }
  },
  {
    id: 'irrelevant',
    description: 'Off-topic answers unrelated to the question or role',
    seniority: 'mid',
    plans: [
      ['irrelevant', 'shortTieback'],
      ['situation', 'irrelevant'],
      ['irrelevant'],
      ['irrelevant', 'tangent0'],
      ['irrelevant', 'tangent1', 'tangent2']
    ],
    expect(q) {
      const e = {
        overall: q === 0 ? [0, 70] : q === 1 ? [0, 62] : [0, 52],
        structure: [0, STRUCT[q][1]],
        sao: {},
        roleFit: q === 0 ? [0, 60] : q === 1 ? [0, 50] : [0, 40],
        mustNot: ['praises-relevance']
      };
      if (q >= 2) e.must = [['relevance-concern']];
      return e;
    }
  },
  {
    id: 'team-credit',
    description: 'Everything is "we"; individual contribution unclear',
    seniority: 'mid',
    plans: [
      ['situation', 'team:action', 'team:metric'],
      ['situation', 'team:action', 'team:outcome'],
      ['situation', 'team:action'],
      ['team:action'],
      ['team:vague']
    ],
    expect(q) {
      const e = {
        overall: overall(q, -5),
        structure: structDim(q, -3),
        sao: {},
        must: [['ownership', 'specificity']]
      };
      // Teamified action fragments still read as substantive (full run: 75).
      if (q === 3) e.overall = [17, 80];
      return e;
    }
  },
  {
    id: 'hypothetical',
    description: 'Answers in hypotheticals, never a real example',
    seniority: 'entry',
    plans: [
      ['hypothetical', 'situation', 'action'],
      ['hypothetical', 'vague'],
      ['hypothetical'],
      ['hypothetical', 'minimal'],
      ['minimal']
    ],
    expect(q) {
      const e = { overall: overall(q, -10), structure: structDim(q, -5), sao: {} };
      if (q >= 1) e.must = [['real-example', 'specificity']];
      return e;
    }
  },
  {
    id: 'negative-blamer',
    description: 'Blames managers, teammates, and circumstances',
    seniority: 'mid',
    plans: [
      ['situation', 'blame', 'outcome'],
      ['situation', 'blame'],
      ['blame'],
      ['blame', 'negExtra'],
      ['negExtra', 'minimal']
    ],
    expect(q) {
      return {
        overall: overall(q, -15),
        structure: structDim(q, -5),
        sao: {},
        must: [['positivity', 'ownership']]
      };
    }
  },
  {
    id: 'buzzword-heavy',
    description: 'Corporate buzzwords with no concrete substance',
    seniority: 'mid',
    plans: [
      ['buzzword', 'metric'],
      ['buzzword', 'outcome'],
      ['buzzword', 'vague'],
      ['buzzword'],
      ['buzzword', 'buzzExtra']
    ],
    expect(q) {
      const e = { overall: overall(q, -10), structure: structDim(q, -5), sao: {} };
      if (q >= 1) e.must = [['specificity', 'clarity-concern']];
      return e;
    }
  },
  {
    id: 'question-dodger',
    description: 'Answers a different question than the one asked',
    seniority: 'mid',
    plans: [
      ['dodge:situation', 'dodge:action', 'dodge:outcome'],
      ['dodge:situation', 'dodge:action'],
      ['dodge:vague', 'dodge:action'],
      ['dodge:vague'],
      ['dodge:short']
    ],
    expect(q) {
      const e = {
        overall: overall(q, -10),
        structure: structDim(q, -3),
        sao: {},
        roleFit: [0, 90]
      };
      if (q >= 2) e.must = [['relevance-concern', 'specificity']];
      return e;
    }
  },
  {
    id: 'balanced-competent',
    description: 'Solid, unremarkable answers without metrics',
    seniority: 'mid',
    plans: [
      ['situation', 'action', 'outcome'],
      ['action', 'outcome'],
      ['vague', 'action', 'outcome'],
      ['vague', 'outcome'],
      ['vague']
    ],
    expect(q) {
      return { overall: overall(q), structure: structDim(q), sao: {} };
    }
  }
];
