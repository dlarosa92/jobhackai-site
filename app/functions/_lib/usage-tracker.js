// Centralized usage tracker backed by KV
// Key: usage:${uid}
// Schema:
// {
//   plan,
//   periodStart,
//   periodEnd,
//   features: {
//     atsScore: { lifetimeUsed },
//     resumeFeedback: { lifetimeUsed, periodUsed, lastUsedAt }
//   }
// }

import { FEATURE_KEYS, getPlanUsageConfig, getCurrentPeriodBounds } from './usage-config.js';

const USAGE_KEY_PREFIX = 'usage:';

function nowMs() {
  return Date.now();
}

function clone(obj) {
  return obj ? JSON.parse(JSON.stringify(obj)) : obj;
}

function initEmptyUsage(plan) {
  const { periodStart, periodEnd } = getCurrentPeriodBounds(plan);
  return {
    plan,
    periodStart,
    periodEnd,
    features: {
      [FEATURE_KEYS.ATS_SCORE]: { lifetimeUsed: 0 },
      [FEATURE_KEYS.RESUME_FEEDBACK]: { lifetimeUsed: 0, periodUsed: 0, lastUsedAt: null }
    }
  };
}

async function readUsage(env, uid) {
  if (!env?.JOBHACKAI_KV) return null;
  const key = `${USAGE_KEY_PREFIX}${uid}`;
  const val = await env.JOBHACKAI_KV.get(key);
  if (!val) return null;
  try {
    return JSON.parse(val);
  } catch {
    return null;
  }
}

async function writeUsage(env, uid, usage) {
  if (!env?.JOBHACKAI_KV) return;
  const key = `${USAGE_KEY_PREFIX}${uid}`;
  await env.JOBHACKAI_KV.put(key, JSON.stringify(usage));
}

/**
 * Ensure usage doc is aligned with current plan and period.
 * - Reset periodUsed when period rolls
 * - If plan changed, adopt new plan and reset period bounds
 */
function normalizeUsage(usage, plan) {
  const u = usage ? clone(usage) : initEmptyUsage(plan);
  if (u.plan !== plan) {
    const bounds = getCurrentPeriodBounds(plan);
    u.plan = plan;
    u.periodStart = bounds.periodStart;
    u.periodEnd = bounds.periodEnd;
    // Reset period counters on plan change
    if (!u.features) {
      u.features = {};
    }
    if (!u.features[FEATURE_KEYS.ATS_SCORE]) {
      u.features[FEATURE_KEYS.ATS_SCORE] = { lifetimeUsed: 0 };
    }
    if (!u.features[FEATURE_KEYS.RESUME_FEEDBACK]) {
      u.features[FEATURE_KEYS.RESUME_FEEDBACK] = { lifetimeUsed: 0, periodUsed: 0, lastUsedAt: null };
    } else {
      u.features[FEATURE_KEYS.RESUME_FEEDBACK].periodUsed = 0;
    }
  }
  // Period rollover (only relevant when period exists)
  const bounds = getCurrentPeriodBounds(u.plan);
  const hasPeriod = !!bounds.periodStart && !!bounds.periodEnd;
  if (hasPeriod) {
    const needReset =
      u.periodStart !== bounds.periodStart ||
      u.periodEnd !== bounds.periodEnd ||
      (u.periodEnd && nowMs() > u.periodEnd);
    if (needReset) {
      u.periodStart = bounds.periodStart;
      u.periodEnd = bounds.periodEnd;
      if (!u.features) u.features = {};
      const rf = u.features[FEATURE_KEYS.RESUME_FEEDBACK] || { lifetimeUsed: 0, periodUsed: 0, lastUsedAt: null };
      rf.periodUsed = 0;
      u.features[FEATURE_KEYS.RESUME_FEEDBACK] = rf;
    }
  } else {
    // Plans without periods keep null bounds
    u.periodStart = null;
    u.periodEnd = null;
  }
  // Ensure feature objects exist
  if (!u.features) u.features = {};
  if (!u.features[FEATURE_KEYS.ATS_SCORE]) {
    u.features[FEATURE_KEYS.ATS_SCORE] = { lifetimeUsed: 0 };
  }
  if (!u.features[FEATURE_KEYS.RESUME_FEEDBACK]) {
    u.features[FEATURE_KEYS.RESUME_FEEDBACK] = { lifetimeUsed: 0, periodUsed: 0, lastUsedAt: null };
  }
  return u;
}

function computeFeatureUsageSnapshot(plan, usage, featureKey) {
  const cfg = getPlanUsageConfig(plan);
  const featureCfg =
    cfg.features[featureKey] ||
    { lifetimeLimit: 0, period: null, periodLimit: null };

  const featureUsage = usage.features?.[featureKey] || {};

  // Determine applicable limit and used counters
  // Priority:
  // - If lifetimeLimit is a number, it governs and used = lifetimeUsed
  // - Else if periodLimit is a number (and period === 'month'), used = periodUsed
  // - Else unlimited
  let limit = null; // null => unlimited
  let used = 0;
  let scope = 'unlimited';

  if (typeof featureCfg.lifetimeLimit === 'number') {
    limit = featureCfg.lifetimeLimit;
    used = Number(featureUsage.lifetimeUsed || 0);
    scope = 'lifetime';
  } else if (typeof featureCfg.periodLimit === 'number' && featureCfg.period === 'month') {
    limit = featureCfg.periodLimit;
    used = Number(featureUsage.periodUsed || 0);
    scope = 'period';
  } else {
    limit = null;
    used = Number(featureUsage.lifetimeUsed || 0); // still track used for analytics
    scope = 'unlimited';
  }

  return { limit, used, scope };
}

