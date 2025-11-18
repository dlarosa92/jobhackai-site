// Grammar engine for ATS scoring (pure JS, deterministic, no AI, no WASM)
// Uses a KV-backed English word list plus tech/resume whitelists and simple heuristics
// Returns a 0–10 grammar score indicating overall writing quality.

// Tech terms whitelist – protect real-world tech résumés
const TECH_TERMS_WHITELIST = new Set([
  // Languages & runtimes
  'javascript',
  'typescript',
  'python',
  'java',
  'csharp',
  'c++',
  'golang',
  'go',
  'rust',
  'scala',
  'kotlin',
  'ruby',
  'php',
  // Frontend frameworks
  'react',
  'angular',
  'vue',
  'nextjs',
  'nuxt',
  'svelte',
  // Cloud / infra
  'aws',
  'azure',
  'gcp',
  'kubernetes',
  'k8s',
  'docker',
  'terraform',
  'cloudformation',
  'ansible',
  'pulumi',
  // Data / db
  'sql',
  'nosql',
  'postgresql',
  'mysql',
  'redshift',
  'snowflake',
  'bigquery',
  'mongodb',
  'cassandra',
  'redis',
  'elasticsearch',
  // DevOps / pipelines
  'cicd',
  'jenkins',
  'github',
  'gitlab',
  'bitbucket',
  'kafka',
  'spark',
  'hadoop',
  'airflow',
  'dbt',
  // Methodology / roles
  'devops',
  'sre',
  'mlops',
  'dataops'
]);

// Resume / leadership / business terms whitelist
const RESUME_TERMS_WHITELIST = new Set([
  // Generic resume nouns
  'stakeholder',
  'stakeholders',
  'roadmap',
  'roadmaps',
  'kpi',
  'kpis',
  'okr',
  'okrs',
  'roi',
  'pnl',
  'crossfunctional',
  'cross-functional',
  'selfservice',
  'self-service',
  'playbook',
  'playbooks',
  // Action / leadership verbs
  'mentored',
  'coached',
  'facilitated',
  'orchestrated',
  'evangelized',
  'productized',
  'streamlined',
  'operationalized',
  // Strategy / org language
  'modernization',
  'modernised',
  'modernized',
  'transformation',
  'governance',
  'enablement',
  'alignment',
  // Ed / certs
  'bachelor',
  'bachelors',
  'master',
  'masters',
  'phd',
  'certification',
  'certifications',
  // Common SaaS-ish terms
  'saas',
  'paas',
  'iaas',
  'multitenant',
  'multitenancy'
]);

let englishWordsPromise;
let englishWordsKvBinding = null;

async function loadEnglishWords(env) {
  const kv = env?.JOBHACKAI_KV;
  if (!kv) {
    console.warn('[GRAMMAR-ENGINE] JOBHACKAI_KV binding not available, using fallback scoring');
    return null; // Return null instead of throwing
  }

  // If we have a cached dictionary for this KV binding, reuse it.
  if (englishWordsPromise && englishWordsKvBinding === kv) {
    return englishWordsPromise;
  }

  // Either first load or KV binding changed (different env / namespace) → reload.
  englishWordsKvBinding = kv;
  englishWordsPromise = (async () => {
    try {
      const dictText = await kv.get('dictionary:english-words', 'text');
      if (!dictText) {
        console.warn(
          '[GRAMMAR-ENGINE] english-words dictionary not found in KV. ' +
            'Using fallback scoring without dictionary. ' +
            'Run: npm run load-dicts to bootstrap dictionaries into JOBHACKAI_KV.'
        );
        return null; // Return null instead of throwing
      }

      const words = dictText
        .split('\n')
        .map((w) => w.trim().toLowerCase())
        .filter(Boolean);

      return new Set(words);
    } catch (error) {
      console.warn('[GRAMMAR-ENGINE] Failed to load dictionary from KV:', error.message);
      return null; // Return null instead of throwing
    }
  })();

  return englishWordsPromise;
}

// Export helper functions for use in ats-scoring-engine.js
export function tokenizeWords(text) {
  if (!text || !text.trim()) return [];
  return text.split(/\s+/).map((w) => w.trim()).filter(Boolean);
}

