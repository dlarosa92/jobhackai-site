const { test, expect } = require('@playwright/test');
const path = require('path');

test.describe('Resume Feedback', () => {
  test('should upload resume and receive ATS score', async ({ page }) => {
    await page.goto('/resume-feedback-pro.html');
    await page.waitForLoadState('networkidle');
    
    // Find file input using actual selector from resume-feedback-pro.html
    const fileInput = page.locator('#rf-upload');
    await expect(fileInput).toBeVisible();
    
    // Use test resume from fixtures
    const testResume = path.join(__dirname, '../fixtures/sample-resume.pdf');
    await fileInput.setInputFiles(testResume);
    
    // Wait for upload API response
    await page.waitForResponse(
      response => response.url().includes('/api/resume-upload') && response.status() === 200,
      { timeout: 30000 }
    );
    
    // Wait for score badge to appear (check for score element)
    // The score appears in .rf-score-badge or similar elements
    await page.waitForSelector('.rf-score-badge, [class*="score"]', { timeout: 60000 });
    
    // Verify score is displayed
    const scoreElement = page.locator('.rf-score-badge, [class*="score"]').first();
    await expect(scoreElement).toBeVisible();
    
    const scoreText = await scoreElement.textContent();
    expect(scoreText).toMatch(/\d+/); // Should contain a number
  });
});

