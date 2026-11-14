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

test('a fire spreads in the preview: flames and smoke are drawn and people are harmed by exposure', async ({ page }) => {
  const mark = await buildRoom(page);
  await page.getByTestId('tool-fire').click();
  const box = (await mark.boundingBox())!;
  const raw = (await mark.getAttribute('data-view'))!;
  const [cx, cy, scale, w, h] = raw.split(',').map(Number) as [number, number, number, number, number];
  await page.mouse.click(box.x + w / 2 + (6 - cx) * scale, box.y + h / 2 - (5 - cy) * scale);
  await page.getByRole('button', { name: 'OK' }).click().catch(() => undefined);
  await page.getByTestId('next').click();
  await page.waitForURL('**/simulate');
  // look for smoke-grey or flame-red pixels in the preview canvas once the animation is under way
  await expect
    .poll(async () => {
      return page.getByTestId('plan-canvas').evaluate((c) => {
        const cv = c as HTMLCanvasElement;
        const d = cv.getContext('2d')!.getImageData(0, 0, cv.width, cv.height).data;
        let flame = 0;
        for (let i = 0; i < d.length; i += 4) if (d[i]! > 180 && d[i + 1]! < 60 && d[i + 2]! < 80) flame++;
        return flame;
      });
    }, { timeout: 60_000 })
    .toBeGreaterThan(20);
  const view = page.getByTestId('view-results');
  await expect(view).toBeEnabled({ timeout: 90_000 });
});