export function splitSentences(text) {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function isLikelyProperNounOrAcronym(word, isSentenceStart) {
  const cleaned = word.replace(/[^A-Za-z]/g, '');
  if (!cleaned) return false;

  if (/^[A-Z]{2,}$/.test(cleaned)) return true; // ALL CAPS, e.g., API, SQL, AWS
  if (!isSentenceStart && /^[A-Z][a-z]+$/.test(cleaned)) return true; // Proper noun mid-sentence (Snowflake)
  return false;
}

function hasVerbLikeWord(words) {
  const commonVerbs = new Set([
    'is',
    'are',
    'was',
    'were',
    'have',
    'has',
    'had',
    'do',
    'did',
    'does',
    'make',
    'made',
    'lead',
    'led',
    'manage',
    'build',
    'built',
    'own',
    'drive',
    'deliver',
    'improve',
    'optimize',
    'reduce',
    'increase',
    'support'
  ]);

  return words.some((w) => {
    const cleaned = w.toLowerCase().replace(/[^a-z]/g, '');
    if (!cleaned) return false;
    if (commonVerbs.has(cleaned)) return true;
    if (cleaned.endsWith('ed') || cleaned.endsWith('ing')) return true;
    return false;
  });
}

export function isPassiveSentence(words) {
  const beVerbs = new Set(['is', 'was', 'were', 'are', 'been', 'being']);
  for (let i = 0; i < words.length - 1; i++) {
    const w1 = words[i].toLowerCase().replace(/[^a-z]/g, '');
    const w2 = words[i + 1].toLowerCase().replace(/[^a-z]/g, '');
    if (beVerbs.has(w1) && w2.endsWith('ed')) {
      return true;
    }
  }
  return false;
}

export function hasRepeatedWords(words) {
  for (let i = 0; i < words.length - 1; i++) {
    const w1 = words[i].toLowerCase().replace(/[^a-z]/g, '');
    const w2 = words[i + 1].toLowerCase().replace(/[^a-z]/g, '');
    if (w1 && w1 === w2) return true;
  }
  return false;
}

export function countLongUnpunctuatedParagraphs(text) {
  const paragraphs = text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);

  let count = 0;
  for (const p of paragraphs) {
    if (p.length > 200 && !/[.?!]/.test(p)) {
      count++;
    }
  }
  return count;
}

/**
 * Compute a rule-based grammar score from 0–10.
 * Uses dictionary-based misspellings + structural heuristics.
 */
export async function getGrammarScore(env, text) {
  let score = 10;
  if (!text || typeof text !== 'string' || !text.trim()) return score;

  const englishWords = await loadEnglishWords(env);

  const sentences = splitSentences(text);
  const allWords = tokenizeWords(text);

  // A) Misspellings (dictionary + whitelists + proper noun tolerance)
  // Only check misspellings if dictionary is available
  if (englishWords) {
    let misspellCount = 0;
    const sentenceList = sentences.length ? sentences : [text];

    for (const sentence of sentenceList) {
      const sentenceWords = tokenizeWords(sentence);
      for (let i = 0; i < sentenceWords.length; i++) {
        const word = sentenceWords[i];
        const isSentenceStart = i === 0;

        const cleanedAlpha = word.replace(/[^A-Za-z]/g, '');
        if (!cleanedAlpha) continue;

        if (isLikelyProperNounOrAcronym(cleanedAlpha, isSentenceStart)) continue;

        const lower = cleanedAlpha.toLowerCase();

        if (
          !englishWords.has(lower) &&
          !TECH_TERMS_WHITELIST.has(lower) &&
          !RESUME_TERMS_WHITELIST.has(lower)
        ) {
          misspellCount++;
        }
      }
    }

    // New penalty structure: 15 free, every 10 = -1, max -3
    const FREE_MISSPELLINGS = 15;
    const misspellingsAfterFree = Math.max(0, misspellCount - FREE_MISSPELLINGS);
    const misspellPenalty = Math.floor(misspellingsAfterFree / 10);
    const MAX_DICTIONARY_PENALTY = 3;
    const finalMisspellPenalty = Math.min(misspellPenalty, MAX_DICTIONARY_PENALTY);
    score -= finalMisspellPenalty;
  } else {
    // Dictionary unavailable - skip spelling checks but apply small penalty
    // This ensures we still provide a score, just without dictionary-based spelling validation
    console.warn('[GRAMMAR-ENGINE] Dictionary unavailable, skipping spelling checks');
    score -= 0; // No penalty when dictionary is unavailable - rely on structural checks only
  }

  // B) Sentence structure penalties (capped at -3)
  if (sentences.length > 0) {
    let sentenceStructurePenalty = 0;
    for (const sentence of sentences) {
      const sWords = tokenizeWords(sentence);
      if (sWords.length > 35) {
        sentenceStructurePenalty++;
      }
      if (!hasVerbLikeWord(sWords)) {
        sentenceStructurePenalty++;
      }
    }
    const MAX_STRUCTURE_PENALTY = 3;
    sentenceStructurePenalty = Math.min(sentenceStructurePenalty, MAX_STRUCTURE_PENALTY);
    score -= sentenceStructurePenalty;
  }

  // C) Passive voice ratio
  let passiveCount = 0;
  for (const sentence of sentences) {
    const sWords = tokenizeWords(sentence);
    if (isPassiveSentence(sWords)) {
      passiveCount++;
    }
  }
  if (sentences.length > 0) {
    const passiveRatio = passiveCount / sentences.length;
    if (passiveRatio > 0.25) {  // Changed from 0.15 to 0.25 to be less strict
      score -= 1;
    }
  }

  // D) Repeated words
  if (hasRepeatedWords(allWords)) {
    score -= 1;
  }

  // E) Long unpunctuated paragraphs
  const longParaCount = countLongUnpunctuatedParagraphs(text);
  if (longParaCount > 0) {
    score -= 1;
  }

  if (score < 0) score = 0;
  if (score > 10) score = 10;

  return score;
}



