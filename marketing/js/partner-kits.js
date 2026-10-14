(function () {
  'use strict';
  const kit = document.body.dataset.kit;
  if (!['interview', 'moveout'].includes(kit)) return;
  // Never collect worksheet content, names, item lists, or user-entered values.
  function record(action) {
    if (window.JHA?.cookieConsent?.hasAnalyticsConsent?.() !== true) return;
    window.JHA?.trackEventSafe?.('partner_kit_action', {
      asset_id: kit === 'interview' ? 'interview_prep_kit' : 'moveout_kit',
      business_line: kit === 'interview' ? 'career_product' : 'local_directory',
      page_path: window.location.pathname,
      action
    });
  }
  document.querySelectorAll('[data-kit-notes]').forEach(input => {
    input.addEventListener('input', () => {
      input.style.height = 'auto';
      input.style.height = `${input.scrollHeight + 4}px`;
    });
  });
  const status = document.querySelector('[data-copy-status]');
  const copy = document.querySelector('[data-copy-block]');
  copy?.addEventListener('click', async () => {
    const text = document.querySelector('[data-partner-block]')?.textContent?.trim();
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      status.textContent = 'Copied. Paste it into your email template.';
      record('email_block_copied');
    } catch (_) {
      status.textContent = 'Copy is unavailable here. Select the email text above and copy it manually.';
    }
  });
  document.querySelector('[data-print-kit]')?.addEventListener('click', () => {
    record('print_opened'); // Opening the dialog does not prove printing or saving.
    window.print();
  });
})();
