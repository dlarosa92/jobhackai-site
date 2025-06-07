// Zapier Integration Handler
class ZapierIntegration {
  constructor() {
    this.webhooks = {
      userSignup: 'https://hooks.zapier.com/hooks/catch/1234567/abc123/',
      interviewComplete: 'https://hooks.zapier.com/hooks/catch/1234567/def456/',
      usageAlert: 'https://hooks.zapier.com/hooks/catch/1234567/ghi789/',
      feedbackSubmit: 'https://hooks.zapier.com/hooks/catch/1234567/jkl012/'
    };
  }

  // User Authentication Flow
  async handleUserSignup(userData) {
    try {
      const response = await fetch(this.webhooks.userSignup, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: userData.email,
          name: userData.name,
          plan: userData.plan,
          signupDate: new Date().toISOString()
        })
      });
      return await response.json();
    } catch (error) {
      console.error('Error in user signup webhook:', error);
      throw error;
    }
  }

  // Interview Session Management
  async saveInterviewSession(sessionData) {
    try {
      const response = await fetch(this.webhooks.interviewComplete, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          userId: sessionData.userId,
          role: sessionData.role,
          score: sessionData.score,
          feedback: sessionData.feedback,
          timestamp: new Date().toISOString()
        })
      });
      return await response.json();
    } catch (error) {
      console.error('Error saving interview session:', error);
      throw error;
    }
  }

  // Usage Tracking
  async trackUsage(usageData) {
    try {
      const response = await fetch(this.webhooks.usageAlert, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          userId: usageData.userId,
          feature: usageData.feature,
          usageCount: usageData.count,
          limit: usageData.limit,
          timestamp: new Date().toISOString()
        })
      });
      return await response.json();
    } catch (error) {
      console.error('Error tracking usage:', error);
      throw error;
    }
  }

  // Feedback Collection
  async submitFeedback(feedbackData) {
    try {
      const response = await fetch(this.webhooks.feedbackSubmit, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          userId: feedbackData.userId,
          rating: feedbackData.rating,
          comment: feedbackData.comment,
          feature: feedbackData.feature,
          timestamp: new Date().toISOString()
        })
      });
      return await response.json();
    } catch (error) {
      console.error('Error submitting feedback:', error);
      throw error;
    }
  }
}

// Export the integration handler
export default ZapierIntegration; 