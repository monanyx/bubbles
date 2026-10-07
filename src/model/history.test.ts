import { describe, expect, it } from 'vitest';
import { History } from './history';

describe('History', () => {
  it('undoes and redoes in order', () => {
    const h = new History<number>();
    h.record(0); // 0 → 1
    h.record(1); // 1 → 2
    expect(h.undo(2)).toBe(1);
    expect(h.undo(1)).toBe(0);
    expect(h.undo(0)).toBeUndefined();
    expect(h.redo(0)).toBe(1);
    expect(h.redo(1)).toBe(2);
    expect(h.canRedo).toBe(false);
  });

  it('clears the redo stack on a new record', () => {
    const h = new History<number>();
    h.record(0);
    h.undo(1);
    expect(h.canRedo).toBe(true);
    h.record(0);
    expect(h.canRedo).toBe(false);
  });

  it('drops the oldest entries past the limit', () => {
    const h = new History<number>(3);
    for (let i = 0; i < 5; i++) h.record(i);
    expect(h.undo(5)).toBe(4);
    expect(h.undo(4)).toBe(3);
    expect(h.undo(3)).toBe(2);
    expect(h.undo(2)).toBeUndefined();
  });

  it('coalesces records with the same key inside the window', () => {
    let time = 0;
    const h = new History<number>(100, 1000, () => time);
    h.record(0, { coalesce: 'nudge' });
    time = 500;
    h.record(1, { coalesce: 'nudge' });
    time = 900;
    h.record(2, { coalesce: 'nudge' });
    expect(h.undo(3)).toBe(0);
    expect(h.canUndo).toBe(false);

    time = 5000;
    h.record(3, { coalesce: 'nudge' });
    time = 7000; // outside the window → new step
    h.record(4, { coalesce: 'nudge' });
    expect(h.undo(5)).toBe(4);
  });

  it('does not coalesce across an undo', () => {
    const h = new History<number>(100, 1000, () => 0);
    h.record(0); // 0 → 1, a separate step
    h.record(1, { coalesce: 'k' }); // 1 → 2
    expect(h.undo(2)).toBe(1); // back at 1; history still holds 0
    h.record(1, { coalesce: 'k' }); // 1 → 3: same key, but after an undo
    expect(h.undo(3)).toBe(1); // its own step, not merged away
    expect(h.undo(1)).toBe(0);
  });
});
