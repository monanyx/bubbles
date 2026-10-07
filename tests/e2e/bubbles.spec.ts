import { expect, test } from '@playwright/test';
import {
  bubble,
  bubbles,
  center,
  drag,
  freshStart,
  links,
  selectOnly,
  status,
  toastAction,
} from './helpers';

test.beforeEach(async ({ page }) => {
  await freshStart(page);
});

test('opens on the welcome map', async ({ page }) => {
  await expect(page).toHaveTitle(/Aero Bubbles/);
  await expect(links(page)).toHaveCount(3);
  await expect(bubble(page, 'Big idea')).toBeVisible();
  await expect(status(page)).toContainText('Double-tap');
});

test('double-click blows a bubble and edits it in place', async ({ page }) => {
  await page.mouse.dblclick(1100, 650);
  await expect(bubbles(page)).toHaveCount(5);
  await expect(page.locator('.bubble.is-editing .label')).toBeFocused();
  await page.keyboard.type('Fresh thought');
  await page.keyboard.press('Enter');
  await expect(bubble(page, 'Fresh thought')).toHaveAttribute('aria-label', 'Fresh thought');
  await expect(page.locator('.bubble.is-editing')).toHaveCount(0);
});

test('tap selects, a second tap edits; Escape commits and undo reverts', async ({ page }) => {
  const root = bubble(page, 'Big idea');
  await root.click();
  await expect(root).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.adornment')).toBeVisible();
  await expect(root).not.toHaveClass(/is-editing/);

  await root.click();
  await expect(root).toHaveClass(/is-editing/);
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type('Renamed');
  await page.keyboard.press('Escape');
  await expect(bubble(page, 'Renamed')).toHaveCount(1);

  await page.keyboard.press('ControlOrMeta+z');
  await expect(bubble(page, 'Big idea')).toHaveCount(1);
  await page.keyboard.press('ControlOrMeta+Shift+z');
  await expect(bubble(page, 'Renamed')).toHaveCount(1);
});

test('dragging moves a bubble as one undo step', async ({ page }) => {
  const tip = bubble(page, 'Press ?');
  const start = await center(tip);
  await drag(page, start, { x: start.x + 120, y: start.y + 90 });
  const moved = await center(tip);
  expect(moved.x - start.x).toBeCloseTo(120, -1);
  expect(moved.y - start.y).toBeCloseTo(90, -1);

  await page.locator('[data-command="undo"]').click();
  const back = await center(tip);
  expect(back.x).toBeCloseTo(start.x, 0);
  expect(back.y).toBeCloseTo(start.y, 0);
});

test('Delete pops the selection and the toast can undo it', async ({ page }) => {
  await selectOnly(page, bubble(page, 'Press ?'));
  await page.keyboard.press('Delete');
  await expect(bubbles(page)).toHaveCount(3);
  await expect(links(page)).toHaveCount(2);
  await expect(status(page)).toHaveText('Popped 1 bubble');
  await toastAction(page, 'Undo').click();
  await expect(bubbles(page)).toHaveCount(4);
  await expect(links(page)).toHaveCount(3);
});

test('the pop chip pops the selected bubble', async ({ page }) => {
  await selectOnly(page, bubble(page, 'Double-tap'));
  await page.locator('.chip-pop').click();
  await expect(bubbles(page)).toHaveCount(3);
});

test('Tab sprouts a connected child; arrow keys hop between bubbles', async ({ page }) => {
  await selectOnly(page, bubble(page, 'Press ?'));
  await page.keyboard.press('Tab');
  await expect(bubbles(page)).toHaveCount(5);
  await page.keyboard.type('Child');
  await page.keyboard.press('Enter');
  await expect(links(page)).toHaveCount(4);
  const child = bubble(page, 'Child');
  await expect(child).toHaveAttribute('aria-selected', 'true');
  await expect(child).toBeFocused();

  await page.keyboard.press('ArrowLeft');
  await expect(bubble(page, 'Press ?')).toHaveAttribute('aria-selected', 'true');
  await expect(bubble(page, 'Press ?')).toBeFocused();
});

test('shift-drag selects several bubbles; number keys recolour them', async ({ page }) => {
  // Spans the three tips but stays below the root bubble.
  await drag(page, { x: 200, y: 400 }, { x: 1100, y: 700 }, ['Shift']);
  await expect(page.locator('.bubble[aria-selected="true"]')).toHaveCount(3);
  await page.keyboard.press('4'); // rose
  await expect(page.locator('.bubble[data-color="rose"]')).toHaveCount(3);
  await page.keyboard.press('ControlOrMeta+z');
  await expect(page.locator('.bubble[data-color="rose"]')).toHaveCount(0);
});

test('the colour chip opens a palette', async ({ page }) => {
  const root = bubble(page, 'Big idea');
  await selectOnly(page, root);
  await page.locator('.chip-color').click();
  const palette = page.getByRole('radiogroup', { name: 'Bubble colour' });
  await expect(palette).toBeVisible();
  await expect(palette.getByRole('radio', { name: /Sky/ })).toHaveAttribute('aria-checked', 'true');
  await palette.getByRole('radio', { name: /Lime/ }).click();
  await expect(palette).toBeHidden();
  await expect(root).toHaveAttribute('data-color', 'lime');
});

test('the grow chip resizes a bubble', async ({ page }) => {
  const root = bubble(page, 'Big idea');
  await selectOnly(page, root);
  const before = (await root.boundingBox())!.width;
  const grip = await center(page.locator('.chip-grow'));
  await drag(page, grip, { x: grip.x + 40, y: grip.y + 40 });
  const after = (await root.boundingBox())!.width;
  expect(after).toBeGreaterThan(before + 60);
});

test('clear empties the canvas and can be undone', async ({ page }) => {
  await page.locator('[data-command="clear"]').click();
  await expect(bubbles(page)).toHaveCount(0);
  await expect(page.locator('[data-command="clear"]')).toBeDisabled();
  await toastAction(page, 'Undo').click();
  await expect(bubbles(page)).toHaveCount(4);
});
