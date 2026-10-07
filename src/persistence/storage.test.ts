import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Editor } from '../core/editor';
import { addBubble, createBubble } from '../model/map';
import { stringify } from '../model/serialize';
import { welcomeMap } from '../model/welcome';
import { Autosave, loadStoredMap, STORAGE_KEY } from './storage';

class MemoryStorage implements Storage {
  private data = new Map<string, string>();
  failWrites = false;
  get length(): number {
    return this.data.size;
  }
  clear(): void {
    this.data.clear();
  }
  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }
  key(index: number): string | null {
    return [...this.data.keys()][index] ?? null;
  }
  removeItem(key: string): void {
    this.data.delete(key);
  }
  setItem(key: string, value: string): void {
    if (this.failWrites) throw new DOMException('Quota exceeded', 'QuotaExceededError');
    this.data.set(key, value);
  }
}

describe('loadStoredMap', () => {
  it('reports empty, ok and corrupt states', () => {
    const storage = new MemoryStorage();
    expect(loadStoredMap(storage)).toEqual({ status: 'empty' });

    storage.setItem(STORAGE_KEY, stringify(welcomeMap(), { x: 1, y: 2, zoom: 1 }));
    const ok = loadStoredMap(storage);
    expect(ok.status).toBe('ok');
    if (ok.status === 'ok') expect(ok.data.map.nodes.size).toBe(4);

    storage.setItem(STORAGE_KEY, '{oops');
    const bad = loadStoredMap(storage);
    expect(bad.status).toBe('corrupt');
    expect(storage.getItem(`${STORAGE_KEY}:corrupt`)).toBe('{oops');
  });

  it('treats unavailable storage as empty', () => {
    expect(loadStoredMap(null)).toEqual({ status: 'empty' });
  });
});

describe('Autosave', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('debounces writes after map or viewport changes', () => {
    const storage = new MemoryStorage();
    const editor = new Editor();
    const autosave = new Autosave(editor, { storage, delay: 300 });

    editor.commit(addBubble(editor.map, createBubble({ x: 0, y: 0 })));
    editor.setViewport({ x: 5, y: 5, zoom: 2 });
    expect(storage.getItem(STORAGE_KEY)).toBeNull();
    vi.advanceTimersByTime(300);

    const saved = loadStoredMap(storage);
    expect(saved.status).toBe('ok');
    if (saved.status === 'ok') {
      expect(saved.data.map.nodes.size).toBe(1);
      expect(saved.data.viewport).toEqual({ x: 5, y: 5, zoom: 2 });
    }
    autosave.destroy();
  });

  it('ignores selection-only changes', () => {
    const storage = new MemoryStorage();
    const editor = new Editor(welcomeMap());
    const autosave = new Autosave(editor, { storage });
    editor.select([...editor.map.nodes.keys()]);
    vi.runAllTimers();
    expect(storage.getItem(STORAGE_KEY)).toBeNull();
    autosave.destroy();
  });

  it('flushes immediately when the page is hidden', () => {
    const storage = new MemoryStorage();
    const editor = new Editor();
    const autosave = new Autosave(editor, { storage, delay: 10_000 });
    editor.commit(addBubble(editor.map, createBubble({ x: 0, y: 0 })));
    window.dispatchEvent(new Event('pagehide'));
    expect(storage.getItem(STORAGE_KEY)).not.toBeNull();
    autosave.destroy();
  });

  describe('cross-tab sync', () => {
    const otherTabSaves = (value: string): void => {
      window.dispatchEvent(new StorageEvent('storage', { key: STORAGE_KEY, newValue: value }));
    };

    it('adopts another tab’s save without echoing it back', () => {
      const storage = new MemoryStorage();
      const editor = new Editor();
      const autosave = new Autosave(editor, {
        storage,
        delay: 10,
        onExternalChange: ({ map }) => editor.reset(map),
      });
      otherTabSaves(stringify(welcomeMap()));
      expect(editor.map.nodes.size).toBe(4);
      vi.runAllTimers();
      expect(storage.getItem(STORAGE_KEY)).toBeNull(); // no echo

      // Later local edits still save normally.
      editor.commit(addBubble(editor.map, createBubble({ x: 0, y: 0 })));
      vi.runAllTimers();
      expect(storage.getItem(STORAGE_KEY)).not.toBeNull();
      autosave.destroy();
    });

    it('ignores saves whose map content is unchanged (e.g. the other tab only panned)', () => {
      const editor = new Editor(welcomeMap());
      const onExternalChange = vi.fn();
      const autosave = new Autosave(editor, { storage: new MemoryStorage(), onExternalChange });
      otherTabSaves(stringify(editor.map, { x: 500, y: 500, zoom: 2 }));
      expect(onExternalChange).not.toHaveBeenCalled();
      autosave.destroy();
    });

    it('never discards unsaved local changes', () => {
      const storage = new MemoryStorage();
      const editor = new Editor();
      const onExternalChange = vi.fn();
      const autosave = new Autosave(editor, { storage, delay: 1000, onExternalChange });
      editor.commit(addBubble(editor.map, createBubble({ x: 0, y: 0 })));
      otherTabSaves(stringify(welcomeMap()));
      expect(onExternalChange).not.toHaveBeenCalled();
      autosave.destroy();
    });

    it('ignores other keys and unreadable values', () => {
      const editor = new Editor();
      const onExternalChange = vi.fn();
      const autosave = new Autosave(editor, { storage: new MemoryStorage(), onExternalChange });
      window.dispatchEvent(new StorageEvent('storage', { key: 'other', newValue: '{}' }));
      otherTabSaves('{broken');
      expect(onExternalChange).not.toHaveBeenCalled();
      autosave.destroy();
    });
  });

  it('reports a failing write once, not on every change', () => {
    const storage = new MemoryStorage();
    storage.failWrites = true;
    const onError = vi.fn();
    const editor = new Editor();
    const autosave = new Autosave(editor, { storage, delay: 1, onError });
    for (let i = 0; i < 3; i++) {
      editor.commit(addBubble(editor.map, createBubble({ x: i, y: 0 })));
      vi.runAllTimers();
    }
    expect(onError).toHaveBeenCalledOnce();
    autosave.destroy();
  });
});
