// Test Helper for Development
class TestHelper {
  constructor() {
    this.init();
  }

  init() {
    // Only show in development/testing mode
    if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' || window.location.hostname.includes('test')) {
      this.createTestPanel();
    }
  }

  createTestPanel() {
    const panel = document.createElement('div');
    panel.id = 'testHelperPanel';
    panel.style.cssText = `
      position: fixed;
      top: 10px;
      right: 10px;
      background: #1a1a1a;
      color: white;
      padding: 15px;
      border-radius: 8px;
      font-family: monospace;
      font-size: 12px;
      z-index: 10000;
      max-width: 300px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.3);
    `;

    panel.innerHTML = `
      <div style="margin-bottom: 10px; font-weight: bold; border-bottom: 1px solid #333; padding-bottom: 5px;">
        🧪 Test Helper
      </div>
      
      <div style="margin-bottom: 10px;">
        <label style="display: block; margin-bottom: 3px;">User State:</label>
        <select id="testUserState" style="width: 100%; padding: 3px; background: #333; color: white; border: 1px solid #555;">
          <option value="logged-out">Logged Out</option>
          <option value="free">Free User</option>
          <option value="trial">Trial User</option>
          <option value="essential">Essential User</option>
          <option value="pro">Pro User</option>
          <option value="premium">Premium User</option>
        </select>
      </div>

      <div style="margin-bottom: 10px;">
        <label style="display: block; margin-bottom: 3px;">Email:</label>
        <input type="email" id="testUserEmail" value="test@example.com" style="width: 100%; padding: 3px; background: #333; color: white; border: 1px solid #555;">
      </div>

      <div style="margin-bottom: 10px;">
        <label style="display: block; margin-bottom: 3px;">Has Card:</label>
        <select id="testUserCard" style="width: 100%; padding: 3px; background: #333; color: white; border: 1px solid #555;">
          <option value="true">Yes</option>
          <option value="false">No</option>
        </select>
      </div>

      <button id="applyTestState" style="width: 100%; padding: 5px; background: #007bff; color: white; border: none; border-radius: 3px; cursor: pointer; margin-bottom: 5px;">
        Apply State
      </button>
      
      <button id="resetTestState" style="width: 100%; padding: 5px; background: #dc3545; color: white; border: none; border-radius: 3px; cursor: pointer;">
        Reset
      </button>

      <div style="margin-top: 10px; font-size: 10px; color: #ccc;">
        Current: <span id="currentState">Loading...</span>
      </div>
    `;

    document.body.appendChild(panel);
    this.bindEvents();
    this.updateCurrentState();
  }

  bindEvents() {
    document.getElementById('applyTestState').addEventListener('click', () => {
      this.applyTestState();
    });

    document.getElementById('resetTestState').addEventListener('click', () => {
      this.resetTestState();
    });

    // Auto-apply state when selection changes
    document.getElementById('testUserState').addEventListener('change', () => {
      this.applyTestState();
    });
  }

  applyTestState() {
    const state = document.getElementById('testUserState').value;
    const email = document.getElementById('testUserEmail').value;
    const hasCard = document.getElementById('testUserCard').value === 'true';

    if (state === 'logged-out') {
      this.logout();
    } else {
      this.loginAsUser(email, state, hasCard);
    }

    this.updateCurrentState();
    
    // Refresh the page to apply changes
    setTimeout(() => {
      window.location.reload();
    }, 500);
  }

  loginAsUser(email, plan, hasCard) {
    // Set authentication state
    localStorage.setItem('user-authenticated', 'true');
    localStorage.setItem('user-email', email);
    localStorage.setItem('user-plan', plan);
    localStorage.setItem('dev-plan', plan);

    // Create or update user in database
    const db = JSON.parse(localStorage.getItem('user-db') || '{}');
    db[email] = {
      email: email,
      plan: plan,
      created: new Date().toISOString(),
      lastLogin: new Date().toISOString(),
      cards: hasCard ? [{
        id: 'test-card-1',
        last4: '4242',
        brand: 'visa',
        expMonth: 12,
        expYear: 2025
      }] : []
    };
    localStorage.setItem('user-db', JSON.stringify(db));
    localStorage.setItem('user-db-backup', JSON.stringify(db));

    // Update navigation if available
    if (window.JobHackAINavigation) {
      window.JobHackAINavigation.setAuthState(true, plan);
    }
  }

  logout() {
    localStorage.removeItem('user-authenticated');
    localStorage.removeItem('user-email');
    localStorage.removeItem('user-plan');
    localStorage.removeItem('dev-plan');
    sessionStorage.removeItem('selectedPlan');
    localStorage.removeItem('plan-amount');

    if (window.JobHackAINavigation) {
      window.JobHackAINavigation.setAuthState(false, 'free');
    }
  }

  resetTestState() {
    localStorage.clear();
    sessionStorage.clear();
    this.updateCurrentState();
    setTimeout(() => {
      window.location.reload();
    }, 500);
  }

  updateCurrentState() {
    const isAuth = localStorage.getItem('user-authenticated') === 'true';
    const plan = localStorage.getItem('user-plan') || 'free';
    const email = localStorage.getItem('user-email') || 'Not logged in';
    
    const stateText = isAuth ? `${email} (${plan})` : 'Logged out';
    document.getElementById('currentState').textContent = stateText;
  }

  checkUrlParams() {
    const urlParams = new URLSearchParams(window.location.search);
    const testState = urlParams.get('test');
    const testEmail = urlParams.get('email') || 'test@example.com';
    const testCard = urlParams.get('card') || 'true';

    if (testState) {
      document.getElementById('testUserState').value = testState;
      document.getElementById('testUserEmail').value = testEmail;
      document.getElementById('testUserCard').value = testCard;
      this.applyTestState();
    }
  }
}

// Initialize test helper
if (typeof window !== 'undefined') {
  window.TestHelper = new TestHelper();
}

// Add these to the global scope for console access
window.testLogin = (plan = 'pro', email = 'test@example.com') => {
  window.TestHelper.loginAsUser(email, plan, true);
  window.location.reload();
};

window.testLogout = () => {
  window.TestHelper.logout();
  window.location.reload();
};

window.testPlan = (plan) => {
  const email = localStorage.getItem('user-email') || 'test@example.com';
  window.TestHelper.loginAsUser(email, plan, true);
  window.location.reload();
}; 