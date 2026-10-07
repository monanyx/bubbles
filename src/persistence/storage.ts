import type { Editor } from '../core/editor';
import { deserialize, stringify, type LoadedMap } from '../model/serialize';

export const STORAGE_KEY = 'aero-bubbles:map';
const CORRUPT_KEY = `${STORAGE_KEY}:corrupt`;

export type StoredMap =
  { status: 'empty' } | { status: 'ok'; data: LoadedMap } | { status: 'corrupt'; error: string };

/** Storage may be missing or throw (private mode, disabled cookies, sandboxed iframes). */
function getStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function loadStoredMap(storage: Storage | null = getStorage()): StoredMap {
  let raw: string | null;
  try {
    raw = storage?.getItem(STORAGE_KEY) ?? null;
  } catch {
    return { status: 'empty' };
  }
  if (raw === null) return { status: 'empty' };
  try {
    return { status: 'ok', data: deserialize(raw) };
  } catch (error) {
    // Keep the unreadable copy so it can be recovered by hand.
    try {
      storage?.setItem(CORRUPT_KEY, raw);
    } catch {
      /* best effort */
    }
    return { status: 'corrupt', error: error instanceof Error ? error.message : String(error) };
  }
}

export interface AutosaveOptions {
  storage?: Storage | null;
  delay?: number;
  onError?: (error: unknown) => void;
  /**
   * Another tab saved a newer map. Only called while this tab has no unsaved
   * changes of its own, so adopting it can never discard local work.
   */
  onExternalChange?: (data: LoadedMap) => void;
}

/**
 * Saves the map (and camera) shortly after every change, and immediately when
 * the page is hidden or closed so nothing is lost on mobile tab switches.
 * Keeps several open tabs in step instead of letting a stale one overwrite
 * newer work.
 */
export class Autosave {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private failed = false;
  /** The document (not just the camera) has changes not yet written. */
  private mapDirty = false;
  /** A map just adopted from another tab; saving it back would only echo. */
  private adopted: LoadedMap['map'] | null = null;
  private readonly unsubscribe: () => void;

  constructor(
    private readonly editor: Editor,
    private readonly options: AutosaveOptions = {},
  ) {
    this.unsubscribe = editor.subscribe((state, prev) => {
      const mapChanged = state.map !== prev.map;
      const viewportChanged = state.viewport !== prev.viewport;
      if (!mapChanged && !viewportChanged) return;
      // Only the adoption itself is an echo. Returning to that same snapshot
      // later (undo, redo) is a real change and must be saved.
      const echo = mapChanged && state.map === this.adopted;
      if (mapChanged) this.adopted = null;
      if (mapChanged && !echo) this.mapDirty = true;
      if (!echo || viewportChanged) this.schedule();
    });
    document.addEventListener('visibilitychange', this.onVisibility);
    window.addEventListener('pagehide', this.flush);
    window.addEventListener('storage', this.onStorage);
  }

  destroy(): void {
    this.flush();
    this.unsubscribe();
    document.removeEventListener('visibilitychange', this.onVisibility);
    window.removeEventListener('pagehide', this.flush);
    window.removeEventListener('storage', this.onStorage);
  }

  readonly flush = (): void => {
    if (this.timer === undefined) return;
    clearTimeout(this.timer);
    this.timer = undefined;
    const storage = this.options.storage === undefined ? getStorage() : this.options.storage;
    if (!storage) return;
    try {
      const { map, viewport } = this.editor.state;
      storage.setItem(STORAGE_KEY, stringify(map, viewport));
      this.mapDirty = false;
      this.failed = false;
    } catch (error) {
      if (!this.failed) this.options.onError?.(error);
      this.failed = true;
    }
  };

  private schedule(): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(this.flush, this.options.delay ?? 400);
  }

  private readonly onVisibility = (): void => {
    if (document.visibilityState === 'hidden') this.flush();
  };

  private readonly onStorage = (e: StorageEvent): void => {
    const { onExternalChange } = this.options;
    if (e.key !== STORAGE_KEY || e.newValue === null || !onExternalChange) return;
    // Our own unsaved edits win. A pending save that only moved the camera
    // must not block (and later overwrite) another tab's newer document.
    if (this.mapDirty) return;
    let data: LoadedMap;
    try {
      data = deserialize(e.newValue);
    } catch {
      return;
    }
    // Viewports are per tab; a save that only moved the camera changes nothing here.
    if (stringify(data.map) === stringify(this.editor.map)) return;
    this.adopted = data.map;
    onExternalChange(data);
  };
}
