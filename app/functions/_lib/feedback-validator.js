/**
 * AI Feedback Response Validation Utilities
 * Validates structured AI feedback responses to ensure all required fields are present
 */

/**
 * @typedef {Object} ValidationResult
 * @property {boolean} valid - Whether the response is valid
 * @property {string[]} missing - Array of missing required field names
 * @property {Object} details - Detailed validation information
 */

/**
 * Validates AI feedback response structure
 * @param {Object} aiFeedback - Parsed AI feedback response
 * @param {boolean} allowOldFormat - Whether to accept old array format for roleSpecificFeedback (default: false)
 * @param {boolean} allowMissingRoleFeedback - Whether to allow missing roleSpecificFeedback (default: false)
 *   Set to true when no role was provided, so we don't require role-specific feedback generation.
 *   This supports the token optimization where role-specific feedback is skipped when no role is selected.
 * @returns {ValidationResult} Validation result with valid flag, missing fields, and details
 */
export function validateAIFeedback(aiFeedback, allowOldFormat = false, allowMissingRoleFeedback = false) {
  const missing = [];
  const details = {};
  
  // Validate atsRubric
  const hasAtsRubric = aiFeedback && 
                       Array.isArray(aiFeedback.atsRubric) && 
                       aiFeedback.atsRubric.length > 0;
  if (!hasAtsRubric) {
    missing.push('atsRubric');
  }
  details.hasAtsRubric = hasAtsRubric;
  details.atsRubricLength = aiFeedback?.atsRubric?.length || 0;
  
  // Validate roleSpecificFeedback only if not allowed to be missing
  if (!allowMissingRoleFeedback) {
    const rsf = aiFeedback?.roleSpecificFeedback;
    
    // Validate roleSpecificFeedback (new format) - use strict validation
    const hasNewFormat = isRoleSpecificFeedbackStrict(rsf);
    
    // Validate roleSpecificFeedback (old format - for backwards compatibility)
    // Old format must be array of objects (not mixed types)
    const hasOldFormat = allowOldFormat &&
                         Array.isArray(rsf) &&
                         rsf.length > 0 &&
                         rsf.every(item => item && typeof item === 'object' && !Array.isArray(item));
    
    const hasRoleSpecificFeedback = hasNewFormat || hasOldFormat;
    if (!hasRoleSpecificFeedback) {
      missing.push('roleSpecificFeedback');
    }
    details.hasRoleSpecificFeedback = hasRoleSpecificFeedback;
    details.roleSpecificFeedbackType = typeof rsf;
    details.roleSpecificFeedbackFormat = hasNewFormat ? 'new' : (hasOldFormat ? 'old' : 'none');
    details.roleSpecificFeedbackKeys = rsf && typeof rsf === 'object' && !Array.isArray(rsf) ? Object.keys(rsf) : null;
    details.sectionsLength = hasNewFormat ? rsf.sections.length : (hasOldFormat ? rsf.length : 0);
  } else {
    // When allowed to be missing, just record if it exists (for logging/debugging)
    details.hasRoleSpecificFeedback = !!(aiFeedback?.roleSpecificFeedback);
    details.roleSpecificFeedbackSkipped = true;
  }
  
  // Validate atsIssues
  const hasAtsIssues = aiFeedback?.atsIssues && 
                      Array.isArray(aiFeedback.atsIssues);
  if (!hasAtsIssues) {
    missing.push('atsIssues');
  }
  details.hasAtsIssues = hasAtsIssues;
  details.atsIssuesLength = aiFeedback?.atsIssues?.length || 0;
  
  return {
    valid: missing.length === 0,
    missing,
    details
  };
}

/**
 * Validates complete feedback result before caching
 * Only accepts new format (not old array format) for roleSpecificFeedback
 * @param {Object} result - Feedback result object to validate
 * @param {boolean} allowMissingRoleFeedback - Whether to allow missing roleSpecificFeedback (default: false)
 *   Set to true when validating results generated without a role
 * @returns {ValidationResult} Validation result with valid flag, missing fields, and details
 */
export function validateFeedbackResult(result, allowMissingRoleFeedback = false) {
  // Don't allow old format in cache - only cache complete, properly formatted results
  // Pass through allowMissingRoleFeedback parameter for cases where role wasn't provided
  return validateAIFeedback(result, false, allowMissingRoleFeedback);
}

/**
 * Sanitize role-specific feedback to ensure all sections are valid objects with required fields
 * Filters out non-object entries, enforces types, and drops empty sections
 * @param {Object|null|undefined} rsf - Role-specific feedback object
 * @returns {Object|null} Sanitized role-specific feedback or null if invalid/empty
 */
