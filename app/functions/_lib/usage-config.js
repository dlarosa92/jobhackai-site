// Centralized plan limits and feature keys for usage tracking
// Source of truth for plan-based limits and periods
// This module contains NO environment or KV access

export const FEATURE_KEYS = {
  ATS_SCORE: 'atsScore',
  RESUME_FEEDBACK: 'resumeFeedback'
};

/**
 * Returns usage configuration for a given plan.
 * Limits:
 * - number => finite limit
 * - null => unlimited
 * - 0 => locked
 *
 * Period:
 * - period: 'month' | null
 * - periodLimit applies only when period is non-null
 */
export function getPlanUsageConfig(plan) {
  const normalized = String(plan || 'free').toLowerCase();
  switch (normalized) {
    case 'free':
      return {
        plan: 'free',
        features: {
          atsScore: { lifetimeLimit: 1, period: null, periodLimit: null },
          resumeFeedback: { lifetimeLimit: 0, period: null, periodLimit: null } // locked
        }
      };
    case 'trial':
      return {
        plan: 'trial',
        features: {
          atsScore: { lifetimeLimit: null, period: null, periodLimit: null }, // unlimited
          resumeFeedback: { lifetimeLimit: 3, period: null, periodLimit: null } // 3 lifetime
        }
      };
    case 'essential':
      return {
        plan: 'essential',
        features: {
          atsScore: { lifetimeLimit: null, period: null, periodLimit: null }, // unlimited
          resumeFeedback: { lifetimeLimit: null, period: 'month', periodLimit: 3 } // 3 per month
        }
      };
    case 'pro':
    case 'premium':
      return {
        plan: normalized,
        features: {
          atsScore: { lifetimeLimit: null, period: null, periodLimit: null }, // unlimited
          resumeFeedback: { lifetimeLimit: null, period: null, periodLimit: null } // unlimited
        }
      };
    default:
      // Fallback to free if unknown
      return {
        plan: 'free',
        features: {
          atsScore: { lifetimeLimit: 1, period: null, periodLimit: null },
          resumeFeedback: { lifetimeLimit: 0, period: null, periodLimit: null }
        }
      };
  }
}

/**
 * Returns current period bounds for plans with monthly period limits.
 * If plan does not have a period, returns { periodStart: null, periodEnd: null }.
 */
export function getCurrentPeriodBounds(plan) {
  const cfg = getPlanUsageConfig(plan);
  // Determine if any feature uses monthly period => align to calendar month
  const anyMonthly = Object.values(cfg.features).some(
    (f) => f.period === 'month' && typeof f.periodLimit === 'number'
  );
  if (!anyMonthly) {
    return { periodStart: null, periodEnd: null };
  }
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0).getTime();
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 1, 0, 0, 0, 0).getTime() - 1;
  return { periodStart: start, periodEnd: end };
}


