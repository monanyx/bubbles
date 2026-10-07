import { expect, test } from '@playwright/test';
import { bubble, bubbles, freshStart, links, selectOnly, status } from './helpers';

test.beforeEach(async ({ page }) => {
  await freshStart(page);
});

test('Tab on a toolbar button moves focus instead of sprouting a bubble', async ({ page }) => {
  await selectOnly(page, bubble(page, 'Big idea'));
  const zoomIn = page.locator('[data-command="zoom-in"]');
  await zoomIn.focus();
  await page.keyboard.press('Tab');
  await expect(bubbles(page)).toHaveCount(4);
  await expect(page.locator('[data-command="zoom-fit"]')).toBeFocused();
});

test('a bubble reached with Tab responds to Enter and the arrow keys', async ({ page }) => {
  await page.keyboard.press('Tab');
  const root = bubble(page, 'Big idea');
  await expect(root).toBeFocused();
  await expect(root).toHaveAttribute('aria-selected', 'false');

  await page.keyboard.press('Enter');
  await expect(root).toHaveClass(/is-editing/);
  await page.keyboard.press('Escape');
  await expect(root).toBeFocused();

  await page.keyboard.press('Escape'); // deselect; focus stays on the bubble
  await expect(root).toHaveAttribute('aria-selected', 'false');
  await page.keyboard.press('ArrowRight');
  const tip = bubble(page, 'Press ?');
  await expect(tip).toBeFocused();
  await expect(tip).toHaveAttribute('aria-selected', 'true');
});

test('two bubbles can be connected without a pointer', async ({ page }) => {
  await page.keyboard.press('Tab'); // Big idea
  await page.keyboard.press('ArrowLeft'); // → the left tip, now selected
  await expect(bubble(page, 'Double-tap')).toBeFocused();
  await page.keyboard.press('c'); // connect mode, from the selected bubble
  await expect(bubble(page, 'Double-tap')).toHaveClass(/is-link-source/);
  await page.keyboard.press('ArrowRight'); // focus hops to the bottom tip
  await expect(bubble(page, 'Drag the')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(links(page)).toHaveCount(4);
  await expect(status(page)).toHaveText('Connected!');
});

test('Delete keeps keyboard focus on a neighbouring bubble', async ({ page }) => {
  await selectOnly(page, bubble(page, 'Press ?'));
  await page.keyboard.press('Delete');
  await expect(bubbles(page)).toHaveCount(3);
  const focused = page.locator('.bubble:focus');
  await expect(focused).toHaveCount(1);
  await expect(focused).toHaveAttribute('aria-selected', 'true');
  await expect(focused).toContainText('Big idea'); // wired to the popped tip
});

test('a disabled toolbar button hands focus back to the canvas', async ({ page }) => {
  const clear = page.locator('[data-command="clear"]');
  await clear.focus();
  await page.keyboard.press('Enter');
  await expect(bubbles(page)).toHaveCount(0);
  await expect(clear).toBeDisabled();
  await expect(page.locator('#canvas')).toBeFocused();
});

test('File menu arrows skip disabled items and stay inside the menu', async ({ page }) => {
  await page.locator('[data-command="clear"]').click();
  await expect(bubbles(page)).toHaveCount(0);
  await page.locator('#file-button').focus();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('menuitem', { name: /Open/ })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown'); // past the disabled export items
  await expect(page.getByRole('menuitem', { name: /welcome map/ })).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('menuitem', { name: /welcome map/ })).toBeFocused();
});

test('Escape on the File button closes a menu opened with the mouse', async ({ page }) => {
  const button = page.locator('#file-button');
  await button.click();
  await expect(page.getByRole('menu', { name: 'File' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu', { name: 'File' })).toBeHidden();
});

test('space-to-pan ends when Space is released over a button', async ({ page }) => {
  await page.mouse.click(60, 400); // focus the canvas
  await page.keyboard.down(' ');
  await expect(page.locator('#canvas')).toHaveClass(/space-pan/);
  await page.locator('[data-command="zoom-fit"]').focus();
  await page.keyboard.up(' ');
  await expect(page.locator('#canvas')).not.toHaveClass(/space-pan/);
  await bubble(page, 'Big idea').click();
  await expect(bubble(page, 'Big idea')).toHaveAttribute('aria-selected', 'true');
});
