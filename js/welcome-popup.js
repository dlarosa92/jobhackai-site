// Welcome popup for first-time dashboard visitors
// Shows plan-specific information about ATS scoring, AI features, and product offerings

/**
 * Escape HTML to prevent XSS attacks
 * @param {string} text - Text to escape
 * @returns {string} Escaped HTML string
 */
function escapeHtml(text) {
  if (typeof text !== 'string') return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/**
 * Get Firebase ID token (tries multiple methods)
 * @returns {Promise<string|null>} Firebase ID token or null
 */
async function getFirebaseIdToken() {
  try {
    // Try window.getFirebaseIdToken if available
    if (typeof window.getFirebaseIdToken === 'function') {
      return await window.getFirebaseIdToken();
    }
    
    // Try FirebaseAuthManager pattern
    const user = window.FirebaseAuthManager?.getCurrentUser?.();
    if (user && typeof user.getIdToken === 'function') {
      return await user.getIdToken();
    }
    
    // Try firebase.auth().currentUser pattern
    if (window.firebase?.auth?.().currentUser) {
      return await window.firebase.auth().currentUser.getIdToken();
    }
    
    return null;
  } catch (error) {
    console.warn('[WelcomePopup] Error getting Firebase token:', error);
    return null;
  }
}

/**
 * Check if user has seen welcome modal on server (source of truth)
 * @returns {Promise<boolean>} True if user has seen the modal
 */
async function checkWelcomeModalSeenServerSide() {
  try {
    const idToken = await getFirebaseIdToken();
    if (!idToken) {
      console.warn('[WelcomePopup] No Firebase token available for server-side check');
      return false;
    }

    const response = await fetch('/api/user-preferences?preference=welcomeModalSeen', {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${idToken}`,
        'Content-Type': 'application/json'
      }
    });

    if (response.ok) {
      const data = await response.json();
      return data.value === true;
    }
    
    return false;
  } catch (error) {
    console.warn('[WelcomePopup] Failed to check server-side modal status:', error);
    return false;
  }
}

/**
 * Mark welcome modal as seen on server (source of truth)
 * @returns {Promise<boolean>} Success
 */
async function markWelcomeModalSeenServerSide() {
  try {
    const idToken = await getFirebaseIdToken();
    if (!idToken) {
      console.warn('[WelcomePopup] No Firebase token available for server-side update');
      return false;
    }

    const response = await fetch('/api/user-preferences', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${idToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        preference: 'welcomeModalSeen',
        value: true
      })
    });

    if (response.ok) {
      console.log('[WelcomePopup] Successfully marked as seen on server');
      return true;
    } else {
      console.warn('[WelcomePopup] Failed to mark as seen on server:', response.status);
      return false;
    }
  } catch (error) {
    console.warn('[WelcomePopup] Failed to update server-side modal status:', error);
    return false;
  }
}

/**
 * Get plan-specific welcome content
 * @param {string} plan - User's plan (free, trial, essential, pro, premium)
 * @returns {Object} Content object with title, features, and CTA
 */
function getWelcomeContent(plan) {
  const baseFeatures = [
    {
      icon: '📊',
      title: 'ATS Resume Scoring',
      description: 'Our AI analyzes your resume against Application Tracking Systems used by 99% of Fortune 500 companies. Get instant, actionable scores.'
    },
    {
      icon: '🤖',
      title: 'AI-Powered Intelligence',
      description: 'We use advanced AI to provide the most current, relevant feedback based on real-time job market trends and what recruiters are actively seeking.'
    }
  ];

  const contentMap = {
    free: {
      title: 'Welcome to JobHackAI!',
      subtitle: 'Start Your Job Search Journey',
      features: [
        ...baseFeatures,
        {
          icon: '🎯',
          title: 'One Free ATS Score',
          description: 'Get your first professional resume score to see exactly where you stand with employer ATS systems.'
        }
      ],
      cta: 'Start Scoring My Resume',
      upgradeMessage: 'Upgrade anytime for unlimited scoring, interview prep, and more.'
    },
    trial: {
      title: 'Welcome to Your Free Trial!',
      subtitle: 'Full Access to All Premium Features',
      features: [
        ...baseFeatures,
        {
          icon: '💬',
          title: 'Interview Question Generator',
          description: 'Get AI-generated, role-specific interview questions that match current hiring trends and help you prepare for real scenarios.'
        },
        {
          icon: '✨',
          title: 'Unlimited Everything',
          description: 'Full access to ATS scoring, detailed resume feedback, interview prep, and all premium features during your trial.'
        }
      ],
      cta: 'Explore Your Features',
      upgradeMessage: ''
    },
    essential: {
      title: 'Welcome to JobHackAI Essential!',
      subtitle: 'Core Tools for Your Job Search',
      features: [
        ...baseFeatures,
        {
          icon: '📝',
          title: 'Detailed Resume Feedback',
          description: 'Get comprehensive, section-by-section analysis with specific recommendations to improve your resume\'s impact.'
        },
        {
          icon: '💬',
          title: 'Interview Questions',
          description: 'Access curated, AI-generated interview questions tailored to your target role and industry.'
        }
      ],
      cta: 'Get Started',
      upgradeMessage: ''
    },
    pro: {
      title: 'Welcome to JobHackAI Pro!',
      subtitle: 'Advanced Tools for Serious Job Seekers',
      features: [
        ...baseFeatures,
        {
          icon: '✍️',
          title: 'Resume Rewriting & Cover Letters',
          description: 'AI-powered resume rewriting and custom cover letter generation optimized for ATS systems and human recruiters.'
        },
        {
          icon: '🎤',
          title: 'Mock Interview Practice',
          description: 'Practice with AI-driven mock interviews and get real-time feedback on your answers and delivery.'
        }
      ],
      cta: 'Start Using Pro Features',
      upgradeMessage: ''
    },
    premium: {
      title: 'Welcome to JobHackAI Premium!',
      subtitle: 'The Ultimate Job Search Arsenal',
      features: [
        ...baseFeatures,
        {
          icon: '💼',
          title: 'LinkedIn Profile Optimizer',
          description: 'Optimize every section of your LinkedIn profile for maximum recruiter visibility and engagement.'
        },
        {
          icon: '⚡',
          title: 'Priority Review & Support',
          description: 'Get expedited AI review of all your documents and priority access to new features and updates.'
        }
      ],
      cta: 'Explore Premium Features',
      upgradeMessage: ''
    }
  };

  return contentMap[plan] || contentMap.free;
}

/**
 * Show welcome popup for first-time dashboard visitors
 * @param {string} plan - User's plan (free, trial, essential, pro, premium)
 * @param {string} userName - User's display name
 * @param {Function} onComplete - Callback when popup is closed
 */
export async function showWelcomePopup(plan = 'free', userName = 'there', onComplete = null) {
  // PRIORITY 1: Check server-side (source of truth)
  const hasSeenServerSide = await checkWelcomeModalSeenServerSide();
  if (hasSeenServerSide) {
    console.log('[WelcomePopup] User has seen modal (server-side)');
    if (onComplete) onComplete();
    return;
  }

  // PRIORITY 2: Check localStorage (fallback/cache)
  const hasSeenLocalStorage = localStorage.getItem('dashboard-welcome-shown');
  if (hasSeenLocalStorage === 'true') {
    console.log('[WelcomePopup] User has seen modal (localStorage)');
    // Sync to server in background if not already there
    markWelcomeModalSeenServerSide().catch(err => 
      console.warn('[WelcomePopup] Background sync to server failed:', err)
    );
    if (onComplete) onComplete();
    return;
  }

  // Remove existing popup if present
  const existingPopup = document.getElementById('jh-welcome-popup');
  if (existingPopup) {
    existingPopup.remove();
  }

  const content = getWelcomeContent(plan);
  const escapedUserName = escapeHtml(userName);
  const escapedSubtitle = escapeHtml(content.subtitle);
  const escapedCta = escapeHtml(content.cta);
  // Personalize title with user's name
  const escapedTitle = escapeHtml(`${content.title}${userName && userName !== 'there' ? ', ' + userName : ''}`);

  // Create modal overlay
  const modal = document.createElement('div');
  modal.id = 'jh-welcome-popup';
  modal.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(0, 0, 0, 0.6);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 10000;
    animation: fadeIn 0.3s ease;
    padding: 1rem;
    overflow-y: auto;
  `;

  // Build features HTML
  const featuresHtml = content.features.map(feature => `
    <div style="
      display: flex;
      gap: 1rem;
      align-items: flex-start;
      margin-bottom: 1.2rem;
    ">
      <div style="
        font-size: 2rem;
        line-height: 1;
        flex-shrink: 0;
      ">${feature.icon}</div>
      <div>
        <h4 style="
          margin: 0 0 0.3rem 0;
          color: #1F2937;
          font-size: 1.05rem;
          font-weight: 700;
          font-family: 'Inter', sans-serif;
        ">${escapeHtml(feature.title)}</h4>
        <p style="
          margin: 0;
          color: #4B5563;
          font-size: 0.95rem;
          line-height: 1.5;
          font-family: 'Inter', sans-serif;
        ">${escapeHtml(feature.description)}</p>
      </div>
    </div>
  `).join('');

  modal.innerHTML = `
    <div style="
      background: #FFFFFF;
      border-radius: 20px;
      padding: 2.5rem;
      max-width: 640px;
      width: 100%;
      box-shadow: 0 20px 60px rgba(31, 41, 55, 0.15);
      animation: slideUp 0.4s ease;
      max-height: 90vh;
      overflow-y: auto;
    ">
      <div style="text-align: center; margin-bottom: 2rem;">
        <div style="
          font-size: 3rem;
          margin-bottom: 1rem;
        ">👋</div>
        <h2 style="
          margin: 0 0 0.5rem 0;
          color: #1F2937;
          font-size: 1.75rem;
          font-weight: 800;
          font-family: 'Inter', sans-serif;
        ">${escapedTitle}</h2>
        <p style="
          margin: 0;
          color: #6B7280;
          font-size: 1.1rem;
          font-weight: 500;
          font-family: 'Inter', sans-serif;
        ">${escapedSubtitle}</p>
      </div>

      <div style="
        background: linear-gradient(135deg, #F0FDF4 0%, #E0F2FE 100%);
        border-radius: 12px;
        padding: 1.5rem;
        margin-bottom: 2rem;
        border: 1px solid #D1FAE5;
      ">
        <h3 style="
          margin: 0 0 1rem 0;
          color: #065F46;
          font-size: 1.15rem;
          font-weight: 700;
          font-family: 'Inter', sans-serif;
          display: flex;
          align-items: center;
          gap: 0.5rem;
        ">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#065F46" stroke-width="2">
            <path d="M12 2L2 7l10 5 10-5-10-5z"/>
            <path d="M2 17l10 5 10-5M2 12l10 5 10-5"/>
          </svg>
          What Makes JobHackAI Different
        </h3>
        <p style="
          margin: 0;
          color: #047857;
          font-size: 0.98rem;
          line-height: 1.6;
          font-family: 'Inter', sans-serif;
        ">
          Our AI doesn't just score your resume—it understands what today's employers are looking for. We analyze real-time job market data to ensure your resume, interview prep, and career materials match current hiring trends, giving you a competitive edge in your job search.
        </p>
      </div>

      <div style="margin-bottom: 2rem;">
        ${featuresHtml}
      </div>

      ${content.upgradeMessage ? `
        <div style="
          background: #FEF3C7;
          border-left: 3px solid #F59E0B;
          padding: 1rem 1.2rem;
          margin-bottom: 1.5rem;
          border-radius: 6px;
        ">
          <p style="
            margin: 0;
            color: #92400E;
            font-size: 0.95rem;
            font-weight: 500;
            font-family: 'Inter', sans-serif;
          ">${escapeHtml(content.upgradeMessage)}</p>
        </div>
      ` : ''}

      <div style="display: flex; gap: 0.75rem; justify-content: center;">
        <button id="jh-welcome-cta" style="
          background: #00E676;
          color: #FFFFFF;
          border: none;
          border-radius: 12px;
          padding: 0.9rem 2.5rem;
          font-size: 1.05rem;
          font-weight: 700;
          font-family: 'Inter', sans-serif;
          cursor: pointer;
          transition: all 0.2s;
          box-shadow: 0 4px 14px rgba(0, 230, 118, 0.3);
        " onmouseover="this.style.background='#00c965'; this.style.transform='translateY(-2px)'; this.style.boxShadow='0 6px 20px rgba(0, 230, 118, 0.4)'"
           onmouseout="this.style.background='#00E676'; this.style.transform='translateY(0)'; this.style.boxShadow='0 4px 14px rgba(0, 230, 118, 0.3)'">
          ${escapedCta}
        </button>
      </div>

      <p style="
        text-align: center;
        margin: 1.5rem 0 0 0;
        color: #9CA3AF;
        font-size: 0.85rem;
        font-family: 'Inter', sans-serif;
      ">This message will only appear once</p>
    </div>
  `;

  // Add animations
  let style = document.getElementById('jh-welcome-styles');
  if (!style) {
    style = document.createElement('style');
    style.id = 'jh-welcome-styles';
    style.textContent = `
      @keyframes fadeIn {
        from { opacity: 0; }
        to { opacity: 1; }
      }
      @keyframes slideUp {
        from { transform: translateY(30px); opacity: 0; }
        to { transform: translateY(0); opacity: 1; }
      }
      @keyframes fadeOut {
        from { opacity: 1; }
        to { opacity: 0; }
      }

      /* Responsive adjustments for mobile */
      @media (max-width: 640px) {
        #jh-welcome-popup > div {
          padding: 1.5rem !important;
          max-height: 85vh !important;
        }
      }
    `;
    document.head.appendChild(style);
  }

  document.body.appendChild(modal);

  // Close on Escape key
  const escapeHandler = (e) => {
    if (e.key === 'Escape') {
      closePopup();
    }
  };
  document.addEventListener('keydown', escapeHandler);

  const closePopup = async () => {
    // Remove escape key listener to prevent memory leak
    document.removeEventListener('keydown', escapeHandler);

    // PRIORITY 1: Mark as shown on server (source of truth)
    const serverUpdateSuccess = await markWelcomeModalSeenServerSide();
    
    // PRIORITY 2: Mark as shown in localStorage (fallback/cache)
    try {
      localStorage.setItem('dashboard-welcome-shown', 'true');
    } catch (e) {
      console.warn('Could not save welcome popup state to localStorage:', e);
    }

    if (!serverUpdateSuccess) {
      console.warn('[WelcomePopup] Failed to save to server, but localStorage saved as fallback');
    }
    
    // Animate and remove modal
    modal.style.animation = 'fadeOut 0.3s ease';
    setTimeout(() => {
      modal.remove();
      if (onComplete) onComplete();
    }, 300);
  };

  // CTA button click
  document.getElementById('jh-welcome-cta').addEventListener('click', closePopup);

  // Close on backdrop click
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      closePopup();
    }
  });
}

/**
 * Reset welcome popup state (for testing)
 * Note: This only clears client-side cache. Server-side reset requires manual database update or admin API.
 */
export function resetWelcomePopup() {
  // Clear localStorage
  try {
    localStorage.removeItem('dashboard-welcome-shown');
    console.log('[WelcomePopup] Cleared localStorage flag');
  } catch (e) {
    console.warn('Could not reset welcome popup localStorage state:', e);
  }

  // Note: Server-side reset requires manual database update or admin API
  // This function only clears client-side cache for testing
  console.warn('[WelcomePopup] Note: Server-side flag not reset. User will not see modal again unless database is updated.');
}

// Make functions available globally
if (typeof window !== 'undefined') {
  window.showWelcomePopup = showWelcomePopup;
  window.resetWelcomePopup = resetWelcomePopup;
}
