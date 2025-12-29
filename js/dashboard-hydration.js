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
      // Wait briefly for auth readiness (non-blocking long wait) if available
      if (window.FirebaseAuthManager && typeof window.FirebaseAuthManager.waitForAuthReady === 'function') {
        await window.FirebaseAuthManager.waitForAuthReady(3000).catch(() => {});
      }

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

      // Try to load Firestore SDK and fetch user doc, but don't fail if it errors
      let displayName = user.displayName || 'User';
      let email = user.email || '';

      try {
        const { getFirestore, doc, getDoc } = await import('https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js');
        const db = getFirestore(app);
        const userDocRef = doc(db, 'users', user.uid);
        const userDoc = await getDoc(userDocRef);
        
        if (userDoc.exists()) {
          const userDocData = userDoc.data();
          displayName = userDocData.displayName || userDocData.name || displayName;
          email = userDocData.email || email;
        }
      } catch (firestoreErr) {
        // Firestore failed (permissions, network, etc.) - use Firebase user data as fallback
        console.debug('Firestore read failed (non-critical), using Firebase user data:', firestoreErr.message);
        // displayName and email already set from Firebase user above
      }

      // Render small, design-system based cards (use existing classes)
      contentWrapper.innerHTML = `
        <div class="dashboard-root">
          <div class="dashboard-header">
            <h2>Welcome, ${escapeHtml(displayName)}!</h2>
            <p class="muted">Signed in as ${escapeHtml(email)}</p>
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

  // Caller is responsible for scheduling (idle/timeouts). Run hydration and await completion
  // so this async function resolves when hydration completes.
  await doHydrate();
}
