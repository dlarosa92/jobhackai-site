import { showToast } from './modals.js';

// LinkedIn Optimizer (MVP) - Premium-only, D1-backed history
// - Left: Inputs + Results
// - Right: History (last 10)
// - Download PDF: window.print() with print-only container

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

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

function formatDateISO(tsMs) {
  try {
    const d = new Date(Number(tsMs || Date.now()));
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  } catch {
    return new Date().toISOString().split('T')[0];
  }
}

async function waitForFirebaseUser() {
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

function getAuthState() {
  return window.JobHackAINavigation?.getAuthState?.() || {
    isAuthenticated: localStorage.getItem('user-authenticated') === 'true' && !!localStorage.getItem('user-email')
  };
}

function getEffectivePlan() {
  return window.JobHackAINavigation?.getEffectivePlan?.() || (localStorage.getItem('user-plan') || 'free');
}

const els = {
  app: null,
  locked: null,
  lockedInner: null,
  login: null,
  upgrade: null,
  form: null,
  role: null,
  headline: null,
  summary: null,
  experience: null,
  skills: null,
  recommendations: null,
  btnAnalyze: null,
  btnStartFresh: null,
  loading: null,
  results: null,
  scoreText: null,
  scoreRing: null,
  meta: null,
  planPill: null,
  quickWins: null,
  keywords: null,
  sections: null,
  btnDownload: null,
  historyList: null,
  historyEmpty: null,
  print: null
};

let currentRun = null; // { run_id, created_at, updated_at, role, overallScore, keywordsToAdd, quickWins, sections }
let historyItems = [];
let selectedHistoryId = null;
let isAnalyzing = false;
let currentAnalysisId = null; // Unique ID for in-flight analysis, used to guard against stale responses
const regenBusy = new Set(); // section keys
const regenCounts = new Map();
// Serialize regenerations across sections to avoid branching from the same base run_id
// and overwriting each other's changes when responses return out of order.
let regenQueue = Promise.resolve();
let currentRegenRunId = null; // Run ID for in-flight regeneration, used to guard against stale regeneration responses
let unlockedInitialized = false;

// HistoryPanel v1 state
let _historyManageMode = false;
let _historySelectedIds = new Set();
let _historyPendingDeleteIds = [];
let _historyMenuOpenForId = null;
let _historyHasError = false;

function setLockedView(kind) {
  // kind: 'none'|'login'|'upgrade'
  if (!els.locked || !els.app) return;
  if (kind === 'none') {
    els.locked.style.display = 'none';
    els.app.style.display = '';
    return;
  }
  els.locked.style.display = 'block';
  els.app.style.display = 'none';
  els.login.hidden = kind !== 'login';
  els.upgrade.hidden = kind !== 'upgrade';
}

function setLoading(on, text) {
  if (!els.loading) return;
  els.loading.style.display = on ? 'flex' : 'none';
  const label = $('#lo-loading-text');
  if (label && text) label.textContent = text;
  if (els.btnAnalyze) els.btnAnalyze.disabled = !!on;
}

function setResultsVisible(on) {
  // Ensure results element is available even if init() hasn't wired els.results yet
  if (!els.results) {
    els.results = document.querySelector('#lo-results');
  }
  if (!els.results) {
    console.warn('[LINKEDIN] setResultsVisible: #lo-results element not found in DOM');
    return;
  }
  els.results.style.display = on ? 'block' : 'none';
}

function resetForm() {
  // Clear all form fields
  if (els.role) els.role.value = '';
  if (els.headline) els.headline.value = '';
  if (els.summary) els.summary.value = '';
  if (els.experience) els.experience.value = '';
  if (els.skills) els.skills.value = '';
  if (els.recommendations) els.recommendations.value = '';
  
  // Hide results
  setResultsVisible(false);
  
  // Clear state
  currentRun = null;
  selectedHistoryId = null;
  // Cancel any in-flight analysis by clearing the analysis ID
  // This prevents stale analyze() responses from rendering results after reset
  currentAnalysisId = null;
  // Reset analyzing flag to allow new analysis to start immediately
  isAnalyzing = false;
  
  // Cancel any in-flight regenerations
  // Clear regeneration tracking to prevent stale regeneration responses from reappearing
  regenBusy.clear();
  currentRegenRunId = null;
  // Reset regenQueue to a fresh promise to cancel any queued regenerations
  regenQueue = Promise.resolve();
  
  // Re-render history to remove active state
  renderHistory();
  
  // Clear any loading state
  setLoading(false);
  
  // Reset score ring to 0
  setScoreRing(0);
  
  // Focus on role field for better UX
  els.role?.focus();
}

function setScoreRing(score) {
  const s = Math.max(0, Math.min(100, Number(score || 0)));
  if (els.scoreText) els.scoreText.textContent = String(Math.round(s));
  if (els.scoreRing) {
    const radius = 36;
    const circumference = 2 * Math.PI * radius;
    const progress = s / 100;
    const offset = circumference * (1 - progress);
    els.scoreRing.setAttribute('stroke-dasharray', String(circumference.toFixed(1)));
    els.scoreRing.setAttribute('stroke-dashoffset', String(offset.toFixed(1)));
  }
}

function getRecruiterBoostLabel(score) {
  const s = Math.max(0, Math.min(100, Number(score || 0)));
  if (s >= 80) return 'High recruiter visibility';
  if (s >= 60) return 'Moderate recruiter visibility';
  return 'Limited recruiter visibility';
}

function setPlanPill(plan) {
  if (!els.planPill) return;
  const normalized = String(plan || 'free').toLowerCase();
  const label = normalized === 'premium' ? 'Premium' : normalized === 'free' ? 'Free' : normalized;
  els.planPill.textContent = label;
  els.planPill.dataset.plan = normalized;
  els.planPill.classList.toggle('lo-plan-pill--premium', normalized === 'premium');
  els.planPill.classList.toggle('lo-plan-pill--free', normalized !== 'premium');
}

function buildScoreMeta(run) {
  if (!run) return '';
  const when = run.created_at ? timeAgo(run.created_at) : '';
  const parts = [
    getRecruiterBoostLabel(run.overallScore),
    run.role || '',
    when
  ].filter(Boolean);
  let meta = escapeHtml(parts.join(' • '));
  if (run.deduped) {
    meta += ' <span class="lo-dedupe-note" title="We found a previous run with the same inputs, so we reused that result.">Loaded from history</span>';
  } else if (run.loadedFromHistory) {
    meta += ' <span class="lo-dedupe-note" title="Loaded from your saved runs.">Loaded from your saved runs</span>';
  }
  return meta;
}

function renderQuickWins(arr) {
  if (!els.quickWins) return;
  const wins = Array.isArray(arr) ? arr.slice(0, 3) : [];
  const labels = ['Biggest win', 'Biggest weakness', 'Fastest improvement'];
  if (!wins.length) {
    els.quickWins.innerHTML = '<li class="lo-quickwin-placeholder">No quick wins available yet.</li>';
    return;
  }
  els.quickWins.innerHTML = wins
    .map((w, idx) => `<li><strong>${labels[idx]}:</strong> ${escapeHtml(w)}</li>`)
    .join('');
}

function renderKeywordChips(arr) {
  if (!els.keywords) return;
  const keywords = Array.isArray(arr) ? arr.slice(0, 10) : [];
  if (!keywords.length) {
    els.keywords.innerHTML = '<span class="lo-chip-placeholder">No additional keywords recommended for this run.</span>';
    return;
  }
  els.keywords.innerHTML = keywords
    .map((k) => `<span class="lo-chip" data-keyword="${escapeHtml(k)}" title="Click to copy">${escapeHtml(k)}</span>`)
    .join('');
}

function sectionTitle(key) {
  if (key === 'headline') return 'Headline';
  if (key === 'summary') return 'Summary';
  if (key === 'experience') return 'Experience';
  if (key === 'skills') return 'Skills';
  if (key === 'recommendations') return 'Recommendations';
  return key;
}

function updateSummaryText(button, isVisible) {
  if (isVisible) {
    button.textContent = 'Hide optimized';
  } else {
    button.textContent = 'View optimized (Before & After)';
  }
}

function attachDetailsListeners() {
  const toggleButtons = document.querySelectorAll('[data-action="toggle-optimized"]');
  toggleButtons.forEach(button => {
    const section = button.dataset.section;
    const content = document.querySelector(`[data-optimized-content="${section}"]`);
    if (!content) return;
    
    // Set initial text based on visibility
    const isVisible = !content.hidden;
    updateSummaryText(button, isVisible);
    
    // Toggle visibility and update text
    button.addEventListener('click', () => {
      content.hidden = !content.hidden;
      updateSummaryText(button, !content.hidden);
    });
  });
}

function renderSections(sections, originalInputsOverride) {
  if (!els.sections) return;
  const keys = ['headline', 'summary', 'experience', 'skills', 'recommendations'];
  const present = keys.filter((k) => sections && sections[k]);
  // Use provided originalInputs if available, otherwise fall back to currentRun
  // This prevents race conditions where currentRun changes between capture and render
  const originalInputs = originalInputsOverride || currentRun?.originalInputs || {};

  els.sections.innerHTML = present
    .map((k) => {
      const s = sections[k];
      const score = Math.round(Number(s.score || 0));
      const label = String(s.label || '');
      const bullets = Array.isArray(s.feedbackBullets) ? s.feedbackBullets.slice(0, 3) : [];
      const optimized = String(s.optimizedText || '').trim();
      const busy = regenBusy.has(k);
      const original = String(originalInputs[k] || '').trim();
      const hasBefore = Boolean(original);
      const beforeBlock = hasBefore
        ? `
            <div>
              <div class="lo-before-after-label">Before</div>
              <div class="lo-before-text">${escapeHtml(original)}</div>
            </div>
          `
        : '';
      const regenCount = regenCounts.get(k) || 0;
      const showTip = regenCount >= 3 && !busy;

      return `
        <section class="lo-card" data-section="${k}">
          <div class="lo-section-header">
            <div>
              <div class="lo-section-header-row">
                <span class="lo-card-title lo-section-title">${escapeHtml(sectionTitle(k))}</span>
                <span class="lo-badge">${score}/100</span>
              </div>
              <div class="lo-section-label">${escapeHtml(label)}</div>
            </div>
          </div>

          <div class="lo-helper-text">Why this section matters</div>
          <ul class="lo-feedback">
            ${bullets.map((b) => `<li>${escapeHtml(b)}</li>`).join('')}
          </ul>

          <div class="lo-optimized-content" data-optimized-content="${k}" hidden>
            <div class="lo-before-after">
              ${beforeBlock}
              <div>
                <div class="lo-before-after-label">After (paste-ready)</div>
                <div class="lo-after-text" id="lo-optimized-${k}">${escapeHtml(optimized)}</div>
              </div>
            </div>
          </div>
          
          <div class="lo-section-actions">
            <button class="btn-outline" type="button" data-action="toggle-optimized" data-section="${k}">
              View optimized (Before & After)
            </button>
            <button class="btn-outline" type="button" data-action="copy" data-section="${k}" data-copy-target="lo-optimized-${k}">
              Copy Optimized
            </button>
            <button class="btn-outline ${busy ? 'lo-btn-loading' : ''}" type="button" data-action="regen" data-section="${k}">
              ${busy ? 'Regenerating…' : 'Regenerate'}
            </button>
          </div>
          ${showTip ? '<div class="lo-section-tip">Tip: For a bigger change, tweak the original text above and regenerate.</div>' : ''}
        </section>
      `;
    })
    .join('');
  
  // Attach listeners after rendering
  attachDetailsListeners();
}

function renderResults(run) {
  console.info('[LINKEDIN DEBUG] renderResults payload', {
    runId: run?.run_id,
    sectionsKeys: run?.sections ? Object.keys(run.sections) : null,
    sectionSamples: run?.sections
      ? Object.fromEntries(
          Object.entries(run.sections)
            .slice(0, 3)
            .map(([k, v]) => [k, { score: v?.score, optimizedText: String(v?.optimizedText || '').slice(0, 80) }])
        )
      : null
  });
  const prevRunId = currentRun?.run_id;
  currentRun = run;
  if (prevRunId !== run?.run_id) {
    regenCounts.clear();
  }
  if (!run) {
    setResultsVisible(false);
    return;
  }
  setResultsVisible(true);
  setScoreRing(run.overallScore);
  if (els.meta) {
    els.meta.innerHTML = buildScoreMeta(run);
  }
  renderQuickWins(run.quickWins);
  renderKeywordChips(run.keywordsToAdd);
  renderSections(run.sections || {});
}

function getVisibleHistoryItems(items) {
  // UI spec: show last 10
  return (items || []).slice(0, 10);
}

function setHistoryLoading(on) {
  const loadingEl = document.getElementById('lo-history-loading');
  if (loadingEl) {
    loadingEl.classList.toggle('is-visible', !!on);
  }
}

function setHistoryErrorVisible(on, message) {
  const errorEl = document.getElementById('lo-history-error');
  _historyHasError = !!on;
  if (errorEl) {
    errorEl.hidden = !on;
    const defaultMsg = errorEl.querySelector('[data-default-message]');
    if (defaultMsg && message) {
      defaultMsg.textContent = message;
    }
  }
}

function setHistoryManageMode(next) {
  const panel = document.getElementById('lo-history-panel');
  const titleEl = document.getElementById('lo-history-header-title');
  _historyManageMode = !!next;
  if (panel) {
    panel.classList.toggle('lo-history-panel--manage', _historyManageMode);
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
  const deleteBtn = document.getElementById('lo-history-delete-selected');
  if (deleteBtn) {
    deleteBtn.disabled = _historySelectedIds.size === 0;
  }
}

function closeAllHistoryMenus() {
  _historyMenuOpenForId = null;
}

function renderHistory() {
  const listEl = document.getElementById('lo-history-list');
  const emptyEl = document.getElementById('lo-history-empty');
  
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
    const roleName = String(item?.role || '').trim() || 'LinkedIn optimization';
    const when = timeAgo(item?.createdAt) || '—';

    // Prevent null from being coerced into a valid 0 score.
    const normalizedScore = item?.overallScore != null && Number.isFinite(Number(item.overallScore))
      ? Number(item.overallScore)
      : null;

    const isCurrent = !_historyManageMode && selectedHistoryId && String(selectedHistoryId) === itemId;
    const isSelected = isCurrent ? 'is-selected' : '';
    const isChecked = _historySelectedIds.has(itemId);

    const scoreHtml = normalizedScore !== null
      ? `<div class="lo-history-score" aria-label="Score ${Math.round(normalizedScore)}">${Math.round(normalizedScore)}</div>`
      : '';

    const menuHidden = _historyMenuOpenForId !== itemId;

    // Row secondary template: "{visibilityLabel} • {relativeDate}" or fallback "LinkedIn optimization • {relativeDate}"
    const visibilityLabel = normalizedScore !== null ? getRecruiterBoostLabel(normalizedScore) : '';
    const secondaryLine = visibilityLabel 
      ? `${escapeHtml(visibilityLabel)} • ${escapeHtml(when)}`
      : `LinkedIn optimization • ${escapeHtml(when)}`;

    return `
      <div class="lo-history-item ${isSelected}" data-id="${escapeHtml(itemId)}" tabindex="0" data-history-row>
        <span class="lo-history-checkbox-wrap" aria-hidden="${_historyManageMode ? 'false' : 'true'}">
          <input
            class="lo-history-checkbox"
            type="checkbox"
            data-action="toggle-select"
            data-id="${escapeHtml(itemId)}"
            aria-label="Select ${escapeHtml(roleName)}"
            ${isChecked ? 'checked' : ''}
          />
        </span>

        <div class="lo-history-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
            <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
            <polyline points="14 2 14 8 20 8"/>
            <line x1="16" y1="13" x2="8" y2="13"/>
            <line x1="16" y1="17" x2="8" y2="17"/>
          </svg>
        </div>

        <div class="lo-history-text">
          <div class="lo-history-line1">${escapeHtml(roleName)}</div>
          <div class="lo-history-line2">${secondaryLine}</div>
        </div>

        ${scoreHtml}

        <div class="lo-history-row-actions" aria-label="Row actions">
          <button
            class="lo-history-kebab"
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
          <div class="lo-history-menu" role="menu" ${menuHidden ? 'hidden' : ''}>
            <button class="lo-history-menu-item" type="button" data-action="open" data-id="${escapeHtml(itemId)}">Open / Restore</button>
            <button class="lo-history-menu-item lo-history-menu-item--danger" type="button" data-action="delete" data-id="${escapeHtml(itemId)}">Delete</button>
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
      selectedHistoryId = item.id;
      loadRun(item.id, { fromHistory: true });
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
        const checkbox = row.querySelector('.lo-history-checkbox');
        if (checkbox && checkbox instanceof HTMLInputElement) {
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
        closeAllHistoryMenus();
        onSelect();
      }
    });

    row.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        if (_historyManageMode) {
          const checkbox = row.querySelector('.lo-history-checkbox');
          if (checkbox && checkbox instanceof HTMLInputElement) {
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
          closeAllHistoryMenus();
          onSelect();
        }
      }
    });
  });
}

async function fetchHistory() {
  const emptyEl = document.getElementById('lo-history-empty');
  const listEl = document.getElementById('lo-history-list');
  // Show loading skeleton, hide error + empty
  setHistoryErrorVisible(false);
  setHistoryLoading(true);
  if (emptyEl) emptyEl.hidden = true;
  if (listEl) listEl.innerHTML = '';
  
  try {
    const data = await apiFetch('/api/linkedin/history', { method: 'GET' });
    historyItems = Array.isArray(data?.items) ? data.items : [];
    setHistoryLoading(false);
    renderHistory();
  } catch (e) {
    console.warn('[LINKEDIN] history failed', e);
    historyItems = [];
    setHistoryLoading(false);
    setHistoryErrorVisible(true, 'Couldn\'t load history.');
    renderHistory();
  }
}

function openDeleteModalFor(ids) {
  _historyPendingDeleteIds = Array.from(new Set(ids.map(String).filter(Boolean)));
  const backdrop = document.getElementById('lo-history-modal-backdrop');
  const modal = document.getElementById('lo-history-delete-modal');
  if (backdrop) backdrop.hidden = false;
  if (modal) {
    modal.hidden = false;
    modal.setAttribute('aria-hidden', 'false');
    // Focus cancel button for accessibility
    const cancelBtn = document.getElementById('lo-history-modal-cancel');
    setTimeout(() => cancelBtn?.focus?.(), 0);
  }
}

function closeDeleteModal() {
  const backdrop = document.getElementById('lo-history-modal-backdrop');
  const modal = document.getElementById('lo-history-delete-modal');
  if (backdrop) backdrop.hidden = true;
  if (modal) {
    modal.hidden = true;
    modal.setAttribute('aria-hidden', 'true');
  }
  _historyPendingDeleteIds = [];
}

async function deleteLinkedInHistoryItem(id) {
  // NOTE: backend may not support DELETE yet; we fail gracefully if it doesn't.
  try {
    await apiFetch(`/api/linkedin/history/${encodeURIComponent(String(id))}`, { method: 'DELETE' });
    return true;
  } catch (e) {
    // If backend doesn't support DELETE, return a rejected promise with clear message
    if (e?.status === 405 || e?.message?.includes('method_not_allowed')) {
      const err = new Error('Delete API not yet implemented');
      err.status = 405;
      throw err;
    }
    throw e;
  }
}

async function deleteLinkedInHistoryItems(ids) {
  const idArray = Array.from(new Set((ids || []).map(String).filter(Boolean)));
  if (!idArray.length) return { success: [], failures: [] };
  const results = await Promise.allSettled(idArray.map((id) => deleteLinkedInHistoryItem(id)));
  // Map first to preserve original index, then filter (same pattern as failures below)
  const successIds = results
    .map((result, index) => ({ result, id: idArray[index] }))
    .filter(({ result }) => result.status === 'fulfilled')
    .map(({ id }) => id);
  const failures = results
    .map((result, index) => ({ result, id: idArray[index] }))
    .filter(({ result }) => result.status === 'rejected');

  if (successIds.length) {
    historyItems = historyItems.filter(item => !successIds.includes(String(item.id)));
    if (selectedHistoryId && successIds.includes(String(selectedHistoryId))) {
      selectedHistoryId = null;
      setResultsVisible(false);
    }
    renderHistory();
  }

  return { success: successIds, failures };
}

async function handleDeleteConfirm() {
  const ids = Array.from(new Set(_historyPendingDeleteIds));
  if (!ids.length) return;

  const confirmBtn = document.getElementById('lo-history-modal-confirm');
  if (confirmBtn) confirmBtn.disabled = true;

  try {
    const { failures } = await deleteLinkedInHistoryItems(ids);
    ids.forEach((id) => {
      _historySelectedIds.delete(id);
    });
    syncBulkDeleteState();
    closeDeleteModal();
    // Store error state before fetchHistory (which may set its own error)
    const hadErrorBeforeFetch = _historyHasError;
    await fetchHistory();
    // Only show error if there were delete failures
    if (failures.length) {
      const failureReason = failures[0].result?.reason;
      const failureMessage = failureReason?.message || failureReason || 'Some selected entries could not be deleted. History refreshed to reflect the current state.';
      setHistoryErrorVisible(true, failureMessage);
    } else if (!_historyHasError) {
      // Only clear error if fetchHistory didn't encounter an error
      setHistoryErrorVisible(false);
    }
  } catch (e) {
    console.warn('[LINKEDIN] Delete failed:', e);
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

async function loadRun(id, options = {}) {
  if (!id) return;
  selectedHistoryId = id;
  if (!_historyManageMode) {
    renderHistory();
  }
  setLoading(true, 'Loading saved run…');
  try {
    const data = await apiFetch(`/api/linkedin/run?id=${encodeURIComponent(id)}`, { method: 'GET' });
    // Verify this is still the selected item after async fetch (prevents race condition from rapid clicks)
    if (selectedHistoryId !== id) {
      // User clicked a different item while this request was in flight, ignore this response
      return;
    }
    // If called from a regeneration, verify the regeneration wasn't cancelled
    // (prevents race condition from "Start Fresh" while regeneration is in flight)
    if (options.fromRegeneration && currentRegenRunId === null) {
      // User clicked "Start Fresh" while this regeneration was in flight, ignore this response
      return;
    }
    // Check if run is in error or processing state (HTTP 202 response without output_json)
    if (data?.status === 'error') {
      alert('This run failed to complete. Please try analyzing again.');
      setLoading(false);
      return;
    }
    if (data?.status === 'processing') {
      alert('This run is still processing. Please wait a moment and try again.');
      setLoading(false);
      return;
    }
    // Check if essential data is missing (shouldn't happen for completed runs, but guard anyway)
    if (!data?.sections || data?.overallScore === undefined) {
      alert('This run is incomplete or still processing. Please try analyzing again.');
      setLoading(false);
      return;
    }
    // data shape from API: {run_id, created_at, updated_at, role, overallScore, keywordsToAdd, quickWins, sections}
    const run = {
      run_id: data.run_id,
      created_at: data.created_at,
      updated_at: data.updated_at,
      role: data.role,
      overallScore: data.overallScore,
      keywordsToAdd: data.keywordsToAdd || [],
      quickWins: data.quickWins || [],
      sections: data.sections || {},
      loadedFromHistory: Boolean(options.fromHistory),
      originalInputs: options.originalInputs || {}
    };
    renderResults(run);
    if (options.fromHistory) {
      showToast('Loaded from history — no new credits used.');
    }
    // Refresh history to update selected state
    await fetchHistory();
  } catch (e) {
    console.warn('[LINKEDIN] load run failed', e);
    // Only show error if this is still the selected item
    if (selectedHistoryId === id) {
      const errorMsg = e?.data?.error || e?.message || 'unknown_error';
      if (errorMsg === 'not_found') {
        alert('This run was not found. It may have been deleted.');
      } else if (errorMsg === 'timeout') {
        alert('The request timed out. Please try again.');
      } else {
        alert('Could not load this run. Please try again.');
      }
    }
  } finally {
    // Only clear loading state if this is still the selected item
    if (selectedHistoryId === id) {
      setLoading(false);
    }
  }
}

function readForm() {
  return {
    role: String(els.role?.value || '').trim(),
    headline: String(els.headline?.value || '').trim(),
    summary: String(els.summary?.value || '').trim(),
    experience: String(els.experience?.value || '').trim(),
    skills: String(els.skills?.value || '').trim(),
    recommendations: String(els.recommendations?.value || '').trim()
  };
}

async function pollRunUntilReady(runId, maxMs = 15000) {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    const data = await apiFetch(`/api/linkedin/run?id=${encodeURIComponent(runId)}`, { method: 'GET' });
    // If the backend run has entered an error state, fail fast instead of waiting for timeout.
    // Note: /api/linkedin/run can return HTTP 202 with { status: 'error', ... }.
    if (data?.status === 'error') {
      const err = new Error(data?.error || data?.reason || 'generation_failed');
      // Shape the thrown error similarly to apiFetch() errors so upstream handling can inspect it.
      err.status = 500;
      err.data = { ...(data || {}), error: data?.error || 'generation_failed' };
      throw err;
    }
    if (data?.sections && data?.overallScore !== undefined) return data;
    await new Promise((r) => setTimeout(r, 900));
  }
  throw new Error('timeout');
}

async function analyze() {
  if (isAnalyzing) return;
  const payload = readForm();
  // Validate all required fields
  if (!payload.role) {
    alert('Please select a Target Role.');
    els.role?.focus();
    return;
  }
  if (!payload.headline) {
    alert('Please enter a Headline.');
    els.headline?.focus();
    return;
  }
  if (!payload.summary) {
    alert('Please enter a Summary.');
    els.summary?.focus();
    return;
  }
  if (!payload.experience) {
    alert('Please enter your Experience.');
    els.experience?.focus();
    return;
  }
  if (!payload.skills) {
    alert('Please enter your Skills.');
    els.skills?.focus();
    return;
  }

  isAnalyzing = true;
  // Generate unique ID for this analysis to guard against stale responses
  // (e.g., if user clicks "Start Fresh" while this analysis is in flight)
  const analysisId = crypto.randomUUID();
  currentAnalysisId = analysisId;
  setResultsVisible(false);
  setLoading(true, 'Analyzing your profile…');

  try {
    const req = {
      request_id: crypto.randomUUID(),
      role: payload.role,
      headline: payload.headline,
      summary: payload.summary,
      experience: payload.experience,
      skills: payload.skills
    };
    if (payload.recommendations) req.recommendations = payload.recommendations;

    let data;
    try {
      data = await apiFetch('/api/linkedin/analyze', { method: 'POST', body: JSON.stringify(req) });
      // Verify this analysis is still current after async fetch (prevents race condition from "Start Fresh")
      if (currentAnalysisId !== analysisId) {
        // User clicked "Start Fresh" while this request was in flight, ignore this response
        return;
      }
      console.info('[LINKEDIN DEBUG] analyze API response', {
        overallScore: data?.overallScore,
        sectionsKeys: data?.sections ? Object.keys(data.sections) : null,
        sectionsSample: data?.sections
          ? Object.fromEntries(
              Object.entries(data.sections)
                .slice(0, 3)
                .map(([k, v]) => [k, { score: v?.score, optimizedText: String(v?.optimizedText || '').slice(0, 80) }])
            )
          : null
      });
    } catch (e) {
      // Verify this analysis is still current before handling errors
      if (currentAnalysisId !== analysisId) {
        // User clicked "Start Fresh" while this request was in flight, ignore this error
        return;
      }
      if (e?.status === 403 && e?.data?.error === 'premium_required') {
        setLockedView('upgrade');
        return;
      }
      throw e;
    }

    if (data?.status === 'processing' && data?.run_id) {
      setLoading(true, 'Finishing up…');
      data = await pollRunUntilReady(data.run_id);
      // Verify this analysis is still current after polling (prevents race condition from "Start Fresh")
      if (currentAnalysisId !== analysisId) {
        // User clicked "Start Fresh" while this request was in flight, ignore this response
        return;
      }
    }

    // Verify this analysis is still current before rendering (double-check after all async operations)
    if (currentAnalysisId !== analysisId) {
      // User clicked "Start Fresh" while this request was in flight, ignore this response
      return;
    }

    // Validate that we have the required data before rendering
    if (!data || !data.run_id || data.overallScore === undefined || !data.sections) {
      throw new Error('Incomplete data received from server');
    }

    const run = {
      run_id: data.run_id,
      created_at: data.created_at,
      updated_at: data.updated_at,
      role: data.role,
      overallScore: data.overallScore,
      keywordsToAdd: data.keywordsToAdd || [],
      quickWins: data.quickWins || [],
      sections: data.sections || {}
    };

    run.deduped = Boolean(data?.deduped);
    run.originalInputs = {
      headline: payload.headline,
      summary: payload.summary,
      experience: payload.experience,
      skills: payload.skills,
      recommendations: payload.recommendations
    };
    renderResults(run);
    showToast('LinkedIn optimization ready. Scroll down to review each section.');
    await fetchHistory();
  } catch (e) {
    // Only show error if this analysis is still current (don't show errors for cancelled analyses)
    if (currentAnalysisId === analysisId) {
      console.error('[LINKEDIN] analyze failed', e);
      const code = e?.data?.error || e?.message || 'server_error';
      if (e?.status === 403 && code === 'premium_required') {
        setLockedView('upgrade');
      } else if ((e?.status === 401 && code === 'unauthorized') || e?.message === 'not_authenticated') {
        setLockedView('login');
      } else if (code === 'timeout') {
        alert('The analysis timed out. Please try again.');
      } else if (code === 'Incomplete data received from server') {
        alert('Received incomplete data from the server. Please try again.');
      } else {
        alert('Could not analyze your profile. Please try again.');
      }
    }
  } finally {
    // Only clear loading state and isAnalyzing if this analysis is still current
    if (currentAnalysisId === analysisId) {
      isAnalyzing = false;
      setLoading(false);
    } else {
      // Analysis was cancelled (user clicked "Start Fresh" or started new analysis)
      // Don't modify isAnalyzing or loading state here:
      // - If cancelled via resetForm(), it already set isAnalyzing = false and setLoading(false)
      // - If new analysis started, isAnalyzing should remain true and loading should remain visible
      // Do nothing - let the current analysis (or resetForm) manage the state
    }
  }
}

async function regenerate(section) {
  console.log('[LINKEDIN] regenerate called', { section, runId: currentRun?.run_id });
  if (!currentRun?.run_id || !section) {
    console.warn('[LINKEDIN] regenerate aborted: missing run_id or section', { runId: currentRun?.run_id, section });
    return;
  }
  if (regenBusy.has(section)) {
    console.log('[LINKEDIN] regenerate aborted: already in progress', { section });
    return;
  }
  // Capture run_id at click time to prevent new analysis from changing which run gets regenerated
  const baseRunId = currentRun.run_id;
  // Also capture the original inputs at click time so "Before" text remains consistent
  // even if a new analysis completes before this regeneration finishes.
  const originalInputsAtClick = currentRun.originalInputs || {};
  regenCounts.set(section, (regenCounts.get(section) || 0) + 1);
  regenBusy.add(section);
  // Set currentRegenRunId to guard against stale regeneration responses
  // (e.g., if user clicks "Start Fresh" while regeneration is in flight)
  currentRegenRunId = baseRunId;
  renderSections(currentRun.sections || {}, originalInputsAtClick);

  // Enqueue so each regen uses the latest currentRun (which may have been updated by a prior regen).
  // Note: baseRunId is captured before enqueueing to ensure we regenerate the run the user clicked on,
  // not a different run that may have become currentRun if a new analysis completed in the meantime.
  let regenCompleted = false;
  regenQueue = regenQueue.then(async () => {
    try {
      // Verify this regeneration is still current before proceeding (prevents race condition from "Start Fresh")
      if (currentRegenRunId !== baseRunId) {
        // User clicked "Start Fresh" while this regeneration was in flight, ignore this response
        return;
      }
      if (!baseRunId) throw new Error('missing_run');

      const resp = await apiFetch('/api/linkedin/regenerate', {
        method: 'POST',
        body: JSON.stringify({
          request_id: crypto.randomUUID(),
          run_id: baseRunId,
          section
        })
      });

      // Verify this regeneration is still current after async fetch (prevents race condition from "Start Fresh")
      if (currentRegenRunId !== baseRunId) {
        // User clicked "Start Fresh" while this request was in flight, ignore this response
        return;
      }

      if (resp?.run_id) {
        await loadRun(resp.run_id, { originalInputs: originalInputsAtClick, fromRegeneration: true });
        // Verify this regeneration is still current after loadRun (double-check before marking complete)
        if (currentRegenRunId === baseRunId) {
          regenCompleted = true;
        }
      }
    } catch (e) {
      // Only show error if this regeneration is still current (don't show errors for cancelled regenerations)
      if (currentRegenRunId === baseRunId) {
        console.warn('[LINKEDIN] regenerate failed', e);
        alert('Could not regenerate this section. Please try again.');
      }
    } finally {
      // Only update UI state if this regeneration is still current
      if (currentRegenRunId === baseRunId) {
        regenBusy.delete(section);
        renderSections(currentRun?.sections || {}, originalInputsAtClick);
      } else {
        // Regeneration was cancelled, just remove from busy set
        regenBusy.delete(section);
      }
    }
  });

  // Wait for this regen (and any earlier queued ones) to finish.
  await regenQueue;
  // Only show toast if regeneration is still current and completed
  if (regenCompleted && currentRegenRunId === baseRunId) {
    showToast('New version ready — review and copy if you prefer it.');
  }
}

async function copyOptimized(section) {
  const el = $(`#lo-optimized-${section}`);
  const text = String(el?.textContent || '').trim();
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    // small non-intrusive feedback: change button text briefly
    const btn = document.activeElement;
    if (btn && btn.matches('button')) {
      const old = btn.textContent;
      btn.textContent = 'Copied';
      setTimeout(() => (btn.textContent = old), 900);
    }
  } catch (e) {
    console.warn('[LINKEDIN] clipboard blocked', e);
    alert('Clipboard access was blocked by your browser.');
  }
}

async function copyKeyword(keyword) {
  const k = String(keyword || '').trim();
  if (!k) return;
  try {
    await navigator.clipboard.writeText(k);
  } catch {
    // ignore
  }
}

function buildPrintHtml(run) {
  if (!run) return '';
  const date = formatDateISO(run.created_at || Date.now());
  const keywords = Array.isArray(run.keywordsToAdd) ? run.keywordsToAdd : [];
  const sections = run.sections || {};
  const keys = ['headline', 'summary', 'experience', 'skills', 'recommendations'].filter((k) => !!sections[k]);

  return `
    <div class="lo-container">
      <section class="lo-card">
        <div style="display:flex; align-items:center; justify-content:space-between; gap:1rem; flex-wrap:wrap;">
          <div style="display:flex; align-items:center; gap:0.75rem;">
            <img src="assets/Offical-JobHackAI-Logo.svg" alt="JobHackAI logo" style="height:32px; width:auto;">
            <div>
              <div style="font-size:1.4rem; font-weight:800; color:var(--color-text-main);">JobHackAI — LinkedIn Optimizer</div>
              <div style="margin-top:.25rem; color:var(--color-text-secondary);">Role: ${escapeHtml(run.role || '')} • Date: ${escapeHtml(date)}</div>
            </div>
          </div>
          <div style="font-size:1.1rem; font-weight:700; color:var(--color-text-main);">Overall Score: ${escapeHtml(Math.round(Number(run.overallScore || 0)))} / 100</div>
        </div>
      </section>

      <section class="lo-card">
        <div class="lo-card-title">Keywords to Add</div>
        <div style="display:flex; flex-wrap:wrap; gap:.5rem;">
          ${keywords.map((k) => `<span class="lo-chip">${escapeHtml(k)}</span>`).join('')}
        </div>
      </section>

      ${keys
        .map((k) => {
          const s = sections[k];
          return `
            <section class="lo-card">
              <div class="lo-card-title">${escapeHtml(sectionTitle(k))}</div>
              <div style="margin-top:.5rem; white-space:pre-wrap;">${escapeHtml(String(s.optimizedText || '').trim())}</div>
            </section>
          `;
        })
        .join('')}
    </div>
  `;
}

function downloadPdf() {
  if (!currentRun) return;
  const prevTitle = document.title;
  const date = formatDateISO(currentRun.created_at || Date.now());
  document.title = `jobhackai-linkedin-optimizer-${date}`;
  if (els.print) {
    els.print.innerHTML = buildPrintHtml(currentRun);
  }
  window.print();
  setTimeout(() => {
    document.title = prevTitle;
  }, 500);
}

function initRoleSelector() {
  let attempts = 0;
  const MAX_ATTEMPTS = 50;

  const tryInit = () => {
    if (!els.role) return;
    if (!window.RoleSelector) {
      if (attempts++ < MAX_ATTEMPTS) return void setTimeout(tryInit, 200);
      console.warn('[LINKEDIN] RoleSelector not available after max attempts');
      return;
    }
    if (els.role.dataset.roleSelectorInitialized) return;
    try {
      new window.RoleSelector(els.role, {
        minChars: 2,
        maxResults: 8,
        showCustomOption: true
      });
      els.role.dataset.roleSelectorInitialized = 'true';
    } catch (e) {
      console.warn('[LINKEDIN] RoleSelector init failed', e);
      if (attempts++ < MAX_ATTEMPTS) return void setTimeout(tryInit, 400);
    }
  };

  setTimeout(tryInit, 0);
}

function bindEvents() {
  els.form?.addEventListener('submit', (e) => {
    // Always prevent default to avoid page reload in edge cases (e.g., if els.form becomes null/stale)
    e.preventDefault();
    // Check HTML5 validation - if form is null/stale, checkValidity() returns undefined, which is falsy
    if (els.form && !els.form.checkValidity()) {
      // Let browser show validation messages
      return;
    }
    analyze();
  });

  els.btnStartFresh?.addEventListener('click', (e) => {
    e.preventDefault();
    resetForm();
  });

  els.keywords?.addEventListener('click', (e) => {
    const chip = e.target.closest('[data-keyword]');
    if (!chip) return;
    copyKeyword(chip.dataset.keyword);
  });

  els.sections?.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    
    const action = btn.dataset.action;
    const section = btn.dataset.section;
    
    // Don't prevent default for toggle-optimized, let attachDetailsListeners handle it
    if (action === 'toggle-optimized') {
      // Handled by attachDetailsListeners
      return;
    }
    
    e.preventDefault();
    e.stopPropagation();
    
    if (action === 'copy') return void copyOptimized(section);
    if (action === 'regen') return void regenerate(section);
  });

  els.btnDownload?.addEventListener('click', (e) => {
    e.preventDefault();
    downloadPdf();
  });

  // History panel event handlers
  const refreshBtn = document.getElementById('lo-history-refresh');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', (e) => {
      e.preventDefault();
      if (_historyManageMode) return;
      fetchHistory();
    });
  }

  // Retry link
  const retryBtn = document.getElementById('lo-history-retry');
  if (retryBtn) {
    retryBtn.addEventListener('click', (e) => {
      e.preventDefault();
      fetchHistory();
    });
  }

  // Manage mode controls
  const manageBtn = document.getElementById('lo-history-manage');
  if (manageBtn) {
    manageBtn.addEventListener('click', (e) => {
      e.preventDefault();
      setHistoryManageMode(true);
    });
  }

  const cancelManageBtn = document.getElementById('lo-history-cancel-manage');
  if (cancelManageBtn) {
    cancelManageBtn.addEventListener('click', (e) => {
      e.preventDefault();
      setHistoryManageMode(false);
    });
  }

  const deleteSelectedBtn = document.getElementById('lo-history-delete-selected');
  if (deleteSelectedBtn) {
    deleteSelectedBtn.addEventListener('click', (e) => {
      e.preventDefault();
      const ids = Array.from(_historySelectedIds);
      if (ids.length) {
        openDeleteModalFor(ids);
      }
    });
  }

  // Clear history handler
  const clearHistoryBtn = document.getElementById('lo-history-clear');
  if (clearHistoryBtn) {
    clearHistoryBtn.addEventListener('click', (e) => {
      e.preventDefault();
      // Enter manage mode
      setHistoryManageMode(true);
      // Auto-select all visible items
      const visibleIds = getVisibleHistoryItems(historyItems).map(item => String(item.id));
      visibleIds.forEach(id => _historySelectedIds.add(id));
      syncBulkDeleteState();
      renderHistory();
      // Open modal immediately
      if (visibleIds.length) {
        openDeleteModalFor(visibleIds);
      }
    });
  }

  // Modal handlers
  const modalBackdrop = document.getElementById('lo-history-modal-backdrop');
  if (modalBackdrop) {
    modalBackdrop.addEventListener('click', (e) => {
      if (e.target === modalBackdrop) {
        closeDeleteModal();
      }
    });
  }

  const modalCancelBtn = document.getElementById('lo-history-modal-cancel');
  if (modalCancelBtn) {
    modalCancelBtn.addEventListener('click', (e) => {
      e.preventDefault();
      closeDeleteModal();
    });
  }

  const modalConfirmBtn = document.getElementById('lo-history-modal-confirm');
  if (modalConfirmBtn) {
    modalConfirmBtn.addEventListener('click', (e) => {
      e.preventDefault();
      handleDeleteConfirm();
    });
  }

  // ESC key to close modal
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const modal = document.getElementById('lo-history-delete-modal');
      if (modal && !modal.hidden) {
        closeDeleteModal();
      }
    }
  });
}

