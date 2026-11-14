import { expect, test } from '@playwright/test';

test('settings apply immediately and persist', async ({ page }) => {
  await page.goto('/settings');
  await page.getByTestId('text-1.3').click();
  await page.getByTestId('set-contrast').check();
  await page.getByTestId('set-cb').check();
  const root = page.locator('html');
  await expect(root).toHaveAttribute('data-contrast', 'high');
  await expect(root).toHaveAttribute('data-palette', 'cb');
  expect(await root.evaluate((e) => e.style.getPropertyValue('--text-scale'))).toBe('1.3');
  await page.reload();
  await expect(root).toHaveAttribute('data-contrast', 'high');
  await page.getByTestId('settings-reset').click();
  await expect(root).toHaveAttribute('data-contrast', 'normal');
});

test('help shows authors and the three tabs', async ({ page }) => {
  await page.goto('/help');
  await expect(page.getByTestId('help-project')).toContainText('Nikhil Shukla');
  await expect(page.getByTestId('help-project')).toContainText('Apeejay School, Saket');
  await page.getByTestId('help-tab-guide').click();
  await expect(page.getByTestId('help-guide')).toContainText('ordered to leave');
  await page.getByTestId('help-tab-build').click();
  await expect(page.getByTestId('help-build')).toBeVisible();
});

test('example plan loads from settings and can be simulated', async ({ page }) => {
  await page.goto('/settings');
  await page.getByTestId('load-demo').click();
  await expect(page).toHaveURL(/\/mark$/);
  await expect(page.getByTestId('plan-canvas')).toBeVisible();
});

test('the trained estimator gives an instant estimate while marking and a cross-check on the results', async ({ page }) => {
  await page.goto('/settings');
  await page.getByTestId('load-demo').click();
  await expect(page.getByTestId('quick-estimate')).toContainText(/Quick estimate: last person out in about/, { timeout: 15000 });
  await page.goto('/simulate');
  await page.waitForURL('**/results', { timeout: 120000 });
  await expect(page.getByTestId('summary')).toContainText('What happened');
  await expect(page.getByTestId('estimate-check')).toContainText(/neural network/i);
  // headless Chromium has no WebGPU: the optional language-model button must not be offered
  await expect(page.getByTestId('narrate')).toHaveCount(0);
});
