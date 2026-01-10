/**
 * Firebase Cloud Functions for JobHackAI
 * 
 * NOTE: LinkedIn OAuth authentication has been moved to Cloudflare Pages Functions
 * and no longer uses Firebase Functions. All LinkedIn auth logic is now in:
 * - /app/functions/api/auth/linkedin/start.js (OAuth initiation)
 * - /app/functions/api/auth/linkedin/callback.js (OAuth callback + Firebase custom token minting)
 * 
 * This file is kept for potential future Firebase Functions, but LinkedIn auth
 * functions have been removed to eliminate Blaze plan dependency.
 */