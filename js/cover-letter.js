// Cover Letter Generator (MVP) - D1-backed history (Pro/Premium only)
// - Left: Generator + Preview
// - Right: History
// - Download PDF: window.print() (matches Interview Questions page)

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function debounce(fn, waitMs) {
  let t = null;
  return (...args) => {
    if (t) clearTimeout(t);
    t = setTimeout(() => fn(...args), waitMs);
  };
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = String(text ?? '');
  return div.innerHTML;
}

function timeAgo(tsMs) {
  const ts = Number(tsMs || 0);
  if (!ts || !Number.isFinite(ts)) return '';
  const diff = Date.now() - ts;
  const s = Math.floor(diff / 1000);
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  const mo = Math.floor(d / 30);
  if (mo < 12) return `${mo}mo ago`;
  const y = Math.floor(mo / 12);
  return `${y}y ago`;
}

async function waitForFirebaseUser() {
  // Prefer the event the firebase-auth module dispatches.
  let user = window.FirebaseAuthManager?.currentUser || null;
  if (user) return user;

  await new Promise((resolve) => {
    let done = false;
    const onReady = (e) => {
      if (done) return;
      done = true;
      document.removeEventListener('firebase-auth-ready', onReady);
      user = e?.detail?.user || window.FirebaseAuthManager?.currentUser || null;
      resolve();
    };
    document.addEventListener('firebase-auth-ready', onReady);
    // If already dispatched earlier, we still need a timeout safety.
    setTimeout(() => {
      if (done) return;
      done = true;
      document.removeEventListener('firebase-auth-ready', onReady);
      user = window.FirebaseAuthManager?.currentUser || null;
      resolve();
    }, 5000);
  });

  return user;
}

async function getIdToken() {
  const user = await waitForFirebaseUser();
  if (!user || typeof user.getIdToken !== 'function') {
    throw new Error('not_authenticated');
  }
  return await user.getIdToken();
}

