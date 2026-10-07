import { expect, test, type Page } from '@playwright/test';
import { bubble, bubbles, center, freshStart } from './helpers';

test.beforeEach(async ({ page }) => {
  await freshStart(page);
});

/** Two-finger gesture via CDP; Playwright has no multi-touch API. */
async function pinch(
  page: Page,
  at: { x: number; y: number },
  from: number,
  to: number,
): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  const points = (spread: number) => [
    { x: at.x - spread / 2, y: at.y, id: 0 },
    { x: at.x + spread / 2, y: at.y, id: 1 },
  ];
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: points(from) });
  for (let i = 1; i <= 10; i++) {
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: points(from + ((to - from) * i) / 10),
    });
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

test('double-tap blows a bubble @touch', async ({ page }) => {
  const spot = { x: 30, y: 100 }; // left of the map, below the toolbar
  const hit = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.id, spot);
  expect(hit).toBe('canvas');
  await page.touchscreen.tap(spot.x, spot.y);
  await page.touchscreen.tap(spot.x, spot.y);
  await expect(bubbles(page)).toHaveCount(5);
  await expect(page.locator('.bubble.is-editing .label')).toBeFocused();
});

test('tap selects and shows chips @touch', async ({ page }) => {
  const root = bubble(page, 'Big idea');
  await root.tap();
  await expect(root).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.chip-link')).toBeVisible();
});

test('pinch zooms the canvas @touch', async ({ page }) => {
  const zoom = page.locator('.zoom-level');
  const start = parseInt((await zoom.textContent()) ?? '0', 10);
  await pinch(page, await center(page.locator('#canvas')), 100, 220);
  await expect
    .poll(async () => parseInt((await zoom.textContent()) ?? '0', 10))
    .toBeGreaterThan(start * 1.5);
});
