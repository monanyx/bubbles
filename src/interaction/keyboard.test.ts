import { describe, expect, it, vi } from 'vitest';
import { BINDINGS, comboOf, displayCombo, KeyboardController, type CommandMap } from './keyboard';

const key = (init: KeyboardEventInit): KeyboardEvent => new KeyboardEvent('keydown', init);

describe('comboOf', () => {
  it.each([
    [{ key: 'z', ctrlKey: true }, false, 'mod+z'],
    [{ key: 'Z', ctrlKey: true, shiftKey: true }, false, 'mod+shift+z'],
    [{ key: 'z', metaKey: true }, true, 'mod+z'],
    [{ key: 'z', ctrlKey: true }, true, 'z'], // Ctrl is not "mod" on Apple
    [{ key: '?', shiftKey: true }, false, '?'], // Shift is part of the character
    [{ key: 'Tab', shiftKey: true }, false, 'shift+Tab'],
    [{ key: 'N', shiftKey: true }, false, 'shift+n'],
  ])('%o (apple=%s) → %s', (init, apple, expected) => {
    expect(comboOf(key(init), apple)).toBe(expected);
  });
});

describe('displayCombo', () => {
  it('formats per platform', () => {
    expect(displayCombo('mod+shift+z', false)).toBe('Ctrl+Shift+Z');
    expect(displayCombo('mod+shift+z', true)).toBe('⌘⇧Z');
    expect(displayCombo('Escape', false)).toBe('Esc');
    expect(displayCombo('+', false)).toBe('+');
    expect(displayCombo('mod++', false)).toBe('Ctrl++');
  });
});

describe('BINDINGS', () => {
  it('never binds the same combo twice', () => {
    const combos = BINDINGS.flatMap((b) => b.keys);
    expect(new Set(combos).size).toBe(combos.length);
  });
});

describe('KeyboardController', () => {
  function setup(enabled = true) {
    const run = vi.fn();
    const commands = new Proxy({} as CommandMap, {
      get: () => ({ label: 'x', enabled: () => enabled, run }),
    });
    const onArrow = vi.fn(() => true);
    const controller = new KeyboardController(commands, onArrow);
    return { run, onArrow, controller };
  }

  it('runs bound commands and prevents the default action', () => {
    const { run, controller } = setup();
    const event = key({ key: 'n', cancelable: true });
    window.dispatchEvent(event);
    expect(run).toHaveBeenCalledOnce();
    expect(event.defaultPrevented).toBe(true);
    controller.destroy();
  });

  it('lets disabled commands fall through (no keyboard trap on Tab)', () => {
    const { run, controller } = setup(false);
    const event = key({ key: 'Tab', cancelable: true });
    window.dispatchEvent(event);
    expect(run).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
    controller.destroy();
  });

  it('ignores keys typed into editable content', () => {
    const { run, controller } = setup();
    const field = document.createElement('div');
    field.contentEditable = 'true';
    document.body.append(field);
    field.dispatchEvent(key({ key: 'n', bubbles: true }));
    expect(run).not.toHaveBeenCalled();
    field.remove();
    controller.destroy();
  });

  it('does not repeat non-repeatable commands when a key is held', () => {
    const { run, controller } = setup();
    window.dispatchEvent(key({ key: 'n', repeat: true, cancelable: true }));
    expect(run).not.toHaveBeenCalled();
    window.dispatchEvent(key({ key: 'z', ctrlKey: true, repeat: true, cancelable: true }));
    expect(run).toHaveBeenCalledOnce();
    controller.destroy();
  });

  it('routes arrow keys to the arrow handler', () => {
    const { onArrow, controller } = setup();
    window.dispatchEvent(key({ key: 'ArrowLeft', shiftKey: true, cancelable: true }));
    expect(onArrow).toHaveBeenCalledWith('left', { shift: true });
    controller.destroy();
  });
});
