import type { Bubble } from '../model/types';

const DROPLETS = 10;

/** Plays the pop animation and sprays droplets, then removes the element. */
export function popBubble(
  el: HTMLElement,
  bubble: Bubble,
  layer: HTMLElement,
  { droplets = true }: { droplets?: boolean } = {},
): void {
  if (droplets) {
    for (let i = 0; i < DROPLETS; i++) {
      const drop = document.createElement('div');
      drop.className = 'droplet';
      drop.style.translate = `${bubble.x}px ${bubble.y}px`;
      const angle = Math.random() * Math.PI * 2;
      const distance = bubble.d * 0.6 + Math.random() * 40;
      drop.style.setProperty('--dx', `${Math.cos(angle) * distance}px`);
      drop.style.setProperty('--dy', `${Math.sin(angle) * distance}px`);
      layer.append(drop);
      drop.addEventListener('animationend', () => drop.remove(), { once: true });
      setTimeout(() => drop.remove(), 800); // in case animations are disabled
    }
  }
  el.classList.add('is-popping');
  el.removeAttribute('role');
  el.addEventListener('animationend', () => el.remove(), { once: true });
  setTimeout(() => el.remove(), 400);
}
