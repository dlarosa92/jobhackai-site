// js/dashboard-hydration.js

/* Dashboard hydration: ensure skeleton paints first, then hydrate at idle priority.
   This module lazy-loads Firebase + Firestore only when necessary to avoid blocking LCP. */
export async function hydrateDashboard() {
  const skeletonContainer = document.getElementById('dashboard-skeleton-container');
  const contentWrapper = document.getElementById('dashboard-content-wrapper');

  if (!skeletonContainer || !contentWrapper) {
    console.error('Dashboard hydration failed: Missing skeleton or content wrapper elements.');
    return;
  }

  // Ensure skeleton is painted first
  await new Promise(requestAnimationFrame);

  // Small HTML-escape helper
  function escapeHtml(s = '') {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;', "'":'&#39;' }[c]));
  }

  const doHydrate = async () => {
    try {
      // Wait briefly for auth readiness (non-blocking long wait)
      await window.FirebaseAuthManager?.waitForAuthReady?.(3000).catch(() => {});

      const user = window.FirebaseAuthManager?.getCurrentUser?.();
      if (!user) {
        // Show minimal authenticated hint and stop (do not block shell)
        contentWrapper.innerHTML = `
          <div class="dashboard-root">
            <div class="dashboard-header">
              <h2>Welcome</h2>
              <p class="muted">Please sign in to personalize your dashboard.</p>
            </div>
          </div>
        `;
        contentWrapper.style.display = 'block';
        skeletonContainer.style.display = 'none';
        return;
      }

      // Lazily initialize Firebase (no analytics by default)
      const { default: initializeFirebase } = await import('./firebase-config.js');
      const app = await initializeFirebase({ enableAnalytics: false });

      // Load Firestore SDK and fetch user doc only when needed
      const { getFirestore, doc, getDoc } = await import('https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js');
      const db = getFirestore(app);

      const userDocRef = doc(db, 'users', user.uid);
      const userDoc = await getDoc(userDocRef);

      const dashboardData = userDoc.exists() ? userDoc.data() : { name: user.displayName || 'User', email: user.email || '' };

      // Render small, design-system based cards (use existing classes)
      contentWrapper.innerHTML = `
        <div class="dashboard-root">
          <div class="dashboard-header">
            <h2>Welcome, ${escapeHtml(dashboardData.name)}!</h2>
            <p class="muted">Signed in as ${escapeHtml(dashboardData.email)}</p>
          </div>
          <div class="dashboard-features">
            <div class="dashboard-card">
              <h3>ATS Resume Score</h3>
              <p class="muted">Your last score will appear here.</p>
              <a class="btn-link" href="/ats.html">View ATS</a>
            </div>
            <div class="dashboard-card">
              <h3>Job Applications</h3>
              <p class="muted">Track your applications and statuses.</p>
              <a class="btn-link" href="/applications.html">Track Applications</a>
            </div>
            <div class="dashboard-card">
              <h3>Account</h3>
              <p class="muted">Manage your plan and settings.</p>
              <a class="btn-link" href="/settings.html">Go to Settings</a>
            </div>
          </div>
        </div>
      `;

      contentWrapper.style.display = 'block';
      skeletonContainer.style.display = 'none';
    } catch (err) {
      console.error('Error during dashboard hydration:', err);
      contentWrapper.innerHTML = `
        <div class="dashboard-root">
          <div class="dashboard-header">
            <h2>Welcome</h2>
            <p class="muted">Unable to load personalized data right now.</p>
          </div>
        </div>
      `;
      contentWrapper.style.display = 'block';
      skeletonContainer.style.display = 'none';
    }
  };

  if ('requestIdleCallback' in window) {
    requestIdleCallback(doHydrate, { timeout: 2000 });
  } else {
    setTimeout(doHydrate, 700);
  }
}
