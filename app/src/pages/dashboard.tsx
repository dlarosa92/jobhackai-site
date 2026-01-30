import React, { useEffect, useState } from 'react';
import Head from 'next/head';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import { auth } from '../lib/firebase';

export default function Dashboard() {
  const [user, setUser] = useState({
    name: "User",
    email: "user@example.com", 
    plan: "pro",
    trialEndsAt: "2024-06-10T00:00:00Z",
    hasUsedFreeTrial: true,
    hasUsedFreeATS: true
  });

  const [atsScoreData, setAtsScoreData] = useState<{
    score: number | null;
    summary: string;
    jobTitle?: string;
    syncedAt?: number;
  } | null>(null);
  const [scoreLoading, setScoreLoading] = useState(true);
  const [firstRunInfo, setFirstRunInfo] = useState<{
    score: number | null;
    createdAt: string | null;
  } | null>(null);
  const [firstRunLoading, setFirstRunLoading] = useState(true);

  // Feature matrix based on plan
  const featureMatrix = {
    free: ["ats"],
    trial: ["ats", "feedback", "interview"],
    essential: ["ats", "feedback", "interview"],
    pro: ["ats", "feedback", "interview", "rewriting", "coverLetter", "mockInterview"],
    premium: ["ats", "feedback", "interview", "rewriting", "coverLetter", "mockInterview", "linkedin", "priorityReview"]
  };

  const features = [
    {
      key: "ats",
      title: "ATS Resume Score",
      desc: "Receive an overall ATS compliance score for your resume, highlighting key areas to improve.",
      action: "Upload PDF",
      included: true
    },
    {
      key: "feedback", 
      title: "Resume Feedback",
      desc: "Get a detailed analysis of what's working and what could be improved across every section of your resume.",
      action: "Get Detailed Feedback",
      included: true
    },
    {
      key: "interview",
      title: "Interview Questions", 
      desc: "Receive a curated set of practice interview questions tailored to your target role.",
      action: "Start Practice",
      included: true
    },
    {
      key: "rewriting",
      title: "Resume Rewriting",
      desc: "See a rewritten version of your resume tailored to your target job – ready to copy and paste.",
      action: "Start Rewriting",
      included: true
    },
    {
      key: "coverLetter",
      title: "Cover Letter Generator",
      desc: "Generate an ATS-optimized, job-specific cover letter in a confident, professional tone.",
      action: "Generate Cover Letter",
      included: true
    },
    {
      key: "mockInterview",
      title: "Mock Interviews",
      desc: "Practice real-time mock interviews with AI feedback to refine your answers and delivery.",
      action: "Start Mock Interview",
      included: true
    },
    {
      key: "linkedin",
      title: "LinkedIn Optimizer",
      desc: "Optimize your LinkedIn profile section-by-section for maximum recruiter visibility.",
      action: "Optimize LinkedIn",
      included: false
    },
    {
      key: "priorityReview",
      title: "Priority Review",
      desc: "Get your documents reviewed by our AI with expedited turnaround.",
      action: "Priority Review",
      included: false
    }
  ];

  const unlocked = featureMatrix[user.plan] || [];

  const daysLeft = (trialEndsAt: string) => {
    const now = new Date();
    const end = new Date(trialEndsAt);
    const diff = Math.ceil((end.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    return diff > 0 ? diff : 0;
  };

  const planIcon = (plan: string) => {
    switch (plan) {
      case 'trial':
        return (
          <svg className="user-plan-icon" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="10" cy="10" r="10" fill="#FF9100" opacity="0.12"/>
            <path d="M10 4v7l4 2" stroke="#FF9100" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        );
      case 'essential':
        return (
          <svg className="user-plan-icon" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="10" cy="10" r="10" fill="#0077B5" opacity="0.12"/>
            <path d="M10 5v10M5 10h10" stroke="#0077B5" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
        );
      case 'pro':
        return (
          <svg className="user-plan-icon" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="10" cy="10" r="10" fill="#388E3C" opacity="0.12"/>
            <path d="M6 10l3 3 5-5" stroke="#388E3C" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        );
      case 'premium':
        return (
          <svg className="user-plan-icon" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="10" cy="10" r="10" fill="#C62828" opacity="0.12"/>
            <path d="M10 5l2.09 4.26L17 9.27l-3.45 3.36L14.18 17 10 14.27 5.82 17l0.63-4.37L3 9.27l4.91-0.01L10 5z" stroke="#C62828" strokeWidth="1.2" fill="none"/>
          </svg>
        );
      default:
        return '';
    }
  };

  const atsDonut = (percent) => {
    const radius = 23;
    const stroke = 3;
    const norm = 2 * Math.PI * radius;
    const progress = (percent / 100) * norm;
    return (
      <div className="ats-donut" aria-label="ATS Score">
        <svg viewBox="0 0 54 54">
          <circle cx="27" cy="27" r={radius} stroke="#E5E7EB" strokeWidth={stroke} fill="none"/>
          <circle cx="27" cy="27" r={radius} stroke="#007A30" strokeWidth={stroke} fill="none" 
                  strokeDasharray={norm} strokeDashoffset={norm - progress} strokeLinecap="round"/>
        </svg>
        <span className="ats-score-text">{percent}%</span>
      </div>
    );
  };

  const formatRelativeTime = (timestamp?: string | number | null) => {
    if (!timestamp) return '';
    const parsed = new Date(timestamp).getTime();
    if (Number.isNaN(parsed)) return '';
    const diffMs = Date.now() - parsed;
    if (diffMs < 0) return 'just now';
    const units = [
      { label: 'day', ms: 24 * 60 * 60 * 1000 },
      { label: 'hour', ms: 60 * 60 * 1000 },
      { label: 'minute', ms: 60 * 1000 },
      { label: 'second', ms: 1000 }
    ];
    for (const { label, ms } of units) {
      const value = Math.floor(diffMs / ms);
      if (value >= 1) {
        return `${value} ${label}${value > 1 ? 's' : ''} ago`;
      }
    }
    return 'moments ago';
  };

  const coerceScore = (value: unknown): number | null => {
    const num = Number(value);
    return Number.isFinite(num) ? num : null;
  };

  const fetchLatestAtsScore = async (token: string) => {
    try {
      const response = await fetch('/api/ats-score-persist', {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!response.ok) {
        throw new Error('Failed to load ATS score from server');
      }
      const data = await response.json();
      const payload = data?.data;
      if (data?.success && payload) {
        const parsedScore = coerceScore(payload.score);
        setAtsScoreData({
          score: parsedScore,
          summary: payload.summary || 'Saved ATS score from your latest resume run.',
          jobTitle: payload.jobTitle || undefined,
          syncedAt: payload.syncedAt || payload.timestamp || undefined
        });
      } else {
        setAtsScoreData(null);
      }
    } catch (error) {
      console.error('[DASHBOARD] Failed to load ATS score:', error);
      setAtsScoreData(null);
    } finally {
      setScoreLoading(false);
    }
  };

  const fetchFirstRunInfo = async (token: string) => {
    try {
      const response = await fetch('/api/ats-score-persist?first=true', {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!response.ok) {
        throw new Error('Failed to load first resume info from server');
      }
      const data = await response.json();
      const payload = data?.data;
      if (data?.success && payload) {
        const parsedScore = coerceScore(payload.score);
        setFirstRunInfo({
          score: parsedScore,
          createdAt: payload.timestamp ? new Date(payload.timestamp).toISOString() : (payload.createdAt || null)
        });
      } else {
        setFirstRunInfo(null);
      }
    } catch (error) {
      console.error('[DASHBOARD] Failed to load first resume run:', error);
      setFirstRunInfo(null);
    } finally {
      setFirstRunLoading(false);
    }
  };

  useEffect(() => {
    // Sync auth + plan from Firebase + KV
    if (auth) {
      const unsubscribe = onAuthStateChanged(auth, async (u) => {
        if (!u) {
          try { localStorage.setItem('user-authenticated', 'false'); } catch (_) {}
          setAtsScoreData(null);
          setFirstRunInfo(null);
          setScoreLoading(false);
          setFirstRunLoading(false);

          // Wait for firebase-auth-ready before redirect to avoid bounce during session restore
          const authReady = typeof window !== 'undefined' && !!(window as any).__firebaseAuthReadyFired;
          if (typeof window !== 'undefined' && !authReady) {
            await new Promise(resolve => {
              let done = false;
              const timer = setTimeout(() => { if (!done) { done = true; resolve(false); } }, 2500);
              const onReady = () => { if (!done) { done = true; clearTimeout(timer); resolve(true); } };
              document.addEventListener('firebase-auth-ready', onReady, { once: true });
            });
            if (!(window as any).FirebaseAuthManager?.getCurrentUser?.()) {
              window.location.href = '/login';
              return;
            } else {
              // Auth now restored; skip redirect
              return;
            }
          } else if (typeof window !== 'undefined') {
            window.location.href = '/login';
            return;
          }
          // Ensure callback always returns when user is null to avoid falling through and calling methods on null
          return;
        }

        // SECURITY: Do NOT store user-email in localStorage - email available via Firebase auth
        try { localStorage.setItem('user-authenticated', 'true'); } catch (_) {}

        // Default plan
        let plan = 'free';
        let trialEndsAt = '';
        let token = '';
        try {
          token = await u.getIdToken();
          const r = await fetch('/api/plan/me', { headers: { Authorization: `Bearer ${token}` } });
          if (r.ok) {
            const data = await r.json();
            plan = data?.plan || 'free';
            trialEndsAt = data?.trialEndsAt || '';
            try {
              localStorage.setItem('user-plan', plan);
              if (trialEndsAt) localStorage.setItem('trial-ends-at', trialEndsAt);
            } catch (_) {}
          }
        } catch (_) {}

        if (u) {
          setUser(prev => ({
            ...prev,
            name: u.displayName || prev.name,
            email: u.email || prev.email,
            plan: plan as any,
            trialEndsAt: trialEndsAt || prev.trialEndsAt
          }));
        }

        if (token) {
          setScoreLoading(true);
          setFirstRunLoading(true);
          await Promise.all([
            fetchLatestAtsScore(token),
            fetchFirstRunInfo(token)
          ]);
        } else {
          setScoreLoading(false);
          setFirstRunLoading(false);
        }
      });
      return () => unsubscribe();
    }

    // Mobile menu toggle functionality
    const mobileToggle = document.querySelector('.mobile-toggle');
    const mobileNav = document.getElementById('mobileNav');
    if (mobileToggle && mobileNav) {
      mobileToggle.addEventListener('click', () => {
        const isOpen = mobileNav.classList.toggle('open');
        mobileToggle.setAttribute('aria-expanded', isOpen.toString());
      });
      // Close mobile nav on link click
      document.querySelectorAll('.mobile-nav a').forEach(link => {
        link.addEventListener('click', () => {
          mobileNav.classList.remove('open');
          mobileToggle.setAttribute('aria-expanded', 'false');
        });
      });
    }

    // Dropdown menus (desktop)
    const dropdownToggles = document.querySelectorAll('.nav-dropdown-toggle');
    dropdownToggles.forEach(toggle => {
      toggle.addEventListener('click', (e) => {
        e.preventDefault();
        const parentDropdown = (toggle as HTMLElement).closest('.nav-dropdown');
        if (parentDropdown) {
          parentDropdown.classList.toggle('open');
        }
      });
    });

    // Close dropdowns when clicking outside
    const handleDocClick = (e: Event) => {
      dropdownToggles.forEach(toggle => {
        const parentDropdown = (toggle as HTMLElement).closest('.nav-dropdown');
        if (parentDropdown && !parentDropdown.contains(e.target as Node)) {
          parentDropdown.classList.remove('open');
        }
      });
    };
    document.addEventListener('click', handleDocClick);

    return () => {
      document.removeEventListener('click', handleDocClick);
    };
  }, []);

  // Dynamic favicon based on color scheme
  useEffect(() => {
    const FAVICON_LIGHT = '/assets/jobhackai_icon_only_128.png'
    const FAVICON_DARK = '/assets/jobhackai_favicon_dark.png'

    const updateFavicon = (isDarkMode: boolean) => {
      const faviconPath = isDarkMode ? FAVICON_DARK : FAVICON_LIGHT
      const existingFavicons = document.querySelectorAll('link[rel="icon"], link[rel="apple-touch-icon"]')
      existingFavicons.forEach(link => link.remove())

      const faviconLink = document.createElement('link')
      faviconLink.rel = 'icon'
      faviconLink.type = 'image/png'
      faviconLink.href = faviconPath
      document.head.appendChild(faviconLink)

      const appleTouchLink = document.createElement('link')
      appleTouchLink.rel = 'apple-touch-icon'
      appleTouchLink.href = faviconPath
      document.head.appendChild(appleTouchLink)
    }

    const detectColorScheme = () => {
      return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
    }

    const isDarkMode = detectColorScheme()
    updateFavicon(isDarkMode)

    if (window.matchMedia) {
      const darkModeQuery = window.matchMedia('(prefers-color-scheme: dark)')
      if (darkModeQuery.addEventListener) {
        darkModeQuery.addEventListener('change', (e) => updateFavicon(e.matches))
      } else if (darkModeQuery.addListener) {
        darkModeQuery.addListener((e) => updateFavicon(e.matches))
      }
    }
  }, []);

  // Show welcome popup on first dashboard visit
  useEffect(() => {
    // Wait for user data to be loaded before showing welcome popup
    if (user.email !== "user@example.com" && user.plan) {
      // Small delay to ensure page is fully rendered
      const timer = setTimeout(() => {
        if (typeof window !== 'undefined' && (window as any).showWelcomePopup) {
          (window as any).showWelcomePopup(user.plan, user.name);
        }
      }, 500);

      return () => clearTimeout(timer);
    }
  }, [user.email, user.plan, user.name]);

  const persistentScoreValue = atsScoreData?.score ?? null;
  const hasPersistentScore = !scoreLoading && persistentScoreValue != null;
  const displayScorePercent = scoreLoading
    ? 0
    : (persistentScoreValue != null ? Math.round(persistentScoreValue) : 0);
  const atsSummaryText = scoreLoading
    ? 'Loading your latest ATS score...'
    : (atsScoreData?.summary || 'Run your resume through Resume Feedback to show your latest ATS score on the dashboard.');

  return (
    <>
      <Head>
        <title>JobHackAI</title>
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
        <link rel="stylesheet" href="/tokens.css" />
        <link rel="stylesheet" href="/main.css" />
        <link rel="stylesheet" href="/header.css" />
        <link rel="stylesheet" href="/footer.css" />
        <link rel="icon" type="image/png" href="/assets/jobhackai_icon_only_128.png" />
        <link rel="apple-touch-icon" href="/assets/jobhackai_icon_only_128.png" />
        <script src="/js/welcome-popup.js" type="module"></script>
      </Head>

      <style jsx>{`
        /* Dashboard-specific styles only. Shared header/footer come from header.css/footer.css */
        .dashboard-banner {
          background: #fff;
          border-radius: 16px;
          box-shadow: 0 2px 12px rgba(31,41,55,0.07);
          padding: 1.2rem 2rem 1.2rem 2rem;
          margin: 2rem auto 2.2rem auto;
          max-width: 540px;
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
          position: relative;
          align-items: flex-start;
        }
        .dashboard-banner .settings-link {
          position: absolute;
          top: 1.1rem;
          right: 1.2rem;
          color: #6B7280;
          font-size: 1.1rem;
          text-decoration: none;
          display: flex;
          align-items: center;
          gap: 0.2rem;
          transition: color 0.18s;
          opacity: 0.7;
        }
        .dashboard-banner .settings-link:hover {
          color: #232B36;
          text-decoration: underline;
          opacity: 1;
        }
        .dashboard-banner .welcome-row {
          display: flex;
          flex-direction: column;
          align-items: flex-start;
          gap: 0.08rem;
          margin-bottom: 0.1rem;
        }
        .dashboard-banner .welcome-row h2 {
          font-size: 1.32rem;
          font-weight: 800;
          color: #232B36;
          margin: 0 0 0.08rem 0;
          padding: 0;
        }
        .dashboard-banner .trial-countdown {
          color: #D97706;
          font-weight: 600;
          font-size: 1.01rem;
          margin: 0.05rem 0 0.05rem 0;
          padding: 0;
          line-height: 1.2;
        }
        .dashboard-banner .user-email {
          font-size: 0.98rem;
          color: #6B7280;
          margin-bottom: 0.1rem;
          font-weight: 400;
          letter-spacing: 0.01em;
        }
        .dashboard-banner .plan-badge {
          display: inline-block;
          background: #F3F4F6;
          color: #0077B5;
          font-weight: 700;
          border-radius: 8px;
          padding: 0.18rem 0.7rem;
          font-size: 0.98rem;
          margin-left: 0;
          margin-top: 0.2rem;
        }
        .dashboard-banner .upgrade-btn {
          background: #007A30;
          color: #fff;
          font-weight: 700;
          border: none;
          border-radius: 8px;
          padding: 0.6rem 1.5rem;
          font-size: 1.01rem;
          cursor: pointer;
          margin-top: 0.5rem;
          align-self: flex-start;
          transition: background 0.18s;
          text-decoration: none;
          display: inline-block;
        }
        .dashboard-banner .upgrade-btn:hover,
        .dashboard-banner .upgrade-btn:focus {
          background: #006B28;
          text-decoration: none;
          outline: none;
        }
        .first-run-section {
          max-width: 960px;
          margin: 1.5rem auto 2rem;
          padding: 0 0.5rem;
        }
        .first-run-card {
          background: #fff;
          border-radius: 18px;
          box-shadow: 0 2px 12px rgba(31,41,55,0.08);
          padding: 1.2rem 1.5rem;
          margin: 0 auto 1.4rem auto;
          max-width: 760px;
          border: 1px solid #EFF2F7;
        }
        .first-run-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 0.6rem;
        }
        .first-run-title {
          font-size: 1.1rem;
          font-weight: 700;
          color: #111;
        }
        .first-run-meta {
          font-size: 0.95rem;
          color: #6B7280;
          font-weight: 500;
        }
        .first-run-score-row {
          display: flex;
          align-items: baseline;
          gap: 0.4rem;
          margin-bottom: 0.4rem;
        }
        .first-run-score-value {
          font-size: 2rem;
          font-weight: 800;
          color: #111;
        }
        .first-run-small-label {
          font-size: 0.9rem;
          color: #4B5563;
        }
        .first-run-copy {
          margin: 0;
          color: #4B5563;
          font-size: 1rem;
          line-height: 1.4;
        }
        .dashboard-features {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(270px, 1fr));
          gap: 1.5rem;
          max-width: 1100px;
          margin: 0 auto 2.5rem auto;
        }
        .feature-card {
          background: #fff;
          border-radius: 16px;
          box-shadow: 0 2px 8px rgba(31,41,55,0.07);
          padding: 1.5rem 1.2rem 1.2rem 1.2rem;
          display: flex;
          flex-direction: column;
          gap: 0.7rem;
          align-items: flex-start;
          min-height: 210px;
          position: relative;
        }
        .feature-card.locked {
          opacity: 0.7;
        }
        .feature-card .feature-title {
          font-size: 1.13rem;
          font-weight: 700;
          margin-bottom: 0.2rem;
          color: #232B36;
        }
        .feature-card .feature-desc {
          font-size: 1rem;
          color: #4B5563;
          margin-bottom: 0.7rem;
        }
        .feature-card .feature-action {
          margin-top: auto;
          width: 100%;
          display: flex;
          align-items: center;
          gap: 0.5rem;
        }
        .feature-card .feature-action .btn-primary,
        .feature-card .feature-action a.btn-primary {
          padding: 0.7rem 1.5rem;
        }
        .feature-card .feature-action .btn-primary {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          background: #fff !important;
          color: #1976D2 !important;
          border: 1.5px solid #1976D2;
          font-weight: 600;
          border-radius: 12px;
          font-size: 1.02rem;
          min-width: 160px;
          font-family: "Inter", Arial, sans-serif;
          text-align: center;
          text-decoration: none;
          transition: background 0.18s, color 0.18s, border-color 0.18s;
          cursor: pointer;
        }
        .feature-card .feature-action .btn-primary:hover,
        .feature-card .feature-action .btn-primary:focus {
          background: #1976D2 !important;
          color: #fff !important;
          border-color: #1976D2;
          text-decoration: none;
          outline: none;
        }
        .feature-card .feature-action .btn-secondary {
          width: 100%;
          min-width: 0;
          font-size: 1.02rem;
          padding: 0.7rem 0;
          border-radius: 8px;
          text-align: center;
          font-weight: 700;
          text-decoration: none;
        }
        .feature-card .feature-action .btn-locked {
          background: #007A30;
          color: #fff;
          border: none;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 0.5rem;
          cursor: pointer;
          font-weight: 700;
          border-radius: 8px;
          width: 100%;
          font-size: 1.02rem;
          padding: 0.7rem 0;
          transition: background 0.18s;
        }
        .feature-card .feature-action .btn-locked:hover,
        .feature-card .feature-action .btn-locked:focus {
          background: #006B28;
          outline: none;
        }
        .feature-card .included-badge {
          color: #00C853;
          font-size: 0.98rem;
          font-weight: 600;
          margin-top: 0.5rem;
          display: flex;
          align-items: center;
          gap: 0.3rem;
        }
        .feature-card .included-badge svg {
          vertical-align: middle;
        }
        @media (max-width: 700px) {
          .dashboard-banner,
          .dashboard-features {
            padding-left: 0.5rem;
            padding-right: 0.5rem;
          }
          .dashboard-banner {
            max-width: 98vw;
          }
          .dashboard-features {
            grid-template-columns: 1fr;
          }
        }
        .ats-score-row {
          display: flex;
          align-items: center;
          gap: 1.1rem;
          margin: 0.5rem 0 0.2rem 0;
        }
        .ats-donut {
          width: 54px;
          height: 54px;
          position: relative;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .ats-donut svg {
          width: 54px;
          height: 54px;
          transform: rotate(-90deg);
        }
        .ats-donut .ats-score-text {
          position: absolute;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          font-size: 1.1rem;
          font-weight: 700;
          color: #111;
          text-align: center;
          letter-spacing: 0.5px;
        }
        .ats-score-details {
          display: flex;
          flex-direction: column;
          gap: 0.1rem;
        }
        .ats-score-details .ats-score-label {
          font-size: 1.05rem;
          font-weight: 700;
          color: #232B36;
          margin-bottom: 0.1rem;
        }
        .ats-score-details .ats-score-summary {
          font-size: 1rem;
          color: #4B5563;
          max-width: 340px;
        }
        .user-plan-status {
          display: flex;
          flex-direction: column;
          align-items: center;
          margin-top: 1.2rem;
          gap: 0.3rem;
        }
        .user-plan-label {
          font-size: 0.92rem;
          color: #6B7280;
          font-weight: 500;
          margin-bottom: 0.1rem;
          letter-spacing: 0.01em;
        }
        .user-plan-badge {
          font-size: 1.05rem;
          font-weight: 700;
          border-radius: 999px;
          padding: 0.22rem 1.1rem 0.22rem 0.8rem;
          display: flex;
          align-items: center;
          gap: 0.4em;
          background: #FFF7E6;
          color: #FF9100;
          box-shadow: 0 1px 4px rgba(31,41,55,0.06);
        }
        .user-plan-badge.essential {
          color: #0077B5;
          background: #E3F2FD;
        }
        .user-plan-badge.pro {
          color: #388E3C;
          background: #E8F5E9;
        }
        .user-plan-badge.premium {
          color: #C62828;
          background: #FFEBEE;
        }
        .user-plan-icon {
          width: 1.1em;
          height: 1.1em;
          vertical-align: middle;
        }
        .dashboard-banner .upgrade-btn {
          width: 100%;
          margin-top: 0.2rem;
        }
        .dashboard-banner-footer {
          display: flex;
          justify-content: flex-end;
          align-items: center;
          gap: 1rem;
          width: 100%;
          margin-top: 1.2rem;
          padding-top: 0.7rem;
          border-top: 1px solid #F3F4F6;
        }
        .user-plan-badge {
          display: flex;
          align-items: center;
          gap: 0.4em;
          background: #FFF7E6;
          color: #FF9100;
          font-weight: 600;
          border-radius: 999px;
          padding: 0.4rem 1.1rem;
          font-size: 1.01rem;
          box-shadow: 0 1px 4px rgba(31,41,55,0.06);
        }
        .status-action-row {
          display: flex;
          flex-direction: row;
          align-items: center;
          justify-content: flex-end;
          gap: 0.7rem;
          margin-top: 0.5rem;
          width: 100%;
        }
        .status-action-row .upgrade-btn {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          background: #1976D2;
          color: #fff;
          border: none;
          font-weight: 600;
          border-radius: 12px;
          padding: 0.6rem 1.5rem;
          font-size: 1.02rem;
          min-width: 0;
          box-shadow: 0 1px 4px rgba(31,41,55,0.06);
          transition: background 0.18s, color 0.18s, border-color 0.18s;
          text-decoration: none;
          margin-top: 0;
          width: auto;
        }
        .status-action-row .upgrade-btn:hover,
        .status-action-row .upgrade-btn:focus {
          background: #125bb5;
          color: #fff;
        }
        .jh-tooltip-trigger {
          cursor: pointer;
          margin-left: 0.4em;
          vertical-align: middle;
          position: relative;
          display: inline-block;
        }
        .jh-tooltip-text {
          display: none;
          position: absolute;
          z-index: 1000;
          padding: 0.5rem 0.8rem;
          background-color: #333;
          color: #fff;
          border-radius: 4px;
          top: 120%;
          left: 50%;
          transform: translateX(-50%);
          min-width: 180px;
          max-width: 260px;
          white-space: normal;
          word-break: break-word;
          font-size: 0.98rem;
          box-shadow: 0 2px 8px rgba(0,0,0,0.12);
          pointer-events: none;
          text-align: left;
        }
        .jh-tooltip-trigger:hover .jh-tooltip-text,
        .jh-tooltip-trigger:focus .jh-tooltip-text,
        .jh-tooltip-trigger:focus-visible .jh-tooltip-text {
          display: block;
          pointer-events: auto;
        }
        .plan-transition-message {
          background: #E6F7FF;
          color: #1976D2;
          padding: 0.7em 1em;
          border-radius: 8px;
          margin-bottom: 0.7em;
          font-size: 1.01rem;
        }
        .plan-transition-heading {
          font-weight: 700;
          font-size: 1.02rem;
          margin-bottom: 0.15em;
          color: #0F4AA2;
        }
        .plan-transition-content {
          font-size: 0.96rem;
          line-height: 1.45;
          color: #11519C;
        }
      `}</style>

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
              <div className="nav-dropdown">
                <a href="#" className="nav-dropdown-toggle">
                  Resume Tools
                  <svg className="dropdown-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="6 9 12 15 18 9"></polyline>
                  </svg>
                </a>
                <div className="nav-dropdown-menu">
                  <a href="/resume-feedback-pro">ATS Resume Score</a>
                  <a href="/resume-feedback-pro">Resume Feedback</a>
                  <a href="/rewriting">Resume Rewriting</a>
                </div>
              </div>
              <div className="nav-dropdown">
                <a href="#" className="nav-dropdown-toggle">
                  Interview Prep
                  <svg className="dropdown-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="6 9 12 15 18 9"></polyline>
                  </svg>
                </a>
                <div className="nav-dropdown-menu">
                  <a href="/interview">Interview Questions</a>
                  <a href="/mockInterview">Mock Interview Practice</a>
                </div>
              </div>
              <a href="/pricing">Pricing</a>
              <a href="/blog">Blog</a>
              <a href="/login">Login</a>
              <a href="/pricing" className="cta-button">Start Free Trial</a>
            </nav>
          </div>
          <button className="mobile-toggle" aria-label="Open navigation menu" aria-expanded="false" aria-controls="mobileNav">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="3" y1="12" x2="21" y2="12"></line>
              <line x1="3" y1="6" x2="21" y2="6"></line>
              <line x1="3" y1="18" x2="21" y2="18"></line>
            </svg>
          </button>
        </div>
      </header>
      <nav className="mobile-nav" id="mobileNav">
        <a href="/">Home</a>
        <a href="/resume-feedback-pro">ATS Resume Score</a>
        <a href="/resume-feedback-pro">Resume Feedback</a>
        <a href="/rewriting">Resume Rewriting</a>
        <a href="/interview">Interview Questions</a>
        <a href="/mockInterview">Mock Interview Practice</a>
        <a href="/pricing">Pricing</a>
        <a href="/blog">Blog</a>
        <a href="/login">Login</a>
        <a href="/pricing" className="cta-button">Start Free Trial</a>
      </nav>

      <main>
        <div className="dashboard-banner">
          <a href="#" aria-label="Account Settings" className="settings-link">
            <svg width="20" height="20" fill="none" stroke="#6B7280" strokeWidth="2" viewBox="0 0 24 24">
              <circle cx="12" cy="12" r="3.2"/>
              <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06A1.65 1.65 0 0015 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 008.6 15a1.65 1.65 0 00-1.82-.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.6 8.6a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 008.6 4.6a1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0015 4.6a1.65 1.65 0 001.82.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 8.6a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06A1.65 1.65 0 0015 15a1.65 1.65 0 001.82.33z"/>
            </svg>
          </a>
          <div className="welcome-row">
            <h2>Hi, {user.name}</h2>
            {(() => {
              // Check multiple indicators that user had a free account
              const hasUpgradedPlan = user.plan === 'trial' || user.plan === 'essential' || user.plan === 'pro' || user.plan === 'premium';
              if (typeof window === 'undefined' || !hasUpgradedPlan) return null;
              
              const hasATSScoreHistory = localStorage.getItem('lastATSScore') || localStorage.getItem('lastATSSummary');
              const hasUsedFreeATS = localStorage.getItem('hasUsedFreeATS') === 'true';
              const freeUsageDataRaw = localStorage.getItem('free-ats-usage');
              let hasUsedLegacyFreeATS = false;
              if (freeUsageDataRaw) {
                try {
                  const usageData = JSON.parse(freeUsageDataRaw);
                  hasUsedLegacyFreeATS = usageData?.used === true;
                } catch {
                  // If data is malformed, assume used to avoid missing prior usage
                  hasUsedLegacyFreeATS = true;
                }
              }
              const hasUploadedResume = localStorage.getItem('lastUploadedResume') || localStorage.getItem('hasUploadedResume') === 'true';
              const currentUser = (window as any)?.FirebaseAuthManager?.getCurrentUser?.() || null;
              const creditKey = currentUser?.uid ? `creditsByUid:${currentUser.uid}` : null;
              let hasUsedFreeCredit = false;
              let hadFreeAccountWithCredit = false;
              if (creditKey) {
                const creditsData = localStorage.getItem(creditKey);
                if (creditsData) {
                  hadFreeAccountWithCredit = true;
                  try {
                    const credits = JSON.parse(creditsData);
                    hasUsedFreeCredit = credits?.ats_free_lifetime === 0;
                  } catch {
                    // ignore parse errors
                  }
                }
              }
              
              // Check if user had a free account
              const wasFreeAccount = !!freeUsageDataRaw || hadFreeAccountWithCredit || localStorage.getItem('was-free-user') === 'true';
              const hadResumeUpload = hasATSScoreHistory || hasUsedFreeATS || hasUsedLegacyFreeATS || hasUploadedResume || hasUsedFreeCredit;
              
              // Show banner if user upgraded from free account
              if (!wasFreeAccount) return null;
              
              // Determine plan-specific greeting
              const planName = user.plan === 'trial' ? '3-day trial' 
                : user.plan === 'essential' ? 'Essential plan'
                : user.plan === 'pro' ? 'Pro plan'
                : user.plan === 'premium' ? 'Premium plan'
                : 'plan';
              
              const messageText = hadResumeUpload
                ? `Your previous ATS resume score from your free account is still available. Welcome to your ${planName}!`
                : `Welcome to your ${planName}!`;
              
              const contentText = user.plan === 'trial'
                ? 'You now have 3 resume feedback assessments (inclusive of ATS scans) and unlimited interview questions. Some features remain locked until you upgrade to a paid plan.'
                : 'You now have access to all features included in your plan. Upload resumes for ATS scoring, get detailed feedback, and generate unlimited interview questions.';
              
              return (
                <div className="plan-transition-message">
                  <div className="plan-transition-heading">{messageText}</div>
                  <div className="plan-transition-content">{contentText}</div>
                </div>
              );
            })()}
            <div className="user-email">{user.email}</div>
          </div>
          <div className="ats-score-row">
            {atsDonut(displayScorePercent)}
            <div className="ats-score-details">
              <span className="ats-score-label">{displayScorePercent}%</span>
              <span className="ats-score-summary">{atsSummaryText}</span>
            </div>
          </div>
          <div className="status-action-row">
            <span className={`user-plan-badge ${user.plan}`}>
              {planIcon(user.plan)}
              {user.plan.charAt(0).toUpperCase() + user.plan.slice(1)}
            </span>
          </div>
        </div>

        {!firstRunLoading && (
          <section className="first-run-section">
            <div className="first-run-card">
              <div className="first-run-row">
                <span className="first-run-title">Your First ATS Resume</span>
                <span className="first-run-meta">
                  {firstRunInfo?.createdAt
                    ? `First run · ${formatRelativeTime(firstRunInfo.createdAt)}`
                    : 'No ATS runs yet'}
                </span>
              </div>
              <div className="first-run-score-row">
                <span className="first-run-score-value">
                  {firstRunInfo?.score != null ? `${Math.round(firstRunInfo.score)}%` : '—'}
                </span>
                {firstRunInfo?.score != null && (
                  <span className="first-run-small-label">Frozen for reference</span>
                )}
              </div>
              <p className="first-run-copy">
                {firstRunInfo?.score != null
                  ? 'We freeze your first-ever score so you always remember where you started.'
                  : 'Upload your first resume in Resume Feedback to capture that first score.'}
              </p>
            </div>
          </section>
        )}

        <div className="dashboard-features">
          {features.map((feature) => {
            const isUnlocked = unlocked.includes(feature.key);
            const isIncluded = feature.included && isUnlocked;
            
            return (
              <div key={feature.key} className={`feature-card ${!isUnlocked ? 'locked' : ''}`}>
                <div className="feature-title">{feature.title}</div>
                <div className="feature-desc">{feature.desc}</div>
                <div className="feature-action">
                  {isUnlocked ? (
                    feature.key === 'ats' ? (
                      hasPersistentScore ? (
                        <a href="/resume-feedback-pro" className="btn-primary">
                          Run a new analysis in Resume Feedback
                        </a>
                      ) : (
                        <>
                          <input type="file" id="ats-upload-input" accept="application/pdf" style={{display: 'none'}} />
                          <button id="ats-upload-btn" className="btn-primary">{feature.action}</button>
                        </>
                      )
                    ) : (
                      <a href={`${feature.key}.html`} className="btn-primary">{feature.action}</a>
                    )
                  ) : (
                    <button className="btn-locked">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2">
                        <rect x="3" y="11" width="18" height="8" rx="2"/>
                        <path d="M7 11V7a5 5 0 0110 0v4"/>
                      </svg>
                      {feature.action}
                    </button>
                  )}
                </div>
                {isIncluded && (
                  <div className="included-badge">
                    <svg width="16" height="16" fill="#00C853" viewBox="0 0 24 24">
                      <path d="M20.285 6.709a1 1 0 00-1.414-1.418l-9.192 9.192-4.242-4.242a1 1 0 00-1.414 1.414l4.949 4.95a1 1 0 001.414 0l9.899-9.896z"/>
                    </svg>
                    Included in {user.plan.charAt(0).toUpperCase() + user.plan.slice(1)}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </main>

      {/* JobHackAI Footer */}
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
            <p>© 2026 JobHackAI. All rights reserved.</p>
          </div>
          <div className="footer-links">
            <a href="/">Home</a>
            <a href="/support">Support</a>
            <a href="/privacy">Privacy</a>
          </div>
        </div>
      </footer>
    </>
  );
}
