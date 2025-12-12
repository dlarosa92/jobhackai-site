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

function renderQuickWins(arr) {
  if (!els.quickWins) return;
  const wins = Array.isArray(arr) ? arr.slice(0, 3) : [];
  els.quickWins.innerHTML = wins.map((w) => `<li>${escapeHtml(w)}</li>`).join('');
}

function renderKeywordChips(arr) {
  if (!els.keywords) return;
  const keywords = Array.isArray(arr) ? arr.slice(0, 10) : [];
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

  els.sections.innerHTML = present
    .map((k) => {
      const s = sections[k];
      const score = Math.round(Number(s.score || 0));
      const label = String(s.label || '');
      const bullets = Array.isArray(s.feedbackBullets) ? s.feedbackBullets.slice(0, 3) : [];
      const optimized = String(s.optimizedText || '').trim();
      const busy = regenBusy.has(k);

      return `
        <section class="lo-card" data-section="${k}">
          <div class="lo-section-header">
            <div class="lo-card-title" style="margin:0;">
              ${escapeHtml(sectionTitle(k))}
              <span class="lo-badge">${score}/100</span>
            </div>
            <div class="lo-meta">${escapeHtml(label)}</div>
          </div>

          <ul class="lo-feedback">
            ${bullets.map((b) => `<li>${escapeHtml(b)}</li>`).join('')}
          </ul>

          <details class="lo-details">
            <summary>Optimized Text</summary>
            <div class="lo-details-body">
              <div class="lo-optimized" id="lo-optimized-${k}">${escapeHtml(optimized)}</div>
              <div class="lo-section-actions">
                <button class="btn-outline" type="button" data-action="copy" data-section="${k}">Copy Optimized</button>
                <button class="btn-outline ${busy ? 'lo-btn-loading' : ''}" type="button" data-action="regen" data-section="${k}">
                  ${busy ? 'Regenerating…' : 'Regenerate'}
                </button>
              </div>
            </div>
          </details>
        </section>
      `;
    })
    .join('');
}

function renderResults(run) {
  currentRun = run;
  if (!run) {
    setResultsVisible(false);
    return;
  }
  setResultsVisible(true);
  setScoreRing(run.overallScore);
  if (els.meta) {
    const when = run.created_at ? timeAgo(run.created_at) : '';
    els.meta.textContent = run.role ? `${run.role}${when ? ` • ${when}` : ''}` : when;
  }
  renderQuickWins(run.quickWins);
  renderKeywordChips(run.keywordsToAdd);
  renderSections(run.sections || {});
}

function renderHistory() {
  if (!els.historyList || !els.historyEmpty) return;
  els.historyList.innerHTML = '';
  els.historyEmpty.hidden = historyItems.length > 0;

  for (const item of historyItems) {
    const row = document.createElement('div');
    row.className = 'lo-history-item';
    row.dataset.id = item.id;
    row.tabIndex = 0;
    row.classList.toggle('is-selected', selectedHistoryId === item.id);

    const when = timeAgo(item.createdAt);
    const score = Number.isFinite(Number(item.overallScore)) ? `${Math.round(Number(item.overallScore))}/100` : '';
    row.innerHTML = `
      <div class="lo-history-line1">${escapeHtml(item.role || 'LinkedIn Optimization')}</div>
      <div class="lo-history-line2">${escapeHtml([when, score].filter(Boolean).join(' • '))}</div>
    `;

    const onSelect = () => loadRun(item.id);
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

async function loadRun(id) {
  if (!id) return;
  selectedHistoryId = id;
  renderHistory();
  setLoading(true, 'Loading saved run…');
  try {
    const data = await apiFetch(`/api/linkedin/run?id=${encodeURIComponent(id)}`, { method: 'GET' });
    // data shape from API: {run_id, created_at, updated_at, role, overallScore, keywordsToAdd, quickWins, sections}
    renderResults({
      run_id: data.run_id,
      created_at: data.created_at,
      updated_at: data.updated_at,
      role: data.role,
      overallScore: data.overallScore,
      keywordsToAdd: data.keywordsToAdd || [],
      quickWins: data.quickWins || [],
      sections: data.sections || {}
    });
  } catch (e) {
    console.warn('[LINKEDIN] load run failed', e);
    alert('Could not load this run. Please try again.');
  } finally {
    setLoading(false);
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
    if (data?.sections && data?.overallScore !== undefined) return data;
    await new Promise((r) => setTimeout(r, 900));
  }
  throw new Error('timeout');
}

async function analyze() {
  if (isAnalyzing) return;
  const payload = readForm();
  if (!payload.role) {
    alert('Please select a Target Role.');
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

    renderResults(run);
    await fetchHistory();
  } catch (e) {
    console.error('[LINKEDIN] analyze failed', e);
    const code = e?.data?.error || e?.message || 'server_error';
    if (e?.status === 403 && code === 'premium_required') {
      setLockedView('upgrade');
    } else if (e?.status === 401 && code === 'unauthorized') {
      setLockedView('login');
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
  regenBusy.add(section);
  renderSections(currentRun.sections || {});

  try {
    const resp = await apiFetch('/api/linkedin/regenerate', {
      method: 'POST',
      body: JSON.stringify({
        request_id: crypto.randomUUID(),
        run_id: currentRun.run_id,
        section
      })
    });

    if (resp?.run_id) {
      await loadRun(resp.run_id);
      await fetchHistory();
    }
  } catch (e) {
    console.warn('[LINKEDIN] regenerate failed', e);
    alert('Could not regenerate this section. Please try again.');
  } finally {
    regenBusy.delete(section);
    renderSections(currentRun?.sections || {});
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
          <div>
            <div style="font-size:1.4rem; font-weight:800; color:var(--color-text-main);">JobHackAI — LinkedIn Optimizer</div>
            <div style="margin-top:.25rem; color:var(--color-text-secondary);">Role: ${escapeHtml(run.role || '')} • Date: ${escapeHtml(date)}</div>
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
    e.preventDefault();
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

