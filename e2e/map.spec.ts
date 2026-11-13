import { expect, test } from '@playwright/test';

test('map path: earthquake M7 at Delhi affects people and simulates to results', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await page.getByRole('link', { name: /India map|Map/i }).first().click();
  await page.getByTestId('kind-earthquake').click();
  // the pin can be placed by tapping the map or by typing coordinates; typing works without WebGL as well
  await page.getByTestId('lat').fill('28.6');
  await page.getByTestId('lon').fill('77.2');
  await page.getByTestId('lon').press('Enter');
  await expect(page.getByTestId('magnitude')).toHaveValue('7');
  await page.getByTestId('compute').click();
  const pop = page.getByTestId('affected-pop');
  await expect(pop).toBeVisible();
  const n = Number((await pop.innerText()).replace(/[^0-9]/g, ''));
  expect(n).toBeGreaterThan(0);
  await page.screenshot({ path: 'e2e/screens/map-affected.png' });
  await page.getByTestId('begin-sim').click();
  await page.waitForURL('**/results', { timeout: 90_000 });
  await expect(page.getByTestId('p95')).toBeVisible();
  await expect(page.getByTestId('map-results')).toBeVisible();
  await page.screenshot({ path: 'e2e/screens/map-results.png' });
  expect(errors).toEqual([]);
});

test('map path: the Thar desert cannot flood from implausible rain, and the reason is stated', async ({ page }) => {
  await page.goto('/map');
  await page.getByTestId('kind-flood').click();
  await page.getByTestId('lat').fill('26.9'); // Jaisalmer, Thar desert
  await page.getByTestId('lon').fill('70.9');
  await page.getByTestId('lon').press('Enter');
  await page.getByTestId('rain').fill('600');
  await expect(page.getByTestId('plausibility')).toContainText(/Not credible/i);
  await expect(page.getByTestId('compute')).toBeDisabled();
  await page.getByTestId('rain').fill('120');
  await expect(page.getByTestId('compute')).toBeEnabled();
});

test('map path: a flood that rain can cause: Patna, with the model explained', async ({ page }) => {
  await page.goto('/map');
  await page.getByTestId('kind-flood').click();
  await page.getByTestId('lat').fill('25.6');
  await page.getByTestId('lon').fill('85.1');
  await page.getByTestId('lon').press('Enter');
  await page.getByTestId('rain').fill('300');
  await page.getByTestId('compute').click();
  await expect(page.getByTestId('affected-pop')).toBeVisible();
  await page.getByText(/How this flood was modelled/).click();
  await expect(page.getByTestId('model-facts')).toContainText(/Curve Number/);
});

test('map path: a cyclone moves, the replay shows a clock, and results follow', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/map');
  await page.getByTestId('kind-cyclone').click();
  await page.getByTestId('lat').fill('19.8');
  await page.getByTestId('lon').fill('85.8');
  await page.getByTestId('lon').press('Enter');
  await page.getByTestId('compute').click();
  await expect(page.getByTestId('affected-pop')).toBeVisible();
  await page.getByTestId('begin-sim').click();
  await expect(page.getByTestId('replay-clock')).toBeVisible();
  const first = await page.getByTestId('replay-clock').innerText();
  await page.waitForTimeout(2500);
  const later = await page.getByTestId('replay-clock').innerText();
  expect(later).not.toBe(first); // the hazard is visibly progressing, not jumping to the end
  await page.waitForURL('**/results', { timeout: 120_000 });
  await expect(page.getByTestId('p95')).toBeVisible();
  expect(errors).toEqual([]);
});

test('map path: a cyclone cannot start inland', async ({ page }) => {
  await page.goto('/map');
  await page.getByTestId('kind-cyclone').click();
  await page.getByTestId('lat').fill('26.9'); // Jaipur
  await page.getByTestId('lon').fill('75.8');
  await page.getByTestId('lon').press('Enter');
  await page.getByTestId('compute').click();
  await expect(page.getByRole('alert')).toContainText(/coast/i);
});

test('map path: no great earthquake on the stable peninsula', async ({ page }) => {
  await page.goto('/map');
  await page.getByTestId('kind-earthquake').click();
  await page.getByTestId('lat').fill('17.4');
  await page.getByTestId('lon').fill('78.5');
  await page.getByTestId('lon').press('Enter');
  await page.getByTestId('magnitude').fill('8.3');
  await expect(page.getByTestId('plausibility')).toContainText(/Not credible/i);
  await expect(page.getByTestId('compute')).toBeDisabled();
});
