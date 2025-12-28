#!/usr/bin/env node
/**
 * Check resume upload length for a specific user
 * Usage: node check-resume-length.js <auth_id> [environment]
 * Example: node check-resume-length.js briIBE0WM2T7JxMmvKZU6qhekGM2 production
 */

const { execSync } = require('child_process');
const path = require('path');

const authId = process.argv[2];
const environment = process.argv[3] || 'production';

if (!authId) {
  console.error('Usage: node check-resume-length.js <auth_id> [environment]');
  console.error('Example: node check-resume-length.js briIBE0WM2T7JxMmvKZU6qhekGM2 production');
  process.exit(1);
}

const validEnvs = ['dev', 'qa', 'production'];
if (!validEnvs.includes(environment)) {
  console.error(`Invalid environment: ${environment}. Must be one of: ${validEnvs.join(', ')}`);
  process.exit(1);
}

console.log(`Checking resume length for user: ${authId}`);
console.log(`Environment: ${environment}\n`);

try {
  // Database IDs by environment (use database ID directly)
  const dbIds = {
    dev: 'c5c0eee5-a223-4ea2-974e-f4aee5a28bab',
    qa: '80d87a73-6615-4823-b7a4-19a8821b4f87',
    production: 'f9b709fd-56c3-4a0b-8141-4542327c9d4d'
  };
  const dbId = dbIds[environment];
  
  // Step 1: Get user ID from auth_id
  console.log('Step 1: Finding user in D1...');
  const userQuery = `SELECT id, auth_id, email, created_at FROM users WHERE auth_id = '${authId}' LIMIT 1`;
  const userResult = execSync(
    `npx wrangler d1 execute ${dbId} --command "${userQuery}" --json`,
    { encoding: 'utf-8', cwd: path.join(__dirname, '../../..') }
  );
  
  // Parse JSON response
  let userData;
  try {
    const jsonResult = JSON.parse(userResult);
    if (!jsonResult.success || !jsonResult.results || jsonResult.results.length === 0) {
      console.error('User not found in database');
      process.exit(1);
    }
    userData = jsonResult.results[0];
  } catch (e) {
    // Fallback to text parsing if JSON fails
    const userMatch = userResult.match(/\|(\d+)\s+\|([^|]+)\s+\|([^|]*)\s+\|([^|]+)\|/);
    if (!userMatch) {
      console.error('User not found in database');
      process.exit(1);
    }
    userData = {
      id: userMatch[1].trim(),
      auth_id: userMatch[2].trim(),
      email: userMatch[3].trim(),
      created_at: userMatch[4].trim()
    };
  }
  
  const userId = userData.id;
  const userEmail = userData.email || 'N/A';
  console.log(`✓ Found user: ID=${userId}, Email=${userEmail}\n`);

  // Step 2: Get most recent resume session
  console.log('Step 2: Finding most recent resume session...');
  const resumeQuery = `SELECT id, user_id, title, role, created_at, raw_text_location, ats_score 
    FROM resume_sessions 
    WHERE user_id = ${userId} 
    ORDER BY created_at DESC 
    LIMIT 1`;
  
  const resumeResult = execSync(
    `npx wrangler d1 execute ${dbId} --command "${resumeQuery}" --json`,
    { encoding: 'utf-8', cwd: path.join(__dirname, '../../..') }
  );
  
  // Parse JSON response
  let resumeData;
  try {
    const jsonResult = JSON.parse(resumeResult);
    if (!jsonResult.success || !jsonResult.results || jsonResult.results.length === 0) {
      console.log('No resume sessions found for this user');
      process.exit(0);
    }
    resumeData = jsonResult.results[0];
  } catch (e) {
    // Fallback to text parsing
    const resumeMatch = resumeResult.match(/\|(\d+)\s+\|(\d+)\s+\|([^|]*)\s+\|([^|]*)\s+\|([^|]+)\s+\|([^|]+)\s+\|([^|]*)\|/);
    if (!resumeMatch) {
      console.log('No resume sessions found for this user');
      process.exit(0);
    }
    resumeData = {
      id: resumeMatch[1].trim(),
      user_id: resumeMatch[2].trim(),
      title: resumeMatch[3].trim(),
      role: resumeMatch[4].trim(),
      created_at: resumeMatch[5].trim(),
      raw_text_location: resumeMatch[6].trim(),
      ats_score: resumeMatch[7].trim()
    };
  }
  
  const rawTextLocation = resumeData.raw_text_location;
  const createdAt = resumeData.created_at;
  const role = resumeData.role || 'N/A';
  const atsScore = resumeData.ats_score || 'N/A';
  
  console.log(`✓ Found resume session:`);
  console.log(`  - Created: ${createdAt}`);
  console.log(`  - Role: ${role}`);
  console.log(`  - ATS Score: ${atsScore}`);
  console.log(`  - KV Key: ${rawTextLocation}\n`);

  if (!rawTextLocation || rawTextLocation === 'null') {
    console.log('No resume text location found (raw_text_location is null)');
    process.exit(0);
  }

  // Extract resumeId from raw_text_location (format: "resume:${resumeId}")
  const resumeId = rawTextLocation.replace(/^resume:/, '');
  
  // Step 3: Get resume text from KV
  console.log('Step 3: Fetching resume text from KV...');
  const kvKey = rawTextLocation;
  
  try {
    const kvResult = execSync(
      `npx wrangler kv:key get "${kvKey}" --env=${environment}`,
      { encoding: 'utf-8', cwd: path.join(__dirname, '../../..') }
    );
    
    if (!kvResult || kvResult.trim() === '') {
      console.log('⚠️  Resume text not found in KV (may have expired or been deleted)');
      process.exit(0);
    }
    
    const resumeData = JSON.parse(kvResult);
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
    
  } catch (kvError) {
    if (kvError.message.includes('not found') || kvError.message.includes('No such key')) {
      console.log('⚠️  Resume text not found in KV (may have expired or been deleted)');
    } else {
      console.error('Error fetching from KV:', kvError.message);
      throw kvError;
    }
  }
  
} catch (error) {
  console.error('Error:', error.message);
  if (error.stdout) console.error('STDOUT:', error.stdout);
  if (error.stderr) console.error('STDERR:', error.stderr);
  process.exit(1);
}

