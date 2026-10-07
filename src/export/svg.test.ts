import { describe, expect, it } from 'vitest';
import { addBubble, addLink, createBubble, emptyMap } from '../model/map';
import { welcomeMap } from '../model/welcome';
import { renderSvg, wrapText, type MeasureText } from './svg';

/** 10px per character regardless of size: easy to reason about. */
const fixed: MeasureText = (text) => [...text].length * 10;

describe('wrapText', () => {
  it('wraps greedily on spaces', () => {
    expect(wrapText('one two three four', 90, 12, fixed)).toEqual(['one two', 'three', 'four']);
  });

  it('honours explicit newlines and breaks over-long words', () => {
    expect(wrapText('ab\nabcdefghijkl', 50, 12, fixed)).toEqual(['ab', 'abcde', 'fghij', 'kl']);
  });

  it('keeps emoji intact when breaking', () => {
    const lines = wrapText('✨✨✨✨', 20, 12, fixed);
    expect(lines).toEqual(['✨✨', '✨✨']);
  });
});

describe('renderSvg', () => {
  it('returns null for an empty map', () => {
    expect(renderSvg(emptyMap())).toBeNull();
  });

  it('produces well-formed SVG sized to the content', () => {
    const map = welcomeMap();
    const result = renderSvg(map, { measure: fixed })!;
    const doc = new DOMParser().parseFromString(result.svg, 'image/svg+xml');
    expect(doc.querySelector('parsererror')).toBeNull();
    const svg = doc.documentElement;
    expect(svg.getAttribute('width')).toBe(String(result.width));
    // One shadow mask per bubble, one text per labelled bubble.
    expect(doc.querySelectorAll('mask')).toHaveLength(map.nodes.size);
    expect(doc.querySelectorAll('text')).toHaveLength(map.nodes.size);
    // Two strokes (core + glow) per link.
    expect(doc.querySelectorAll('path[stroke="url(#wire)"]')).toHaveLength(map.links.size);
  });

  it('defines gradients only for colours in use', () => {
    let map = addBubble(emptyMap(), createBubble({ x: 0, y: 0 }, { color: 'rose' }));
    const svg = renderSvg(map, { measure: fixed })!.svg;
    expect(svg).toContain('id="tint-rose"');
    expect(svg).not.toContain('id="tint-sky"');

    map = addBubble(map, createBubble({ x: 300, y: 0 }, { id: 'b' }));
    expect(renderSvg(map, { measure: fixed })!.svg).toContain('id="tint-sky"');
  });

  it('escapes label text', () => {
    const map = addBubble(emptyMap(), createBubble({ x: 0, y: 0 }, { text: '<b>&"x"</b>' }));
    const svg = renderSvg(map, { measure: () => 0 })!.svg; // keep it on one line
    expect(svg).toContain('&lt;b&gt;&amp;"x"&lt;/b&gt;');
    expect(
      new DOMParser().parseFromString(svg, 'image/svg+xml').querySelector('parsererror'),
    ).toBeNull();
  });

  it('can omit the wallpaper', () => {
    let map = addBubble(emptyMap(), createBubble({ x: 0, y: 0 }, { id: 'a' }));
    map = addLink(addBubble(map, createBubble({ x: 400, y: 0 }, { id: 'b' })), 'a', 'b').map;
    expect(renderSvg(map, { background: false, measure: fixed })!.svg).not.toContain('url(#bg)');
  });
});
