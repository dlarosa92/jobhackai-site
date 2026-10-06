// Display the shared UTC reset instant in the visitor's browser timezone.
(() => {
  const resetLabel = document.getElementById('subscription-reset');
  if (!resetLabel) return;

  function renderReset() {
    const now = new Date();
    const nextReset = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));

    try {
      const localReset = new Intl.DateTimeFormat(undefined, {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        timeZoneName: 'short'
      }).format(nextReset);
      resetLabel.textContent = `Next reset: ${localReset} (your local time).`;
    } catch (_) {
      // Keep the static UTC explanation if local formatting is unavailable.
    }
  }

  renderReset();
  window.addEventListener('pageshow', renderReset);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) renderReset();
  });
})();
