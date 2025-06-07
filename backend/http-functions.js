// Wix HTTP Functions
import { scoreResume, generateFeedback, generateCoverLetter, 
         generateQuestions, scoreAnswer, optimizeProfile } from './openai-service';
import wixAuth from 'wix-auth';

// Helper function to handle errors
function handleError(error) {
  console.error('API Error:', error);
  return {
    status: error.status || 500,
    body: {
      error: error.message || 'Internal server error'
    }
  };
}

// Resume Endpoints
export async function post_resume_score(request) {
  try {
    const { resumeText, targetRole } = request.body;
    const { userId } = await wixAuth.getCurrentUser();
    const { plan } = await wixAuth.getUserPlan(userId);
    
    const result = await scoreResume(resumeText, targetRole, userId, plan);
    return {
      status: 200,
      body: result
    };
  } catch (error) {
    return handleError(error);
  }
}

export async function post_resume_feedback(request) {
  try {
    const { resumeText, targetRole } = request.body;
    const { userId } = await wixAuth.getCurrentUser();
    const { plan } = await wixAuth.getUserPlan(userId);
    
    const result = await generateFeedback(resumeText, targetRole, userId, plan);
    return {
      status: 200,
      body: result
    };
  } catch (error) {
    return handleError(error);
  }
}

// Cover Letter Endpoint
export async function post_cover_letter(request) {
  try {
    const { resumeText, jobDescription, targetRole } = request.body;
    const { userId } = await wixAuth.getCurrentUser();
    const { plan } = await wixAuth.getUserPlan(userId);
    
    const result = await generateCoverLetter(resumeText, jobDescription, targetRole, userId, plan);
    return {
      status: 200,
      body: result
    };
  } catch (error) {
    return handleError(error);
  }
}

// Interview Endpoints
export async function post_interview_questions(request) {
  try {
    const { targetRole, seniority, count } = request.body;
    const { userId } = await wixAuth.getCurrentUser();
    const { plan } = await wixAuth.getUserPlan(userId);
    
    const result = await generateQuestions(targetRole, seniority, count, userId, plan);
    return {
      status: 200,
      body: result
    };
  } catch (error) {
    return handleError(error);
  }
}

export async function post_interview_score(request) {
  try {
    const { question, answer, targetRole } = request.body;
    const { userId } = await wixAuth.getCurrentUser();
    const { plan } = await wixAuth.getUserPlan(userId);
    
    const result = await scoreAnswer(question, answer, targetRole, userId, plan);
    return {
      status: 200,
      body: result
    };
  } catch (error) {
    return handleError(error);
  }
}

// LinkedIn Endpoint
export async function post_linkedin_optimize(request) {
  try {
    const { profileSections, targetRole } = request.body;
    const { userId } = await wixAuth.getCurrentUser();
    const { plan } = await wixAuth.getUserPlan(userId);
    
    const result = await optimizeProfile(profileSections, targetRole, userId, plan);
    return {
      status: 200,
      body: result
    };
  } catch (error) {
    return handleError(error);
  }
} 