import { expect, test } from '@playwright/test';
import { buildRoom } from './helpers';

test('draw a room, simulate 200 trials, read results', async ({ page }) => {
  await buildRoom(page);
  // validation bar is satisfied: all blocking checks pass
  const next = page.getByTestId('next');
  await expect(next).toBeEnabled();
  await next.click();
  await page.waitForURL('**/simulate');
  const view = page.getByTestId('view-results');
  await expect(view).toBeEnabled({ timeout: 90_000 });
  await view.click();
  await page.waitForURL('**/results');
  const p95 = Number(await page.getByTestId('p95').innerText().then((t) => t.replace(/[^0-9.]/g, '')));
  expect(p95).toBeGreaterThan(5);
  expect(p95).toBeLessThan(1200);
  await expect(page.getByText('Findings', { exact: true })).toBeVisible();
  await page.screenshot({ path: 'e2e/screens/results-draw.png' });
});
