const { test, expect } = require('@playwright/test');
const path = require('path');
const { waitForAuthReady, getAuthToken, postStripeCheckout } = require('../helpers/auth-helpers');

const ALLOWED_PLANS = new Set(['free', 'trial', 'essential', 'pro', 'premium']);

function jsonResponse(route, body, status = 200) {
  return route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });
}

function safePostDataJSON(request) {
  try {
    return request.postDataJSON();
  } catch {
    try {
      return JSON.parse(request.postData() || '{}');
    } catch {
      return {};
    }
  }
}

async function forceAuthenticatedPlan(page, plan = 'pro') {
  await page.addInitScript((planValue) => {
    try {
      localStorage.setItem('user-authenticated', 'true');
      localStorage.setItem('user-plan', planValue);
      localStorage.setItem('dev-plan', planValue);
    } catch {
      // no-op
    }
  }, plan);

  await page.route('**/api/plan/me**', async (route) => {
    await jsonResponse(route, {
      plan,
      status: 'active',
      source: 'full-app-check',
      trialEndsAt: null,
      trialUsed: true,
    });
  });
}

async function mockInterviewEndpoints(page) {
  const historyItems = [];
  const savedSets = new Map();

  await page.route('**/api/interview-questions/generate', async (route) => {
    const body = safePostDataJSON(route.request());
    const role = String(body.role || 'Software Engineer');
    const type = String(body.type || 'mixed');
    const questions = Array.from({ length: 10 }, (_, i) => ({
      q: `${role} ${type} question ${i + 1}`,
      hint: `Focus on impact for question ${i + 1}.`,
      example: `Example answer framework ${i + 1}.`,
    }));

    await jsonResponse(route, {
      success: true,
      questions,
      dailyLimitReached: false,
    });
  });

  await page.route('**/api/interview-questions/save-set', async (route) => {
    const body = safePostDataJSON(route.request());
    const id = String(1000 + historyItems.length + 1);
    const now = new Date().toISOString();
    const role = String(body.role || 'Software Engineer');
    const questions = Array.isArray(body.questions) ? body.questions : [];

    const item = {
      id,
      role,
      count: questions.length || 10,
      time: now,
      questions,
      selectedIndices: Array.isArray(body.selectedIndices) ? body.selectedIndices : [],
      type: body.type || 'mixed',
      seniority: body.seniority || '',
      jd: body.jd || '',
    };

    savedSets.set(id, item);
    historyItems.unshift({
      id,
      role: item.role,
      count: item.count,
      time: item.time,
    });

    await jsonResponse(route, {
      success: true,
      id,
      createdAt: now,
    });
  });

  await page.route('**/api/interview-questions/get-set**', async (route) => {
    const url = new URL(route.request().url());
    const id = String(url.searchParams.get('id') || '');
    const found = savedSets.get(id);

    if (!found) {
      await jsonResponse(route, { error: 'not_found' }, 404);
      return;
    }

    await jsonResponse(route, {
      success: true,
      id: Number(found.id),
      role: found.role,
      questions: found.questions,
      selectedIndices: found.selectedIndices,
      count: found.count,
      time: found.time,
      type: found.type,
      types: [found.type],
      seniority: found.seniority,
      jd: found.jd,
    });
  });

  await page.route('**/api/interview-questions/history**', async (route) => {
    const request = route.request();
    const method = request.method();
    const url = request.url();

    if (method === 'DELETE') {
      const id = url.split('/').pop().split('?')[0];
      const next = historyItems.filter((item) => String(item.id) !== String(id));
      historyItems.length = 0;
      historyItems.push(...next);
      savedSets.delete(String(id));
      await jsonResponse(route, { success: true });
      return;
    }

    await jsonResponse(route, { items: historyItems.slice(0, 10) });
  });
}

