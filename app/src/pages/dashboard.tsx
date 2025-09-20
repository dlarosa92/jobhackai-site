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
      setSubscription({ status: 'active', plan: 'free' });
    }
  };

  const fetchUsageStats = async (userId: string) => {
    try {
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
        <link rel="stylesheet" href="/css/tokens.css" />
        <link rel="stylesheet" href="/css/main.css" />
      </Head>

      <div className="dashboard">
        {/* Header */}
        <header className="dashboard-header">
          <div className="header-content">
            <div className="nav-logo">
              <span>JobHackAI</span>
            </div>
            <div className="user-info">
              <div className="user-details">
                <img src={user.photoURL || '/default-avatar.png'} alt="Profile" className="avatar" />
                <div>
                  <p className="user-name">{user.displayName}</p>
                  <p className="user-email">{user.email}</p>
                </div>
              </div>
              <button onClick={handleSignOut} className="btn-outline">
                Sign Out
              </button>
            </div>
          </div>
        </header>

        {/* Main Content */}
        <main className="dashboard-content">
          {/* Hero Section */}
          <section className="hero">
            <h1>Welcome back, {user.displayName}!</h1>
            <p>Manage your JobHackAI subscription and access all features</p>
          </section>

          {/* Subscription Status */}
          <section className="subscription-section">
            <div className="feature">
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
            <div className="features">
              <div className="feature">
                <div className="stat-number">{usageStats.resumeScans}</div>
                <div className="stat-label">Resume Scans</div>
              </div>
              <div className="feature">
                <div className="stat-number">{usageStats.coverLetters}</div>
                <div className="stat-label">Cover Letters</div>
              </div>
              <div className="feature">
                <div className="stat-number">{usageStats.interviewQuestions}</div>
                <div className="stat-label">Interview Questions</div>
              </div>
            </div>
          </section>

          {/* Feature Access */}
          <section className="features-section">
            <h2>Available Features</h2>
            <div className="features">
              <div className="feature">
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

              <div className="feature">
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

              <div className="feature">
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

              <div className="feature">
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
                <div className="feature">
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
                <div className="feature">
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
              <div className="callout">
                <h2>Unlock More Features</h2>
                <p>Upgrade to Essential, Pro, or Premium to access advanced features and unlimited usage.</p>
                <button 
                  className="btn-primary btn-lg"
                  onClick={() => router.push('/pricing')}
                >
                  View Pricing Plans
                </button>
              </div>
            </section>
          )}
        </main>
      </div>

      <style jsx>{`
        .dashboard {
          min-height: 100vh;
          background: var(--color-bg-light);
        }

        .dashboard-header {
          background: var(--color-card-bg);
          border-bottom: 1px solid var(--color-divider);
          padding: var(--space-md) var(--space-lg);
          position: sticky;
          top: 0;
          z-index: var(--z-sticky);
        }

        .header-content {
          max-width: 1200px;
          margin: 0 auto;
          display: flex;
          justify-content: space-between;
          align-items: center;
        }

        .user-info {
          display: flex;
          align-items: center;
          gap: var(--space-md);
        }

        .user-details {
          display: flex;
          align-items: center;
          gap: var(--space-sm);
        }

        .avatar {
          width: 40px;
          height: 40px;
          border-radius: var(--radius-full);
          object-fit: cover;
        }

        .user-name {
          font-weight: var(--font-weight-semibold);
          color: var(--color-text-main);
          margin: 0;
          font-size: var(--font-size-sm);
        }

        .user-email {
          color: var(--color-text-secondary);
          margin: 0;
          font-size: var(--font-size-xs);
        }

        .dashboard-content {
          max-width: 1200px;
          margin: 0 auto;
          padding: var(--space-lg);
        }

        .subscription-section {
          margin-bottom: var(--space-xl);
        }

        .subscription-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: var(--space-md);
        }

        .plan-badge {
          background: var(--color-cta-green);
          color: white;
          padding: var(--space-xs) var(--space-sm);
          border-radius: var(--radius-button);
          font-weight: var(--font-weight-bold);
          font-size: var(--font-size-xs);
        }

        .plan-badge.free {
          background: var(--color-text-muted);
        }

        .plan-status {
          color: var(--color-text-secondary);
          margin-bottom: var(--space-md);
        }

        .plan-features h3 {
          font-size: var(--font-size-lg);
          font-weight: var(--font-weight-semibold);
          color: var(--color-text-main);
          margin-bottom: var(--space-sm);
        }

        .plan-features ul {
          list-style: none;
          padding: 0;
          margin: 0;
        }

        .plan-features li {
          color: var(--color-text-secondary);
          margin-bottom: var(--space-xs);
          font-size: var(--font-size-sm);
        }

        .usage-section {
          margin-bottom: var(--space-xl);
        }

        .usage-section h2 {
          font-size: var(--font-size-2xl);
          font-weight: var(--font-weight-bold);
          color: var(--color-text-main);
          margin-bottom: var(--space-lg);
          text-align: center;
        }

        .stat-number {
          font-size: var(--font-size-3xl);
          font-weight: var(--font-weight-bold);
          color: var(--color-accent-blue);
          margin-bottom: var(--space-xs);
        }

        .stat-label {
          color: var(--color-text-secondary);
          font-size: var(--font-size-sm);
          font-weight: var(--font-weight-medium);
        }

        .features-section {
          margin-bottom: var(--space-xl);
        }

        .features-section h2 {
          font-size: var(--font-size-2xl);
          font-weight: var(--font-weight-bold);
          color: var(--color-text-main);
          margin-bottom: var(--space-lg);
          text-align: center;
        }

        .feature h3 {
          font-size: var(--font-size-lg);
          font-weight: var(--font-weight-semibold);
          color: var(--color-text-main);
          margin-bottom: var(--space-sm);
        }

        .feature p {
          color: var(--color-text-secondary);
          line-height: 1.6;
          margin-bottom: var(--space-md);
          font-size: var(--font-size-sm);
        }

        .feature button:disabled {
          background: var(--color-disabled);
          cursor: not-allowed;
        }

        .upgrade-section {
          margin-top: var(--space-xl);
        }

        .loading-container {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          min-height: 50vh;
          gap: var(--space-md);
        }

        .loading-spinner {
          width: 40px;
          height: 40px;
          border: 4px solid var(--color-divider);
          border-top: 4px solid var(--color-accent-blue);
          border-radius: 50%;
          animation: spin 1s linear infinite;
        }

        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }

        .auth-container {
          display: flex;
          align-items: center;
          justify-content: center;
          min-height: 100vh;
          padding: var(--space-lg);
        }

        .auth-card {
          background: var(--color-card-bg);
          border-radius: var(--radius-card);
          box-shadow: var(--shadow-card);
          padding: var(--space-xl);
          text-align: center;
          max-width: 400px;
          width: 100%;
        }

        .auth-card h1 {
          font-size: var(--font-size-2xl);
          font-weight: var(--font-weight-bold);
          color: var(--color-text-main);
          margin-bottom: var(--space-sm);
        }

        .auth-card p {
          color: var(--color-text-secondary);
          margin-bottom: var(--space-lg);
        }

        @media (max-width: 768px) {
          .header-content {
            flex-direction: column;
            gap: var(--space-md);
          }

          .user-info {
            flex-direction: column;
            gap: var(--space-sm);
          }

          .dashboard-content {
            padding: var(--space-md);
          }

          .features {
            flex-direction: column;
          }
        }
      `}</style>
    </>
  );
}