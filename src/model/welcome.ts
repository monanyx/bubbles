import { addBubble, addLink, createBubble, emptyMap } from './map';
import type { MindMap } from './types';

const TIPS = [
  { text: 'Double-tap empty space to blow a bubble', color: 'aqua' },
  { text: 'Drag the 🔗 chip onto another bubble', color: 'sun' },
  { text: 'Press ? for every shortcut', color: 'violet' },
] as const;

/** Tip positions: a wide fan for landscape screens, a compact stack for phones. */
const LAYOUTS = {
  landscape: {
    root: { x: 0, y: -10 },
    tips: [
      { x: -230, y: 150 },
      { x: 0, y: 220 },
      { x: 230, y: 150 },
    ],
  },
  portrait: {
    root: { x: 0, y: -170 },
    tips: [
      { x: -105, y: 10 },
      { x: 0, y: 190 },
      { x: 105, y: 10 },
    ],
  },
};

/** First-run map: doubles as a tiny tutorial. */
export function welcomeMap(orientation: keyof typeof LAYOUTS = 'landscape'): MindMap {
  const layout = LAYOUTS[orientation];
  const root = createBubble(layout.root, { text: 'Big idea ✨', d: 150 });
  const tips = TIPS.map((tip, i) => createBubble(layout.tips[i]!, tip));

  let map = addBubble(emptyMap(), root);
  for (const tip of tips) {
    map = addBubble(map, tip);
    map = addLink(map, root.id, tip.id).map;
  }
  return map;
}
