import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import indexHtml from '../../index.html?raw';
import { addBubble, createBubble, updateBubble } from '../model/map';
import { deserialize, stringify } from '../model/serialize';
import type { MindMap } from '../model/types';
import { welcomeMap } from '../model/welcome';
import { STORAGE_KEY } from '../persistence/storage';
import { mountApp, type App } from './app';

/**
 * Integration tests: the whole app mounted on the real page markup, with
 * animation frames, timers and page visibility under the test's control.
 */
const body = indexHtml
  .slice(indexHtml.indexOf('<body>') + 6, indexHtml.indexOf('</body>'))
  .replace(/<script[\s\S]*?<\/script>/g, '');

let frames: FrameRequestCallback[] = [];
let now = 0;
let hidden = false;
let app: App | null = null;

function runFrames(count: number): void {
  for (let i = 0; i < count; i++) {
    now += 16;
    const due = frames;
    frames = [];
    for (const cb of due) cb(now);
  }
}

function setHidden(value: boolean): void {
  hidden = value;
  document.dispatchEvent(new Event('visibilitychange'));
}

/** Another tab saved `map`: write it and fire the cross-tab storage event. */
function otherTabSaves(map: MindMap): void {
  const value = stringify(map, { x: 0, y: 0, zoom: 1 });
  localStorage.setItem(STORAGE_KEY, value);
  window.dispatchEvent(new StorageEvent('storage', { key: STORAGE_KEY, newValue: value }));
}

const stored = (): MindMap => deserialize(localStorage.getItem(STORAGE_KEY) ?? '').map;
const texts = (map: MindMap): string[] => [...map.nodes.values()].map((b) => b.text);

function mount(map: MindMap = welcomeMap()): App {
  localStorage.setItem(STORAGE_KEY, stringify(map, { x: 0, y: 0, zoom: 1 }));
  app = mountApp(document);
  runFrames(2);
  return app;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
  document.body.innerHTML = body;
  localStorage.clear();
  frames = [];
  now = 0;
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => frames.push(cb));
  vi.stubGlobal('cancelAnimationFrame', () => undefined);
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => (hidden ? 'hidden' : 'visible'),
  });
});

afterEach(() => {
  app?.destroy();
  app = null;
  hidden = false;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('mountApp', () => {
  it('a tidy in flight never overwrites a map adopted from another tab', () => {
    const { editor } = mount();
    document.querySelector<HTMLButtonElement>('[data-command="tidy"]')!.click();
    runFrames(3); // the 500 ms animation is mid-way

    setHidden(true); // switch away: autosave flushes, frames pause
    otherTabSaves(addBubble(stored(), createBubble({ x: 900, y: 900 }, { text: 'From A' })));
    expect(texts(editor.map)).toContain('From A');

    setHidden(false);
    runFrames(60);
    vi.advanceTimersByTime(5000);
    expect(texts(editor.map)).toContain('From A');
    expect(texts(stored())).toContain('From A');
  });

  it('an untouched label in edit mode never overwrites another tab’s wording', () => {
    const { editor } = mount();
    const root = [...editor.map.nodes.values()].find((b) => b.text === 'Big idea ✨')!;
    editor.startEditing(root.id);

    otherTabSaves(updateBubble(stored(), root.id, { text: 'Final wording from A' }));
    vi.advanceTimersByTime(5000);
    expect(editor.map.nodes.get(root.id)?.text).toBe('Final wording from A');
    expect(stored().nodes.get(root.id)?.text).toBe('Final wording from A');
  });

  it('saves a half-typed label when the page is hidden, as one undo step overall', () => {
    const { editor } = mount();
    const root = [...editor.map.nodes.values()].find((b) => b.text === 'Big idea ✨')!;
    editor.startEditing(root.id);
    const label = document.querySelector<HTMLElement>(`.bubble[data-id="${root.id}"] .label`)!;

    label.textContent = 'Hello';
    setHidden(true);
    expect(stored().nodes.get(root.id)?.text).toBe('Hello'); // persisted while away

    setHidden(false);
    label.textContent = 'Hello world';
    editor.stopEditing();
    expect(editor.map.nodes.get(root.id)?.text).toBe('Hello world');

    editor.undo(); // straight back to before the edit, not to the draft
    expect(editor.map.nodes.get(root.id)?.text).toBe('Big idea ✨');
    expect(editor.state.canUndo).toBe(false);
  });

  it('destroy() detaches from the window', () => {
    const mounted = mount();
    const { editor } = mounted;
    const before = editor.map;
    mounted.destroy();
    app = null;
    otherTabSaves(addBubble(stored(), createBubble({ x: 0, y: 900 }, { text: 'Later' })));
    expect(editor.map).toBe(before);
  });
});
