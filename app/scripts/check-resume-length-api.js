#!/usr/bin/env node
/**
 * Check resume upload length for a specific user using Cloudflare API
 * Usage: node check-resume-length-api.js <auth_id> [environment]
 * Requires: CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID env vars
 */

const https = require('https');

const authId = process.argv[2];
const environment = process.argv[3] || 'production';

if (!authId) {
  console.error('Usage: node check-resume-length-api.js <auth_id> [environment]');
  console.error('Example: node check-resume-length-api.js briIBE0WM2T7JxMmvKZU6qhekGM2 production');
  process.exit(1);
}

const validEnvs = ['dev', 'qa', 'production'];
if (!validEnvs.includes(environment)) {
  console.error(`Invalid environment: ${environment}. Must be one of: ${validEnvs.join(', ')}`);
  process.exit(1);
}

const API_TOKEN = process.env.CLOUDFLARE_API_TOKEN;
const ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID;

if (!API_TOKEN || !ACCOUNT_ID) {
  console.error('Error: CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID environment variables are required');
  process.exit(1);
}

// Database IDs by environment
const dbIds = {
  dev: 'c5c0eee5-a223-4ea2-974e-f4aee5a28bab',
  qa: '80d87a73-6615-4823-b7a4-19a8821b4f87',
  production: 'f9b709fd-56c3-4a0b-8141-4542327c9d4d'
};
const dbId = dbIds[environment];

console.log(`Checking resume length for user: ${authId}`);
console.log(`Environment: ${environment}\n`);

function queryD1(sql) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({ sql });
    
    const options = {
      hostname: 'api.cloudflare.com',
      path: `/client/v4/accounts/${ACCOUNT_ID}/d1/database/${dbId}/query`,
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${API_TOKEN}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const result = JSON.parse(data);
          if (result.success) {
            resolve(result);
          } else {
            reject(new Error(result.errors?.[0]?.message || 'Query failed'));
          }
        } catch (e) {
          reject(new Error(`Failed to parse response: ${e.message}`));
        }
      });
    });

    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

function getKVNamespaceId() {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.cloudflare.com',
      path: `/client/v4/accounts/${ACCOUNT_ID}/storage/kv/namespaces`,
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${API_TOKEN}`,
        'Content-Type': 'application/json'
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const result = JSON.parse(data);
          if (result.success && result.result && result.result.length > 0) {
            // Find namespace that matches production pattern
            const namespace = result.result.find(ns => 
              ns.title.toLowerCase().includes('production') || 
              ns.title.toLowerCase().includes('prod') ||
              ns.title.toLowerCase().includes('jobhackai')
            ) || result.result[0];
            resolve(namespace.id);
          } else {
            reject(new Error('No KV namespaces found'));
          }
        } catch (e) {
          reject(new Error(`Failed to parse response: ${e.message}`));
        }
      });
    });

    req.on('error', reject);
    req.end();
  });
}

function getKVKey(key, namespaceId) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.cloudflare.com',
      path: `/client/v4/accounts/${ACCOUNT_ID}/storage/kv/namespaces/${namespaceId}/values/${encodeURIComponent(key)}`,
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${API_TOKEN}`,
        'Content-Type': 'application/json'
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode === 404) {
          resolve(null);
        } else if (res.statusCode === 200) {
          resolve(data);
        } else {
          reject(new Error(`KV GET failed: ${res.statusCode} - ${data}`));
        }
      });
    });

    req.on('error', reject);
    req.end();
  });
}

