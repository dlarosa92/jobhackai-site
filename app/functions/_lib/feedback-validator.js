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
 * @returns {ValidationResult} Validation result with valid flag, missing fields, and details
 */
export function validateAIFeedback(aiFeedback, allowOldFormat = false) {
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
  
  // Validate roleSpecificFeedback (new format)
  const hasNewFormat = aiFeedback?.roleSpecificFeedback &&
                       typeof aiFeedback.roleSpecificFeedback === 'object' &&
                       !Array.isArray(aiFeedback.roleSpecificFeedback) &&
                       aiFeedback.roleSpecificFeedback.targetRoleUsed !== undefined &&
                       Array.isArray(aiFeedback.roleSpecificFeedback.sections) &&
                       aiFeedback.roleSpecificFeedback.sections.length > 0;
  
  // Validate roleSpecificFeedback (old format - for backwards compatibility)
  const hasOldFormat = allowOldFormat &&
                       Array.isArray(aiFeedback?.roleSpecificFeedback) &&
                       aiFeedback.roleSpecificFeedback.length > 0;
  
  const hasRoleSpecificFeedback = hasNewFormat || hasOldFormat;
  if (!hasRoleSpecificFeedback) {
    missing.push('roleSpecificFeedback');
  }
  details.hasRoleSpecificFeedback = hasRoleSpecificFeedback;
  details.roleSpecificFeedbackType = typeof aiFeedback?.roleSpecificFeedback;
  details.roleSpecificFeedbackFormat = hasNewFormat ? 'new' : (hasOldFormat ? 'old' : 'none');
  details.roleSpecificFeedbackKeys = aiFeedback?.roleSpecificFeedback ? Object.keys(aiFeedback.roleSpecificFeedback) : null;
  details.sectionsLength = aiFeedback?.roleSpecificFeedback?.sections?.length;
  
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
 * @returns {ValidationResult} Validation result with valid flag, missing fields, and details
 */
export function validateFeedbackResult(result) {
  // Don't allow old format in cache - only cache complete, properly formatted results
  return validateAIFeedback(result, false);
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

  const rsf = result.roleSpecificFeedback;
  const rsfIsObject = rsf && typeof rsf === 'object' && !Array.isArray(rsf);
  const hasRoleSpecificFeedback =
    rsfIsObject &&
    rsf.targetRoleUsed !== undefined &&
    Array.isArray(rsf.sections) &&
    rsf.sections.length > 0;

  const roleSpecificOk = requireRoleSpecific ? hasRoleSpecificFeedback : true;

  return hasAtsRubric && hasAtsIssues && roleSpecificOk;
}

