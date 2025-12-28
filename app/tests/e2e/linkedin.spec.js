const { test, expect } = require('@playwright/test');

test.describe('LinkedIn Optimizer E2E (mocked AI, real auth)', () => {
  // Deterministic fixture response for analyze/run/history/regenerate
  const analyzeResponse = {
    overallScore: 87,
    keywordsToAdd: ['Data Engineering','Big Data','Data Integration','Data Pipeline','Data Analytics'],
    quickWins: ['Add specific metrics to achievements','Highlight collaboration','Emphasize cloud migration experience'],
    sections: {
      headline: { score: 90, label: 'Optimized', feedbackBullets: ['Clear and impactful','Includes relevant skills'], optimizedText: 'Data Engineer — Cloud ETL & Pipelines' },
      summary: { score: 85, label: 'Good', feedbackBullets: ['Strong opening','Add metrics'], optimizedText: 'Senior Data Engineer...' },
      experience: { score: 88, label: 'Optimized', feedbackBullets: ['Achievements articulated','Add quant results'], optimizedText: 'Led migration...' },
      skills: { score: 80, label: 'Optimized', feedbackBullets: ['Comprehensive list','Prioritize based on role'], optimizedText: 'Python, SQL, Spark...' }
    }
  };

  test.beforeEach(async ({ page }) => {
    // Mock analyze POST
    await page.route('**/api/linkedin/analyze', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ...analyzeResponse })
      });
    });

    // Mock run GET
    await page.route('**/api/linkedin/run*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          run_id: 'run-1',
          created_at: Date.now(),
          updated_at: Date.now(),
          role: 'Data Engineer',
          ...analyzeResponse
        })
      });
    });

    // Mock history
    await page.route('**/api/linkedin/history', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          items: [{ id: 'run-1', role: 'Data Engineer', overallScore: analyzeResponse.overallScore, createdAt: Date.now() }]
        })
      });
    });

    // Mock regenerate POST (improved headline)
    await page.route('**/api/linkedin/regenerate', async (route) => {
      const newOutput = JSON.parse(JSON.stringify(analyzeResponse));
      newOutput.sections.headline.score = 95;
      newOutput.overallScore = 89;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ run_id: 'run-2', ...newOutput })
      });
    });
  });

  test('submit analyze → normalized overall + PDF', async ({ page }) => {
    await page.goto('/linkedin-optimizer.html');
    await page.fill('#lo-role', 'Data Engineer');
    await page.fill('#lo-headline', 'Data Engineer');
    await page.fill('#lo-summary', 'Summary about data engineering experience');
    await page.fill('#lo-experience', 'Experience details');
    await page.fill('#lo-skills', 'Python, SQL');
    await page.click('#lo-analyze');

    const scoreText = page.locator('#lo-score-text');
    await expect(scoreText).toHaveText(String(analyzeResponse.overallScore));

    // Trigger download PDF (calls print builder)
    await page.click('#lo-download');
    const print = page.locator('#lo-print');
    await expect(print).toContainText(`Overall Score: ${analyzeResponse.overallScore}`);
  });

  test('section badges show rubric points and tooltip contains percent', async ({ page }) => {
    await page.goto('/linkedin-optimizer.html');
    await page.fill('#lo-role', 'Data Engineer');
    await page.fill('#lo-headline', 'Data Engineer');
    await page.fill('#lo-summary', 'Summary');
    await page.fill('#lo-experience', 'Experience');
    await page.fill('#lo-skills', 'Skills');
    await page.click('#lo-analyze');

    const headlineBadge = page.locator('[data-section="headline"] .lo-badge');
    await expect(headlineBadge).toHaveText('18/20');
    await expect(headlineBadge).toHaveAttribute('title', `${analyzeResponse.sections.headline.score}/100`);
  });

  test('history load preserves normalized scores and regenerate updates', async ({ page }) => {
    await page.goto('/linkedin-optimizer.html');
    await page.fill('#lo-role', 'Data Engineer');
    await page.fill('#lo-headline', 'Data Engineer');
    await page.fill('#lo-summary', 'Summary');
    await page.fill('#lo-experience', 'Experience');
    await page.fill('#lo-skills', 'Skills');
    await page.click('#lo-analyze');

    await page.waitForSelector('.lo-history-item');
    await page.click('.lo-history-item');

    const scoreText = page.locator('#lo-score-text');
    await expect(scoreText).toHaveText(String(analyzeResponse.overallScore));

    const regenBtn = page.locator('[data-section="headline"] button[data-action="regen"]');
    await regenBtn.click();

    const headlineBadge = page.locator('[data-section="headline"] .lo-badge');
    await expect(headlineBadge).toHaveText('19/20'); // 95 -> 19/20

    await expect(page.locator('.lo-history-item')).toContainText('Data Engineer');
  });
});


