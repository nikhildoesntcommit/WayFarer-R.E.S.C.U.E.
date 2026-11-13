import { expect, test } from '@playwright/test';

test('after one online visit the app works offline, including the map path and its data', async ({ page, context }) => {
  await page.goto('/');
  // wait for the service worker to take control and finish precaching
  await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) {
      await new Promise<void>((res) => navigator.serviceWorker.addEventListener('controllerchange', () => res(), { once: true }));
    }
    return reg.active?.state;
  }).catch(() => undefined);
  await page.waitForFunction(async () => (await caches.keys()).some((k) => k.includes('precache')), undefined, { timeout: 60_000 });
  // give Workbox a moment to finish storing the data files
  await page.waitForTimeout(3000);
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);

  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('link', { name: /Draw a layout/i })).toBeVisible();

  // map path, offline: data files come from the precache
  await page.getByRole('link', { name: /India map|Map/i }).first().click();
  await page.getByTestId('kind-earthquake').click();
  await page.getByTestId('lat').fill('28.6');
  await page.getByTestId('lon').fill('77.2');
  await page.getByTestId('lon').press('Enter');
  await page.getByTestId('compute').click();
  await expect(page.getByTestId('affected-pop')).toBeVisible();
  await page.getByTestId('begin-sim').click();
  await page.waitForURL('**/results', { timeout: 90_000 });
  await expect(page.getByTestId('p95')).toBeVisible();
  await context.setOffline(false);
});
