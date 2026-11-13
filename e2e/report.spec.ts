import { writeFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { buildRoom } from './helpers';

test('what-if, report, print-to-PDF and JSON export', async ({ page }) => {
  await buildRoom(page);
  await page.getByTestId('next').click();
  await page.waitForURL('**/simulate');
  await page.getByTestId('view-results').click({ timeout: 90_000 });
  await page.waitForURL('**/results');
  const before = Number((await page.getByTestId('p95').innerText()).replace(/[^0-9.]/g, ''));

  // what-if: take the first finding that carries an automatic change
  const tryIt = page.getByTestId('try-this').first();
  if (await tryIt.isVisible().catch(() => false)) {
    await tryIt.click();
    await expect(page.getByTestId('whatif-table')).toBeVisible({ timeout: 90_000 });
    await page.getByTestId('keep-change').click();
    const after = Number((await page.getByTestId('p95').innerText()).replace(/[^0-9.]/g, ''));
    expect(Number.isFinite(after)).toBe(true);
    expect(after).toBeLessThanOrEqual(before * 1.05);
  }

  await page.getByTestId('open-report').click();
  await page.waitForURL('**/report');
  await page.getByLabel('Analyst name').fill('A. Analyst');
  await page.getByLabel('Mentor name').fill('M. Mentor');
  await expect(page.getByTestId('report')).toContainText('A. Analyst');

  const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('share-json').click()]);
  expect(download.suggestedFilename()).toMatch(/\.json$/);

  await page.emulateMedia({ media: 'print' });
  const pdf = await page.pdf({ format: 'A4', printBackground: true });
  expect(pdf.length).toBeGreaterThan(5_000);
  expect(pdf.subarray(0, 4).toString()).toBe('%PDF');
  writeFileSync('e2e/screens/report.pdf', pdf);
});
