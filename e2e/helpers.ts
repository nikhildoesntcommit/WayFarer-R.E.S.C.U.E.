import type { Locator, Page } from '@playwright/test';

/** Plan metres -> page pixels for the plan canvas currently on screen. */
export async function worldToPage(page: Page, canvas: Locator, x: number, y: number): Promise<{ x: number; y: number }> {
  const box = (await canvas.boundingBox())!;
  const raw = (await canvas.getAttribute('data-view'))!;
  const [cx, cy, scale, w, h] = raw.split(',').map(Number) as [number, number, number, number, number];
  return { x: box.x + w / 2 + (x - cx) * scale, y: box.y + h / 2 - (y - cy) * scale };
}

export async function dragWall(page: Page, canvas: Locator, a: [number, number], b: [number, number]) {
  const p = await worldToPage(page, canvas, a[0], a[1]);
  const q = await worldToPage(page, canvas, b[0], b[1]);
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  await page.mouse.move((p.x + q.x) / 2, (p.y + q.y) / 2, { steps: 3 });
  await page.mouse.move(q.x, q.y, { steps: 3 });
  await page.mouse.up();
}

export async function tapWorld(page: Page, canvas: Locator, x: number, y: number) {
  const p = await worldToPage(page, canvas, x, y);
  await page.mouse.click(p.x, p.y);
}

/** Draw a closed rectangular room with two final exits and one people area; stops on the marking screen. */
export async function buildRoom(page: Page) {
  await page.goto('/');
  await page.getByRole('link', { name: /Draw a layout/i }).click();
  const canvas = page.getByTestId('plan-canvas');
  await canvas.waitFor();
  await dragWall(page, canvas, [2, 2], [14, 2]);
  await dragWall(page, canvas, [14, 2], [14, 9]);
  await dragWall(page, canvas, [14, 9], [2, 9]);
  await dragWall(page, canvas, [2, 9], [2, 2]);

  await page.getByTestId('tool-door').click();
  await tapWorld(page, canvas, 8, 2);
  await page.getByRole('button', { name: 'OK' }).click();
  await tapWorld(page, canvas, 14, 5.5);
  await page.getByRole('button', { name: 'OK' }).click();

  await page.getByTestId('next').click(); // Continue to marking
  await page.waitForURL('**/mark');
  const mark = page.getByTestId('plan-canvas');
  await page.getByTestId('tool-area').click();
  await dragWall(page, mark, [4, 4], [10, 8]); // rectangle drag
  await page.getByLabel(/People in this area/i).fill('40');
  await page.getByRole('button', { name: 'OK' }).click();
  return mark;
}
