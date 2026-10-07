import { expect, test } from '@playwright/test';
import {
  bubble,
  bubbles,
  center,
  drag,
  freshStart,
  linkMidpoint,
  links,
  selectOnly,
  status,
} from './helpers';

test.beforeEach(async ({ page }) => {
  await freshStart(page);
});

test('dragging the link chip onto a bubble connects them', async ({ page }) => {
  await selectOnly(page, bubble(page, 'Double-tap'));
  const chip = await center(page.locator('.chip-link'));
  await drag(page, chip, await center(bubble(page, 'Press ?')));
  await expect(links(page)).toHaveCount(4);
  await expect(status(page)).toHaveText('Connected!');
});

test('dropping the link chip on empty space sprouts a connected bubble', async ({ page }) => {
  await selectOnly(page, bubble(page, 'Press ?'));
  const chip = await center(page.locator('.chip-link'));
  await drag(page, chip, { x: 1150, y: 200 });
  await expect(bubbles(page)).toHaveCount(5);
  await expect(links(page)).toHaveCount(4);
  await expect(page.locator('.bubble.is-editing .label')).toBeFocused();
});

test('connect mode links two tapped bubbles', async ({ page }) => {
  const toggle = page.locator('[data-command="connect"]');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await expect(status(page)).toContainText('tap the first bubble');

  await bubble(page, 'Double-tap').click();
  await expect(bubble(page, 'Double-tap')).toHaveClass(/is-link-source/);
  await expect(status(page)).toContainText('Now tap');
  await bubble(page, 'Drag the').click();
  await expect(links(page)).toHaveCount(4);

  await page.keyboard.press('Escape');
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
});

test('existing connections are not duplicated', async ({ page }) => {
  await page.keyboard.press('c');
  await bubble(page, 'Big idea').click();
  await bubble(page, 'Press ?').click();
  await expect(status(page)).toHaveText('Those bubbles are already connected');
  await expect(links(page)).toHaveCount(3);
});

test('a wire can be selected and cut', async ({ page }) => {
  const link = links(page).first();
  const mid = await linkMidpoint(link);
  await page.mouse.click(mid.x, mid.y);
  await expect(link).toHaveClass(/is-selected/);
  await page.getByRole('button', { name: /Cut connection/ }).click();
  await expect(links(page)).toHaveCount(2);
  await expect(bubbles(page)).toHaveCount(4);
});

test('tidy untangles overlapping bubbles', async ({ page }) => {
  const a = bubble(page, 'Double-tap');
  const b = bubble(page, 'Press ?');
  await drag(page, await center(a), await center(b)); // pile them up
  await page.locator('[data-command="tidy"]').click();
  await expect(status(page)).toHaveText('Tidied up');
  const pa = await center(a);
  const pb = await center(b);
  const radius = (await a.boundingBox())!.width / 2;
  expect(Math.hypot(pa.x - pb.x, pa.y - pb.y)).toBeGreaterThan(radius * 2);
});
