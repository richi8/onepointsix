import { describe, expect, it } from 'vitest';
import { EYE_HEIGHT } from '../src/shared/constants.ts';
import { VEG_CELL, vegetationOf, type Bush } from '../src/shared/vegetation.ts';
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
});
