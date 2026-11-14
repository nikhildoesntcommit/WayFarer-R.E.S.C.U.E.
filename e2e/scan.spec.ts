import { expect, test } from '@playwright/test';

test.describe('scan without a camera', () => {
  test('shows the error and a "Use draw mode" way out', async ({ page }) => {
    // headless Chromium has no camera device: getUserMedia rejects
    await page.addInitScript(() => {
      navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('no camera', 'NotFoundError'));
    });
    await page.goto('/');
    await page.getByRole('link', { name: /Scan a room/i }).click();
    await page.getByTestId('scan-opt-camera').click();
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
    await page.goto('/scan/camera');
    await expect(page.getByTestId('camera-error')).toContainText(/denied/i);
  });
});

test.describe('scan with a fake camera and emulated gyroscope', () => {
  test.use({ permissions: ['camera', 'accelerometer', 'gyroscope', 'magnetometer'] });

  test('four corner taps -> calibrate -> marking with a closed perimeter', async ({ page, context }) => {
    await page.goto('/scan/camera');
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

test.describe('other ways to scan', () => {
  test('type the size: a rectangle goes straight to marking with a closed perimeter', async ({ page }) => {
    await page.goto('/scan');
    await expect(page.getByTestId('scan-opt-ar')).toHaveCount(0); // no WebXR in this browser
    await page.getByTestId('scan-opt-size').click();
    await expect(page.getByTestId('size-make')).toBeDisabled();
    await page.getByTestId('size-length').fill('12');
    await page.getByTestId('size-width').fill('7.5');
    await page.getByTestId('size-make').click();
    await page.waitForURL('**/mark');
    await expect(page.getByTestId('validation')).toContainText('Perimeter closed');
  });

  test('type the size: an L-shape and a nonsense size is refused', async ({ page }) => {
    await page.goto('/scan/size');
    await page.getByTestId('shape-l').click();
    await page.getByTestId('size-length').fill('10');
    await page.getByTestId('size-width').fill('6');
    await page.getByTestId('size-nl').fill('12');
    await page.getByTestId('size-nw').fill('2');
    await expect(page.getByRole('alert')).toContainText(/smaller/i);
    await page.getByTestId('size-nl').fill('4');
    await page.getByTestId('size-nw').fill('3');
    await page.getByTestId('size-make').click();
    await page.waitForURL('**/mark');
  });

  test('walk the walls: steps and compass headings from emulated sensors give a closed room', async ({ page, context }) => {
    await page.goto('/scan/walk');
    await page.getByTestId('walk-start').click();
    const cdp = await context.newCDPSession(page);
    await expect(page.getByTestId('walk-readout')).toBeVisible();
    // walk a 8 × 5 m rectangle: 0.7 m steps at 1.8 steps/s; headings are alpha = 360 - heading
    const walk = async (heading: number, metres: number) => {
      await cdp.send('DeviceOrientation.setDeviceOrientationOverride', { alpha: (360 - heading) % 360, beta: 0, gamma: 0 });
      const steps = Math.round(metres / 0.7);
      await page.evaluate(async (n) => {
        const dt = 1000 / 50;
        for (let k = 0; k < Math.round((n / 1.8) * 50) + 10; k++) {
          const t = (k * dt) / 1000;
          const mag = 9.81 + 2.2 * Math.sin(2 * Math.PI * 1.8 * t);
          const ev = new Event('devicemotion') as Event & { accelerationIncludingGravity: unknown };
          ev.accelerationIncludingGravity = { x: 0, y: 0, z: mag };
          window.dispatchEvent(ev);
          await new Promise((r) => setTimeout(r, 4));
        }
      }, steps);
    };
    await walk(90, 8);
    await page.getByTestId('walk-corner').click();
    await walk(0, 5);
    await page.getByTestId('walk-corner').click();
    await walk(270, 8);
    await page.getByTestId('walk-corner').click();
    await walk(180, 5);
    await page.getByTestId('walk-finish').click();
    await page.waitForURL('**/calibrate');
    await page.getByTestId('calibrate-continue').click();
    await page.waitForURL('**/mark');
    await expect(page.getByTestId('validation')).toContainText('Perimeter closed');
  });

  test('AR scan: with a stand-in WebXR hit-test, corners placed while walking become the plan', async ({ page }) => {
    await page.addInitScript(() => {
      let n = 0;
      const corners = [[0, 0], [6, 0], [6, -4], [0, -4]]; // x right, z towards viewer (so plan y = -z)
      const hits = () => {
        const [x, z] = corners[Math.min(n, corners.length - 1)]!;
        return [{ getPose: () => ({ transform: { position: { x, y: 0, z } } }) }];
      };
      const session = {
        renderState: { baseLayer: { framebuffer: null } },
        updateRenderState: () => undefined,
        requestReferenceSpace: async () => ({}),
        requestHitTestSource: async () => ({}),
        addEventListener: () => undefined,
        requestAnimationFrame: (cb: (t: number, f: unknown) => void) => window.setTimeout(() => cb(0, { getHitTestResults: hits }), 30),
        end: async () => undefined,
      };
      Object.defineProperty(navigator, 'xr', {
        configurable: true,
        value: { isSessionSupported: async () => true, requestSession: async () => session },
      });
      (window as unknown as { XRWebGLLayer: unknown }).XRWebGLLayer = class {};
      (window as unknown as { __nextCorner: () => void }).__nextCorner = () => { n++; };
    });
    await page.goto('/scan');
    await page.getByTestId('scan-opt-ar').click();
    await page.getByTestId('ar-start').click();
    await expect(page.getByTestId('ar-hud')).toBeVisible();
    for (let i = 0; i < 4; i++) {
      await page.waitForTimeout(550); // the point is the median of the last 0.4 s, so let the stand-in settle on the new corner
      await page.getByTestId('ar-place').click();
      await page.evaluate(() => (window as unknown as { __nextCorner: () => void }).__nextCorner());
    }
    await expect(page.getByText(/4\s*corners/)).toBeVisible();
    await page.getByTestId('ar-done').click();
    await page.waitForURL('**/calibrate');
    await page.getByTestId('calibrate-continue').click();
    await page.waitForURL('**/mark');
    await expect(page.getByTestId('validation')).toContainText('Perimeter closed');
  });
});
