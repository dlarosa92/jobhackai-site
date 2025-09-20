import React, { useEffect, useState } from 'react';
import Head from 'next/head';

export default function Dashboard() {
  const [user, setUser] = useState({
    name: "User",
    email: "user@example.com", 
    plan: "pro",
    trialEndsAt: "2024-06-10T00:00:00Z",
    hasUsedFreeTrial: true,
    hasUsedFreeATS: true
  });

  const [atsScore, setAtsScore] = useState({
    percent: 78,
    value: 78,
    max: 100,
    summary: "Your resume meets many ATS criteria and is likely to be noticed."
  });

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
      included: false
    },
    {
      key: "coverLetter",
      title: "Cover Letter Generator",
      desc: "Generate an ATS-optimized, job-specific cover letter in a confident, professional tone.",
      action: "Generate Cover Letter",
      included: false
    },
    {
      key: "mockInterview",
      title: "Mock Interviews",
      desc: "Practice real-time mock interviews with AI feedback to refine your answers and delivery.",
      action: "Start Mock Interview",
      included: false
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
          <circle cx="27" cy="27" r={radius} stroke="#00E676" strokeWidth={stroke} fill="none" 
                  strokeDasharray={norm} strokeDashoffset={norm - progress} strokeLinecap="round"/>
        </svg>
        <span className="ats-score-text">{percent}%</span>
      </div>
    );
  };

  return (
    <>
      <Head>
        <title>Dashboard – JobHackAI</title>
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      </Head>

      <style jsx>{`
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
          background: #00E676;
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
          background: #00c965;
          text-decoration: none;
          outline: none;
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
          font-family: 'Inter', Arial, sans-serif;
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
          background: #00E676;
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
          background: #00c965;
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
          .dashboard-banner, .dashboard-features {
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
      `}</style>

      <main>
        <div className="dashboard-banner">
          <a href="#" className="settings-link" aria-label="Account Settings">
            <svg width="20" height="20" fill="none" stroke="#6B7280" strokeWidth="2" viewBox="0 0 24 24">
              <circle cx="12" cy="12" r="3.2"/>
              <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06A1.65 1.65 0 0015 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 008.6 15a1.65 1.65 0 00-1.82-.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.6 8.6a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 008.6 4.6a1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0015 4.6a1.65 1.65 0 001.82.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 8.6a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06A1.65 1.65 0 0015 15a1.65 1.65 0 001.82.33z"/>
            </svg>
          </a>
          <div className="welcome-row">
            <h2>Welcome back, {user.name || 'User'}!</h2>
            {(user.plan === 'trial' || user.plan === 'essential' || user.plan === 'pro' || user.plan === 'premium') && (
              <div className="plan-transition-message">
                Your previous ATS resume score has been carried over from your free account. You now have access to more features and unlimited scoring!
              </div>
            )}
            {user.plan === 'trial' && (
              <div className="trial-countdown">
                You have {daysLeft(user.trialEndsAt)} day{daysLeft(user.trialEndsAt) !== 1 ? 's' : ''} left in your trial!
              </div>
            )}
            <div className="user-email">{user.email}</div>
          </div>
          <div className="ats-score-row">
            {atsDonut(atsScore.percent)}
            <div className="ats-score-details">
              <span className="ats-score-label">{atsScore.value} / {atsScore.max}</span>
              <span className="ats-score-summary">{atsScore.summary}</span>
            </div>
          </div>
          <div className="status-action-row">
            <span className={`user-plan-badge ${user.plan}`}>
              {planIcon(user.plan)}
              {user.plan.charAt(0).toUpperCase() + user.plan.slice(1)}
            </span>
            {user.plan === 'cancelled' && (
              <a href="pricing-a.html" className="upgrade-btn">Reactivate</a>
            )}
          </div>
        </div>

        <div className="dashboard-features">
          {features.map((feature) => {
            const isUnlocked = unlocked.includes(feature.key);
            return (
              <div key={feature.key} className={`feature-card${isUnlocked ? '' : ' locked'}`}>
                <div className="feature-title">{feature.title}</div>
                <div className="feature-desc">{feature.desc}</div>
                <div className="feature-action">
                  {isUnlocked && feature.key === 'ats' && (
                    <>
                      <input type="file" id="ats-upload-input" accept="application/pdf" style={{display: 'none'}} />
                      <button className="btn-primary" id="ats-upload-btn">{feature.action}</button>
                    </>
                  )}
                  {isUnlocked && feature.key === 'feedback' && (
                    <a href="resume-feedback-pro.html" className="btn-primary">{feature.action}</a>
                  )}
                  {isUnlocked && feature.key === 'interview' && (
                    <a href="interview-questions.html" className="btn-primary">{feature.action}</a>
                  )}
                  {isUnlocked && feature.key === 'rewriting' && (
                    <a href="resume-feedback-pro.html#rewrite" className="btn-primary">{feature.action}</a>
                  )}
                  {isUnlocked && feature.key === 'coverLetter' && (
                    <a href="cover-letter-generator.html" className="btn-primary">{feature.action}</a>
                  )}
                  {isUnlocked && feature.key === 'mockInterview' && (
                    <a href="mock-interview.html" className="btn-primary">{feature.action}</a>
                  )}
                  {isUnlocked && feature.key === 'linkedin' && (
                    <a href="linkedin-optimizer.html" className="btn-primary">{feature.action}</a>
                  )}
                  {isUnlocked && feature.key === 'priorityReview' && (
                    <div style={{display: 'flex', alignItems: 'center', gap: '0.6rem', margin: '0.7rem 0 0.2rem 0'}}>
                      <svg width="22" height="22" fill="none" stroke="#00E676" strokeWidth="2" viewBox="0 0 24 24">
                        <circle cx="12" cy="12" r="10"/>
                        <path d="M12 8v4l2.5 2.5"/>
                      </svg>
                      <span style={{fontWeight: '600', color: '#00C853'}}>All your AI-generated content will get priority review.</span>
                    </div>
                  )}
                  {!isUnlocked && (
                    <button className="btn-locked">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2">
                        <rect x="3" y="11" width="18" height="8" rx="2"/>
                        <path d="M7 11V7a5 5 0 0110 0v4"/>
                      </svg>
                      {feature.action}
                    </button>
                  )}
                </div>
                {isUnlocked && (user.plan === 'trial' || user.plan === 'essential' || user.plan === 'pro' || user.plan === 'premium') && (
                  <div className="included-badge">
                    <svg width="16" height="16" fill="#00C853" viewBox="0 0 24 24">
                      <path d="M20.285 6.709a1 1 0 00-1.414-1.418l-9.192 9.192-4.242-4.242a1 1 0 00-1.414 1.414l4.949 4.95a1 1 0 001.414 0l9.899-9.896z"/>
                    </svg>
                    Included in {user.plan === 'trial' ? 'Trial' : user.plan.charAt(0).toUpperCase() + user.plan.slice(1)}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </main>
    </>
  );
}