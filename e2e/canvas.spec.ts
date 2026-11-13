import { expect, test } from '@playwright/test';
import { buildRoom, dragWall } from './helpers';

type View = { cx: number; cy: number; scale: number };
const view = async (canvas: import('@playwright/test').Locator): Promise<View> => {
  await canvas.page().waitForTimeout(80); // data-view is published on the next animation frame
  const [cx, cy, scale] = (await canvas.getAttribute('data-view'))!.split(',').map(Number) as [number, number, number];
  return { cx, cy, scale };
};

test('panning and zooming work with every input a person might use', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('link', { name: /Draw a layout/i }).click();
  const canvas = page.getByTestId('plan-canvas');
  await canvas.waitFor();
  const box = (await canvas.boundingBox())!;
  const mid = { x: box.x + box.width / 2, y: box.y + box.height / 2 };

  // zoom buttons reach campus scale (the old floor was 2 px/m)
  const v0 = await view(canvas);
  for (let i = 0; i < 8; i++) await page.getByTestId('zoom-out').click();
  const far = await view(canvas);
  expect(far.scale).toBeLessThan(v0.scale / 10);
  expect(far.scale).toBeGreaterThanOrEqual(0.25);
  for (let i = 0; i < 8; i++) await page.getByTestId('zoom-in').click();
  await page.waitForTimeout(200); // let the last repaint publish data-view

  // trackpad two-finger scroll PANS (it used to zoom wildly)
  const before = await view(canvas);
  await page.mouse.move(mid.x, mid.y);
  await page.mouse.wheel(60, 40.5);
  await expect.poll(async () => (await view(canvas)).cx).not.toBe(before.cx);
  const afterScroll = await view(canvas);
  expect(afterScroll.scale).toBeCloseTo(before.scale, 6);

  // Pan tool drag
  await page.getByTestId('tool-pan').click();
  await page.mouse.move(mid.x, mid.y);
  await page.mouse.down();
  await page.mouse.move(mid.x + 120, mid.y + 40, { steps: 4 });
  await page.mouse.up();
  const afterPan = await view(canvas);
  expect(afterPan.cx).toBeLessThan(afterScroll.cx);

  // Space + drag pans while the wall tool is active, and draws no wall
  await page.getByTestId('tool-wall').click();
  await page.mouse.move(mid.x, mid.y); // hover the canvas, then hold Space
  await page.keyboard.down('Space');
  await page.mouse.down();
  await page.mouse.move(mid.x - 150, mid.y, { steps: 4 });
  await page.mouse.up();
  await page.keyboard.up('Space');
  const afterSpace = await view(canvas);
  expect(afterSpace.cx).toBeGreaterThan(afterPan.cx);

  // dragging a wall against the canvas edge scrolls the view so a long wall can be finished
  const b = await view(canvas);
  await page.mouse.move(mid.x, mid.y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 6, mid.y, { steps: 6 });
  await page.waitForTimeout(500);
  const scrolled = await view(canvas);
  await page.mouse.up();
  expect(scrolled.cx).toBeGreaterThan(b.cx + 1);
});

test('the simulation preview can be panned with a plain drag', async ({ page }) => {
  await buildRoom(page);
  await page.getByTestId('next').click();
  await page.waitForURL('**/simulate');
  const canvas = page.getByTestId('plan-canvas');
  await canvas.waitFor();
  const box = (await canvas.boundingBox())!;
  const before = await view(canvas);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 100, box.y + box.height / 2, { steps: 4 });
  await page.mouse.up();
  const after = await view(canvas);
  expect(after.cx).toBeLessThan(before.cx);
  void dragWall;
});
