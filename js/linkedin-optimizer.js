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
const regenBusy = new Set(); // section keys
const regenCounts = new Map();
// Serialize regenerations across sections to avoid branching from the same base run_id
// and overwriting each other's changes when responses return out of order.
let regenQueue = Promise.resolve();
let unlockedInitialized = false;

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
  if (!els.results) return;
  els.results.style.display = on ? '' : 'none';
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

function renderSections(sections) {
  if (!els.sections) return;
  const keys = ['headline', 'summary', 'experience', 'skills', 'recommendations'];
  const present = keys.filter((k) => sections && sections[k]);
  const originalInputs = currentRun?.originalInputs || {};

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

          <details class="lo-details">
            <summary>View optimized (Before & After)</summary>
            <div class="lo-details-body">
              <div class="lo-before-after">
                ${beforeBlock}
                <div>
                  <div class="lo-before-after-label">After (paste-ready)</div>
                  <div class="lo-after-text" id="lo-optimized-${k}">${escapeHtml(optimized)}</div>
                </div>
              </div>
              <div class="lo-section-actions">
                <button class="btn-outline" type="button" data-action="copy" data-section="${k}" data-copy-target="lo-optimized-${k}">
                  Copy Optimized
                </button>
                <button class="btn-outline ${busy ? 'lo-btn-loading' : ''}" type="button" data-action="regen" data-section="${k}">
                  ${busy ? 'Regenerating…' : 'Regenerate'}
                </button>
              </div>
              ${showTip ? '<div class="lo-section-tip">Tip: For a bigger change, tweak the original text above and regenerate.</div>' : ''}
            </div>
          </details>
        </section>
      `;
    })
    .join('');
}

function renderResults(run) {
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

function renderHistory() {
  if (!els.historyList || !els.historyEmpty) return;
  els.historyList.innerHTML = '';
  els.historyEmpty.hidden = historyItems.length > 0;

  const getScoreTone = (score) => {
    if (score >= 80) return 'history-score high';
    if (score >= 60) return 'history-score medium';
    return 'history-score low';
  };

  for (const item of historyItems) {
    const row = document.createElement('div');
    row.className = 'lo-history-item history-item';
    row.dataset.id = item.id;
    row.tabIndex = 0;
    row.classList.toggle('is-selected', selectedHistoryId === item.id);

    const when = timeAgo(item.createdAt);
    // Guard against null scores because Number(null) === 0 and would be treated as valid.
    const normalizedScore = item.overallScore != null && Number.isFinite(Number(item.overallScore))
      ? Number(item.overallScore)
      : null;
    const scoreHtml = normalizedScore !== null
      ? `<div class="history-score ${getScoreTone(normalizedScore)}">${Math.round(normalizedScore)}</div>`
      : '';
    const scorePart = normalizedScore !== null ? `${Math.round(normalizedScore)}/100` : '';
    const visibilityMeta = normalizedScore !== null ? getRecruiterBoostLabel(normalizedScore) : '';
    const metaParts = [scorePart, visibilityMeta, when].filter(Boolean);
    const metaText = metaParts.join(' • ');

    row.innerHTML = `
      <div class="history-main">
        <svg class="history-doc-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
          <polyline points="14 2 14 8 20 8"></polyline>
        </svg>
        <div class="history-text">
          <div class="history-line1">${escapeHtml(item.role || 'LinkedIn Optimization')}</div>
          <div class="history-line2">${escapeHtml(metaText)}</div>
        </div>
      </div>
      ${scoreHtml}
    `;

    const onSelect = () => loadRun(item.id, { fromHistory: true });
    row.addEventListener('click', onSelect);
    row.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onSelect();
      }
    });

    els.historyList.appendChild(row);
  }
}

async function fetchHistory() {
  try {
    const data = await apiFetch('/api/linkedin/history', { method: 'GET' });
    historyItems = Array.isArray(data?.items) ? data.items : [];
    renderHistory();
  } catch (e) {
    console.warn('[LINKEDIN] history failed', e);
    historyItems = [];
    renderHistory();
  }
}

async function loadRun(id, options = {}) {
  if (!id) return;
  selectedHistoryId = id;
  renderHistory();
  setLoading(true, 'Loading saved run…');
  try {
    const data = await apiFetch(`/api/linkedin/run?id=${encodeURIComponent(id)}`, { method: 'GET' });
    // Verify this is still the selected item after async fetch (prevents race condition from rapid clicks)
    if (selectedHistoryId !== id) {
      // User clicked a different item while this request was in flight, ignore this response
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
    } catch (e) {
      if (e?.status === 403 && e?.data?.error === 'premium_required') {
        setLockedView('upgrade');
        return;
      }
      throw e;
    }

    if (data?.status === 'processing' && data?.run_id) {
      setLoading(true, 'Finishing up…');
      data = await pollRunUntilReady(data.run_id);
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
  } finally {
    isAnalyzing = false;
    setLoading(false);
  }
}

async function regenerate(section) {
  if (!currentRun?.run_id || !section) return;
  if (regenBusy.has(section)) return;
  // Capture run_id at click time to prevent new analysis from changing which run gets regenerated
  const baseRunId = currentRun.run_id;
  regenCounts.set(section, (regenCounts.get(section) || 0) + 1);
  regenBusy.add(section);
  renderSections(currentRun.sections || {});

  // Enqueue so each regen uses the latest currentRun (which may have been updated by a prior regen).
  // Note: baseRunId is captured before enqueueing to ensure we regenerate the run the user clicked on,
  // not a different run that may have become currentRun if a new analysis completed in the meantime.
  let regenCompleted = false;
  regenQueue = regenQueue.then(async () => {
    try {
      if (!baseRunId) throw new Error('missing_run');

      const resp = await apiFetch('/api/linkedin/regenerate', {
        method: 'POST',
        body: JSON.stringify({
          request_id: crypto.randomUUID(),
          run_id: baseRunId,
          section
        })
      });

      if (resp?.run_id) {
        await loadRun(resp.run_id, { originalInputs: currentRun.originalInputs });
        regenCompleted = true;
      }
    } catch (e) {
      console.warn('[LINKEDIN] regenerate failed', e);
      alert('Could not regenerate this section. Please try again.');
    } finally {
      regenBusy.delete(section);
      renderSections(currentRun?.sections || {});
    }
  });

  // Wait for this regen (and any earlier queued ones) to finish.
  await regenQueue;
  if (regenCompleted) {
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
    if (action === 'copy') return void copyOptimized(section);
    if (action === 'regen') return void regenerate(section);
  });

  els.btnDownload?.addEventListener('click', (e) => {
    e.preventDefault();
    downloadPdf();
  });

  document.getElementById('lo-history-refresh')?.addEventListener('click', (e) => {
    e.preventDefault();
    fetchHistory();
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

