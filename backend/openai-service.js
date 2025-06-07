// Wix Backend Service for OpenAI Integration
import { OpenAI } from 'openai';
import wixSecrets from 'wix-secrets';

// Initialize OpenAI client
let openai;
async function getOpenAIClient() {
  if (!openai) {
    const apiKey = await wixSecrets.getSecret('OPENAI_API_KEY');
    openai = new OpenAI({ apiKey });
  }
  return openai;
}

// Rate limiting and usage tracking
const userQuotas = new Map();
const RATE_LIMIT = {
  free: { calls: 5, period: 24 * 60 * 60 * 1000 }, // 5 calls per day
  essential: { calls: 20, period: 24 * 60 * 60 * 1000 }, // 20 calls per day
  pro: { calls: 50, period: 24 * 60 * 60 * 1000 }, // 50 calls per day
  premium: { calls: 100, period: 24 * 60 * 60 * 1000 } // 100 calls per day
};

async function checkQuota(userId, plan) {
  const now = Date.now();
  const quota = RATE_LIMIT[plan] || RATE_LIMIT.free;
  
  if (!userQuotas.has(userId)) {
    userQuotas.set(userId, {
      calls: 0,
      resetTime: now + quota.period
    });
  }
  
  const userQuota = userQuotas.get(userId);
  
  if (now > userQuota.resetTime) {
    userQuota.calls = 0;
    userQuota.resetTime = now + quota.period;
  }
  
  if (userQuota.calls >= quota.calls) {
    throw new Error('Rate limit exceeded. Please upgrade your plan for more calls.');
  }
  
  userQuota.calls++;
  return true;
}

// Resume Analysis Endpoints
export async function scoreResume(resumeText, targetRole, userId, plan) {
  await checkQuota(userId, plan);
  const openai = await getOpenAIClient();
  
  const response = await openai.chat.completions.create({
    model: 'gpt-4-turbo-preview',
    messages: [{
      role: 'user',
      content: `Analyze this resume for ATS compatibility and provide a detailed score. 
      Target Role: ${targetRole}
      Resume: ${resumeText}`
    }],
    max_tokens: 4000,
    temperature: 0.7
  });
  
  return response.choices[0].message.content;
}

export async function generateFeedback(resumeText, targetRole, userId, plan) {
  await checkQuota(userId, plan);
  const openai = await getOpenAIClient();
  
  const response = await openai.chat.completions.create({
    model: 'gpt-4-turbo-preview',
    messages: [{
      role: 'user',
      content: `Provide detailed feedback on this resume for the role of ${targetRole}.
      Resume: ${resumeText}`
    }],
    max_tokens: 4000,
    temperature: 0.7
  });
  
  return response.choices[0].message.content;
}

// Cover Letter Endpoint
export async function generateCoverLetter(resumeText, jobDescription, targetRole, userId, plan) {
  await checkQuota(userId, plan);
  const openai = await getOpenAIClient();
  
  const response = await openai.chat.completions.create({
    model: 'gpt-4-turbo-preview',
    messages: [{
      role: 'user',
      content: `Generate a professional cover letter for the role of ${targetRole}.
      Resume: ${resumeText}
      Job Description: ${jobDescription}`
    }],
    max_tokens: 4000,
    temperature: 0.7
  });
  
  return response.choices[0].message.content;
}

// Interview Endpoints
export async function generateQuestions(targetRole, seniority, count, userId, plan) {
  await checkQuota(userId, plan);
  const openai = await getOpenAIClient();
  
  const response = await openai.chat.completions.create({
    model: 'gpt-4-turbo-preview',
    messages: [{
      role: 'user',
      content: `Generate ${count} interview questions for a ${seniority} ${targetRole} position.`
    }],
    max_tokens: 4000,
    temperature: 0.7
  });
  
  return response.choices[0].message.content;
}

export async function scoreAnswer(question, answer, targetRole, userId, plan) {
  await checkQuota(userId, plan);
  const openai = await getOpenAIClient();
  
  const response = await openai.chat.completions.create({
    model: 'gpt-4-turbo-preview',
    messages: [{
      role: 'user',
      content: `Evaluate this interview answer for a ${targetRole} position.
      Question: ${question}
      Answer: ${answer}`
    }],
    max_tokens: 4000,
    temperature: 0.7
  });
  
  return response.choices[0].message.content;
}

// LinkedIn Endpoint
export async function optimizeProfile(profileSections, targetRole, userId, plan) {
  await checkQuota(userId, plan);
  const openai = await getOpenAIClient();
  
  const response = await openai.chat.completions.create({
    model: 'gpt-4-turbo-preview',
    messages: [{
      role: 'user',
      content: `Optimize this LinkedIn profile for a ${targetRole} position.
      Profile Sections: ${JSON.stringify(profileSections)}`
    }],
    max_tokens: 4000,
    temperature: 0.7
  });
  
  return response.choices[0].message.content;
} 