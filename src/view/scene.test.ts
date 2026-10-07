import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Editor } from '../core/editor';
import {
  addBubble,
  addLink,
  createBubble,
  emptyMap,
  moveBubbles,
  removeBubbles,
} from '../model/map';
import type { MindMap } from '../model/types';
import { Scene } from './scene';

function seeded(): MindMap {
  let map = emptyMap();
  map = addBubble(map, createBubble({ x: 0, y: 0 }, { id: 'a', text: 'Alpha' }));
  map = addBubble(map, createBubble({ x: 400, y: 0 }, { id: 'b', text: 'Beta', color: 'rose' }));
  return addLink(map, 'a', 'b', 'ab').map;
}

describe('Scene', () => {
  let root: HTMLElement;
  let editor: Editor;
  let scene: Scene;

  beforeEach(() => {
    root = document.createElement('main');
    document.body.append(root);
    editor = new Editor(seeded(), { x: 10, y: 20, zoom: 2 });
    scene = new Scene(root, editor, { reducedMotion: true });
    scene.flush();
  });

  afterEach(() => {
    scene.destroy();
    root.remove();
  });

  const bubbleEl = (id: string): HTMLElement | null =>
    root.querySelector(`.bubble[data-id="${id}"]`);

  it('renders bubbles, labels, colours and links', () => {
    expect(root.querySelectorAll('.bubble')).toHaveLength(2);
    expect(bubbleEl('a')?.querySelector('.label')?.textContent).toBe('Alpha');
    expect(bubbleEl('b')?.dataset.color).toBe('rose');
    expect(bubbleEl('a')?.getAttribute('aria-label')).toBe('Alpha');
    const link = root.querySelector('[data-link-id="ab"] .link-core');
    expect(link?.getAttribute('d')).toMatch(/^M/);
  });

  it('applies the viewport transform and counter-scales chips', () => {
    const sceneEl = root.querySelector<HTMLElement>('.scene')!;
    expect(sceneEl.style.transform).toBe('translate(10px,20px) scale(2)');
    expect(sceneEl.style.getPropertyValue('--chip-scale')).toBe('0.5');
  });

  it('reuses DOM nodes across updates and only touches what changed', () => {
    const a = bubbleEl('a');
    const b = bubbleEl('b');
    editor.preview(moveBubbles(editor.map, ['a'], 50, 0));
    scene.flush();
    expect(bubbleEl('a')).toBe(a);
    expect(bubbleEl('b')).toBe(b);
    expect(a?.style.translate).toBe('50px 0px');
  });

  it('removes bubbles and their links', () => {
    editor.commit(removeBubbles(editor.map, ['b']));
    scene.flush();
    expect(bubbleEl('b')).toBeNull();
    expect(root.querySelector('[data-link-id="ab"]')).toBeNull();
  });

  it('reflects selection with classes, aria-selected and a roving tabindex', () => {
    editor.select(['b']);
    scene.flush();
    expect(bubbleEl('b')?.classList.contains('is-selected')).toBe(true);
    expect(bubbleEl('b')?.getAttribute('aria-selected')).toBe('true');
    expect(bubbleEl('b')?.tabIndex).toBe(0);
    expect(bubbleEl('a')?.tabIndex).toBe(-1);
    expect(root.querySelector<HTMLElement>('.adornment')?.hidden).toBe(false);

    editor.select(['a', 'b']);
    scene.flush();
    expect(root.querySelector<HTMLElement>('.adornment')?.hidden).toBe(true);
  });

  it('shows the cut button for a single selected link', () => {
    editor.select([], ['ab']);
    scene.flush();
    expect(root.querySelector('[data-link-id="ab"]')?.classList.contains('is-selected')).toBe(true);
    expect(root.querySelector<HTMLElement>('.link-cut')?.hidden).toBe(false);
  });

  it('hit-tests bubbles in world space', () => {
    expect(scene.bubbleAt({ x: 10, y: 10 })).toBe('a');
    expect(scene.bubbleAt({ x: 10, y: 10 }, 'a')).toBeNull();
    expect(scene.bubbleAt({ x: 200, y: 0 })).toBeNull();
  });
});
