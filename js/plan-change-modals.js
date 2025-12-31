/**
 * Plan Change Modals
 * Reusable modals for plan changes following UX design system
 * Used for: trial eligibility, upgrade reactivation, downgrade timing selection
 */

/**
 * Show trial eligibility block modal
 * Called when user tries to start a trial but has already had a paid subscription
 */
export function showTrialEligibilityModal() {
  const modal = document.createElement('div');
  modal.id = 'jh-trial-eligibility-modal';
  modal.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 10000;
    animation: fadeIn 0.2s ease;
  `;

  modal.innerHTML = `
    <style>
      @keyframes fadeIn {
        from { opacity: 0; }
        to { opacity: 1; }
      }
      @keyframes slideUp {
        from { transform: translateY(20px); opacity: 0; }
        to { transform: translateY(0); opacity: 1; }
      }
      @keyframes fadeOut {
        from { opacity: 1; }
        to { opacity: 0; }
      }
    </style>
    <div style="
      background: #FFFFFF;
      border-radius: 16px;
      padding: 2rem;
      max-width: 500px;
      width: 90%;
      box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.15);
      animation: slideUp 0.3s ease;
    ">
      <div style="text-align: center; margin-bottom: 1.5rem;">
        <div style="width: 60px; height: 60px; background: #E6F7FF; border-radius: 50%; display: flex; align-items: center; justify-content: center; margin: 0 auto 1rem;">
          <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#1890FF" stroke-width="2">
            <circle cx="12" cy="12" r="10"/>
            <line x1="12" y1="16" x2="12" y2="12"/>
            <line x1="12" y1="8" x2="12.01" y2="8"/>
          </svg>
        </div>
        <h3 style="margin: 0 0 0.5rem 0; color: #232B36; font-size: 1.5rem; font-weight: 700;">Trial Not Available</h3>
        <p style="margin: 0; color: #64748B; font-size: 1rem; line-height: 1.5;">
          Trial is for first-time subscribers only. You're already subscribed, so you can switch plans anytime.
        </p>
      </div>
      
      <div style="display: flex; gap: 0.75rem;">
        <button id="jh-trial-modal-view-plans" style="
          flex: 1;
          background: #00E676;
          color: white;
          border: none;
          padding: 0.875rem;
          border-radius: 8px;
          cursor: pointer;
          font-weight: 700;
          font-size: 1rem;
          transition: all 0.2s;
        " onmouseover="this.style.background='#00c965'" onmouseout="this.style.background='#00E676'">
          View Plans
        </button>
        <button id="jh-trial-modal-close" style="
          flex: 1;
          background: white;
          color: #64748B;
          border: 1px solid #CBD5E1;
          padding: 0.875rem;
          border-radius: 8px;
          cursor: pointer;
          font-weight: 600;
          font-size: 1rem;
          transition: all 0.2s;
        " onmouseover="this.style.background='#F8FAFC'" onmouseout="this.style.background='white'">
          Close
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  let escapeHandler = null;

  const closeModal = (suppressOnCancel = false) => {
    modal.style.animation = 'fadeOut 0.2s ease';
    // Remove keydown handler if attached to avoid leaks
    if (escapeHandler) {
      document.removeEventListener('keydown', escapeHandler);
      escapeHandler = null;
    }
    setTimeout(() => {
      modal.remove();
    }, 200);
  };

  modal.querySelector('#jh-trial-modal-close').addEventListener('click', closeModal);
  modal.querySelector('#jh-trial-modal-view-plans').addEventListener('click', () => {
    closeModal();
    window.location.href = '/pricing-a';
  });

  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeModal();
  });

  escapeHandler = (e) => {
    if (e.key === 'Escape') {
      closeModal();
    }
  };
  document.addEventListener('keydown', escapeHandler);
}

/**
 * Show upgrade reactivation confirmation modal
 * Called when user upgrades and has cancel_at_period_end = true
 * @param {Object} options - Modal options
 * @param {string} options.currentPlan - Current plan name
 * @param {string} options.newPlan - New plan name
 * @param {string} options.currentPrice - Current plan price (e.g., "$29/month")
 * @param {string} options.newPrice - New plan price (e.g., "$59/month")
 * @param {string} options.proratedAmount - Prorated charge amount (e.g., "$15.50")
 * @param {Function} options.onConfirm - Callback when user confirms upgrade
 * @param {Function} options.onCancel - Callback when user cancels
 */
