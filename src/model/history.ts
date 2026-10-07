export interface RecordOptions {
  /**
   * Consecutive records sharing a key within `coalesceMs` collapse into one
   * undo step (e.g. a burst of arrow-key nudges).
   */
  coalesce?: string;
}

/**
 * Snapshot-based undo/redo. Because documents are immutable, a snapshot is just
 * a reference and unchanged parts are structurally shared between entries.
 */
export class History<T> {
  private past: T[] = [];
  private future: T[] = [];
  private lastKey: string | undefined;
  private lastAt = 0;

  constructor(
    private readonly limit = 200,
    private readonly coalesceMs = 1000,
    private readonly now: () => number = () => Date.now(),
  ) {}

  get canUndo(): boolean {
    return this.past.length > 0;
  }

  get canRedo(): boolean {
    return this.future.length > 0;
  }

  /** Remembers `previous` as the state to return to on the next undo. */
  record(previous: T, { coalesce }: RecordOptions = {}): void {
    const time = this.now();
    const merge =
      coalesce !== undefined &&
      coalesce === this.lastKey &&
      time - this.lastAt <= this.coalesceMs &&
      this.past.length > 0;

    if (!merge) {
      this.past.push(previous);
      if (this.past.length > this.limit) this.past.shift();
    }
    this.future = [];
    this.lastKey = coalesce;
    this.lastAt = time;
  }

  undo(current: T): T | undefined {
    const previous = this.past.pop();
    if (previous === undefined) return undefined;
    this.future.push(current);
    this.lastKey = undefined;
    return previous;
  }

  redo(current: T): T | undefined {
    const next = this.future.pop();
    if (next === undefined) return undefined;
    this.past.push(current);
    this.lastKey = undefined;
    return next;
  }

  clear(): void {
    this.past = [];
    this.future = [];
    this.lastKey = undefined;
  }
}