async function mockLinkedInEndpoints(page) {
  const historyItems = [];
  const runsById = new Map();

  function buildRun(runId, role) {
    const now = new Date().toISOString();
    return {
      run_id: runId,
      created_at: now,
      updated_at: now,
      role,
      overallScore: 84,
      keywordsToAdd: ['Distributed systems', 'Stakeholder communication', 'Observability'],
      quickWins: ['Add measurable outcomes', 'Tighten opening headline', 'Use role keywords naturally'],
      sections: {
        headline: {
          score: 80,
          label: 'Strong start',
          feedbackBullets: ['Lead with impact', 'Add role keyword'],
          optimizedText: `${role} | Scalable systems leader driving measurable product outcomes.`,
        },
        summary: {
          score: 83,
          label: 'Solid summary',
          feedbackBullets: ['Clarify scope', 'Quantify outcomes'],
          optimizedText: `I build reliable platforms and partner with teams to ship customer value quickly.`,
        },
        experience: {
          score: 86,
          label: 'Good structure',
          feedbackBullets: ['Use action verbs', 'Highlight metrics'],
          optimizedText: `Reduced incident response time by 42% through improved observability and runbooks.`,
        },
        skills: {
          score: 85,
          label: 'Relevant skill mix',
          feedbackBullets: ['Prioritize core stack', 'Map to role'],
          optimizedText: 'Node.js, React, Cloudflare Workers, PostgreSQL, CI/CD, incident response',
        },
        recommendations: {
          score: 78,
          label: 'Needs social proof',
          feedbackBullets: ['Request manager recommendation', 'Highlight collaboration'],
          optimizedText: 'Seeking recommendations focused on cross-functional leadership and delivery impact.',
        },
      },
    };
  }

  await page.route('**/api/linkedin/analyze', async (route) => {
    const body = safePostDataJSON(route.request());
    const role = String(body.role || 'Software Engineer');
    const runId = `run_${historyItems.length + 1}`;
    const run = buildRun(runId, role);

    runsById.set(runId, run);
    historyItems.unshift({
      id: runId,
      role,
      overallScore: run.overallScore,
      createdAt: run.created_at,
      updatedAt: run.updated_at,
    });

    await jsonResponse(route, run);
  });

  await page.route('**/api/linkedin/run**', async (route) => {
    const url = new URL(route.request().url());
    const id = String(url.searchParams.get('id') || '');
    const run = runsById.get(id);

    if (!run) {
      await jsonResponse(route, { error: 'not_found' }, 404);
      return;
    }

    await jsonResponse(route, run);
  });

  await page.route('**/api/linkedin/regenerate', async (route) => {
    const body = safePostDataJSON(route.request());
    const runId = String(body.run_id || '');
    const section = String(body.section || '');
    const run = runsById.get(runId);

    if (!run || !section || !run.sections[section]) {
      await jsonResponse(route, { error: 'invalid_request' }, 400);
      return;
    }

    run.sections[section].optimizedText = `${run.sections[section].optimizedText} (Regenerated)`;
    run.updated_at = new Date().toISOString();
    runsById.set(runId, run);
    await jsonResponse(route, { run_id: runId });
  });

  await page.route('**/api/linkedin/history**', async (route) => {
    const request = route.request();
    const method = request.method();
    const url = request.url();

    if (method === 'DELETE') {
      const id = url.split('/').pop().split('?')[0];
      const next = historyItems.filter((item) => String(item.id) !== String(id));
      historyItems.length = 0;
      historyItems.push(...next);
      runsById.delete(String(id));
      await jsonResponse(route, { success: true });
      return;
    }

    await jsonResponse(route, { items: historyItems.slice(0, 10) });
  });
}

