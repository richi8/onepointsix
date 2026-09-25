import { describe, expect, it } from 'vitest';
import type * as THREE from 'three';
import { Resolution } from '../src/client/resolution.ts';

/** A GPU whose frame time grows with the pixels drawn: `full` ms at the device's resolution. */
function run(full: number, seconds: number, exponent = 2.6) {
  (globalThis as { devicePixelRatio?: number }).devicePixelRatio = 1;
  let ratio = 1;
  const renderer = { setPixelRatio: (r: number) => (ratio = r) } as unknown as THREE.WebGLRenderer;
  const res = new Resolution(renderer);
  const shares: number[] = [];
  for (let t = 0; t < seconds; t += 1 / 60) {
    res.update((full * ratio ** exponent) / 1000);
    shares.push(res.share);
  }
  return { res, shares };
}

describe('adaptive resolution', () => {
  it('stays at full resolution when there is headroom', () => {
    const { res } = run(10, 120);
    expect(res.share).toBe(1);
    expect(res.changes).toBe(0);
  });

  it('drops until frames are fast enough', () => {
    const { res } = run(40, 60);
    expect(res.frameMs).toBeLessThan(1000 / 50);
    expect(res.share).toBeLessThan(1);
  });

  it('settles between two steps instead of switching back and forth', () => {
    // Full resolution is too slow (21 ms), one step down comfortably fast (14 ms).
    const { res, shares } = run(21, 600);
    // Without the back-off it switched every 5 s or so: 121 times in these 10 minutes.
    expect(res.changes).toBeLessThan(12);
    // And it spends nearly all the time on the step that holds 50 fps.
    const low = shares.filter((s) => s < 0.99).length / shares.length;
    expect(low).toBeGreaterThan(0.9);
  });
});