export async function getUsageForUser(env, uid, plan) {
  const current = await readUsage(env, uid);
  const normalized = normalizeUsage(current, plan);
  if (!current) {
    await writeUsage(env, uid, normalized);
  } else if (JSON.stringify(current) !== JSON.stringify(normalized)) {
    await writeUsage(env, uid, normalized);
  }
  return normalized;
}

export async function checkFeatureAllowed(env, uid, featureKey) {
  // Plan must be derived outside and persisted inside usage doc
  // We read then compute using plan stored inside, but callers should keep it fresh by calling getUsageForUser first
  const current = await readUsage(env, uid);
  const plan = current?.plan || 'free';
  const usage = normalizeUsage(current || initEmptyUsage(plan), plan);
  const { limit, used } = computeFeatureUsageSnapshot(plan, usage, featureKey);

  if (limit === 0) {
    return {
      allowed: false,
      feature: featureKey,
      plan,
      reason: 'locked',
      used,
      limit
    };
  }
  if (limit === null) {
    return {
      allowed: true,
      feature: featureKey,
      plan,
      reason: 'ok',
      used,
      limit
    };
  }
  if (used >= limit) {
    return {
      allowed: false,
      feature: featureKey,
      plan,
      reason: 'limit',
      used,
      limit
    };
  }
  return {
    allowed: true,
    feature: featureKey,
    plan,
    reason: 'ok',
    used,
    limit
  };
}

export async function incrementFeatureUsage(env, uid, plan, featureKey) {
  let usage = await readUsage(env, uid);
  usage = normalizeUsage(usage, plan);

  // increment according to config
  if (featureKey === FEATURE_KEYS.ATS_SCORE) {
    const ats = usage.features[FEATURE_KEYS.ATS_SCORE] || { lifetimeUsed: 0 };
    ats.lifetimeUsed = Number(ats.lifetimeUsed || 0) + 1;
    usage.features[FEATURE_KEYS.ATS_SCORE] = ats;
  } else if (featureKey === FEATURE_KEYS.RESUME_FEEDBACK) {
    const rf = usage.features[FEATURE_KEYS.RESUME_FEEDBACK] || { lifetimeUsed: 0, periodUsed: 0, lastUsedAt: null };
    rf.lifetimeUsed = Number(rf.lifetimeUsed || 0) + 1;
    const cfg = getPlanUsageConfig(usage.plan);
    if (cfg.features.resumeFeedback.period === 'month' && typeof cfg.features.resumeFeedback.periodLimit === 'number') {
      rf.periodUsed = Number(rf.periodUsed || 0) + 1;
    }
    rf.lastUsedAt = nowMs();
    usage.features[FEATURE_KEYS.RESUME_FEEDBACK] = rf;
  }

  await writeUsage(env, uid, usage);

  // Return snapshot for convenience in responses
  const { limit, used, scope } = computeFeatureUsageSnapshot(usage.plan, usage, featureKey);
  return {
    usage,
    feature: featureKey,
    plan: usage.plan,
    limit,
    used,
    scope
  };
}

export async function getCooldownStatus(env, uid, featureKey, cooldownSeconds) {
  const current = await readUsage(env, uid);
  const plan = current?.plan || 'free';
  const usage = normalizeUsage(current || initEmptyUsage(plan), plan);
  const featureUsage = usage.features?.[featureKey] || {};
  const last = Number(featureUsage.lastUsedAt || 0);
  const cdMs = (cooldownSeconds || 0) * 1000;
  const now = nowMs();
  const onCooldown = !!(last && cdMs > 0 && now - last < cdMs);
  const remaining = onCooldown ? Math.ceil((cdMs - (now - last)) / 1000) : 0;
  return {
    onCooldown,
    cooldownSecondsRemaining: remaining,
    feature: featureKey,
    plan: usage.plan
  };
}

export async function touchCooldown(env, uid, plan, featureKey) {
  let usage = await readUsage(env, uid);
  usage = normalizeUsage(usage, plan);
  if (!usage.features) usage.features = {};
  if (!usage.features[featureKey]) {
    // Initialize feature with correct schema based on feature type
    if (featureKey === FEATURE_KEYS.ATS_SCORE) {
      usage.features[featureKey] = { lifetimeUsed: 0 };
    } else if (featureKey === FEATURE_KEYS.RESUME_FEEDBACK) {
      usage.features[featureKey] = { lifetimeUsed: 0, periodUsed: 0, lastUsedAt: null };
    } else {
      // Fallback for unknown features (should not happen, but be safe)
      usage.features[featureKey] = { lifetimeUsed: 0, periodUsed: 0, lastUsedAt: null };
    }
  }
  // Only update lastUsedAt if the feature supports it (RESUME_FEEDBACK)
  if (featureKey === FEATURE_KEYS.RESUME_FEEDBACK) {
    usage.features[featureKey].lastUsedAt = nowMs();
  }
  await writeUsage(env, uid, usage);
  const lastUsedAt = usage.features[featureKey]?.lastUsedAt || null;
  return { feature: featureKey, plan: usage.plan, lastUsedAt };
}

// Re-export for convenience
export { getCurrentPeriodBounds } from './usage-config.js';
export { FEATURE_KEYS } from './usage-config.js';


