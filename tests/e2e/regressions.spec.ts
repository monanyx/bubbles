import { expect, test } from '@playwright/test';
import {
  bubble,
  bubbles,
  center,
  freshStart,
  linkMidpoint,
  links,
  selectOnly,
  toastAction,
} from './helpers';

test.beforeEach(async ({ page }) => {
  await freshStart(page);
});

test('text typed but not yet confirmed survives a reload', async ({ page }) => {
  await page.mouse.dblclick(1100, 650);
  await page.keyboard.type('Buy milk');
  await page.reload(); // no Enter, no click elsewhere
  await expect(bubble(page, 'Buy milk')).toHaveCount(1);
});

test('undo during a drag is not overwritten when the drag ends', async ({ page }) => {
  await selectOnly(page, bubble(page, 'Press ?'));
  await page.keyboard.press('Delete');
  await expect(bubbles(page)).toHaveCount(3);

  const from = await center(bubble(page, 'Big idea'));
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 40, from.y + 40, { steps: 5 });
  await page.keyboard.press('ControlOrMeta+z'); // restores the popped tip
  await page.mouse.move(from.x + 80, from.y + 80, { steps: 5 });
  await page.mouse.up();

  await expect(bubble(page, 'Press ?')).toHaveCount(1);
  await expect(bubbles(page)).toHaveCount(4);
});

test('pasting over selected text replaces it in full', async ({ page }) => {
  const root = bubble(page, 'Big idea');
  await root.click();
  await root.click(); // edit
  const paste = (text: string) =>
    page.locator('.bubble.is-editing .label').evaluate((label, value) => {
      const data = new DataTransfer();
      data.setData('text/plain', value);
      label.dispatchEvent(
        new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }),
      );
    }, text);
  // A long label first, then replace all of it with another long paste: only
  // the unselected text counts against the 200-character limit.
  await page.keyboard.press('ControlOrMeta+a');
  await paste('x'.repeat(150));
  await page.keyboard.press('ControlOrMeta+a');
  const replacement = `Replacement ${'y'.repeat(100)}`;
  await paste(replacement);
  await page.keyboard.press('Enter');
  await expect(page.locator(`.bubble[aria-label="${replacement}"]`)).toHaveCount(1);
});

test('a toast’s Undo is withdrawn once another edit happens', async ({ page }) => {
  await selectOnly(page, bubble(page, 'Press ?'));
  await page.keyboard.press('Delete');
  await expect(toastAction(page, 'Undo')).toBeVisible();
  await selectOnly(page, bubble(page, 'Big idea'));
  await page.keyboard.press('4'); // recolour: a newer edit
  await expect(toastAction(page, 'Undo')).toBeHidden();
});

test('the cut button stays centred on its wire when zoomed in', async ({ page }) => {
  await page.locator('[data-command="zoom-in"]').click();
  await page.locator('[data-command="zoom-in"]').click();
  await expect(page.locator('.zoom-level')).toHaveText('156%');
  const link = links(page).first();
  const hit = await linkMidpoint(link);
  await page.mouse.click(hit.x, hit.y);
  // The button sits at the curve's t = ½ point (not its arc-length midpoint).
  const mid = await link.locator('.link-core').evaluate((path: SVGPathElement) => {
    const [sx, sy, cx, cy, ex, ey] = (path.getAttribute('d') ?? '').match(/-?[\d.]+/g)!.map(Number);
    const x = 0.25 * sx! + 0.5 * cx! + 0.25 * ex!;
    const y = 0.25 * sy! + 0.5 * cy! + 0.25 * ey!;
    const m = path.getScreenCTM()!;
    return { x: x * m.a + y * m.c + m.e, y: x * m.b + y * m.d + m.f };
  });
  const cut = await center(page.locator('.link-cut'));
  expect(Math.hypot(cut.x - mid.x, cut.y - mid.y)).toBeLessThan(1.5);
});

test('Tab-sprouted children stay on screen while chain-typing', async ({ page }) => {
  const root = bubble(page, 'Big idea');
  await root.click();
  await root.click(); // edit
  for (let i = 1; i <= 6; i++) {
    await page.keyboard.press('Tab');
    await page.keyboard.type(`Child ${i}`);
  }
  await page.keyboard.press('Enter');
  const viewport = page.viewportSize()!;
  await expect
    .poll(async () => {
      const c = await center(bubble(page, 'Child 6'));
      return c.y > 0 && c.y < viewport.height && c.x > 0 && c.x < viewport.width;
    })
    .toBe(true);
});