async function apiFetch(path, options = {}) {
  const token = await getIdToken();
  const headers = new Headers(options.headers || {});
  headers.set('Authorization', `Bearer ${token}`);
  if (options.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  const res = await fetch(path, { ...options, headers });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!res.ok) {
    const err = new Error(data?.error || `http_${res.status}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

function getPlanLabel(plan) {
  const p = String(plan || '').toLowerCase();
  if (p === 'premium') return { label: 'Premium Plan', plan: 'premium' };
  if (p === 'pro') return { label: 'Pro Plan', plan: 'pro' };
  return { label: 'Plan', plan: '' };
}

function updatePlanBadge() {
  const el = $('#cl-plan-badge');
  if (!el) return;
  const plan = window.JobHackAINavigation?.getEffectivePlan?.() || '';
  const mapped = getPlanLabel(plan);
  el.textContent = mapped.label;
  if (mapped.plan) el.setAttribute('data-plan', mapped.plan);
  else el.removeAttribute('data-plan');
}

// ---------------------------
// Page state
// ---------------------------

let historyItems = [];
let selectedId = null;
let pendingDeleteId = null;
let isLoadingHistory = false;
let isGenerating = false;

const els = {
  form: null,
  role: null,
  company: null,
  seniority: null,
  tone: null,
  jobDescription: null,
  resumeText: null,
  generate: null,
  reset: null,
  preview: null,
  previewSkeleton: null,
  saveIndicator: null,
  copy: null,
  download: null,
  historyList: null,
  historyLoading: null,
  historyEmpty: null,
  refresh: null,
  modalBackdrop: null,
  deleteModal: null,
  deleteCancel: null,
  deleteConfirm: null
};

function setSaveIndicator(state, text) {
  if (!els.saveIndicator) return;
  if (!state) {
    els.saveIndicator.textContent = '';
    els.saveIndicator.removeAttribute('data-state');
    return;
  }
  els.saveIndicator.textContent = text || '';
  els.saveIndicator.setAttribute('data-state', state);
}

function showHistoryLoading(show) {
  if (!els.historyLoading) return;
  els.historyLoading.hidden = !show;
}

function showHistoryEmpty(show) {
  if (!els.historyEmpty) return;
  els.historyEmpty.hidden = !show;
}

function setGeneratingUI(on) {
  isGenerating = on;
  if (els.generate) {
    els.generate.disabled = !!on;
    els.generate.textContent = on ? 'Generating…' : 'Generate Cover Letter';
  }
  if (els.previewSkeleton) {
    els.previewSkeleton.hidden = !on;
  }
}

function setSelected(id) {
  selectedId = id;
  $$('.cl-history-item').forEach((row) => {
    row.classList.toggle('is-selected', row.dataset.id === id);
  });
}

function getSelectedItem() {
  if (!selectedId) return null;
  return historyItems.find((it) => it.id === selectedId) || null;
}

function readFormInputs() {
  return {
    role: String(els.role?.value || '').trim(),
    company: String(els.company?.value || '').trim(),
    seniority: String(els.seniority?.value || '').trim(),
    tone: String(els.tone?.value || '').trim() || 'Confident + Professional',
    jobDescription: String(els.jobDescription?.value || '').trim(),
    resumeText: String(els.resumeText?.value || '').trim()
  };
}

function restoreFromItem(item) {
  if (!item) return;
  if (els.role) els.role.value = item.role || '';
  if (els.company) els.company.value = item.company || '';
  if (els.seniority) els.seniority.value = item.seniority || '';
  if (els.tone) els.tone.value = item.tone || 'Confident + Professional';
  if (els.jobDescription) els.jobDescription.value = item.jobDescription || '';
  if (els.resumeText) els.resumeText.value = item.resumeText || '';
  if (els.preview) els.preview.value = item.coverLetterText || '';
  setSaveIndicator(null, '');
}

function clearForm() {
  if (els.role) els.role.value = '';
  if (els.company) els.company.value = '';
  if (els.seniority) els.seniority.value = '';
  if (els.tone) els.tone.value = 'Confident + Professional';
  if (els.jobDescription) els.jobDescription.value = '';
  if (els.resumeText) els.resumeText.value = '';
  if (els.preview) els.preview.value = '';
  setSaveIndicator(null, '');
  setSelected(null);
}

function openDeleteModal(id) {
  pendingDeleteId = id;
  if (els.modalBackdrop) els.modalBackdrop.hidden = false;
  if (els.deleteModal) els.deleteModal.hidden = false;
  // Focus the safer action by default
  setTimeout(() => els.deleteCancel?.focus(), 0);
}

function closeDeleteModal() {
  pendingDeleteId = null;
  if (els.modalBackdrop) els.modalBackdrop.hidden = true;
  if (els.deleteModal) els.deleteModal.hidden = true;
}

function renderHistory() {
  if (!els.historyList) return;
  els.historyList.innerHTML = '';

  if (!historyItems.length) {
    showHistoryEmpty(true);
    return;
  }

  showHistoryEmpty(false);

  for (const item of historyItems) {
    const row = document.createElement('div');
    row.className = 'cl-history-item';
    row.dataset.id = item.id;
    row.tabIndex = 0;
    if (selectedId === item.id) row.classList.add('is-selected');

    const companyPart = item.company ? `• ${item.company}` : '';
    const when = timeAgo(item.createdAt);
    const meta = [companyPart, when].filter(Boolean).join(' ');

    row.innerHTML = `
      <div class="cl-history-main">
        <svg class="cl-doc-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
          <polyline points="14 2 14 8 20 8"></polyline>
        </svg>
        <div class="cl-history-text">
          <div class="cl-history-line1" data-title>${escapeHtml(item.title || item.role || 'Cover Letter')}</div>
          <div class="cl-history-line2">${escapeHtml(item.role || '')} <span style="color:var(--color-text-muted);">${escapeHtml(meta)}</span></div>
        </div>
      </div>
      <div class="cl-history-actions" aria-label="Row actions">
        <button class="cl-action-btn" type="button" data-action="rename" title="Rename" aria-label="Rename">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
            <path d="M12 20h9"></path>
            <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z"></path>
          </svg>
        </button>
        <button class="cl-action-btn cl-action-btn--danger" type="button" data-action="delete" title="Delete" aria-label="Delete">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
            <polyline points="3 6 5 6 21 6"></polyline>
            <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path>
            <path d="M10 11v6"></path>
            <path d="M14 11v6"></path>
            <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"></path>
          </svg>
        </button>
      </div>
    `;

    const onSelect = () => {
      const chosen = historyItems.find((x) => x.id === item.id);
      if (!chosen) return;
      setSelected(item.id);
      restoreFromItem(chosen);
    };

    row.addEventListener('click', (e) => {
      const actionBtn = e.target.closest('button[data-action]');
      if (actionBtn) return; // handled below
      onSelect();
    });

    row.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onSelect();
      }
    });

    row.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-action]');
      if (!btn) return;
      e.preventDefault();
      e.stopPropagation();

      const action = btn.dataset.action;
      if (action === 'delete') {
        openDeleteModal(item.id);
        return;
      }

      if (action === 'rename') {
        startInlineRename(row, item);
      }
    });

    els.historyList.appendChild(row);
  }
}

async function fetchHistory() {
  if (isLoadingHistory) return;
  isLoadingHistory = true;
  showHistoryLoading(true);
  showHistoryEmpty(false);

  try {
    const data = await apiFetch('/api/cover-letter/history?limit=25', { method: 'GET' });
    historyItems = Array.isArray(data?.items) ? data.items : [];

    // Keep selected if present; if not, clear selection
    if (selectedId && !historyItems.some((x) => x.id === selectedId)) {
      selectedId = null;
    }

    renderHistory();
  } catch (e) {
    console.warn('[COVER-LETTER] Failed to load history:', e);
    historyItems = [];
    renderHistory();
  } finally {
    showHistoryLoading(false);
    isLoadingHistory = false;
  }
}

async function generateCoverLetter() {
  if (isGenerating) return;
  const payload = readFormInputs();
  if (!payload.role || !payload.seniority || !payload.jobDescription) {
    // Minimal client-side validation: rely on server for canonical validation.
    alert('Please fill in Target Role, Seniority, and Job Description.');
    return;
  }

  setGeneratingUI(true);
  setSaveIndicator(null, '');

  try {
    const data = await apiFetch('/api/cover-letter/generate', {
      method: 'POST',
      body: JSON.stringify(payload)
    });

    const item = data?.item;
    if (!item?.id) throw new Error('invalid_response');

    // Upsert into local list and select it
    const existingIdx = historyItems.findIndex((x) => x.id === item.id);
    if (existingIdx >= 0) {
      historyItems[existingIdx] = item;
    } else {
      historyItems = [item, ...historyItems];
    }

    setSelected(item.id);
    restoreFromItem(item);
    renderHistory();
  } catch (e) {
    console.error('[COVER-LETTER] Generate failed:', e);
    const code = e?.data?.error || e?.message || 'server_error';
    if (e?.status === 403 && code === 'not_authorized') {
      alert('This feature is available on Pro and Premium plans only.');
    } else {
      alert('Could not generate a cover letter. Please try again.');
    }
  } finally {
    setGeneratingUI(false);
  }
}

const autosave = debounce(async (id, text) => {
  const targetId = String(id || '').trim();
  if (!targetId) return;

  const nextText = String(text || '');

  // Only update the UI indicator for the currently selected item.
  if (selectedId === targetId) setSaveIndicator('saving', 'Saving…');

  try {
    const data = await apiFetch(`/api/cover-letter/history/${encodeURIComponent(targetId)}`, {
      method: 'PATCH',
      body: JSON.stringify({ coverLetterText: nextText })
    });

    const updated = data?.item;
    if (updated?.id) {
      const idx = historyItems.findIndex((x) => x.id === updated.id);
      if (idx >= 0) historyItems[idx] = updated;
      renderHistory();
    }

    if (selectedId === targetId) setSaveIndicator('saved', 'Saved');
  } catch (e) {
    console.warn('[COVER-LETTER] Autosave failed:', e);
    if (selectedId === targetId) setSaveIndicator('error', 'Couldn’t save');
  }
}, 800);

async function renameHistoryItem(id, newTitle) {
  const title = String(newTitle || '').trim();
  if (!id) return null;
  const data = await apiFetch(`/api/cover-letter/history/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify({ title })
  });
  return data?.item || null;
}

