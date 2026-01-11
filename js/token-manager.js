/**
 * Token Manager - Client-authority token storage and refresh
 * Manages Firebase idToken and refreshToken in sessionStorage
 * Implements hybrid refresh strategy (time-based + 401 fallback)
 */

const TOKEN_STORAGE_KEY = 'firebase_id_token';
const REFRESH_TOKEN_STORAGE_KEY = 'firebase_refresh_token';
const TOKEN_EXPIRY_KEY = 'firebase_token_expiry';

// Single-flight refresh lock to prevent concurrent refresh requests
let refreshPromise = null;
let refreshLock = false;

/**
 * Get Firebase Web API key from config
 * Cache the result to avoid repeated imports
 */
let cachedApiKey = null;
function getFirebaseApiKey() {
  if (cachedApiKey) {
    return cachedApiKey;
  }
  
  // Try window.firebaseConfig (set by pages that import firebase-config.js)
  if (typeof window !== 'undefined' && window.firebaseConfig && window.firebaseConfig.apiKey) {
    cachedApiKey = window.firebaseConfig.apiKey;
    return cachedApiKey;
  }
  
  // Fallback - this is the public API key from firebase-config.js, safe to use client-side
  cachedApiKey = 'AIzaSyCDZksp8XpRJaYnoihiuXT5Uvd0YrbLdfw';
  return cachedApiKey;
}

/**
 * Store tokens in sessionStorage
 */
export function storeTokens(idToken, refreshToken, expiresIn) {
  try {
    const expiryTime = Date.now() + (expiresIn * 1000) - (60 * 1000); // Subtract 1 minute buffer
    sessionStorage.setItem(TOKEN_STORAGE_KEY, idToken);
    sessionStorage.setItem(REFRESH_TOKEN_STORAGE_KEY, refreshToken);
    sessionStorage.setItem(TOKEN_EXPIRY_KEY, expiryTime.toString());
  } catch (e) {
    console.error('Failed to store tokens:', e);
    throw e;
  }
}

/**
 * Clear tokens from sessionStorage
 */
export function clearTokens() {
  try {
    sessionStorage.removeItem(TOKEN_STORAGE_KEY);
    sessionStorage.removeItem(REFRESH_TOKEN_STORAGE_KEY);
    sessionStorage.removeItem(TOKEN_EXPIRY_KEY);
  } catch (e) {
    console.error('Failed to clear tokens:', e);
  }
}

/**
 * Get stored idToken (does not refresh)
 */
export function getIdTokenSync() {
  try {
    return sessionStorage.getItem(TOKEN_STORAGE_KEY);
  } catch (e) {
    return null;
  }
}

/**
 * Check if token is expired or expiring soon
 */
function isTokenExpired() {
  try {
    const expiryStr = sessionStorage.getItem(TOKEN_EXPIRY_KEY);
    if (!expiryStr) return true;
    const expiryTime = parseInt(expiryStr, 10);
    return Date.now() >= expiryTime;
  } catch (e) {
    return true;
  }
}

/**
 * Refresh token using refreshToken
 */
async function refreshTokenInternal() {
  const refreshToken = sessionStorage.getItem(REFRESH_TOKEN_STORAGE_KEY);
  if (!refreshToken) {
    throw new Error('No refresh token available');
  }

  const apiKey = getFirebaseApiKey();
  const response = await fetch(
    `https://securetoken.googleapis.com/v1/token?key=${apiKey}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken
      }).toString()
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    console.error('Token refresh failed:', response.status, errorText);
    clearTokens();
    throw new Error('Token refresh failed');
  }

  const data = await response.json();
  if (!data.id_token || !data.refresh_token) {
    clearTokens();
    throw new Error('Invalid refresh response');
  }

  storeTokens(data.id_token, data.refresh_token, parseInt(data.expires_in || '3600', 10));
  return data.id_token;
}

/**
 * Get idToken, refreshing if necessary (hybrid: time-based + caller handles 401)
 * Returns a promise that resolves to the idToken
 */
export async function getIdToken() {
  // Check if we have a valid token
  const currentToken = getIdTokenSync();
  if (currentToken && !isTokenExpired()) {
    return currentToken;
  }

  // Token expired or missing - refresh it
  // Use single-flight lock to prevent concurrent refreshes
  if (refreshLock && refreshPromise) {
    // Wait for existing refresh to complete
    return refreshPromise;
  }

  refreshLock = true;
  refreshPromise = refreshTokenInternal()
    .finally(() => {
      refreshLock = false;
      refreshPromise = null;
    });

  return refreshPromise;
}

/**
 * Force refresh token (for 401 handling)
 * Uses single-flight lock
 */
export async function forceRefreshToken() {
  if (refreshLock && refreshPromise) {
    return refreshPromise;
  }

  refreshLock = true;
  refreshPromise = refreshTokenInternal()
    .finally(() => {
      refreshLock = false;
      refreshPromise = null;
    });

  return refreshPromise;
}

/**
 * Check if user is authenticated (has tokens)
 */
export function isAuthenticated() {
  const idToken = getIdTokenSync();
  const refreshToken = sessionStorage.getItem(REFRESH_TOKEN_STORAGE_KEY);
  return !!(idToken || refreshToken);
}
