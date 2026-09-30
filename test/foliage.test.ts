import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { bladesGeometry } from '../src/client/groundcover.ts';
import { CARD_HALF } from '../src/client/impostors.ts';
import { fir, TREE_HEIGHT } from '../src/client/trees.ts';
import { TUFT_BLOCK } from '../src/shared/vegetation.ts';

/**
 * How much of a tuft of single blades a line through it at each height
 * crosses, seen side on from every direction round it: its triangles drawn
 * flat on a grid, and the share of each band of height covered within
 * `off` of its middle, averaged over the directions.
 */
function coverage(geo: THREE.BufferGeometry, bands: number, off: number): number[] {
  const pos = geo.getAttribute('position');
  const index = geo.getIndex()!;
  const NX = 160;
  const NY = bands * 10;
  const out = new Array<number>(bands).fill(0);
  const views = 12;
  for (let v = 0; v < views; v++) {
    const a = (v / views) * Math.PI;
    const grid = new Uint8Array(NX * NY);
    const p = (i: number) => [pos.getX(i) * Math.cos(a) + pos.getZ(i) * Math.sin(a), pos.getY(i)];
    for (let t = 0; t < index.count; t += 3) {
      const [[x0, y0], [x1, y1], [x2, y2]] = [p(index.getX(t)), p(index.getX(t + 1)), p(index.getX(t + 2))];
      const area = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
      if (Math.abs(area) < 1e-12) continue;
      for (let gy = 0; gy < NY; gy++) {
        const y = (gy + 0.5) / NY;
        for (let gx = 0; gx < NX; gx++) {
          const x = ((gx + 0.5) / NX - 0.5) * 2 * off;
          const w0 = ((x1 - x) * (y2 - y) - (x2 - x) * (y1 - y)) / area;
          const w1 = ((x2 - x) * (y0 - y) - (x0 - x) * (y2 - y)) / area;
          if (w0 >= 0 && w1 >= 0 && w0 + w1 <= 1) grid[gy * NX + gx] = 1;
        }
      }
    }
    for (let gy = 0; gy < NY; gy++) {
      let n = 0;
      for (let gx = 0; gx < NX; gx++) n += grid[gy * NX + gx];
      out[Math.floor(gy / 10)] += n / NX / views / 10;
    }
  }
  return out;
}

/** What the sight model has a line through a tuft's middle lose at height u (see Vegetation.grassThrough). */
function modelled(u: number): number {
  return u >= 0.95 ? 0 : TUFT_BLOCK * (u < 0.5 ? 1 : (0.95 - u) / 0.45);
}

describe('foliage', () => {
  it('draws tufts of blades about as thick as bots see them', () => {
    // Through the middle, where the sight model's tufts are thickest, at each tenth of their height.
    const drawn = coverage(bladesGeometry(), 10, 0.1);
    drawn.forEach((c, i) => expect(Math.abs(c - modelled((i + 0.5) / 10)), `at ${i / 10} of the height`).toBeLessThan(0.15));
  });

  it('draws a tree near and far as the same tree, the far one far cheaper', () => {
    const near = fir(22, true);
    const far = fir(22, false);
    const extent = (geo: THREE.BufferGeometry) => {
      const pos = geo.getAttribute('position');
      let reach = 0;
      let top = 0;
      for (let i = 0; i < pos.count; i++) {
        reach = Math.max(reach, Math.hypot(pos.getX(i), pos.getZ(i)));
        top = Math.max(top, pos.getY(i));
      }
      return { reach, top };
    };
    const triangles = (parts: typeof near) => (parts.wood.getIndex()!.count + parts.foliage.getIndex()!.count) / 3;
    for (const parts of [near, far]) {
      const { reach, top } = extent(parts.foliage);
      // Inside the impostor's card, and about the collider's height.
      expect(reach).toBeLessThan(CARD_HALF);
      expect(top).toBeGreaterThan(TREE_HEIGHT * 0.95);
      expect(top).toBeLessThan(TREE_HEIGHT * 1.05);
    }
    expect(Math.abs(extent(far.foliage).reach - extent(near.foliage).reach)).toBeLessThan(0.3);
    expect(triangles(far)).toBeLessThan(triangles(near) / 4);
    expect(triangles(far)).toBeLessThan(600);
  });
});
