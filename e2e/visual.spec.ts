import { expect, test } from '@playwright/test';
import { buildRoom } from './helpers';

// Not an assertion-heavy test: it leaves screenshots in e2e/screens for a human to look at, desktop and phone width.
for (const vp of [{ name: 'desktop', width: 1100, height: 760 }, { name: 'phone', width: 390, height: 780 }]) {
  test(`screens at ${vp.name} width`, async ({ page }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.goto('/');
    await page.screenshot({ path: `e2e/screens/${vp.name}-home.png` });
    await buildRoom(page);
    await page.screenshot({ path: `e2e/screens/${vp.name}-mark.png` });
    await page.getByTestId('next').click();
    await page.getByTestId('view-results').click({ timeout: 90_000 });
    await page.waitForURL('**/results');
    await page.waitForTimeout(1200);
    await page.screenshot({ path: `e2e/screens/${vp.name}-results.png`, fullPage: true });
    // no horizontal page scroll at any width
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });
}
