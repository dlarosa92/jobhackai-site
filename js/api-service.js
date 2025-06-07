// API Service for JobHackAI
// Handles all OpenAI interactions in a Wix-compatible way

const OPENAI_MODEL = 'gpt-4-turbo-preview';
const MAX_TOKENS = 4000;

// Wix-compatible fetch wrapper
async function wixFetch(url, options = {}) {
  try {
    const response = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers
      }
    });
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    return await response.json();
  } catch (error) {
    console.error('API Error:', error);
    throw error;
  }
}

// Resume Analysis Service
const ResumeService = {
  async scoreResume(resumeText, targetRole) {
    const prompt = `Analyze this resume for ATS compatibility and provide a detailed score. 
    Target Role: ${targetRole}
    Resume: ${resumeText}
    
    Provide a JSON response with:
    - overallScore (0-100)
    - keywordMatch (0-100)
    - formattingScore (0-100)
    - detailedFeedback (string)
    - missingKeywords (array)
    - suggestedImprovements (array)`;

    return await wixFetch('/api/resume/score', {
      method: 'POST',
      body: JSON.stringify({
        model: OPENAI_MODEL,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: MAX_TOKENS,
        temperature: 0.7
      })
    });
  },

  async generateFeedback(resumeText, targetRole) {
    const prompt = `Provide detailed feedback on this resume for the role of ${targetRole}.
    Resume: ${resumeText}
    
    Focus on:
    1. Content quality and relevance
    2. Achievement quantification
    3. Skills alignment
    4. Professional tone
    5. Specific improvement suggestions`;

    return await wixFetch('/api/resume/feedback', {
      method: 'POST',
      body: JSON.stringify({
        model: OPENAI_MODEL,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: MAX_TOKENS,
        temperature: 0.7
      })
    });
  },

  async rewriteResume(resumeText, targetRole, style = 'professional') {
    const prompt = `Rewrite this resume for the role of ${targetRole} in a ${style} style.
    Resume: ${resumeText}
    
    Maintain all factual information but:
    1. Optimize for ATS
    2. Quantify achievements
    3. Align skills with role
    4. Improve impact statements
    5. Maintain professional tone`;

    return await wixFetch('/api/resume/rewrite', {
      method: 'POST',
      body: JSON.stringify({
        model: OPENAI_MODEL,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: MAX_TOKENS,
        temperature: 0.7
      })
    });
  }
};

// Cover Letter Service
const CoverLetterService = {
  async generateCoverLetter(resumeText, jobDescription, targetRole) {
    const prompt = `Generate a professional cover letter for the role of ${targetRole}.
    Resume: ${resumeText}
    Job Description: ${jobDescription}
    
    Requirements:
    1. ATS-optimized
    2. Highlight relevant experience
    3. Professional tone
    4. Specific to the role
    5. Include quantifiable achievements`;

    return await wixFetch('/api/cover-letter/generate', {
      method: 'POST',
      body: JSON.stringify({
        model: OPENAI_MODEL,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: MAX_TOKENS,
        temperature: 0.7
      })
    });
  }
};

// Interview Service
const InterviewService = {
  async generateQuestions(targetRole, seniority = 'mid-level', count = 5) {
    const prompt = `Generate ${count} interview questions for a ${seniority} ${targetRole} position.
    Include:
    1. Technical questions
    2. Behavioral questions
    3. Problem-solving scenarios
    4. Role-specific challenges
    5. Leadership/team questions`;

    return await wixFetch('/api/interview/questions', {
      method: 'POST',
      body: JSON.stringify({
        model: OPENAI_MODEL,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: MAX_TOKENS,
        temperature: 0.7
      })
    });
  },

  async scoreAnswer(question, answer, targetRole) {
    const prompt = `Evaluate this interview answer for a ${targetRole} position.
    Question: ${question}
    Answer: ${answer}
    
    Provide a JSON response with:
    - score (0-100)
    - strengths (array)
    - weaknesses (array)
    - improvementSuggestions (array)
    - sampleAnswer (string)`;

    return await wixFetch('/api/interview/score', {
      method: 'POST',
      body: JSON.stringify({
        model: OPENAI_MODEL,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: MAX_TOKENS,
        temperature: 0.7
      })
    });
  }
};

// LinkedIn Service
const LinkedInService = {
  async optimizeProfile(profileSections, targetRole) {
    const prompt = `Optimize this LinkedIn profile for a ${targetRole} position.
    Profile Sections: ${JSON.stringify(profileSections)}
    
    Provide a JSON response with:
    - overallScore (0-100)
    - sectionScores (object)
    - optimizedSections (object)
    - keywordSuggestions (array)
    - improvementTips (array)`;

    return await wixFetch('/api/linkedin/optimize', {
      method: 'POST',
      body: JSON.stringify({
        model: OPENAI_MODEL,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: MAX_TOKENS,
        temperature: 0.7
      })
    });
  }
};

// Export services
export {
  ResumeService,
  CoverLetterService,
  InterviewService,
  LinkedInService
}; 