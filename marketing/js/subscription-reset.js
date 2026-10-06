// Display the shared UTC reset instant in the visitor's browser timezone.
(() => {
  const resetLabel = document.getElementById('subscription-reset');
  if (!resetLabel) return;
  const fallbackText = resetLabel.textContent;
  let refreshTimer;

  function renderReset() {
    window.clearTimeout(refreshTimer);
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
      resetLabel.textContent = fallbackText;
    }

    // Check daily for clock/timezone changes and at the UTC month boundary.
    // A bounded delay also avoids browsers' maximum timeout length.
    refreshTimer = window.setTimeout(renderReset, Math.min(nextReset - now + 1000, 86400000));
  }

  renderReset();
  window.addEventListener('pageshow', renderReset);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) renderReset();
  });
})();