async function main() {
  try {
    // Step 1: Try to find user in D1, but if not found, try KV directly
    console.log('Step 1: Finding user in D1...');
    let user = null;
    let resumeSession = null;
    
    try {
      const userResult = await queryD1(`SELECT id, auth_id, email, created_at FROM users WHERE auth_id = '${authId}' LIMIT 1`);
      if (userResult.results && userResult.results.length > 0) {
        user = userResult.results[0];
        console.log(`✓ Found user in D1: ID=${user.id}, Email=${user.email || 'N/A'}\n`);

        // Step 2: Get most recent resume session
        console.log('Step 2: Finding most recent resume session...');
        const resumeResult = await queryD1(`
          SELECT id, user_id, title, role, created_at, raw_text_location, ats_score 
          FROM resume_sessions 
          WHERE user_id = ${user.id} 
          ORDER BY created_at DESC 
          LIMIT 1
        `);
        
        if (resumeResult.results && resumeResult.results.length > 0) {
          resumeSession = resumeResult.results[0];
        }
      }
    } catch (d1Error) {
      console.log('⚠️  User not found in D1 (this is okay - resume may be in KV only)');
    }
    
    // Step 3: Try to get resume from KV directly
    console.log('\nStep 3: Searching for resume in KV...');
    
    // Get KV namespace ID
    const namespaceId = await getKVNamespaceId();
    console.log(`✓ Found KV namespace: ${namespaceId}\n`);
    
    // Try to find recent resume keys for this user
    // Resume keys are in format: resume:${uid}:${timestamp}
    // Try a few recent timestamps (last 7 days)
    const now = Date.now();
    const oneDayAgo = now - (24 * 60 * 60 * 1000);
    const sevenDaysAgo = now - (7 * 24 * 60 * 60 * 1000);
    
    let resumeData = null;
    let foundKey = null;
    
    // Try to get resume with a recent timestamp (within last day)
    // We'll try a few potential keys
    const potentialKeys = [
      `resume:${authId}:${now}`,
      `resume:${authId}:${oneDayAgo}`,
      `resume:${authId}:${Math.floor(now / 1000) * 1000}`, // Round to nearest second
      `resume:${authId}:${Math.floor(oneDayAgo / 1000) * 1000}`
    ];
    
    // Also try to construct key from D1 session if available
    if (resumeSession && resumeSession.raw_text_location) {
      potentialKeys.unshift(resumeSession.raw_text_location);
    }
    
    console.log('Trying to fetch resume from KV...');
    for (const key of potentialKeys) {
      try {
        const kvValue = await getKVKey(key, namespaceId);
        if (kvValue) {
          resumeData = JSON.parse(kvValue);
          // Verify it belongs to this user
          if (resumeData.uid === authId) {
            foundKey = key;
            break;
          }
        }
      } catch (e) {
        // Continue to next key
      }
    }
    
    if (!resumeData) {
      console.log('⚠️  Could not find resume in KV with common patterns.');
      console.log('   The resume may have been uploaded with a different timestamp.');
      console.log('   Please check the browser console or network tab for the actual resumeId.');
      process.exit(0);
    }
    
    console.log(`✓ Found resume in KV: ${foundKey}\n`);
    
    // Step 4: Analyze resume length
    console.log('Step 4: Analyzing resume data...\n');
    const resumeText = resumeData.text || '';
    const textLength = resumeText.length;
    const wordCount = resumeData.wordCount || resumeText.split(/\s+/).filter(w => w.length > 0).length;
    const fileSize = resumeData.fileSize || 'N/A';
    const fileName = resumeData.fileName || 'N/A';
    
    console.log(`✓ Resume data retrieved:\n`);
    console.log(`  File Name: ${fileName}`);
    console.log(`  File Size: ${fileSize} bytes`);
    console.log(`  Text Length: ${textLength.toLocaleString()} characters`);
    console.log(`  Word Count: ${wordCount.toLocaleString()} words`);
    console.log(`  Character/Word Ratio: ${wordCount > 0 ? (textLength / wordCount).toFixed(2) : 'N/A'} chars/word\n`);
    
    // Analyze if length could be causing delays
    console.log('Performance Analysis:');
    if (textLength > 50000) {
      console.log(`  ⚠️  WARNING: Resume is very long (${textLength.toLocaleString()} chars)`);
      console.log(`     This could significantly slow down AI processing.`);
      console.log(`     OpenAI API processes ~1600 tokens per request, and long resumes`);
      console.log(`     require more tokens, leading to longer response times.`);
    } else if (textLength > 20000) {
      console.log(`  ⚠️  Resume is moderately long (${textLength.toLocaleString()} chars)`);
      console.log(`     This may contribute to slower processing times.`);
    } else {
      console.log(`  ✓ Resume length is reasonable (${textLength.toLocaleString()} chars)`);
      console.log(`     Length is unlikely to be the primary cause of delays.`);
    }
    
    // Estimate token count (rough approximation: 1 token ≈ 4 characters)
    const estimatedTokens = Math.ceil(textLength / 4);
    console.log(`\n  Estimated Tokens: ~${estimatedTokens.toLocaleString()} tokens`);
    console.log(`  (Rough estimate: 1 token ≈ 4 characters)`);
    
    if (estimatedTokens > 4000) {
      console.log(`  ⚠️  High token count may require multiple API calls or longer processing`);
    }
    
    // If we found resume session info, show it
    if (resumeSession) {
      console.log(`\n  Resume Session Info:`);
      console.log(`    - Created: ${resumeSession.created_at}`);
      console.log(`    - Role: ${resumeSession.role || 'N/A'}`);
      console.log(`    - ATS Score: ${resumeSession.ats_score || 'N/A'}`);
    }
    
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

main();

