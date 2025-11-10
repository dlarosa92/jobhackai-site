/**
 * JobHackAI API Retry Utility
 * Retry logic with exponential backoff for API calls
 */

(function() {
  'use strict';

  /**
   * Retry API call with exponential backoff
   * @param {Function} apiCall - Function that returns a Promise
   * @param {Object} options - Retry configuration
   * @param {number} [options.maxRetries=3] - Maximum number of retries
   * @param {number} [options.initialDelay=1000] - Initial delay in ms
   * @param {number} [options.maxDelay=30000] - Maximum delay in ms
   * @param {Function} [options.shouldRetry] - Function to determine if error should be retried
   * @returns {Promise} API response
   */
  async function retryWithBackoff(apiCall, options = {}) {
    const {
      maxRetries = 3,
      initialDelay = 1000,
      maxDelay = 30000,
      shouldRetry = (error) => {
        // Retry on network errors, 5xx errors, and rate limits
        if (error instanceof TypeError && error.message.includes('fetch')) {
          return true; // Network error
        }
        if (error.status >= 500) {
          return true; // Server error
        }
        if (error.status === 429) {
          return true; // Rate limit
        }
        if (error.status === 408) {
          return true; // Request timeout
        }
        return false;
      }
    } = options;

    let lastError;
    let delay = initialDelay;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const result = await apiCall();
        return result;
      } catch (error) {
        lastError = error;

        // Don't retry on last attempt
        if (attempt === maxRetries) {
          break;
        }

        // Check if error should be retried
        if (!shouldRetry(error)) {
          throw error;
        }

        // Calculate delay with exponential backoff
        const retryDelay = Math.min(delay * Math.pow(2, attempt), maxDelay);
        
        // Add jitter to prevent thundering herd
        const jitter = Math.random() * 0.3 * retryDelay;
        const finalDelay = retryDelay + jitter;

        console.log(`[API-RETRY] Attempt ${attempt + 1} failed, retrying in ${Math.round(finalDelay)}ms...`, error);

        await new Promise(resolve => setTimeout(resolve, finalDelay));
      }
    }

    // All retries exhausted
    throw lastError;
  }

  /**
   * Enhanced fetch with retry logic
   * @param {string} url - Request URL
   * @param {Object} options - Fetch options
   * @param {Object} retryOptions - Retry configuration
   * @returns {Promise<Response>} Fetch response
   */
  async function fetchWithRetry(url, options = {}, retryOptions = {}) {
    return retryWithBackoff(async () => {
      const response = await fetch(url, options);

      // Check if response indicates retryable error
      if (!response.ok) {
        const error = new Error(`HTTP ${response.status}: ${response.statusText}`);
        error.status = response.status;
        error.response = response;
        throw error;
      }

      return response;
    }, retryOptions);
  }

  // Export public API
  window.JobHackAIRetry = {
    retryWithBackoff,
    fetchWithRetry
  };
})();

