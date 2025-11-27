// Input sanitization utility
// Provides safe input validation and sanitization

/**
 * Sanitize and validate job title
 * @param {string} jobTitle - Raw job title input
 * @param {number} maxLength - Maximum allowed length (default 200)
 * @returns {Object} { valid: boolean, sanitized: string, error: string }
 */
export function sanitizeJobTitle(jobTitle, maxLength = 200) {
  // Handle null/undefined
  if (!jobTitle) {
    return { valid: true, sanitized: '', error: null }; // Empty is valid
  }
  
  // Ensure string type
  const str = String(jobTitle);
  
  // Check length
  if (str.length > maxLength) {
    return {
      valid: false,
      sanitized: str.substring(0, maxLength).trim(),
      error: `Job title exceeds maximum length of ${maxLength} characters`
    };
  }
  
  // Trim whitespace
  const trimmed = str.trim();
  
  // Check for only whitespace
  if (trimmed.length === 0) {
    return { valid: true, sanitized: '', error: null }; // Empty is valid
  }
  
  // Remove control characters (except newlines, tabs, carriage returns)
  const sanitized = trimmed.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
  
  return { valid: true, sanitized, error: null };
}

/**
 * Sanitize resume text
 * @param {string} resumeText - Raw resume text
 * @param {number} maxLength - Maximum allowed length (default 80000)
 * @returns {Object} { valid: boolean, sanitized: string, error: string }
 */
export function sanitizeResumeText(resumeText, maxLength = 80000) {
  // Handle null/undefined
  if (!resumeText) {
    return {
      valid: false,
      sanitized: '',
      error: 'Resume text is required'
    };
  }
  
  // Ensure string type
  const str = String(resumeText);
  
  // Check length
  if (str.length > maxLength) {
    return {
      valid: false,
      sanitized: str.substring(0, maxLength),
      error: `Resume text exceeds maximum length of ${maxLength} characters`
    };
  }
  
  // Remove null bytes and other dangerous control characters
  // Keep newlines, tabs, and carriage returns for formatting
  const sanitized = str.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
  
  return { valid: true, sanitized, error: null };
}

/**
 * Sanitize resume ID
 * @param {string} resumeId - Raw resume ID
 * @returns {Object} { valid: boolean, sanitized: string, error: string }
 */
export function sanitizeResumeId(resumeId) {
  if (!resumeId) {
    return {
      valid: false,
      sanitized: '',
      error: 'Resume ID is required'
    };
  }
  
  const str = String(resumeId).trim();
  
  // Resume IDs should be alphanumeric with hyphens/underscores/colons
  // Format: userId:timestamp (e.g., "bUxocN5IkahkdEnwWlPAl8NTYWm2:1763926426446")
  if (!/^[a-zA-Z0-9_:]+$/.test(str)) {
    return {
      valid: false,
      sanitized: str.replace(/[^a-zA-Z0-9_:]/g, ''),
      error: 'Resume ID contains invalid characters'
    };
  }
  
  // Check reasonable length (UUIDs are 36 chars, but allow some buffer)
  if (str.length > 100) {
    return {
      valid: false,
      sanitized: str.substring(0, 100),
      error: 'Resume ID exceeds maximum length'
    };
  }
  
  return { valid: true, sanitized: str, error: null };
}

/**
 * Sanitize section name
 * @param {string} section - Section name
 * @returns {Object} { valid: boolean, sanitized: string, error: string }
 */
export function sanitizeSection(section) {
  if (!section) {
    return { valid: true, sanitized: '', error: null }; // Empty is valid
  }
  
  const str = String(section).trim();
  
  if (str.length > 100) {
    return {
      valid: false,
      sanitized: str.substring(0, 100),
      error: 'Section name exceeds maximum length'
    };
  }
  
  // Remove control characters
  const sanitized = str.replace(/[\x00-\x1F\x7F]/g, '');
  
  return { valid: true, sanitized, error: null };
}

