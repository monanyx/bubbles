export interface Animation {
  /** Jumps straight to the end state. */
  finish(): void;
}

const easeOutCubic = (t: number): number => 1 - (1 - t) ** 3;

/**
 * Drives `step(progress)` from 0 to 1 over `duration` ms with an ease-out
 * curve, then calls `done`. With reduced motion it completes immediately.
 */
export function animate(
  duration: number,
  step: (progress: number) => void,
  done: () => void = () => undefined,
  reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches,
): Animation {
  let frame = 0;
  let finished = false;
  const finish = (): void => {
    if (finished) return;
    finished = true;
    cancelAnimationFrame(frame);
    step(1);
    done();
  };
  if (reducedMotion || duration <= 0) {
    finish();
    return { finish };
  }
  const start = performance.now();
  const tick = (now: number): void => {
    const t = Math.min(1, (now - start) / duration);
    if (t >= 1) return finish();
    step(easeOutCubic(t));
    frame = requestAnimationFrame(tick);
  };
  frame = requestAnimationFrame(tick);
  return { finish };
}
