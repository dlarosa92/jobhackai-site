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
        <div className="card">
          <h1>Welcome to JobHackAI</h1>
          <p>Sign in to access your dashboard</p>
          <a href="#" className="btn-primary" onClick={handleSignIn}>
            Sign in with Google
          </a>
        </div>
      </div>
    );
  }

  return (
    <>
      <Head>
        <title>Dashboard - JobHackAI</title>
        <meta name="description" content="Manage your JobHackAI subscription and access all features" />
        <link rel="stylesheet" href="/css/reset.css" />
        <link rel="stylesheet" href="/css/tokens.css" />
        <link rel="stylesheet" href="/css/main.css" />
        <link rel="stylesheet" href="/css/header.css" />
        <link rel="stylesheet" href="/css/footer.css" />
      </Head>

      {/* JobHackAI HEADER (canonical) */}
      <header className="site-header">
        <div className="container">
          <a href="/" className="nav-logo" aria-label="Go to homepage">
            <svg width="24" height="24" fill="none" stroke="#1F2937" strokeWidth="2" xmlns="http://www.w3.org/2000/svg">
              <rect x="3" y="7" width="18" height="13" rx="2"/>
              <path d="M8 7V5a2 2 0 012-2h4a2 2 0 012 2v2"/>
            </svg>
            <span>JOBHACKAI</span>
          </a>
          <div className="nav-group">
            <nav className="nav-links" role="navigation">
              <a href="/">Home</a>
              <a href="#features">Features</a>
              <a href="/pricing">Pricing</a>
              <a href="#blog">Blog</a>
              <div className="nav-user-menu">
                <button className="nav-user-toggle" aria-label="User menu">
                  <img src={user.photoURL || '/default-avatar.png'} alt="Profile" className="avatar" />
                </button>
                <div className="nav-user-dropdown">
                  <a href="/dashboard">Dashboard</a>
                  <a href="/account-settings">Settings</a>
                  <a href="#" onClick={handleSignOut}>Sign Out</a>
                </div>
              </div>
            </nav>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main>
        {/* Hero Section */}
        <section className="hero">
          <h1>Welcome back, {user.displayName}!</h1>
          <p>Manage your JobHackAI subscription and access all features</p>
        </section>

        {/* Subscription Status */}
        <section>
          <div className="card">
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
                  <a href="#" className="btn-secondary" onClick={handleManageSubscription}>
                    Manage Subscription
                  </a>
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
        <section>
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
        <section>
          <h2>Available Features</h2>
          <div className="features">
            <div className="feature">
              <div className="feature-icon">📄</div>
              <h3>ATS Resume Scoring</h3>
              <p>Get your resume scored for ATS compatibility and receive detailed feedback.</p>
              <a 
                href="#" 
                className="btn-primary"
                onClick={() => router.push('/resume-scoring')}
              >
                Score Resume
              </a>
            </div>

            <div className="feature">
              <div className="feature-icon">✍️</div>
              <h3>Resume Feedback</h3>
              <p>Get AI-powered feedback on how to improve your resume.</p>
              <a 
                href="#" 
                className={`btn-primary ${subscription?.plan === 'free' ? 'disabled' : ''}`}
                onClick={() => subscription?.plan !== 'free' ? router.push('/resume-feedback') : null}
              >
                {subscription?.plan === 'free' ? 'Upgrade Required' : 'Get Feedback'}
              </a>
            </div>

            <div className="feature">
              <div className="feature-icon">📝</div>
              <h3>Cover Letter Generator</h3>
              <p>Generate personalized cover letters for any job posting.</p>
              <a 
                href="#" 
                className={`btn-primary ${!['pro', 'premium'].includes(subscription?.plan || '') ? 'disabled' : ''}`}
                onClick={() => ['pro', 'premium'].includes(subscription?.plan || '') ? router.push('/cover-letter') : null}
              >
                {!['pro', 'premium'].includes(subscription?.plan || '') ? 'Upgrade Required' : 'Generate Letter'}
              </a>
            </div>

            <div className="feature">
              <div className="feature-icon">❓</div>
              <h3>Interview Questions</h3>
              <p>Practice with AI-generated interview questions for your target role.</p>
              <a 
                href="#" 
                className="btn-primary"
                onClick={() => router.push('/interview-questions')}
              >
                Generate Questions
              </a>
            </div>

            {subscription?.plan === 'pro' && (
              <div className="feature">
                <div className="feature-icon">🎭</div>
                <h3>Mock Interviews</h3>
                <p>Practice interviews with AI-powered mock interview sessions.</p>
                <a 
                  href="#" 
                  className="btn-primary"
                  onClick={() => router.push('/mock-interview')}
                >
                  Start Mock Interview
                </a>
              </div>
            )}

            {subscription?.plan === 'premium' && (
              <div className="feature">
                <div className="feature-icon">💼</div>
                <h3>LinkedIn Optimizer</h3>
                <p>Optimize your LinkedIn profile for better visibility to recruiters.</p>
                <a 
                  href="#" 
                  className="btn-primary"
                  onClick={() => router.push('/linkedin-optimizer')}
                >
                  Optimize Profile
                </a>
              </div>
            )}
          </div>
        </section>

        {/* Upgrade Section for Free Users */}
        {subscription?.plan === 'free' && (
          <section>
            <div className="callout">
              <h2>Unlock More Features</h2>
              <p>Upgrade to Essential, Pro, or Premium to access advanced features and unlimited usage.</p>
              <a 
                href="/pricing" 
                className="btn-primary btn-lg"
                onClick={() => router.push('/pricing')}
              >
                View Pricing Plans
              </a>
            </div>
          </section>
        )}
      </main>

      {/* JobHackAI FOOTER (canonical) */}
      <footer className="site-footer">
        <div className="footer-container">
          <div className="footer-brand">
            <svg className="footer-logo" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <rect x="3" y="7" width="18" height="13" rx="2" stroke="#1F2937" strokeWidth="2"/>
              <path d="M8 7V5a2 2 0 012-2h4a2 2 0 012 2v2" stroke="#1F2937" strokeWidth="2"/>
            </svg>
            <span className="footer-name">JOBHACKAI</span>
          </div>
          <div className="footer-legal">
            <p>© 2025 JobHackAI. All rights reserved.</p>
          </div>
          <div className="footer-links">
            <a href="/">Home</a>
            <a href="/support">Support</a>
            <a href="/privacy">Privacy</a>
          </div>
        </div>
      </footer>

      <style jsx>{`
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

        .loading-container p {
          color: var(--color-text-secondary);
          font-size: var(--font-size-sm);
        }

        .auth-container {
          display: flex;
          align-items: center;
          justify-content: center;
          min-height: 100vh;
          padding: var(--space-lg);
          background: var(--color-bg-light);
        }

        .subscription-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: var(--space-md);
        }

        .subscription-header h2 {
          font-size: var(--font-size-xl);
          font-weight: var(--font-weight-semibold);
          color: var(--color-text-main);
          margin: 0;
        }

        .plan-badge {
          background: var(--color-cta-green);
          color: white;
          padding: var(--space-xs) var(--space-sm);
          border-radius: var(--radius-button);
          font-weight: var(--font-weight-bold);
          font-size: var(--font-size-xs);
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }

        .plan-badge.free {
          background: var(--color-text-muted);
        }

        .plan-badge.essential {
          background: var(--color-accent-blue);
        }

        .plan-badge.pro {
          background: var(--color-cta-green);
        }

        .plan-badge.premium {
          background: linear-gradient(135deg, var(--color-cta-green), var(--color-accent-blue));
        }

        .plan-status {
          color: var(--color-text-secondary);
          margin-bottom: var(--space-md);
          font-size: var(--font-size-sm);
        }

        .plan-status span {
          font-weight: var(--font-weight-semibold);
          color: var(--color-success);
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
          display: flex;
          align-items: center;
          gap: var(--space-xs);
        }

        .plan-features li::before {
          content: "✓";
          color: var(--color-success);
          font-weight: var(--font-weight-bold);
        }

        .stat-number {
          font-size: var(--font-size-3xl);
          font-weight: var(--font-weight-bold);
          color: var(--color-accent-blue);
          margin-bottom: var(--space-xs);
          line-height: 1;
        }

        .stat-label {
          color: var(--color-text-secondary);
          font-size: var(--font-size-sm);
          font-weight: var(--font-weight-medium);
          text-transform: uppercase;
          letter-spacing: 0.5px;
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

        .feature-icon {
          font-size: 2rem;
          margin-bottom: var(--space-sm);
          display: block;
        }

        .btn-primary.disabled {
          background: var(--color-disabled) !important;
          color: var(--color-text-muted) !important;
          cursor: not-allowed !important;
          box-shadow: none !important;
        }

        .btn-primary.disabled:hover {
          background: var(--color-disabled) !important;
          box-shadow: none !important;
        }

        .avatar {
          width: 32px;
          height: 32px;
          border-radius: var(--radius-full);
          object-fit: cover;
        }

        section {
          margin-bottom: var(--space-xl);
        }

        section h2 {
          font-size: var(--font-size-2xl);
          font-weight: var(--font-weight-bold);
          color: var(--color-text-main);
          margin-bottom: var(--space-lg);
          text-align: center;
        }

        @media (max-width: 768px) {
          .subscription-header {
            flex-direction: column;
            gap: var(--space-sm);
            text-align: center;
          }

          .features {
            flex-direction: column;
          }

          .feature {
            max-width: none;
          }
        }
      `}</style>

      <script dangerouslySetInnerHTML={{
        __html: `
          // User menu toggle
          const userToggle = document.querySelector('.nav-user-toggle');
          const userMenu = document.querySelector('.nav-user-menu');
          if (userToggle && userMenu) {
            userToggle.addEventListener('click', (e) => {
              e.stopPropagation();
              userMenu.classList.toggle('open');
            });
            
            // Close menu when clicking outside
            document.addEventListener('click', () => {
              userMenu.classList.remove('open');
            });
          }
        `
      }} />
    </>
  );
}