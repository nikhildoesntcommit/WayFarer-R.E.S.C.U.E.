import { expect, test } from '@playwright/test';

test.describe('scan without a camera', () => {
  test('shows the error and a "Use draw mode" way out', async ({ page }) => {
    // headless Chromium has no camera device: getUserMedia rejects
    await page.addInitScript(() => {
      navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('no camera', 'NotFoundError'));
    });
    await page.goto('/');
    await page.getByRole('link', { name: /Scan a room/i }).click();
    await expect(page.getByTestId('camera-error')).toContainText(/camera/i);
    const useDraw = page.getByRole('button', { name: /Use draw mode instead/i });
    await expect(useDraw).toBeVisible();
    await useDraw.click();
    await page.waitForURL('**/draw');
  });

  test('permission denied is reported as such', async ({ page }) => {
    await page.addInitScript(() => {
      navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('denied', 'NotAllowedError'));
    });
    await page.goto('/scan');
    await expect(page.getByTestId('camera-error')).toContainText(/denied/i);
  });
});

test.describe('scan with a fake camera and emulated gyroscope', () => {
  test.use({ permissions: ['camera', 'accelerometer', 'gyroscope', 'magnetometer'] });

  test('four corner taps -> calibrate -> marking with a closed perimeter', async ({ page, context }) => {
    await page.goto('/scan');
    const stage = page.getByTestId('scan-stage');
    await expect(page.locator('video')).toBeVisible();
    const cdp = await context.newCDPSession(page);
    // recent Chromium exposes requestPermission() like iOS does, so the app asks for a tap first
    const enable = page.getByRole('button', { name: /Enable motion sensors/i });
    if (await enable.isVisible()) await enable.click();
    const box = (await stage.boundingBox())!;
    const aim = async (alpha: number, beta: number) => {
      await cdp.send('DeviceOrientation.setDeviceOrientationOverride', { alpha, beta, gamma: 0 });
      await page.waitForTimeout(400);
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    };
    // alpha grows counter-clockwise, so headings 0/90/180/270 are alpha 0/270/180/90
    await aim(0, 45);   // 1.40 m north
    await aim(270, 40); // east, a little farther
    await aim(180, 45);
    await aim(90, 40);
    await expect(page.getByText(/4\s*corners/)).toBeVisible();
    await page.getByTestId('scan-done').click();
    await page.waitForURL('**/calibrate');
    await page.getByTestId('calibrate-continue').click();
    await page.waitForURL('**/mark');
    await expect(page.getByTestId('validation')).toContainText('Perimeter closed');
    await expect(page.getByTestId('validation').locator('.ok').first()).toBeVisible();
  });
});
