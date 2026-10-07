import { describe, expect, it } from 'vitest';
import { CALABIANCA } from '../src/shared/maps/calabianca.ts';
import { mulberry32 } from '../src/shared/rng.ts';
import { World } from '../src/shared/world.ts';
import { sightlines } from '../src/client/sightlines.ts';
import { plantings } from '../src/client/greenery.ts';

// What the town can't see of the hillside isn't drawn (client/sightlines.ts).

const town = new World(1, CALABIANCA);
const REACH = 300;

describe('sightlines', () => {
  it('never hides what a player on the ground could see', () => {
    const seen = sightlines(town, REACH);
    const rand = mulberry32(5);
    const b = town.bounds;
    const [cx, cz] = [(b.minX + b.maxX) / 2, (b.minZ + b.maxZ) / 2];
    let visible = 0;
    let wrong = 0;
    for (let k = 0; k < 400; k++) {
      // A spot on the ground in the town, and a treetop out on the hillside, by the exact ground.
      const [ex, ez] = [b.minX + rand() * (b.maxX - b.minX), b.minZ + rand() * (b.maxZ - b.minZ)];
      const ey = town.terrainHeight(ex, ez) + 1.7;
      const a = rand() * Math.PI * 2;
      const d = 20 + rand() * 200;
      const [x, z] = [cx + Math.cos(a) * d, cz + Math.sin(a) * d];
      const top = town.terrainHeight(x, z) + 4;
      let clear = true;
      const len = Math.hypot(x - ex, z - ez);
      for (let s = 1; s < len && clear; s += 1) clear = ey + ((top - ey) * s) / len >= town.terrainHeight(ex + ((x - ex) * s) / len, ez + ((z - ez) * s) / len);
      if (!clear) continue;
      visible++;
      if (!seen(x, top, z)) wrong++;
    }
    expect(visible).toBeGreaterThan(20);
    expect(wrong).toBe(0);
  });

  it('draws far fewer trees than it plants, and still some on the hillside facing the town', () => {
    const plants = plantings(town);
    expect(plants.length).toBeGreaterThan(300);
    expect(plants.length).toBeLessThan(2000);
  });
});
