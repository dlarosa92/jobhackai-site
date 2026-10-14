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
  const status = document.querySelector('[data-copy-status]');
  async function copyText(text, targetStatus, action, success) {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      targetStatus.textContent = success;
      record(action);
    } catch (_) {
      targetStatus.textContent = 'Copy is unavailable here. Select the text and copy it manually.';
    }
  }
  document.querySelector('[data-copy-block]')?.addEventListener('click', () => {
    return copyText(document.querySelector('[data-partner-block]')?.textContent?.trim(), status, 'email_block_copied', 'Copied. Open your email or saved template, paste below the existing instructions, then check the link before sending.');
  });
  const model = window.JHAKitModel;
  const preview = document.querySelector('[data-worksheet-preview]');
  const progress = document.querySelector('[data-progress]');
  const inputs = [...document.querySelectorAll('[data-kit-notes]')];
  function value(id) { return document.getElementById(id)?.value || ''; }
  function updateWorksheet() {
    if (!model || !preview) return;
    let result;
    if (kit === 'interview') {
      const data = {};
      ['project', 'result', 'ownership', 'action1', 'action2', 'boundary', 'reflection'].forEach(key => { data[key] = value(key); });
      result = model.interviewSummary(data);
      progress.textContent = `${result.complete} of 3 parts filled in. Your summary uses only what you enter.`;
    } else {
      const data = { items: value('items'), access: value('access'), deadline: value('deadline') };
      ['a', 'b'].forEach(provider => {
        data[provider] = {};
        ['name', 'price', 'available', 'items', 'carrying', 'disposal', 'written', 'extras'].forEach(key => { data[provider][key] = value(`${provider}-${key}`); });
      });
      result = model.moveoutSummary(data);
      progress.textContent = result.status;
      document.querySelector('[data-job-brief]').textContent = result.text.split('\n').slice(1, 4).join('\n');
      const tbody = document.querySelector('[data-comparison-rows]');
      tbody.replaceChildren();
      result.rows.forEach(row => {
        const tr = document.createElement('tr');
        row.forEach((text, index) => { const cell = document.createElement(index === 0 ? 'th' : 'td'); if (index === 0) cell.scope = 'row'; cell.textContent = text; tr.appendChild(cell); });
        tbody.appendChild(tr);
      });
      ['a', 'b'].forEach((provider, index) => { document.querySelector(`[data-provider-name="${provider}"]`).textContent = result.names[index]; });
    }
    preview.textContent = result.text;
  }
  inputs.forEach(input => {
    input.addEventListener('input', () => {
      if (input.tagName === 'TEXTAREA') { input.style.height = 'auto'; input.style.height = `${input.scrollHeight + 4}px`; }
      updateWorksheet();
    });
    input.addEventListener('change', updateWorksheet);
  });
  if (model && preview) { document.body.classList.add('kit-interactive'); updateWorksheet(); }
  document.querySelector('[data-copy-notes]')?.addEventListener('click', () => {
    return copyText(preview?.textContent, document.querySelector('[data-notes-status]'), 'worksheet_summary_copied', 'Your summary is copied. Paste it into Notes or a document to keep it.');
  });
  document.querySelector('[data-print-kit]')?.addEventListener('click', () => {
    record('print_opened');
    window.print();
  });
})();
