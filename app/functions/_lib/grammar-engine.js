// Grammar engine for ATS scoring (pure JS, deterministic, no AI, no WASM)
// Uses a KV-backed English word list plus tech/resume whitelists and simple heuristics.
// Primary API exposes diagnostics; a 0–10 grammar score is derived from those diagnostics.

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
 * Compute detailed grammar diagnostics for a piece of text.
 * This is the primary API; rawScore is derived from misspelling +
 * structural penalties. ATS-level banding/floor logic should be
 * implemented in ats-scoring-engine.js, not here.
 *
 * @param {Object} env - Cloudflare environment (for KV-backed dictionary)
 * @param {string} text - Input text to analyze
 * @param {Object} [options]
 * @param {'ok'|'scanned_pdf'|'ocr_needed'|null} [options.extractionHint]
 * @returns {Promise<{
 *   rawScore: number,
 *   misspellCount: number,
 *   misspellPenalty: number,
 *   misspellRate: number,
 *   structurePenalty: number,
 *   passiveRatio: number,
 *   repeatedWords: boolean,
 *   longParaCount: number,
 *   dictionaryHitRate: number,
 *   tokenCount: number,
 *   extractionStatus: 'ok' | 'empty' | 'very_short' | 'probably_non_english' | 'scanned_pdf',
 *   confidence: number
 * }>}
 */
