import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { bubble, bubbles, center, drag, freshStart, links, status } from './helpers';

test.beforeEach(async ({ page }) => {
  await freshStart(page);
});

test('dragging empty space pans; zoom controls zoom and fit', async ({ page }) => {
  const root = bubble(page, 'Big idea');
  const before = await center(root);
  await drag(page, { x: 150, y: 650 }, { x: 250, y: 600 });
  const panned = await center(root);
  expect(panned.x - before.x).toBeCloseTo(100, -1);
  expect(panned.y - before.y).toBeCloseTo(-50, -1);

  const zoom = page.locator('.zoom-level');
  await expect(zoom).toHaveText('100%');
  await page.locator('[data-command="zoom-in"]').click();
  await expect(zoom).toHaveText('125%');
  await page.keyboard.press('-');
  await expect(zoom).toHaveText('100%');

  await page.locator('[data-command="zoom-fit"]').click();
  await expect.poll(async () => (await center(root)).x).toBeCloseTo(before.x, -1);
});

test('ctrl + wheel zooms around the pointer', async ({ page }) => {
  await page.mouse.move(640, 400);
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, -100);
  await page.keyboard.up('Control');
  await expect(page.locator('.zoom-level')).toHaveText('120%');
});

test('the map survives a reload', async ({ page }) => {
  await page.mouse.dblclick(1100, 650);
  await page.keyboard.type('Remember me');
  await page.keyboard.press('Enter');
  await expect(bubble(page, 'Remember me')).toHaveCount(1);
  await page.waitForFunction(() =>
    localStorage.getItem('aero-bubbles:map')?.includes('Remember me'),
  );
  await page.reload();
  await expect(bubbles(page)).toHaveCount(5);
  await expect(bubble(page, 'Remember me')).toHaveCount(1);
  await expect(links(page)).toHaveCount(3);
});

test('a corrupted save falls back to the welcome map with a warning', async ({ page }) => {
  await page.evaluate(() => localStorage.setItem('aero-bubbles:map', '{not json'));
  await page.reload();
  await expect(bubbles(page)).toHaveCount(4);
  await expect(status(page)).toContainText("couldn't be read");
});

test('save as JSON, then open it again', async ({ page }, testInfo) => {
  await page.locator('#file-button').click();
  await expect(page.getByRole('menu', { name: 'File' })).toBeVisible();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('menuitem', { name: /Save as JSON/ }).click(),
  ]);
  expect(download.suggestedFilename()).toBe('big-idea.json');
  const path = testInfo.outputPath('map.json');
  await download.saveAs(path);
  const saved = JSON.parse(await readFile(path, 'utf8')) as { format: string; nodes: unknown[] };
  expect(saved.format).toBe('aero-bubbles');
  expect(saved.nodes).toHaveLength(4);

  await page.locator('[data-command="clear"]').click();
  await expect(bubbles(page)).toHaveCount(0);

  await page.locator('#file-button').click();
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.getByRole('menuitem', { name: /Open/ }).click(),
  ]);
  await chooser.setFiles(path);
  await expect(bubbles(page)).toHaveCount(4);
  await expect(links(page)).toHaveCount(3);
  await expect(status(page)).toContainText('Opened');
});

test('opening an invalid file reports the problem and keeps the map', async ({ page }) => {
  await page.locator('#file-button').click();
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.getByRole('menuitem', { name: /Open/ }).click(),
  ]);
  await chooser.setFiles({
    name: 'nope.json',
    mimeType: 'application/json',
    buffer: Buffer.from('[1,2]'),
  });
  await expect(status(page)).toContainText("Couldn't open “nope.json”");
  await expect(bubbles(page)).toHaveCount(4);
});

for (const kind of ['png', 'svg'] as const) {
  test(`exports a ${kind.toUpperCase()} image`, async ({ page }, testInfo) => {
    await page.locator('#file-button').click();
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('menuitem', { name: new RegExp(`Export ${kind}`, 'i') }).click(),
    ]);
    expect(download.suggestedFilename()).toBe(`big-idea.${kind}`);
    const path = testInfo.outputPath(`map.${kind}`);
    await download.saveAs(path);
    const bytes = await readFile(path);
    if (kind === 'png') expect(bytes.subarray(1, 4).toString()).toBe('PNG');
    else expect(bytes.toString()).toMatch(/^<svg[^>]+xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
  });
}

test('the menu is keyboard operable', async ({ page }) => {
  const button = page.locator('#file-button');
  await button.focus();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('menuitem', { name: /Open/ })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('menuitem', { name: /Save as JSON/ })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu', { name: 'File' })).toBeHidden();
  await expect(button).toBeFocused();
});

test('help opens with ? and lists shortcuts', async ({ page }) => {
  await page.keyboard.press('?');
  const dialog = page.getByRole('dialog', { name: /Help/ });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('Add connected bubble');
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
});

test('no horizontal overflow and toolbar fits on a phone', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  const toolbar = await page.locator('.toolbar').boundingBox();
  expect(toolbar!.x).toBeGreaterThanOrEqual(0);
  expect(toolbar!.x + toolbar!.width).toBeLessThanOrEqual(360);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
  expect(overflow).toBe(false);
});

test('works without console errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));
  await page.reload();
  await expect(bubbles(page)).toHaveCount(4);
  await drag(page, await center(bubble(page, 'Big idea')), { x: 700, y: 200 });
  await page.keyboard.press('t');
  await expect(status(page)).toHaveText('Tidied up');
  expect(errors).toEqual([]);
});

test('a second tab picks up changes made in the first', async ({ page, context }) => {
  const other = await context.newPage();
  await other.goto('/');
  await expect(bubbles(other)).toHaveCount(4);
  // Let the second tab's own start-up save settle so it has nothing pending.
  await other.waitForTimeout(600);

  await page.mouse.dblclick(1100, 650);
  await page.keyboard.type('From tab one');
  await page.keyboard.press('Enter');

  await expect(bubble(other, 'From tab one')).toHaveCount(1);
  await expect(other.locator('.status-text')).toContainText('another tab');
});