export function showUpgradeReactivationModal({ currentPlan, newPlan, currentPrice, newPrice, proratedAmount, onConfirm, onCancel }) {
  const modal = document.createElement('div');
  modal.id = 'jh-upgrade-reactivation-modal';
  modal.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 10000;
    animation: fadeIn 0.2s ease;
  `;

  const planNames = {
    'trial': '3-Day Free Trial',
    'essential': 'Essential Plan',
    'pro': 'Pro Plan',
    'premium': 'Premium Plan'
  };

  modal.innerHTML = `
    <style>
      @keyframes fadeIn {
        from { opacity: 0; }
        to { opacity: 1; }
      }
      @keyframes slideUp {
        from { transform: translateY(20px); opacity: 0; }
        to { transform: translateY(0); opacity: 1; }
      }
      @keyframes fadeOut {
        from { opacity: 1; }
        to { opacity: 0; }
      }
    </style>
    <div style="
      background: #FFFFFF;
      border-radius: 16px;
      padding: 2rem;
      max-width: 500px;
      width: 90%;
      box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.15);
      animation: slideUp 0.3s ease;
    ">
      <div style="text-align: center; margin-bottom: 1.5rem;">
        <div style="width: 60px; height: 60px; background: linear-gradient(135deg, #00E676 0%, #00c965 100%); border-radius: 50%; display: flex; align-items: center; justify-content: center; margin: 0 auto 1rem;">
          <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3">
            <path d="M5 12l5 5L20 7"/>
          </svg>
        </div>
        <h3 style="margin: 0 0 0.5rem 0; color: #232B36; font-size: 1.5rem; font-weight: 700;">Upgrade Your Plan</h3>
        <p style="margin: 0; color: #64748B; font-size: 1rem;">You're upgrading from ${planNames[currentPlan] || currentPlan} to ${planNames[newPlan] || newPlan}</p>
      </div>
      
      <div style="background: #F8FAFC; border-radius: 12px; padding: 1.25rem; margin-bottom: 1.5rem;">
        <div style="display: flex; justify-content: space-between; margin-bottom: 0.75rem; padding-bottom: 0.75rem; border-bottom: 1px solid #E2E8F0;">
          <span style="color: #64748B; font-size: 0.95rem;">Current Plan:</span>
          <span style="color: #232B36; font-weight: 600;">${planNames[currentPlan] || currentPlan} - ${currentPrice}</span>
        </div>
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.75rem; padding-bottom: 0.75rem; border-bottom: 1px solid #E2E8F0;">
          <span style="color: #64748B; font-size: 0.95rem;">New Plan:</span>
          <div style="text-align: right;">
            <div style="color: #00E676; font-weight: 700; font-size: 1.1rem;">${planNames[newPlan] || newPlan}</div>
            <div style="color: #232B36; font-size: 0.9rem;">${newPrice}</div>
          </div>
        </div>
        ${proratedAmount ? `
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <span style="color: #64748B; font-size: 0.95rem;">Prorated charge today:</span>
          <span style="color: #232B36; font-weight: 600; font-size: 1rem;">${proratedAmount}</span>
        </div>
        ` : ''}
      </div>
      
      <div style="background: #E6F7FF; border: 1px solid #91D5FF; border-radius: 8px; padding: 0.875rem; margin-bottom: 1.5rem;">
        <p style="margin: 0; color: #1890FF; font-size: 0.9rem; line-height: 1.5;">
          <strong>ℹ️ Upgrading will reactivate your subscription immediately.</strong> Your subscription will be reactivated immediately and you'll have access to ${planNames[newPlan] || newPlan} features right away.
        </p>
      </div>
      
      <div style="display: flex; gap: 0.75rem;">
        <button id="jh-upgrade-modal-cancel" style="
          flex: 1;
          background: white;
          color: #64748B;
          border: 1px solid #CBD5E1;
          padding: 0.875rem;
          border-radius: 8px;
          cursor: pointer;
          font-weight: 600;
          font-size: 1rem;
          transition: all 0.2s;
        " onmouseover="this.style.background='#F8FAFC'" onmouseout="this.style.background='white'">
          Cancel
        </button>
        <button id="jh-upgrade-modal-confirm" style="
          flex: 1;
          background: #00E676;
          color: white;
          border: none;
          padding: 0.875rem;
          border-radius: 8px;
          cursor: pointer;
          font-weight: 700;
          font-size: 1rem;
          transition: all 0.2s;
        " onmouseover="this.style.background='#00c965'" onmouseout="this.style.background='#00E676'">
          Continue to Checkout
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  let escapeHandler = null;

  const closeModal = (suppressOnCancel = false) => {
    modal.style.animation = 'fadeOut 0.2s ease';
    // Remove keydown handler if attached to avoid leaks
    if (escapeHandler) {
      document.removeEventListener('keydown', escapeHandler);
      escapeHandler = null;
    }
    setTimeout(() => {
      modal.remove();
      if (onCancel && !suppressOnCancel) onCancel();
    }, 200);
  };

  modal.querySelector('#jh-upgrade-modal-cancel').addEventListener('click', closeModal);
  modal.querySelector('#jh-upgrade-modal-confirm').addEventListener('click', () => {
    // cleanup and close without triggering onCancel
    closeModal(true);
    if (onConfirm) onConfirm();
  });

  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeModal();
  });

  escapeHandler = (e) => {
    if (e.key === 'Escape') {
      closeModal();
    }
  };
  document.addEventListener('keydown', escapeHandler);
}

