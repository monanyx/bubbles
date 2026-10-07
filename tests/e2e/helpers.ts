import { expect, type Locator, type Page } from '@playwright/test';

/** Bubbles that are alive (not mid-pop). */
export const bubbles = (page: Page): Locator => page.locator('.bubble:not(.is-popping)');

export const bubble = (page: Page, text: string | RegExp): Locator =>
  bubbles(page).filter({ hasText: text });

export const links = (page: Page): Locator => page.locator('.link');

export const status = (page: Page): Locator => page.locator('.status-text');

/** The action button inside the status toast (e.g. "Undo"). */
export const toastAction = (page: Page, name: string): Locator =>
  page.locator('.status').getByRole('button', { name });

/** Opens the app with an empty store so every test starts from the welcome map. */
export async function freshStart(page: Page): Promise<void> {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(bubbles(page)).toHaveCount(4);
}

export async function center(locator: Locator): Promise<{ x: number; y: number }> {
  const box = await locator.boundingBox();
  if (!box) throw new Error('Element is not visible');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** Presses at `from`, moves to `to` in steps, releases — a real drag. */
export async function drag(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
  modifiers: ('Shift' | 'Control')[] = [],
): Promise<void> {
  for (const key of modifiers) await page.keyboard.down(key);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 12 });
  await page.mouse.up();
  for (const key of modifiers) await page.keyboard.up(key);
}

/** Screen-space point halfway along a wire, for clicking it precisely. */
export async function linkMidpoint(link: Locator): Promise<{ x: number; y: number }> {
  return link.locator('.link-hit').evaluate((path: SVGPathElement) => {
    const point = path.getPointAtLength(path.getTotalLength() / 2);
    const m = path.getScreenCTM()!;
    return { x: point.x * m.a + point.y * m.c + m.e, y: point.x * m.b + point.y * m.d + m.f };
  });
}

/** Selects exactly one bubble (from a clean selection) without entering edit mode. */
export async function selectOnly(page: Page, target: Locator): Promise<void> {
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await target.click();
  await expect(target).toHaveAttribute('aria-selected', 'true');
}