export function sanitizeRoleSpecificFeedback(rsf) {
  if (!rsf || typeof rsf !== 'object' || Array.isArray(rsf)) {
    return null;
  }

  if (!Array.isArray(rsf.sections)) {
    return null;
  }

  // Filter to only object entries (drop strings, nulls, arrays, etc.)
  const objectSections = rsf.sections.filter(
    item => item && typeof item === 'object' && !Array.isArray(item)
  );

  // Sanitize each section object
  const cleanSections = objectSections
    .map(section => {
      // Enforce required fields with defaults
      const sectionName = typeof section.section === 'string' && section.section.trim()
        ? section.section.trim()
        : null;
      
      if (!sectionName) {
        return null; // Drop sections without a name
      }

      // Validate fitLevel (enum)
      const validFitLevels = ['big_impact', 'tunable', 'strong'];
      const fitLevel = validFitLevels.includes(section.fitLevel)
        ? section.fitLevel
        : 'tunable';

      // Ensure diagnosis is a string
      const diagnosis = typeof section.diagnosis === 'string'
        ? section.diagnosis.trim()
        : '';

      // Ensure tips is an array of strings
      const tips = Array.isArray(section.tips)
        ? section.tips
            .filter(tip => typeof tip === 'string')
            .map(tip => tip.trim())
            .filter(tip => tip.length > 0)
            .slice(0, 3) // Cap at 3
        : [];

      // Ensure rewritePreview is a string
      const rewritePreview = typeof section.rewritePreview === 'string'
        ? section.rewritePreview.trim()
        : '';

      // Drop sections with no meaningful content
      if (!diagnosis && tips.length === 0 && !rewritePreview) {
        return null;
      }

      return {
        section: sectionName,
        fitLevel,
        diagnosis,
        tips,
        rewritePreview
      };
    })
    .filter(section => section !== null); // Remove dropped sections

  // Return null if no valid sections remain
  if (cleanSections.length === 0) {
    return null;
  }

  return {
    targetRoleUsed: typeof rsf.targetRoleUsed === 'string' && rsf.targetRoleUsed.trim()
      ? rsf.targetRoleUsed.trim()
      : 'general',
    sections: cleanSections
  };
}

/**
 * Strict validation for role-specific feedback structure
 * Checks that all sections are objects with required fields and correct types
 * @param {Object|null|undefined} rsf - Role-specific feedback object
 * @returns {boolean} True if rsf is strictly valid
 */
export function isRoleSpecificFeedbackStrict(rsf) {
  if (!rsf || typeof rsf !== 'object' || Array.isArray(rsf)) {
    return false;
  }

  if (typeof rsf.targetRoleUsed !== 'string' || !rsf.targetRoleUsed.trim()) {
    return false;
  }

  if (!Array.isArray(rsf.sections) || rsf.sections.length === 0) {
    return false;
  }

  // Every section must be an object with required fields
  const validFitLevels = ['big_impact', 'tunable', 'strong'];
  return rsf.sections.every(section => {
    if (!section || typeof section !== 'object' || Array.isArray(section)) {
      return false;
    }

    // Check required fields exist and have correct types
    if (typeof section.section !== 'string' || !section.section.trim()) {
      return false;
    }

    if (!validFitLevels.includes(section.fitLevel)) {
      return false;
    }

    if (typeof section.diagnosis !== 'string') {
      return false;
    }

    if (!Array.isArray(section.tips)) {
      return false;
    }

    if (!section.tips.every(tip => typeof tip === 'string')) {
      return false;
    }

    if (typeof section.rewritePreview !== 'string') {
      return false;
    }

    return true;
  });
}

/**
 * Normalize a role string for comparison
 * @param {string|null|undefined} role 
 * @returns {string|null}
 */
export function normalizeRole(role) {
  if (role == null) return null;
  const trimmed = role.trim();
  if (!trimmed) return null;
  return trimmed.toLowerCase();
}

/**
 * Lightweight validity check for full feedback result objects
 * Used for KV/D1 reads and writes to ensure we only serve/store complete results
 * @param {Object} result 
 * @param {Object} opts 
 * @param {boolean} opts.requireRoleSpecific - whether roleSpecificFeedback must be present/complete
 * @returns {boolean}
 */
export function isValidFeedbackResult(result, { requireRoleSpecific = false } = {}) {
  if (!result || typeof result !== 'object') return false;

  const hasAtsRubric = Array.isArray(result.atsRubric) && result.atsRubric.length > 0;
  const hasAtsIssues = Array.isArray(result.atsIssues);

  // Use strict validation for role-specific feedback
  const hasRoleSpecificFeedback = isRoleSpecificFeedbackStrict(result.roleSpecificFeedback);

  const roleSpecificOk = requireRoleSpecific ? hasRoleSpecificFeedback : true;

  return hasAtsRubric && hasAtsIssues && roleSpecificOk;
}

