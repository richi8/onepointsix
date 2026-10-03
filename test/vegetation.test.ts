import { describe, expect, it } from 'vitest';
import { EYE_HEIGHT } from '../src/shared/constants.ts';
import { bagShows, TUFT_STRIDE, VEG_CELL, vegetationOf, type Bush } from '../src/shared/vegetation.ts';
import { World } from '../src/shared/world.ts';

const w = new World(1);
const veg = vegetationOf(w);

/** A big bush on flat, bare-ish ground, for looking through. */
function bigBush(): Bush {
  for (let iz = -40; iz < 40; iz++) {
    for (let ix = -40; ix < 40; ix++) {
      for (const b of veg.bushes(ix, iz)) if (b.height > 1.1 && Math.abs(w.terrainHeight(b.x + 6, b.z) - b.y) < 0.3) return b;
    }
  }
  throw new Error('no big bush');
}

/** A tree on flat ground with open ground to one side of it. */
function loneTree() {
  for (const t of w.trees) {
    if (Math.abs(w.terrainHeight(t.x - 30, t.z) - t.y) > 1 || Math.abs(w.terrainHeight(t.x + 2, t.z) - t.y) > 0.3) continue;
    if (w.trees.some((o) => o !== t && Math.abs(o.z - t.z) < 6 && o.x > t.x - 32 && o.x < t.x + 4)) continue;
    if (!w.hasLineOfSight(t.x - 30, w.terrainHeight(t.x - 30, t.z) + EYE_HEIGHT, t.z, t.x, t.y + 1.2, t.z + 0.6)) continue;
    return t;
  }
  throw new Error('no lone tree');
}

