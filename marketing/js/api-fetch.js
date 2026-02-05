/**
 * API Fetch Helper - Token-based API calls with automatic refresh on 401
 * Uses token-manager for token storage and refresh
 */

import { getIdToken, forceRefreshToken } from './token-manager.js';

/**
 * Fetch API with automatic token attachment and 401 refresh
 * @param {string} path - API path (relative or absolute)
 * @param {RequestInit} options - Fetch options
 * @returns {Promise<Response>}
 */
export async function apiFetch(path, options = {}) {
  // Get idToken (will refresh if expired)
  let idToken;
  try {
    idToken = await getIdToken();
  } catch (e) {
    console.error('Failed to get idToken:', e);
    throw new Error('Authentication required');
  }

  // Prepare headers
  const headers = new Headers(options.headers || {});
  headers.set('Authorization', `Bearer ${idToken}`);

  if (options.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  // Make request
  let response = await fetch(path, { ...options, headers });

  // Handle 401 - try refresh and retry once
  if (response.status === 401) {
    try {
      // Force refresh token
      idToken = await forceRefreshToken();
      
      // Retry request with new token
      headers.set('Authorization', `Bearer ${idToken}`);
      response = await fetch(path, { ...options, headers });
    } catch (refreshError) {
      console.error('Token refresh failed on 401:', refreshError);
      throw new Error('Authentication failed - please sign in again');
    }
  }

  return response;
}

/**
 * Fetch API and parse JSON response
 * @param {string} path - API path
 * @param {RequestInit} options - Fetch options
 * @returns {Promise<any>} Parsed JSON response
 */
export async function apiFetchJSON(path, options = {}) {
  const response = await apiFetch(path, options);
  const text = await response.text();
  
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch (e) {
    data = null;
  }

  if (!response.ok) {
    const error = new Error(data?.error || `HTTP ${response.status}`);
    error.status = response.status;
    error.data = data;
    throw error;
  }

  return data;
}