/**
 * Show downgrade timing selector modal
 * Called when user downgrades (e.g., Premium → Essential)
 * @param {Object} options - Modal options
 * @param {string} options.fromPlan - Current plan name
 * @param {string} options.toPlan - New plan name
 * @param {string} options.fromPrice - Current plan price (e.g., "$99/month")
 * @param {string} options.toPrice - New plan price (e.g., "$29/month")
 * @param {string} options.currentPeriodEnd - Current period end date (e.g., "January 30, 2026")
 * @param {Function} options.onConfirm - Callback when user confirms (receives { timing: 'immediate' | 'scheduled' })
 * @param {Function} options.onCancel - Callback when user cancels
 */
export function showDowngradeTimingModal({ fromPlan, toPlan, fromPrice, toPrice, currentPeriodEnd, onConfirm, onCancel }) {
  const modal = document.createElement('div');
  modal.id = 'jh-downgrade-timing-modal';
  modal.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 10000;
    animation: fadeIn 0.2s ease;
  `;

  const planNames = {
    'essential': 'Essential Plan',
    'pro': 'Pro Plan',
    'premium': 'Premium Plan'
  };
  
  // Fallback display text for current period end when not provided
  const periodText = currentPeriodEnd ? currentPeriodEnd : 'your next billing date';

  modal.innerHTML = `
    <style>
      @keyframes fadeIn {
        from { opacity: 0; }
        to { opacity: 1; }
      }
      @keyframes slideUp {
        from { transform: translateY(20px); opacity: 0; }
        to { transform: translateY(0); opacity: 1; }
      }
    </style>
    <div style="
      background: #FFFFFF;
      border-radius: 16px;
      padding: 2rem;
      max-width: 550px;
      width: 90%;
      box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.15);
      animation: slideUp 0.3s ease;
    ">
      <h3 style="margin: 0 0 1rem 0; color: #232B36; font-size: 1.5rem; font-weight: 700;">Change Your Plan</h3>
      <p style="margin: 0 0 1.5rem 0; color: #64748B; font-size: 1rem; line-height: 1.5;">
        You're changing from ${planNames[fromPlan] || fromPlan} (${fromPrice}) to ${planNames[toPlan] || toPlan} (${toPrice}).
      </p>
      
      <p style="margin: 0 0 1rem 0; color: #232B36; font-size: 1rem; font-weight: 600;">When would you like this change to take effect?</p>
      
      <div style="margin-bottom: 1.5rem;">
        <label style="
          display: flex;
          align-items: flex-start;
          padding: 1rem;
          border: 2px solid #E2E8F0;
          border-radius: 8px;
          margin-bottom: 0.75rem;
          cursor: pointer;
          transition: all 0.2s;
          background: #F8FAFC;
        " id="jh-downgrade-option-scheduled" onmouseover="this.style.borderColor='#00E676'; this.style.background='#F0FDF4'" onmouseout="this.style.borderColor='#E2E8F0'; this.style.background='#F8FAFC'">
          <input type="radio" name="downgrade-timing" value="scheduled" checked style="margin-right: 0.75rem; margin-top: 0.25rem; cursor: pointer;">
          <div style="flex: 1;">
            <div style="display: flex; align-items: center; margin-bottom: 0.5rem;">
              <span style="color: #232B36; font-weight: 600; font-size: 1rem;">Switch on renewal (Recommended)</span>
              <span style="margin-left: 0.5rem; background: #00E676; color: white; padding: 0.125rem 0.5rem; border-radius: 4px; font-size: 0.75rem; font-weight: 600;">Recommended</span>
            </div>
            <p style="margin: 0; color: #64748B; font-size: 0.9rem; line-height: 1.5;">
              Keep ${planNames[fromPlan] || fromPlan} features until ${periodText}. Plan changes on your next billing date. No charges or credits today.
            </p>
          </div>
        </label>
        
        <label style="
          display: flex;
          align-items: flex-start;
          padding: 1rem;
          border: 2px solid #E2E8F0;
          border-radius: 8px;
          cursor: pointer;
          transition: all 0.2s;
          background: white;
        " id="jh-downgrade-option-immediate" onmouseover="this.style.borderColor='#00E676'" onmouseout="this.style.borderColor='#E2E8F0'">
          <input type="radio" name="downgrade-timing" value="immediate" style="margin-right: 0.75rem; margin-top: 0.25rem; cursor: pointer;">
          <div style="flex: 1;">
            <span style="color: #232B36; font-weight: 600; font-size: 1rem;">Switch now (Prorated)</span>
            <p style="margin: 0.5rem 0 0 0; color: #64748B; font-size: 0.9rem; line-height: 1.5;">
              Your bill will adjust today. You may see a credit for unused ${planNames[fromPlan] || fromPlan} time.
            </p>
          </div>
        </label>
      </div>
      
      <div style="display: flex; gap: 0.75rem;">
        <button id="jh-downgrade-modal-cancel" style="
          flex: 1;
          background: white;
          color: #64748B;
          border: 1px solid #CBD5E1;
          padding: 0.875rem;
          border-radius: 8px;
          cursor: pointer;
          font-weight: 600;
          font-size: 1rem;
          transition: all 0.2s;
        " onmouseover="this.style.background='#F8FAFC'" onmouseout="this.style.background='white'">
          Cancel
        </button>
        <button id="jh-downgrade-modal-confirm" style="
          flex: 1;
          background: #00E676;
          color: white;
          border: none;
          padding: 0.875rem;
          border-radius: 8px;
          cursor: pointer;
          font-weight: 700;
          font-size: 1rem;
          transition: all 0.2s;
        " onmouseover="this.style.background='#00c965'" onmouseout="this.style.background='#00E676'">
          Confirm Change
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  let escapeHandler = null;

  const closeModal = (suppressOnCancel = false) => {
    modal.style.animation = 'fadeOut 0.2s ease';
    // Remove keydown handler if attached to avoid leaks
    if (escapeHandler) {
      document.removeEventListener('keydown', escapeHandler);
      escapeHandler = null;
    }
    setTimeout(() => {
      modal.remove();
      if (onCancel && !suppressOnCancel) onCancel();
    }, 200);
  };

  modal.querySelector('#jh-downgrade-modal-cancel').addEventListener('click', closeModal);
  modal.querySelector('#jh-downgrade-modal-confirm').addEventListener('click', () => {
    const selected = modal.querySelector('input[name="downgrade-timing"]:checked')?.value || 'scheduled';
    // cleanup and close without triggering onCancel
    closeModal(true);
    if (onConfirm) onConfirm({ timing: selected });
  });

  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeModal();
  });

  escapeHandler = (e) => {
    if (e.key === 'Escape') {
      closeModal();
    }
  };
  document.addEventListener('keydown', escapeHandler);
}

// Make functions available globally
if (typeof window !== 'undefined') {
  window.showTrialEligibilityModal = showTrialEligibilityModal;
  window.showUpgradeReactivationModal = showUpgradeReactivationModal;
  window.showDowngradeTimingModal = showDowngradeTimingModal;
}