describe('vegetation', () => {
  it('scatters the same bushes every time', () => {
    expect(vegetationOf(new World(1)).bushes(3, -2)).toEqual(veg.bushes(3, -2));
    let n = 0;
    for (let iz = -10; iz < 10; iz++) for (let ix = -10; ix < 10; ix++) n += veg.bushes(ix, iz).length;
    expect(n).toBeGreaterThan(50);
  });

  it('hides someone crouched behind a bush but not someone standing', () => {
    const b = bigBush();
    const eyeX = b.x - 25;
    const eyeY = w.terrainHeight(eyeX, b.z) + EYE_HEIGHT;
    const crouched = veg.seeThrough(eyeX, eyeY, b.z, b.x + 1.2, b.y + 0.7, b.z);
    const standing = veg.seeThrough(eyeX, eyeY, b.z, b.x + 1.2, b.y + 1.6, b.z);
    expect(crouched).toBeLessThan(0.3);
    expect(standing).toBeGreaterThan(0.3);
  });

  it('hides a line that skims through thick grass', () => {
    let x = 0, z = 0;
    // A grassy, fairly flat stretch.
    for (let k = 0; k < 4000; k++) {
      x = ((k * 37) % 400) - 200;
      z = ((k * 91) % 400) - 200;
      if (veg.grassiness(x, z) > 0.9 && veg.grassiness(x + 10, z) > 0.9 && Math.abs(w.terrainHeight(x, z) - w.terrainHeight(x + 10, z)) < 0.1) break;
    }
    const y0 = w.terrainHeight(x, z);
    const y1 = w.terrainHeight(x + 10, z);
    expect(veg.seeThrough(x, y0 + 0.3, z, x + 10, y1 + 0.3, z)).toBeLessThan(0.1);
    expect(veg.seeThrough(x, y0 + 1.6, z, x + 10, y1 + 1.6, z)).toBeGreaterThan(0.9);
  });

  it('keeps cells to their squares', () => {
    for (const b of veg.bushes(5, 5)) {
      expect(Math.floor(b.x / VEG_CELL)).toBe(5);
      expect(Math.floor(b.z / VEG_CELL)).toBe(5);
    }
  });

  it('scatters the same grass tufts every time, each in its square', () => {
    const a = veg.tufts(3, -2);
    expect(vegetationOf(new World(1)).tufts(3, -2)).toEqual(a);
    for (let sq = 0; sq < VEG_CELL * VEG_CELL; sq++) {
      for (let k = a.start[sq]; k < a.start[sq + 1]; k++) {
        expect(Math.floor(a.data[k * TUFT_STRIDE] - 3 * VEG_CELL)).toBe(sq % VEG_CELL);
        expect(Math.floor(a.data[k * TUFT_STRIDE + 2] + 2 * VEG_CELL)).toBe(Math.floor(sq / VEG_CELL));
      }
    }
  });

  it('hides a little behind a lone tuft, and nothing through a gap', () => {
    // A tuft with no other within 1.5 m of it, on fairly flat ground.
    let tuft: number[] | null = null;
    let all: number[][] = [];
    for (let iz = -30; iz < 30 && !tuft; iz++) {
      for (let ix = -30; ix < 30 && !tuft; ix++) {
        const t = veg.tufts(ix, iz);
        all = [];
        for (const [dx, dz] of [[-1, -1], [0, -1], [1, -1], [-1, 0], [0, 0], [1, 0], [-1, 1], [0, 1], [1, 1]]) {
          const n = veg.tufts(ix + dx, iz + dz);
          for (let k = 0; k < n.count; k++) all.push([...n.data.subarray(k * TUFT_STRIDE, k * TUFT_STRIDE + 5)]);
        }
        for (let k = 0; k < t.count && !tuft; k++) {
          const [x, y, z, , h] = t.data.subarray(k * TUFT_STRIDE, k * TUFT_STRIDE + 5);
          const alone = all.every(([ox, , oz]) => (ox === x && oz === z) || Math.hypot(ox - x, oz - z) > 1.5);
          const flat = Math.abs(w.terrainHeight(x - 5, z) - y) < 0.2 && Math.abs(w.terrainHeight(x + 5, z) - y) < 0.2;
          if (alone && flat && h > 0.45) tuft = [x, y, z, h];
        }
      }
    }
    if (!tuft) throw new Error('no lone tuft');
    const [x, y, z] = tuft;
    // Low across it: some lost, not all. Just beside it, where there's no grass: nothing lost.
    const across = veg.seeThrough(x - 5, y + 0.15, z, x + 5, y + 0.15, z);
    expect(across).toBeLessThan(0.5);
    expect(across).toBeGreaterThan(0.1);
    expect(veg.seeThrough(x - 1, y + 0.15, z + 0.9, x + 1, y + 0.15, z + 0.9)).toBe(1);
  });

  it('lets someone in a bush see out of it, though not in', () => {
    const b = bigBush();
    const inside = { x: b.x, y: b.y + 0.7, z: b.z };
    const out = { x: b.x - 25, y: w.terrainHeight(b.x - 25, b.z) + EYE_HEIGHT, z: b.z };
    expect(veg.seeThrough(inside.x, inside.y, inside.z, out.x, out.y, out.z)).toBeGreaterThan(0.3);
    expect(veg.seeThrough(out.x, out.y, out.z, inside.x, inside.y, inside.z)).toBeLessThan(0.3);
  });

  it('hides a bag behind a bush', () => {
    const b = bigBush();
    const eyeX = b.x - 25;
    const eyeY = w.terrainHeight(eyeX, b.z) + EYE_HEIGHT;
    const behind = b.x + b.size * 0.4;
    expect(bagShows(w, eyeX, eyeY, b.z, behind, w.terrainHeight(behind, b.z), b.z)).toBe(false);
  });

  it("hides someone standing in or behind a tree's crown, but not beside it", () => {
    const t = loneTree();
    const eyeX = t.x - 30;
    const eyeY = w.terrainHeight(eyeX, t.z) + EYE_HEIGHT;
    const by = (x: number, z: number) => w.terrainHeight(x, z) + 1.2;
    // Against the trunk, just off the line through it, under the drooping limbs.
    expect(veg.seeThrough(eyeX, eyeY, t.z, t.x + 0.3, by(t.x + 0.3, t.z + 0.6), t.z + 0.6)).toBeLessThan(0.3);
    // A little way behind it.
    expect(veg.seeThrough(eyeX, eyeY, t.z, t.x + 2, by(t.x + 2, t.z + 0.5), t.z + 0.5)).toBeLessThan(0.3);
    // Well clear of it to the side.
    expect(veg.seeThrough(eyeX, eyeY, t.z, t.x, by(t.x, t.z + 5), t.z + 5)).toBeGreaterThan(0.9);
  });

  it('lets someone under a tree see out of it', () => {
    const t = loneTree();
    const x = t.x - 0.6;
    const out = { x: t.x - 30, y: w.terrainHeight(t.x - 30, t.z) + 1.2, z: t.z };
    expect(veg.seeThrough(x, w.terrainHeight(x, t.z) + EYE_HEIGHT, t.z, out.x, out.y, out.z)).toBeGreaterThan(0.3);
  });
});
