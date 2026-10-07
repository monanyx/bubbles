import { expect, test, type Page } from '@playwright/test';
import { bubble, bubbles, center, freshStart, links, selectOnly, toastAction } from './helpers';

test.beforeEach(async ({ page }) => {
  await freshStart(page);
});

const sceneTransform = (page: Page): Promise<string> =>
  page.locator('.scene').evaluate((el) => (el as HTMLElement).style.transform);

test('in connect mode, holding Space still pans and leaves the source alone', async ({ page }) => {
  await selectOnly(page, bubble(page, 'Big idea'));
  await page.keyboard.press('c');
  await expect(bubble(page, 'Big idea')).toHaveClass(/is-link-source/);

  const before = await sceneTransform(page);
  const tip = bubble(page, 'Press ?');
  const start = await center(tip);
  await page.keyboard.down(' ');
  await page.keyboard.down(' '); // auto-repeat
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x - 150, start.y + 40, { steps: 8 });
  await page.mouse.up();
  await page.keyboard.up(' ');

  expect(await sceneTransform(page)).not.toBe(before); // the view panned…
  await expect(bubble(page, 'Big idea')).toHaveClass(/is-link-source/); // …source kept
});

test('holding Enter on a bubble in connect mode picks it once', async ({ page }) => {
  await page.keyboard.press('Tab'); // focus Big idea
  await page.keyboard.press('c');
  await page.keyboard.down('Enter');
  await page.keyboard.down('Enter'); // an auto-repeat must not toggle it off again
  await page.keyboard.up('Enter');
  await expect(bubble(page, 'Big idea')).toHaveClass(/is-link-source/);
});

test('Enter on the link chip keeps focus on the source bubble', async ({ page }) => {
  const tip = bubble(page, 'Press ?');
  await selectOnly(page, tip);
  await page.locator('.chip-link').focus();
  await page.keyboard.press('Enter');
  await expect(tip).toHaveClass(/is-link-source/);
  await expect(tip).toBeFocused();
});

test('activating the toast Undo from the keyboard keeps focus on the page', async ({ page }) => {
  await selectOnly(page, bubble(page, 'Press ?'));
  await page.keyboard.press('Delete');
  const undo = toastAction(page, 'Undo');
  await undo.focus();
  await page.keyboard.press('Enter');
  await expect(bubbles(page)).toHaveCount(4);
  expect(await page.evaluate(() => document.activeElement?.tagName)).not.toBe('BODY');
});

test('shortcuts typed inside the open File menu stay in the menu', async ({ page }) => {
  await selectOnly(page, bubble(page, 'Press ?'));
  await page.locator('#file-button').focus();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('menuitem', { name: /Open/ })).toBeFocused();
  await page.keyboard.press('Delete');
  await expect(bubble(page, 'Press ?')).toHaveCount(1); // not popped behind the menu
  await page.keyboard.press('n');
  await expect(page.locator('.bubble.is-editing')).toHaveCount(0); // no new bubble
  await expect(bubbles(page)).toHaveCount(4);
});

test('moving focus out of a mouse-opened File menu closes it', async ({ page }) => {
  await page.locator('#file-button').click();
  await expect(page.getByRole('menu', { name: 'File' })).toBeVisible();
  await page.keyboard.press('ArrowRight'); // toolbar arrow → next button
  await expect(page.getByRole('menu', { name: 'File' })).toBeHidden();
});

test('a command pressed mid-drag keeps the drag as its own undo step', async ({ page }) => {
  await page.keyboard.press('Escape');
  const root = bubble(page, 'Big idea');
  const from = await center(root);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 100, from.y + 100, { steps: 6 });
  await page.keyboard.press('4'); // recolour the dragged (selected) bubble
  await page.mouse.move(from.x + 200, from.y + 200, { steps: 6 });
  await page.mouse.up();
  await expect(root).toHaveAttribute('data-color', 'rose');
  const dragged = await center(root);
  expect(dragged.x - from.x).toBeCloseTo(100, -1);

  await page.keyboard.press('ControlOrMeta+z'); // undo the colour
  await expect(root).toHaveAttribute('data-color', 'sky');
  await page.keyboard.press('ControlOrMeta+z'); // undo the drag
  await expect.poll(async () => (await center(root)).x).toBeCloseTo(from.x, 0);
});

test('Delete moves to the nearest bubble and scrolls it into view', async ({ page }) => {
  await page.addInitScript(() => {
    const node = (id: string, x: number, y: number, text: string) => ({
      id,
      x,
      y,
      d: 130,
      text,
      color: 'sky',
    });
    localStorage.setItem(
      'aero-bubbles:map',
      JSON.stringify({
        format: 'aero-bubbles',
        version: 1,
        nodes: [node('a', 0, 0, 'Alpha'), node('b', 1600, 900, 'Beta')],
        links: [{ id: 'ab', a: 'a', b: 'b' }],
        viewport: { x: 640, y: 400, zoom: 1 },
      }),
    );
  });
  await page.goto('/');
  await bubble(page, 'Alpha').click();
  await page.keyboard.press('Delete');
  const beta = bubble(page, 'Beta');
  await expect(beta).toHaveAttribute('aria-selected', 'true');
  await expect.poll(async () => (await center(beta)).x).toBeLessThan(1280);
  await expect.poll(async () => (await center(beta)).y).toBeLessThan(800);
});

test.describe('with animations on', () => {
  test.use({ reducedMotion: 'no-preference' });

  test('a keyboard connection made during a tidy is kept, with clean history', async ({ page }) => {
    await selectOnly(page, bubble(page, 'Press ?'));
    await page.keyboard.press('c');
    await page.keyboard.press('ArrowLeft');
    await expect(bubble(page, 'Drag the')).toBeFocused();
    await page.keyboard.press('t'); // 500 ms tidy starts
    await page.keyboard.press('Enter'); // connect while it runs
    await page.waitForTimeout(700);
    await expect(links(page)).toHaveCount(4);
    await page.keyboard.press('Escape');
    await page.keyboard.press('ControlOrMeta+z'); // undo the connection…
    await expect(links(page)).toHaveCount(3);
    await page.keyboard.press('ControlOrMeta+z'); // …then the tidy
    await expect(page.locator('[data-command="undo"]')).toBeDisabled();
  });
});

test.describe('focus indicators', () => {
  test('a focused bubble shows an outline in forced-colors mode', async ({ page }) => {
    await page.emulateMedia({ forcedColors: 'active' });
    await page.keyboard.press('Tab');
    const outline = await bubble(page, 'Big idea').evaluate((el) => {
      const s = getComputedStyle(el);
      return `${s.outlineStyle} ${s.outlineWidth}`;
    });
    expect(outline).toBe('solid 2px');
  });

  test('the canvas shows a frame when it takes keyboard focus', async ({ page }) => {
    const clear = page.locator('[data-command="clear"]');
    await clear.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#canvas')).toBeFocused();
    const outline = await page
      .locator('#canvas')
      .evaluate((el) => getComputedStyle(el).outlineWidth);
    expect(outline).toBe('3px');
  });

  test('the checked colour swatch shows its focus ring outside the checked ring', async ({
    page,
  }) => {
    await selectOnly(page, bubble(page, 'Big idea'));
    await page.locator('.chip-color').focus();
    await page.keyboard.press('Enter');
    const checked = page.getByRole('radio', { name: /Sky/ });
    await expect(checked).toBeFocused();
    const shadow = await checked.evaluate((el) => getComputedStyle(el).boxShadow);
    expect(shadow).toContain('0px 0px 0px 8px');
  });
});
