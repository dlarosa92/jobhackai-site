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

function escapeHtmlAttr(text) {
  const div = document.createElement('div');
  div.textContent = String(text ?? '');
  // Escape quotes for use in HTML attributes
  return div.innerHTML.replace(/"/g, '&quot;').replace(/'/g, '&#x27;');
}

function timeAgo(dateInput) {
  let ts = 0;
  
  // Handle timestamp (number in milliseconds)
  if (typeof dateInput === 'number' && Number.isFinite(dateInput)) {
    ts = dateInput;
  } 
  // Handle date string (SQLite datetime format: "YYYY-MM-DD HH:MM:SS" or ISO format)
  else if (typeof dateInput === 'string' && dateInput.trim()) {
    // Normalize SQLite datetime to ISO format for Safari compatibility
    const normalized = dateInput.replace(' ', 'T');
    const date = new Date(normalized);
    if (!isNaN(date.getTime())) {
      ts = date.getTime();
    }
  }
  
  if (!ts) return '';
  
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
  if (p === 'essential') return { label: 'Essential Plan', plan: 'essential' };
  if (p === 'trial') return { label: 'Trial Plan', plan: 'trial' };
  if (p === 'free') return { label: 'Free Plan', plan: 'free' };
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

// HistoryPanel v1 state
let _historyManageMode = false;
let _historySelectedIds = new Set();
let _historyPendingDeleteIds = [];
let _historyMenuOpenForId = null;
let _historyHasError = false;

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
  historyError: null,
  refresh: null,
  modalBackdrop: null,
  deleteModal: null,
  deleteCancel: null,
  deleteConfirm: null,
  historyManage: null,
  historyCancelManage: null,
  historyDeleteSelected: null,
  historyClear: null,
  historyRetry: null
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

function setHistoryLoading(isLoading) {
  const loadingEl = els.historyLoading;
  if (!loadingEl) return;
  loadingEl.classList.toggle('is-visible', !!isLoading);
}

function showHistoryEmpty(show) {
  if (!els.historyEmpty) return;
  els.historyEmpty.hidden = !show;
}

function setHistoryErrorVisible(isVisible, message) {
  const errEl = els.historyError;
  if (!errEl) return;
  const textEl = errEl.querySelector('span[data-default-message]') || errEl.querySelector('span');
  if (textEl) {
    if (message) {
      textEl.textContent = message;
    } else if (textEl.dataset.defaultMessage) {
      textEl.textContent = textEl.dataset.defaultMessage;
    }
  }
  errEl.hidden = !isVisible;
  _historyHasError = isVisible;
}

function getVisibleHistoryItems(items) {
  // UI spec: show last 10
  return (items || []).slice(0, 10);
}

function getVisibleHistoryIds() {
  return getVisibleHistoryItems(historyItems)
    .map((x) => String(x?.id || ''))
    .filter(Boolean);
}

function setHistoryManageMode(next) {
  const panel = $('#cl-history-panel');
  const titleEl = $('#cl-history-header-title');
  _historyManageMode = !!next;
  if (panel) {
    panel.classList.toggle('cl-history-panel--manage', _historyManageMode);
  }
  if (titleEl) {
    titleEl.textContent = _historyManageMode ? 'Select items' : 'History';
  }
  if (!_historyManageMode) {
    _historySelectedIds.clear();
    _historyMenuOpenForId = null;
  }
  syncBulkDeleteState();
  // Re-render list so checkboxes/menus match mode
  renderHistory();
}

function syncBulkDeleteState() {
  const btn = els.historyDeleteSelected;
  if (!btn) return;
  btn.disabled = _historySelectedIds.size < 1;
}

function closeAllHistoryMenus() {
  const listEl = els.historyList;
  if (!listEl) return;
  listEl.querySelectorAll('.cl-history-menu').forEach((menu) => {
    menu.hidden = true;
  });
  _historyMenuOpenForId = null;
}

function openDeleteModalFor(ids) {
  const unique = Array.from(new Set((ids || []).map(String).filter(Boolean)));
  if (!unique.length) {
    _historyPendingDeleteIds = [];
    return;
  }
  _historyPendingDeleteIds = unique;

  const backdrop = els.modalBackdrop;
  const modal = els.deleteModal;
  const cancelBtn = els.deleteCancel;
  if (backdrop) backdrop.hidden = false;
  if (modal) modal.hidden = false;
  // Default focus: Cancel
  setTimeout(() => cancelBtn?.focus?.(), 0);
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
  selectedId = id != null ? String(id) : null;
  $$('.cl-history-item').forEach((row) => {
    row.classList.toggle('is-selected', row.dataset.id === selectedId);
  });
}

function getSelectedItem() {
  if (!selectedId) return null;
  return historyItems.find((it) => String(it.id) === selectedId) || null;
}

function readFormInputs() {
  // Capitalize seniority to match backend expectations (dropdown uses lowercase values)
  const seniorityRaw = String(els.seniority?.value || '').trim();
  const seniority = seniorityRaw 
    ? seniorityRaw.charAt(0).toUpperCase() + seniorityRaw.slice(1).toLowerCase()
    : '';
  
  return {
    role: String(els.role?.value || '').trim(),
    company: String(els.company?.value || '').trim(),
    seniority,
    tone: String(els.tone?.value || '').trim() || 'Confident + Professional',
    jobDescription: String(els.jobDescription?.value || '').trim(),
    resumeText: String(els.resumeText?.value || '').trim()
  };
}

function restoreFromItem(item) {
  if (!item) return;
  if (els.role) els.role.value = item.role || '';
  if (els.company) els.company.value = item.company || '';
  // Normalize seniority to lowercase to match dropdown values (handles old capitalized values)
  if (els.seniority) {
    const seniority = String(item.seniority || '').trim().toLowerCase();
    els.seniority.value = seniority;
  }
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
  openDeleteModalFor([id]);
}

function closeDeleteModal() {
  _historyPendingDeleteIds = [];
  pendingDeleteId = null;
  if (els.modalBackdrop) els.modalBackdrop.hidden = true;
  if (els.deleteModal) els.deleteModal.hidden = true;
}

function renderHistory() {
  const listEl = els.historyList;
  const emptyEl = els.historyEmpty;
  
  if (!listEl) return;
  
  // Always hide loading when rendering
  setHistoryLoading(false);
  
  if (!historyItems || historyItems.length === 0) {
    listEl.innerHTML = '';
    if (emptyEl) {
      emptyEl.hidden = _historyHasError ? true : false;
    }
    return;
  }
  
  if (emptyEl) emptyEl.hidden = true;
  
  const visibleItems = getVisibleHistoryItems(historyItems);

  listEl.innerHTML = visibleItems.map(item => {
    const itemId = String(item?.id || '');
    const roleName = String(item?.role || '').trim() || 'Untitled role';
    const when = timeAgo(item.createdAt) || '—';
    const secondaryLine = `Cover letter • ${when}`;

    const isCurrent = !_historyManageMode && selectedId && String(selectedId) === itemId;
    const isSelected = isCurrent ? 'is-selected' : '';
    const isChecked = _historySelectedIds.has(itemId);

    const menuHidden = _historyMenuOpenForId !== itemId;

    return `
      <div class="cl-history-item ${isSelected}" data-id="${escapeHtml(itemId)}" tabindex="0" data-history-row>
        <span class="cl-history-checkbox-wrap" aria-hidden="${_historyManageMode ? 'false' : 'true'}">
          <input
            class="cl-history-checkbox"
            type="checkbox"
            data-action="toggle-select"
            data-id="${escapeHtml(itemId)}"
            aria-label="Select ${escapeHtmlAttr(roleName)}"
            ${isChecked ? 'checked' : ''}
          />
        </span>

        <div class="cl-history-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
            <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
            <polyline points="14 2 14 8 20 8"/>
            <line x1="16" y1="13" x2="8" y2="13"/>
            <line x1="16" y1="17" x2="8" y2="17"/>
          </svg>
        </div>

        <div class="cl-history-text">
          <div class="cl-history-line1">${escapeHtml(roleName)}</div>
          <div class="cl-history-line2">${escapeHtml(secondaryLine)}</div>
        </div>

        <div class="cl-history-row-actions" aria-label="Row actions">
          <button
            class="cl-history-kebab"
            type="button"
            aria-label="Row actions"
            data-action="menu-toggle"
            data-id="${escapeHtml(itemId)}"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <circle cx="5" cy="12" r="2"></circle>
              <circle cx="12" cy="12" r="2"></circle>
              <circle cx="19" cy="12" r="2"></circle>
            </svg>
          </button>
          <div class="cl-history-menu" role="menu" ${menuHidden ? 'hidden' : ''}>
            <button class="cl-history-menu-item" type="button" data-action="open" data-id="${escapeHtml(itemId)}">Open / Restore</button>
            <button class="cl-history-menu-item cl-history-menu-item--danger" type="button" data-action="delete" data-id="${escapeHtml(itemId)}">Delete</button>
          </div>
        </div>
      </div>
    `;
  }).join('');

  // Attach event listeners
  listEl.querySelectorAll('[data-history-row]').forEach((row) => {
    const itemId = row.dataset.id;
    const item = historyItems.find((x) => String(x.id) === itemId);
    if (!item) return;

    const onSelect = () => {
      if (_historyManageMode) return;
      const chosen = historyItems.find((x) => String(x.id) === itemId);
      if (!chosen) return;
      setSelected(item.id);
      restoreFromItem(chosen);
    };

    row.addEventListener('click', (e) => {
      const actionEl = e.target.closest('[data-action]');
      if (actionEl) {
        const action = actionEl.dataset.action;
        if (action === 'toggle-select') {
          e.stopPropagation();
          const checkbox = actionEl;
          if ((checkbox instanceof HTMLInputElement) && checkbox.type === 'checkbox') {
            if (checkbox.checked) {
              _historySelectedIds.add(itemId);
            } else {
              _historySelectedIds.delete(itemId);
            }
            syncBulkDeleteState();
            renderHistory();
          }
          return;
        }
        if (action === 'menu-toggle') {
          e.stopPropagation();
          const previouslyOpen = _historyMenuOpenForId;
          closeAllHistoryMenus();
          _historyMenuOpenForId = previouslyOpen === itemId ? null : itemId;
          renderHistory();
          return;
        }
        if (action === 'open') {
          e.stopPropagation();
          closeAllHistoryMenus();
          onSelect();
          return;
        }
        if (action === 'delete') {
          e.stopPropagation();
          closeAllHistoryMenus();
          openDeleteModalFor([itemId]);
          return;
        }
        return;
      }
      if (_historyManageMode) {
        // In manage mode, clicking row toggles checkbox
        const checkbox = row.querySelector('.cl-history-checkbox');
        if (checkbox) {
          checkbox.checked = !checkbox.checked;
          if (checkbox.checked) {
            _historySelectedIds.add(itemId);
          } else {
            _historySelectedIds.delete(itemId);
          }
          syncBulkDeleteState();
          renderHistory();
        }
      } else {
        onSelect();
      }
    });

    row.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        if (_historyManageMode) {
          const checkbox = row.querySelector('.cl-history-checkbox');
          if (checkbox) {
            checkbox.checked = !checkbox.checked;
            if (checkbox.checked) {
              _historySelectedIds.add(itemId);
            } else {
              _historySelectedIds.delete(itemId);
            }
            syncBulkDeleteState();
            renderHistory();
          }
        } else {
          onSelect();
        }
      }
    });
  });
}