export async function getGrammarDiagnostics(env, text, options = {}) {
  const input = (text || '').trim();

  // Empty / whitespace-only → neutral score with low confidence
  if (!input.length) {
    return {
      rawScore: 5,
      misspellCount: 0,
      misspellPenalty: 0,
      misspellRate: 0,
      structurePenalty: 0,
      passiveRatio: 0,
      repeatedWords: false,
      longParaCount: 0,
      dictionaryHitRate: 0,
      tokenCount: 0,
      extractionStatus: 'empty',
      confidence: 0.2
    };
  }

  const englishWords = await loadEnglishWords(env);

  const sentences = splitSentences(input);
  const allTokens = tokenizeWords(input);
  const tokenCount = allTokens.length;

  if (tokenCount === 0) {
    return {
      rawScore: 5,
      misspellCount: 0,
      misspellPenalty: 0,
      misspellRate: 0,
      structurePenalty: 0,
      passiveRatio: 0,
      repeatedWords: false,
      longParaCount: 0,
      dictionaryHitRate: 0,
      tokenCount: 0,
      extractionStatus: 'empty',
      confidence: 0.2
    };
  }

  // A) Misspellings & dictionary coverage
  let misspellCount = 0;
  let knownTokens = 0;
  let checkedTokens = 0;

  if (englishWords) {
    const sentenceList = sentences.length ? sentences : [input];

    for (const sentence of sentenceList) {
      const sentenceWords = tokenizeWords(sentence);
      for (let i = 0; i < sentenceWords.length; i++) {
        const word = sentenceWords[i];
        const isSentenceStart = i === 0;

        const cleanedAlpha = word.replace(/[^A-Za-z]/g, '');
        if (!cleanedAlpha) continue;

        checkedTokens++;

        // Proper nouns / acronyms are treated as known
        if (isLikelyProperNounOrAcronym(cleanedAlpha, isSentenceStart)) {
          knownTokens++;
          continue;
        }

        const lower = cleanedAlpha.toLowerCase();

        if (
          (englishWords && englishWords.has(lower)) ||
          TECH_TERMS_WHITELIST.has(lower) ||
          RESUME_TERMS_WHITELIST.has(lower)
        ) {
          knownTokens++;
        } else {
          misspellCount++;
        }
      }
    }
  } else {
    // Dictionary unavailable - skip misspelling checks but still compute
    // structural diagnostics. We keep misspell-related fields neutral.
    console.warn('[GRAMMAR-ENGINE] Dictionary unavailable, skipping spelling checks');
  }

  const dictionaryHitRate =
    englishWords && checkedTokens > 0 ? knownTokens / Math.max(checkedTokens, 1) : 0;

  const FREE_MISSPELLINGS = 15;
  const MAX_DICTIONARY_PENALTY = 3;

  const extraMisspell = Math.max(0, misspellCount - FREE_MISSPELLINGS);
  const misspellRate = extraMisspell / Math.max(tokenCount, 1);

  let misspellPenalty = 0;
  if (englishWords && extraMisspell > 0) {
    if (misspellRate < 0.01) {
      misspellPenalty = 1;
    } else if (misspellRate < 0.03) {
      misspellPenalty = 2;
    } else {
      misspellPenalty = 3;
    }
  }
  misspellPenalty = Math.min(misspellPenalty, MAX_DICTIONARY_PENALTY);

  // B) Sentence structure penalties (long sentences, missing verbs)
  let structurePenalty = 0;
  let passiveCount = 0;

  if (sentences.length > 0) {
    for (const sentence of sentences) {
      const sWords = tokenizeWords(sentence);
      if (sWords.length > 35) {
        structurePenalty++;
      }
      if (!hasVerbLikeWord(sWords)) {
        structurePenalty++;
      }

      if (isPassiveSentence(sWords)) {
        passiveCount++;
      }
    }
  }

  const passiveRatio =
    sentences.length > 0 ? passiveCount / sentences.length : 0;

  // C) Passive voice penalty – counted once via structurePenalty
  if (passiveRatio > 0.25) {
    structurePenalty += 1;
  }

  // D) Repeated words & long paragraphs – at most 1 additional point total
  const repeatedWords = hasRepeatedWords(allTokens);
  const longParaCount = countLongUnpunctuatedParagraphs(input);

  if (repeatedWords) {
    structurePenalty += 1;
  }
  if (longParaCount > 2) {
    structurePenalty += 1;
  }

  const MAX_STRUCTURE_PENALTY = 3;
  structurePenalty = Math.min(structurePenalty, MAX_STRUCTURE_PENALTY);

  // Raw score combines misspelling + structure penalties
  let rawScore = 10;
  rawScore -= misspellPenalty;
  rawScore -= structurePenalty;

  if (rawScore < 0) rawScore = 0;
  if (rawScore > 10) rawScore = 10;

  // Determine extractionStatus using hint + heuristics
  const extractionHint = options.extractionHint || null;
  let extractionStatus;

  if (extractionHint === 'scanned_pdf' || extractionHint === 'ocr_needed') {
    extractionStatus = 'scanned_pdf';
  } else if (tokenCount < 30) {
    extractionStatus = 'very_short';
  } else if (englishWords && dictionaryHitRate < 0.3) {
    // Only check dictionaryHitRate if we actually used the dictionary
    // If dictionary is unavailable, dictionaryHitRate is 0 but that doesn't mean non-English
    extractionStatus = 'probably_non_english';
  } else {
    extractionStatus = 'ok';
  }

  // Confidence score – multiplicative heuristic
  let confidence = 1.0;

  // Penalize very short text
  if (tokenCount < 50) confidence *= 0.7;
  if (tokenCount < 30) confidence *= 0.6;

  // Penalize low dictionary coverage when we have enough tokens
  if (tokenCount >= 50 && dictionaryHitRate < 0.5) confidence *= 0.7;
  if (tokenCount >= 50 && dictionaryHitRate < 0.3) confidence *= 0.5;

  // Penalize extraction issues
  if (extractionStatus !== 'ok') confidence *= 0.5;

  // Note: multipliers compound intentionally.
  // Very short + low hit rate + extraction issues → low confidence (≈0.1–0.3).
  if (confidence < 0.1) confidence = 0.1;
  if (confidence > 1.0) confidence = 1.0;

  return {
    rawScore,
    misspellCount,
    misspellPenalty,
    misspellRate,
    structurePenalty,
    passiveRatio,
    repeatedWords,
    longParaCount,
    dictionaryHitRate,
    tokenCount,
    extractionStatus,
    confidence
  };
}

/**
 * Backwards-compatible wrapper that returns only the numeric grammar score.
 * Prefer getGrammarDiagnostics for new code.
 */
export async function getGrammarScore(env, text, options = {}) {
  const diagnostics = await getGrammarDiagnostics(env, text, options);
  return diagnostics.rawScore;
}