async function init() {
  // elements
  els.app = $('#lo-app');
  els.locked = $('#lo-locked');
  els.login = $('#lo-login');
  els.upgrade = $('#lo-upgrade');
  els.form = $('#lo-form');
  els.role = $('#lo-role');
  els.headline = $('#lo-headline');
  els.summary = $('#lo-summary');
  els.experience = $('#lo-experience');
  els.skills = $('#lo-skills');
  els.recommendations = $('#lo-recommendations');
  els.btnAnalyze = $('#lo-analyze');
  els.btnStartFresh = $('#lo-start-fresh');
  els.loading = $('#lo-loading');
  els.results = $('#lo-results');
  els.scoreText = $('#lo-score-text');
  els.scoreRing = $('#lo-score-ring');
  els.meta = $('#lo-score-meta');
  els.planPill = $('#lo-plan-pill');
  els.quickWins = $('#lo-quickwins');
  els.keywords = $('#lo-keywords');
  els.sections = $('#lo-sections');
  els.btnDownload = $('#lo-download');
  els.historyList = $('#lo-history-list');
  els.historyEmpty = $('#lo-history-empty');
  els.print = $('#lo-print');

  const applyGate = async () => {
    const auth = getAuthState();
    const plan = getEffectivePlan();

    if (!auth.isAuthenticated) {
      setLockedView('login');
      return;
    }
    if (plan !== 'premium') {
      setLockedView('upgrade');
      return;
    }

    setLockedView('none');
    setPlanPill(plan);
    if (unlockedInitialized) return;
    unlockedInitialized = true;

    bindEvents();
    initRoleSelector();

    // Load history once auth is ready for token
    try {
      await waitForFirebaseUser();
    } catch {
      // ignore
    }
    await fetchHistory();
  };

  // Re-apply gate when navigation learns plan/auth
  window.addEventListener('planChanged', () => {
    applyGate().catch(() => {});
  });
  window.addEventListener('navigationReady', () => {
    applyGate().catch(() => {});
  });

  await applyGate();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