async function mockCoverLetterEndpoints(page) {
  const historyItems = [];

  await page.route('**/api/cover-letter/generate', async (route) => {
    const body = safePostDataJSON(route.request());
    const id = String(2000 + historyItems.length + 1);
    const now = Date.now();
    const role = String(body.role || 'Software Engineer');
    const company = String(body.company || 'Acme');

    const item = {
      id,
      role,
      company,
      seniority: String(body.seniority || 'Mid'),
      tone: String(body.tone || 'Confident + Professional'),
      jobDescription: String(body.jobDescription || ''),
      resumeText: String(body.resumeText || ''),
      coverLetterText: `Dear Hiring Manager,\n\nI am excited to apply for the ${role} role at ${company}. My background aligns strongly with your needs.\n\nSincerely,\nJobHackAI Test User`,
      createdAt: now,
      updatedAt: now,
    };

    historyItems.unshift(item);
    await jsonResponse(route, { item });
  });

  await page.route('**/api/cover-letter/history**', async (route) => {
    const request = route.request();
    const method = request.method();
    const url = request.url();

    if (method === 'PATCH') {
      const id = url.split('/').pop().split('?')[0];
      const body = safePostDataJSON(request);
      const idx = historyItems.findIndex((item) => String(item.id) === String(id));

      if (idx === -1) {
        await jsonResponse(route, { error: 'not_found' }, 404);
        return;
      }

      historyItems[idx] = {
        ...historyItems[idx],
        coverLetterText: String(body.coverLetterText || historyItems[idx].coverLetterText),
        updatedAt: Date.now(),
      };
      await jsonResponse(route, { item: historyItems[idx] });
      return;
    }

    if (method === 'DELETE') {
      const id = url.split('/').pop().split('?')[0];
      const next = historyItems.filter((item) => String(item.id) !== String(id));
      historyItems.length = 0;
      historyItems.push(...next);
      await jsonResponse(route, { success: true });
      return;
    }

    await jsonResponse(route, { items: historyItems.slice(0, 10) });
  });
}

async function mockResumeFeedbackEndpoints(page) {
  const sessionId = 'rf_session_1';
  const nowIso = new Date().toISOString();

  const rubric = [
    { category: 'KEYWORD_RELEVANCE', score: 34, maxScore: 40, tip: 'Add two role-specific keywords.' },
    { category: 'FORMATTING_COMPLIANCE', score: 16, maxScore: 20, tip: 'Keep section headers consistent.' },
    { category: 'STRUCTURE_COMPLETENESS', score: 13, maxScore: 15, tip: 'Expand accomplishments for recent role.' },
    { category: 'TONE_CLARITY', score: 14, maxScore: 15, tip: 'Use stronger action verbs.' },
    { category: 'GRAMMAR_SPELLING', score: 9, maxScore: 10, tip: 'Fix minor punctuation issues.' },
  ];

  await page.route('**/api/ats-score-persist**', async (route) => {
    await jsonResponse(route, { success: true, data: null });
  });

  await page.route('**/api/resume-upload', async (route) => {
    await jsonResponse(route, {
      success: true,
      resumeId: 'resume_e2e_1',
      resumeText: 'Experienced software engineer with 8+ years building web applications.',
      isMultiColumn: false,
    });
  });

  await page.route('**/api/ats-score', async (route) => {
    await jsonResponse(route, {
      success: true,
      score: 86,
      breakdown: {
        KEYWORD_RELEVANCE: { score: 34 },
        FORMATTING_COMPLIANCE: { score: 16 },
        STRUCTURE_COMPLETENESS: { score: 13 },
        TONE_CLARITY: { score: 14 },
        GRAMMAR_SPELLING: { score: 9 },
      },
      extractionQuality: 'high',
    });
  });

  await page.route('**/api/resume-feedback', async (route) => {
    await jsonResponse(route, {
      sessionId,
      meta: {
        role: 'Software Engineer',
        createdAt: nowIso,
      },
      atsRubric: rubric,
      roleSpecificFeedback: [
        {
          title: 'Role-Specific Tailoring Tips',
          tip: 'Lead with API scalability and measurable impact for this role.',
        },
      ],
      atsIssues: [
        {
          title: 'Quantify impact',
          tip: 'Add metrics to 2-3 recent bullets.',
        },
      ],
    });
  });

  await page.route('**/api/role-tips', async (route) => {
    await jsonResponse(route, {
      success: true,
      roleSpecificFeedback: [
        {
          title: 'Role-Specific Tailoring Tips',
          tip: 'Align project bullets with backend architecture outcomes.',
        },
      ],
      sessionId,
    });
  });

  await page.route('**/api/resume-feedback/history**', async (route) => {
    const request = route.request();
    const url = request.url();

    if (url.includes(`/api/resume-feedback/history/${encodeURIComponent(sessionId)}`) || url.includes(`/api/resume-feedback/history/${sessionId}`)) {
      await jsonResponse(route, {
        sessionId,
        atsRubric: rubric,
        roleSpecificFeedback: [
          {
            title: 'Role-Specific Tailoring Tips',
            tip: 'Align bullets to the posted role scope.',
          },
        ],
      });
      return;
    }

    await jsonResponse(route, {
      items: [
        {
          sessionId,
          role: 'Software Engineer',
          atsScore: 86,
          createdAt: nowIso,
          resumeId: 'resume_e2e_1',
        },
      ],
    });
  });
}