function startInlineRename(rowEl, item) {
  const titleEl = rowEl.querySelector('[data-title]');
  if (!titleEl) return;

  const original = item.title || item.role || 'Cover Letter';
  const input = document.createElement('input');
  input.className = 'cl-rename-input';
  input.value = original;
  input.setAttribute('aria-label', 'Rename cover letter');

  titleEl.replaceWith(input);
  input.focus();
  input.select();

  let committed = false;
  const commit = async () => {
    if (committed) return;
    committed = true;

    const next = String(input.value || '').trim() || original;
    try {
      const updated = await renameHistoryItem(item.id, next);
      if (updated?.id) {
        const idx = historyItems.findIndex((x) => x.id === updated.id);
        if (idx >= 0) historyItems[idx] = updated;
      }
      renderHistory();
    } catch (e) {
      console.warn('[COVER-LETTER] Rename failed:', e);
      renderHistory();
    }
  };

  input.addEventListener('blur', commit);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      renderHistory();
    }
  });
}

async function deleteHistoryItem(id) {
  await apiFetch(`/api/cover-letter/history/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

async function handleDeleteConfirm() {
  const id = pendingDeleteId;
  if (!id) return;

  try {
    await deleteHistoryItem(id);
    // If deleted item was selected, clear selection + preview
    if (selectedId === id) {
      selectedId = null;
      if (els.preview) els.preview.value = '';
      setSaveIndicator(null, '');
    }
    closeDeleteModal();
    await fetchHistory();
  } catch (e) {
    console.warn('[COVER-LETTER] Delete failed:', e);
    closeDeleteModal();
    alert('Could not delete this item. Please try again.');
  }
}

async function copyPreview() {
  const text = String(els.preview?.value || '').trim();
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    const btn = els.copy;
    if (btn) {
      const old = btn.textContent;
      btn.textContent = 'Copied';
      setTimeout(() => (btn.textContent = old), 900);
    }
  } catch (e) {
    console.warn('[COVER-LETTER] Clipboard blocked:', e);
    alert('Clipboard access was blocked by your browser.');
  }
}

function downloadPdf() {
  // Matches Interview Questions page behavior.
  // Print CSS ensures only the preview prints cleanly.
  const item = getSelectedItem();
  const prevTitle = document.title;
  if (item?.title) {
    document.title = item.title;
  }
  window.print();
  // Restore title shortly after print dialog opens.
  setTimeout(() => {
    document.title = prevTitle;
  }, 500);
}

function initRoleSelector() {
  let attempts = 0;
  const MAX_ATTEMPTS = 50;

  const tryInit = () => {
    const input = els.role;
    if (!input) return;
    if (!window.RoleSelector) {
      if (attempts++ < MAX_ATTEMPTS) return void setTimeout(tryInit, 200);
      console.warn('[COVER-LETTER] RoleSelector not available after max attempts');
      return;
    }

    if (input.dataset.roleSelectorInitialized) return;
    try {
      new window.RoleSelector(input, {
        placeholder: input.getAttribute('placeholder') || '',
        minChars: 2,
        maxResults: 8,
        showCustomOption: true,
        onSelect: () => {
          // no-op; input value already updated
        }
      });
      input.dataset.roleSelectorInitialized = 'true';
    } catch (e) {
      console.warn('[COVER-LETTER] Failed to init RoleSelector:', e);
      if (attempts++ < MAX_ATTEMPTS) return void setTimeout(tryInit, 400);
    }
  };

  setTimeout(tryInit, 0);
}

function bindEvents() {
  els.form?.addEventListener('submit', (e) => {
    e.preventDefault();
    generateCoverLetter();
  });

  els.reset?.addEventListener('click', () => {
    clearForm();
  });

  els.refresh?.addEventListener('click', () => {
    fetchHistory();
  });

  els.preview?.addEventListener('input', () => {
    if (!selectedId) return;
    autosave(selectedId, els.preview?.value || '');
  });

  els.copy?.addEventListener('click', copyPreview);
  els.download?.addEventListener('click', downloadPdf);

  els.modalBackdrop?.addEventListener('click', closeDeleteModal);
  els.deleteCancel?.addEventListener('click', closeDeleteModal);
  els.deleteConfirm?.addEventListener('click', handleDeleteConfirm);

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (pendingDeleteId) closeDeleteModal();
    }
  });
}

function initElements() {
  els.form = $('#cl-form');
  els.role = $('#cl-role');
  els.company = $('#cl-company');
  els.seniority = $('#cl-seniority');
  els.tone = $('#cl-tone');
  els.jobDescription = $('#cl-job-description');
  els.resumeText = $('#cl-resume-text');
  els.generate = $('#cl-generate');
  els.reset = $('#cl-reset');
  els.preview = $('#cl-preview');
  els.previewSkeleton = $('#cl-preview-skeleton');
  els.saveIndicator = $('#cl-save-indicator');
  els.copy = $('#cl-copy');
  els.download = $('#cl-download');
  els.historyList = $('#cl-history-list');
  els.historyLoading = $('#cl-history-loading');
  els.historyEmpty = $('#cl-history-empty');
  els.refresh = $('#cl-history-refresh');
  els.modalBackdrop = $('#cl-modal-backdrop');
  els.deleteModal = $('#cl-delete-modal');
  els.deleteCancel = $('#cl-delete-cancel');
  els.deleteConfirm = $('#cl-delete-confirm');
}

async function init() {
  initElements();
  updatePlanBadge();
  window.addEventListener('planChanged', updatePlanBadge);

  bindEvents();
  initRoleSelector();

  // Wait for auth once so we can fetch history.
  // (Static auth guard should already redirect unauthenticated users.)
  try {
    await waitForFirebaseUser();
  } catch (_) {
    // ignore
  }

  // Small delay to reduce race with firebase-auth init on cold loads
  await sleep(50);
  await fetchHistory();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

