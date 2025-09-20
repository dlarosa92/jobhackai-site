import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';

interface SubscriptionData {
  status: string;
  plan: string;
  currentPeriodEnd?: number;
  cancelAtPeriodEnd?: boolean;
}

export default function Dashboard() {
  const router = useRouter();
  const [user, setUser] = useState<any>({ uid: 'test-user', displayName: 'Test User', email: 'test@example.com' });
  const [loading, setLoading] = useState(false);
  const [subscription, setSubscription] = useState<SubscriptionData | null>({ status: 'active', plan: 'free' });
  const [usageStats, setUsageStats] = useState({
    resumeScans: 0,
    coverLetters: 0,
    interviewQuestions: 0,
    lastActivity: null as string | null
  });

  useEffect(() => {
    // Mock user data for testing
    setLoading(false);
  }, []);

  const fetchSubscriptionData = async (userId: string) => {
    try {
      // This would fetch from your Cloudflare Worker
      const response = await fetch('/api/subscription', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId })
      });
      
      if (response.ok) {
        const data = await response.json();
        setSubscription(data);
      }
    } catch (error) {
      console.error('Error fetching subscription:', error);
      // Default to free plan if no subscription found
      setSubscription({ status: 'active', plan: 'free' });
    }
  };

  const fetchUsageStats = async (userId: string) => {
    try {
      // This would fetch from your KV storage
      const response = await fetch('/api/usage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId })
      });
      
      if (response.ok) {
        const data = await response.json();
        setUsageStats(data);
      }
    } catch (error) {
      console.error('Error fetching usage stats:', error);
    }
  };

  const handleSignIn = async () => {
    console.log('Sign in clicked');
  };

  const handleSignOut = async () => {
    console.log('Sign out clicked');
    router.push('/');
  };

  const handleManageSubscription = async () => {
    try {
      const response = await fetch('/api/stripe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          action: 'create-customer-portal',
          data: { customerId: user?.uid }
        })
      });
      
      if (response.ok) {
        const data = await response.json();
        window.open(data.url, '_blank');
      }
    } catch (error) {
      console.error('Error opening customer portal:', error);
    }
  };

  const getPlanFeatures = (plan: string) => {
    switch (plan) {
      case 'essential':
        return [
          'Unlimited ATS Resume Scoring',
          'Resume Feedback & Optimization',
          'Interview Question Generator',
          'Email Support'
        ];
      case 'pro':
        return [
          'Everything in Essential',
          'Resume Rewrite Service',
          'Cover Letter Generator',
          'Mock Interview Practice',
          'Priority Support'
        ];
      case 'premium':
        return [
          'Everything in Pro',
          'LinkedIn Profile Optimizer',
          'Priority Review (24hrs)',
          'Career Coaching Session',
          'Phone Support'
        ];
      default:
        return [
          '1-time ATS Resume Score',
          'Basic feedback'
        ];
    }
  };

  if (loading) {
    return (
      <div className="loading-container">
        <div className="loading-spinner"></div>
        <p>Loading dashboard...</p>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="auth-container">
        <div className="auth-card">
          <h1>Welcome to JobHackAI</h1>
          <p>Sign in to access your dashboard</p>
          <button onClick={handleSignIn} className="btn-primary">
            Sign in with Google
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      <Head>
        <title>Dashboard - JobHackAI</title>
        <meta name="description" content="Manage your JobHackAI subscription and access all features" />
      </Head>

      <div className="dashboard">
        {/* Header */}
        <header className="dashboard-header">
          <div className="header-content">
            <h1>JobHackAI Dashboard</h1>
            <div className="user-info">
              <div className="user-details">
                <img src={user.photoURL || '/default-avatar.png'} alt="Profile" className="avatar" />
                <div>
                  <p className="user-name">{user.displayName}</p>
                  <p className="user-email">{user.email}</p>
                </div>
              </div>
              <button onClick={handleSignOut} className="btn-secondary">
                Sign Out
              </button>
            </div>
          </div>
        </header>

        {/* Main Content */}
        <main className="dashboard-content">
          {/* Subscription Status */}
          <section className="subscription-section">
            <div className="subscription-card">
              <div className="subscription-header">
                <h2>Current Plan</h2>
                <span className={`plan-badge ${subscription?.plan || 'free'}`}>
                  {subscription?.plan?.toUpperCase() || 'FREE'}
                </span>
              </div>
              
              <div className="subscription-details">
                <p className="plan-status">
                  Status: <span className={subscription?.status || 'active'}>{subscription?.status || 'Active'}</span>
                </p>
                
                {subscription?.plan !== 'free' && (
                  <div className="subscription-actions">
                    <button onClick={handleManageSubscription} className="btn-outline">
                      Manage Subscription
                    </button>
                  </div>
                )}
              </div>

              <div className="plan-features">
                <h3>Your Plan Includes:</h3>
                <ul>
                  {getPlanFeatures(subscription?.plan || 'free').map((feature, index) => (
                    <li key={index}>✓ {feature}</li>
                  ))}
                </ul>
              </div>
            </div>
          </section>

          {/* Usage Statistics */}
          <section className="usage-section">
            <h2>Usage Statistics</h2>
            <div className="stats-grid">
              <div className="stat-card">
                <div className="stat-number">{usageStats.resumeScans}</div>
                <div className="stat-label">Resume Scans</div>
              </div>
              <div className="stat-card">
                <div className="stat-number">{usageStats.coverLetters}</div>
                <div className="stat-label">Cover Letters</div>
              </div>
              <div className="stat-card">
                <div className="stat-number">{usageStats.interviewQuestions}</div>
                <div className="stat-label">Interview Questions</div>
              </div>
            </div>
          </section>

          {/* Feature Access */}
          <section className="features-section">
            <h2>Available Features</h2>
            <div className="features-grid">
              <div className="feature-card">
                <div className="feature-icon">📄</div>
                <h3>ATS Resume Scoring</h3>
                <p>Get your resume scored for ATS compatibility and receive detailed feedback.</p>
                <button 
                  className="btn-primary"
                  onClick={() => router.push('/resume-scoring')}
                >
                  Score Resume
                </button>
              </div>

              <div className="feature-card">
                <div className="feature-icon">✍️</div>
                <h3>Resume Feedback</h3>
                <p>Get AI-powered feedback on how to improve your resume.</p>
                <button 
                  className="btn-primary"
                  onClick={() => router.push('/resume-feedback')}
                  disabled={subscription?.plan === 'free'}
                >
                  {subscription?.plan === 'free' ? 'Upgrade Required' : 'Get Feedback'}
                </button>
              </div>

              <div className="feature-card">
                <div className="feature-icon">📝</div>
                <h3>Cover Letter Generator</h3>
                <p>Generate personalized cover letters for any job posting.</p>
                <button 
                  className="btn-primary"
                  onClick={() => router.push('/cover-letter')}
                  disabled={!['pro', 'premium'].includes(subscription?.plan || '')}
                >
                  {!['pro', 'premium'].includes(subscription?.plan || '') ? 'Upgrade Required' : 'Generate Letter'}
                </button>
              </div>

              <div className="feature-card">
                <div className="feature-icon">❓</div>
                <h3>Interview Questions</h3>
                <p>Practice with AI-generated interview questions for your target role.</p>
                <button 
                  className="btn-primary"
                  onClick={() => router.push('/interview-questions')}
                >
                  Generate Questions
                </button>
              </div>

              {subscription?.plan === 'pro' && (
                <div className="feature-card">
                  <div className="feature-icon">🎭</div>
                  <h3>Mock Interviews</h3>
                  <p>Practice interviews with AI-powered mock interview sessions.</p>
                  <button 
                    className="btn-primary"
                    onClick={() => router.push('/mock-interview')}
                  >
                    Start Mock Interview
                  </button>
                </div>
              )}

              {subscription?.plan === 'premium' && (
                <div className="feature-card">
                  <div className="feature-icon">💼</div>
                  <h3>LinkedIn Optimizer</h3>
                  <p>Optimize your LinkedIn profile for better visibility to recruiters.</p>
                  <button 
                    className="btn-primary"
                    onClick={() => router.push('/linkedin-optimizer')}
                  >
                    Optimize Profile
                  </button>
                </div>
              )}
            </div>
          </section>

          {/* Upgrade Section for Free Users */}
          {subscription?.plan === 'free' && (
            <section className="upgrade-section">
              <div className="upgrade-card">
                <h2>Unlock More Features</h2>
                <p>Upgrade to Essential, Pro, or Premium to access advanced features and unlimited usage.</p>
                <button 
                  className="btn-primary btn-large"
                  onClick={() => router.push('/pricing')}
                >
                  View Pricing Plans
                </button>
              </div>
            </section>
          )}
        </main>
      </div>
    </>
  );
}