async function fetchHistory() {
  if (isLoadingHistory) return;
  isLoadingHistory = true;
  setHistoryLoading(true);
  setHistoryErrorVisible(false);
  showHistoryEmpty(false);
  if (els.historyList) els.historyList.innerHTML = '';

  try {
    const data = await apiFetch('/api/cover-letter/history?limit=10', { method: 'GET' });
    historyItems = Array.isArray(data?.items) ? data.items : [];

    // Keep selected if present; if not, clear selection
    if (selectedId && !historyItems.some((x) => String(x.id) === selectedId)) {
      selectedId = null;
    }

    setHistoryLoading(false);
    renderHistory();
  } catch (e) {
    console.warn('[COVER-LETTER] Failed to load history:', e);
    historyItems = [];
    setHistoryLoading(false);
    setHistoryErrorVisible(true, "Couldn't load history.");
    renderHistory();
  } finally {
    isLoadingHistory = false;
  }
}

async function generateCoverLetter() {
  if (isGenerating) return;
  const payload = readFormInputs();
  if (!payload.role || !payload.seniority || !payload.jobDescription || !payload.resumeText) {
    // Minimal client-side validation: rely on server for canonical validation.
    alert('Please fill in Target Role, Seniority, Job Description, and Resume Text.');
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


async function deleteHistoryItem(id) {
  await apiFetch(`/api/cover-letter/history/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

async function deleteHistoryItems(ids) {
  const failures = [];
  for (const id of ids) {
    try {
      await deleteHistoryItem(id);
    } catch (e) {
      failures.push({ id, result: { reason: { message: e?.message || 'Delete failed' } } });
    }
  }
  return { failures };
}

async function handleDeleteConfirm() {
  const ids = Array.from(new Set(_historyPendingDeleteIds));
  if (!ids.length) return;

  const confirmBtn = els.deleteConfirm;
  if (confirmBtn) confirmBtn.disabled = true;

  try {
    const { failures } = await deleteHistoryItems(ids);
    ids.forEach((id) => {
      _historySelectedIds.delete(id);
      if (selectedId === id) {
        selectedId = null;
        if (els.preview) els.preview.value = '';
        setSaveIndicator(null, '');
      }
    });
    syncBulkDeleteState();
    closeDeleteModal();
    // Store error state before fetchHistory (which may set its own error)
    const hadErrorBeforeFetch = _historyHasError;
    await fetchHistory();
    // Only clear error if there were no delete failures AND fetchHistory didn't set an error
    if (failures.length) {
      const failureReason = failures[0].result?.reason;
      const failureMessage = failureReason?.message
        || 'Some selected entries could not be deleted. History refreshed to reflect the current state.';
      setHistoryErrorVisible(true, failureMessage);
    } else if (!_historyHasError) {
      // Only clear error if fetchHistory didn't encounter an error
      setHistoryErrorVisible(false);
    }
    // If fetchHistory set an error, leave it visible (don't override it)
  } catch (e) {
    console.warn('[COVER-LETTER] Delete failed:', e);
    closeDeleteModal();
    const failureMessage = e?.message || 'Failed to delete selected history.';
    setHistoryErrorVisible(true, failureMessage);
    await fetchHistory().catch(() => {});
    _historySelectedIds.clear();
    syncBulkDeleteState();
  } finally {
    if (confirmBtn) confirmBtn.disabled = false;
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
  const coverLetterText = String(els.preview?.value || '').trim();
  if (!coverLetterText) return;

  const safeText = escapeHtml(coverLetterText).replace(/\n/g, '<br/>');
  const printHtml = `
    <div class="cl-print-header">
      <div class="cl-print-logo">
        <svg class="cl-print-logo-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <rect x="3" y="7" width="18" height="13" rx="2" ry="2" fill="none" stroke="currentColor" stroke-width="1.8"/>
          <path d="M9 7V5a3 3 0 0 1 6 0v2" fill="none" stroke="currentColor" stroke-width="1.8"/>
        </svg>
        <span>JobHackAI</span>
      </div>
    </div>
    <section class="cl-print-section">
      <div class="cl-print-body">${safeText}</div>
    </section>
  `;

  const existingPrint = document.getElementById('cl-print');
  let printContainer = existingPrint;
  let createdTempPrintContainer = false;

  if (!printContainer) {
    printContainer = document.createElement('div');
    printContainer.id = 'cl-print';
    printContainer.style.display = 'none';
    createdTempPrintContainer = true;
  }

  if (printContainer.parentElement !== document.body) {
    document.body.appendChild(printContainer);
  }

  printContainer.innerHTML = printHtml;

  const item = getSelectedItem();
  const role = String(item?.role || els.role?.value || '').trim();
  const company = String(item?.company || els.company?.value || '').trim();
  const printTitle = role ? (company ? `${role} — ${company}` : role) : 'Cover Letter';

  const prevTitle = document.title;
  document.title = printTitle;
  window.print();
  setTimeout(() => {
    document.title = prevTitle;
    if (createdTempPrintContainer && printContainer && printContainer.parentNode) {
      printContainer.parentNode.removeChild(printContainer);
    } else if (printContainer) {
      printContainer.innerHTML = '';
    }
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

  els.refresh?.addEventListener('click', (e) => {
    e.preventDefault();
    if (_historyManageMode) return;
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

  // History manage mode controls
  els.historyManage?.addEventListener('click', (e) => {
    e.preventDefault();
    setHistoryManageMode(true);
  });

  els.historyCancelManage?.addEventListener('click', (e) => {
    e.preventDefault();
    setHistoryManageMode(false);
  });

  els.historyDeleteSelected?.addEventListener('click', (e) => {
    e.preventDefault();
    if (_historySelectedIds.size < 1) return;
    openDeleteModalFor(Array.from(_historySelectedIds));
  });

  // Retention footer: Clear history
  els.historyClear?.addEventListener('click', (e) => {
    e.preventDefault();
    const ids = getVisibleHistoryIds();
    if (!ids.length) {
      return;
    }
    if (!_historyManageMode) setHistoryManageMode(true);
    _historySelectedIds = new Set(ids);
    syncBulkDeleteState();
    renderHistory();
    openDeleteModalFor(ids);
  });

  // Retry link
  els.historyRetry?.addEventListener('click', (e) => {
    e.preventDefault();
    fetchHistory();
  });

  // Focus trap + ESC close for modal
  const modal = els.deleteModal;
  if (modal && !modal.dataset.bound) {
    modal.dataset.bound = '1';
    modal.addEventListener('keydown', function(e) {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeDeleteModal();
        return;
      }
      if (e.key !== 'Tab') return;
      const focusables = modal.querySelectorAll('button,[href],input,select,textarea,[tabindex]:not([tabindex="-1"])');
      const list = Array.from(focusables).filter((el) => !el.disabled && el.offsetParent !== null);
      if (!list.length) return;
      const first = list[0];
      const last = list[list.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    });
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const backdropEl = els.modalBackdrop;
      if (backdropEl && !backdropEl.hidden) {
        closeDeleteModal();
      }
    }
  });

  // Close menus when clicking outside
  document.addEventListener('click', (e) => {
    if (!_historyManageMode && _historyMenuOpenForId) {
      const menu = els.historyList?.querySelector('.cl-history-menu:not([hidden])');
      if (menu && !menu.contains(e.target)) {
        closeAllHistoryMenus();
        renderHistory();
      }
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
  els.historyError = $('#cl-history-error');
  els.refresh = $('#cl-history-refresh');
  els.modalBackdrop = $('#cl-modal-backdrop');
  els.deleteModal = $('#cl-delete-modal');
  els.deleteCancel = $('#cl-delete-cancel');
  els.deleteConfirm = $('#cl-delete-confirm');
  els.historyManage = $('#cl-history-manage');
  els.historyCancelManage = $('#cl-history-cancel-manage');
  els.historyDeleteSelected = $('#cl-history-delete-selected');
  els.historyClear = $('#cl-history-clear');
  els.historyRetry = $('#cl-history-retry');
}

// Wait for navigation system before updating badge
// CRITICAL FIX: window.JobHackAINavigation exists at module load time, but navigation isn't initialized
// until initializeNavigation() completes and dispatches navigationReady event
// We must wait for navigationReady event, not just check if the function exists
function initPlanBadge() {
  // Always wait for navigationReady event to ensure navigation is fully initialized
  // This ensures getEffectivePlan() reads from the correct source (not stale localStorage)
  if (window.JobHackAINavigation?.getEffectivePlan) {
    // Navigation.js has loaded, but may not be initialized yet
    // Check if navigationReady has already fired
    const navigationReadyFired = window.__navigationReadyFired || false;
    if (navigationReadyFired) {
      // Navigation already initialized, safe to update badge immediately
      updatePlanBadge();
    } else {
      // Wait for navigationReady event
      window.addEventListener('navigationReady', updatePlanBadge, { once: true });
    }
  } else {
    // Navigation.js hasn't loaded yet, wait for navigationReady
    window.addEventListener('navigationReady', updatePlanBadge, { once: true });
  }
}

async function init() {
  initElements();
  initPlanBadge();
  window.addEventListener('planChanged', updatePlanBadge);

  // Safety: ensure delete modal/backdrop are never stuck visible on cold load
  // (CSS may override the browser's default [hidden] behavior).
  closeDeleteModal();

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