test.describe('Full App Check', () => {
  test('auth + dashboard nav + plan indicators are healthy', async ({ page }) => {
    await page.goto('/dashboard');
    await page.waitForLoadState('domcontentloaded');
    await waitForAuthReady(page, 15000);

    const currentUrl = page.url();
    expect(currentUrl).not.toContain('/login');

    const currentUser = await page.evaluate(() => {
      return !!window.FirebaseAuthManager?.getCurrentUser?.();
    });
    expect(currentUser).toBeTruthy();

    const navLinks = page.locator('nav.nav-links a');
    await expect(navLinks.first()).toBeVisible();
    expect(await navLinks.count()).toBeGreaterThanOrEqual(3);

    const navTexts = (await navLinks.allTextContents()).map((t) => t.trim().toLowerCase());
    expect(navTexts.includes('pricing')).toBeFalsy();

    const planBadge = page.locator('.user-plan-badge').first();
    await expect(planBadge).toBeVisible({ timeout: 15000 });
    const planBadgeText = (await planBadge.textContent()) || '';
    expect(planBadgeText.trim().length).toBeGreaterThan(0);
  });

  test('stripe checkout + billing endpoints are healthy', async ({ page, baseURL }) => {
    await page.goto('/pricing-a.html');
    await page.waitForLoadState('domcontentloaded');
    await waitForAuthReady(page, 15000);

    const token = await getAuthToken(page);
    expect(token).toBeTruthy();

    const planResponse = await page.request.get('/api/plan/me', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(planResponse.ok()).toBeTruthy();
    const planData = await planResponse.json();
    const normalizedPlan = String(planData.plan || '').toLowerCase();
    expect(ALLOWED_PLANS.has(normalizedPlan)).toBeTruthy();

    const checkoutPayloads = [
      { plan: 'trial', startTrial: true },
      { plan: 'essential', startTrial: false },
      { plan: 'pro', startTrial: false },
      { plan: 'premium', startTrial: false },
    ];

    for (const payload of checkoutPayloads) {
      const { response, data } = await postStripeCheckout(page, payload);
      expect([200, 400, 401, 403, 409]).toContain(response.status());

      const hasCheckoutUrl = typeof data?.url === 'string' && data.url.includes('checkout.stripe.com');
      const hasExpectedError = typeof data?.error === 'string' && data.error.length > 0;
      expect(hasCheckoutUrl || hasExpectedError).toBeTruthy();
    }

    const billingStatusResponse = await page.request.get('/api/billing-status?force=1', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect([200, 401, 403]).toContain(billingStatusResponse.status());
    const billingStatusData = await billingStatusResponse.json().catch(() => ({}));
    expect(typeof billingStatusData).toBe('object');

    const billingPortalResponse = await page.request.post('/api/billing-portal', {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      data: {
        return_url: `${baseURL}/account-setting.html`,
      },
    });
    expect([200, 400, 401, 403]).toContain(billingPortalResponse.status());
    const billingPortalData = await billingPortalResponse.json().catch(() => ({}));
    if (billingPortalResponse.status() === 200) {
      expect(typeof billingPortalData.url).toBe('string');
      expect(billingPortalData.url.length).toBeGreaterThan(0);
    } else {
      expect(typeof billingPortalData.error).toBe('string');
    }
  });

  test('resume feedback supports PDF/DOCX upload and core analysis UI', async ({ page }) => {
    test.setTimeout(120000);
    await forceAuthenticatedPlan(page, 'pro');
    await mockResumeFeedbackEndpoints(page);

    await page.goto('/resume-feedback-pro.html');
    await page.waitForLoadState('domcontentloaded');
    await waitForAuthReady(page, 15000);
    await page.waitForFunction(() => !document.documentElement.classList.contains('plan-pending'), null, { timeout: 15000 });

    const pdfFixture = path.join(__dirname, '../fixtures/sample-resume.pdf');
    const docxFixture = path.join(__dirname, '../../../docs', 'Test Resumes', 'ATS-Test-Suite', 'resume-01-excellent-baseline.docx');

    const uploadInput = page.locator('#rf-upload');
    await uploadInput.setInputFiles(pdfFixture);
    await expect(page.locator('#rf-file-name')).toContainText('.pdf', { timeout: 5000 });

    await uploadInput.setInputFiles(docxFixture);
    await expect(page.locator('#rf-file-name')).toContainText('.docx', { timeout: 5000 });

    await page.fill('#rf-job-title', 'Software Engineer');
    await page.locator('#rf-job-title').blur();

    const generateButton = page.locator('#rf-generate-btn');
    await expect(generateButton).toBeEnabled({ timeout: 10000 });

    await Promise.all([
      page.waitForResponse((response) => response.url().includes('/api/resume-upload') && response.ok()),
      page.waitForResponse((response) => response.url().includes('/api/ats-score') && response.ok()),
      page.waitForResponse((response) => response.url().includes('/api/resume-feedback') && response.ok()),
      generateButton.click(),
    ]);

    await expect(page.locator('#rf-ats-score-tile .rf-progress-ring text')).toHaveText(/%/, { timeout: 15000 });
    await expect(page.locator('#rf-rubric-grid .rf-rubric-item').first()).toBeVisible({ timeout: 15000 });
    await expect(page.locator('#rf-history-panel')).toBeVisible();
  });

  test('interview questions generation + history works', async ({ page }) => {
    test.setTimeout(90000);
    await forceAuthenticatedPlan(page, 'pro');
    await mockInterviewEndpoints(page);

    await page.goto('/interview-questions.html');
    await page.waitForLoadState('domcontentloaded');
    await waitForAuthReady(page, 15000);

    await page.fill('#iq-role', 'Software Engineer');
    await page.selectOption('#iq-seniority', { label: 'Mid' });
    await page.keyboard.press('Escape');
    await page.locator('body').click({ position: { x: 10, y: 10 } });
    await page.locator('#iq-role').blur();
    await page.waitForFunction(() => {
      const dropdown = document.querySelector('#iq-role + .role-selector-dropdown');
      if (!dropdown) return true;
      const style = window.getComputedStyle(dropdown);
      return style.display === 'none' || style.visibility === 'hidden';
    }, null, { timeout: 5000 });

    const generateButton = page.locator('#btn-generate');
    await expect(generateButton).toBeEnabled({ timeout: 10000 });

    await Promise.all([
      page.waitForResponse((response) => response.url().includes('/api/interview-questions/generate') && response.ok()),
      page.waitForResponse((response) => response.url().includes('/api/interview-questions/save-set') && response.ok()),
      generateButton.dispatchEvent('click'),
    ]);

    await expect(page.locator('#iq-questions .iq-question-card').first()).toBeVisible({ timeout: 15000 });
    await expect(page.locator('#iq-history-list .rf-history-item').first()).toBeVisible({ timeout: 15000 });
    await expect(page.locator('#iq-questions .btn-copy').first()).toBeVisible();
    await expect(page.locator('#iq-questions .btn-save').first()).toBeVisible();
  });

  test('linkedin optimizer analysis + history works', async ({ page }) => {
    test.setTimeout(90000);
    await forceAuthenticatedPlan(page, 'premium');
    await mockLinkedInEndpoints(page);

    await page.goto('/linkedin-optimizer.html');
    await page.waitForLoadState('domcontentloaded');
    await waitForAuthReady(page, 15000);

    await page.fill('#lo-role', 'Senior Software Engineer');
    await page.fill('#lo-headline', 'Backend Engineer | Distributed Systems');
    await page.fill('#lo-summary', 'Engineer focused on scalable backend architecture and delivery.');
    await page.fill('#lo-experience', 'Led platform modernization and reduced incident volume by 30%.');
    await page.fill('#lo-skills', 'Node.js, PostgreSQL, Cloudflare Workers, CI/CD, Observability');
    await page.fill('#lo-recommendations', 'Team leadership and cross-functional collaboration.');

    await Promise.all([
      page.waitForResponse((response) => response.url().includes('/api/linkedin/analyze') && response.ok()),
      page.locator('#lo-analyze').click(),
    ]);

    await page.waitForFunction(() => {
      const scoreNode = document.getElementById('lo-score-text');
      if (!scoreNode) return false;
      const score = Number((scoreNode.textContent || '').trim());
      return Number.isFinite(score) && score > 0;
    }, null, { timeout: 20000 });

    await expect(page.locator('#lo-score-ring')).toBeVisible();
    await expect(page.locator('#lo-history-list .lo-history-item').first()).toBeVisible({ timeout: 15000 });
    await expect(page.locator('#lo-quickwins li').first()).toBeVisible();
  });

  test('cover letter generation + history works', async ({ page }) => {
    test.setTimeout(90000);
    await forceAuthenticatedPlan(page, 'pro');
    await mockCoverLetterEndpoints(page);

    await page.goto('/cover-letter-generator.html');
    await page.waitForLoadState('domcontentloaded');
    await waitForAuthReady(page, 15000);

    await page.fill('#cl-role', 'Software Engineer');
    await page.fill('#cl-company', 'Acme Corp');
    const seniorityDropdown = page.locator('#cl-seniority').locator('xpath=ancestor::div[contains(@class,"jh-dropdown")][1]');
    await seniorityDropdown.locator('.jh-dropdown__button').click();
    await seniorityDropdown.locator('.jh-dropdown__option[data-value="mid"]').click();
    await expect.poll(async () => page.locator('#cl-seniority').evaluate((el) => el.value)).toBe('mid');
    await page.fill('#cl-job-description', 'Build scalable APIs and improve platform reliability.');
    await page.fill('#cl-resume-text', '8+ years building backend systems and leading delivery in production environments.');
    await page.locator('#cl-generate').scrollIntoViewIfNeeded();
    await expect.poll(async () => {
      return page.evaluate(() => {
        const role = (document.getElementById('cl-role')?.value || '').trim();
        const seniority = (document.getElementById('cl-seniority')?.value || '').trim();
        const jobDescription = (document.getElementById('cl-job-description')?.value || '').trim();
        const resumeText = (document.getElementById('cl-resume-text')?.value || '').trim();
        return `${role}|${seniority}|${jobDescription}|${resumeText}`;
      });
    }).not.toContain('||');

    await Promise.all([
      page.waitForResponse((response) => response.url().includes('/api/cover-letter/generate') && response.ok()),
      page.locator('#cl-generate').dispatchEvent('click'),
    ]);

    await expect(page.locator('#cl-preview')).toHaveValue(/Dear Hiring Manager/, { timeout: 15000 });
    await expect(page.locator('#cl-history-list .cl-history-item').first()).toBeVisible({ timeout: 15000 });
    await expect(page.locator('#cl-download')).toBeVisible();
  });
});
