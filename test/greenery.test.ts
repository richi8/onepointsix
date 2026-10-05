import { describe, expect, it } from 'vitest';
import { CALABIANCA } from '../src/shared/maps/calabianca.ts';
import { World } from '../src/shared/world.ts';
import { beyondTown, groveAt, TERRACE_RISE } from '../src/shared/hillside.ts';
import { paint } from '../src/shared/ground.ts';
import { outcrops, plantings, terraces } from '../src/client/greenery.ts';
import { extent, KINDS, shapeOf } from '../src/client/species.ts';

// Chunk 63: the town's trees and the hillside round it (see
// client/greenery.ts and shared/hillside.ts), all drawn only.

const town = new World(1, CALABIANCA);
const plants = plantings(town);

describe('greenery', () => {
  it('grows each kind as the same tree near and far, the far one far cheaper', () => {
    const triangles = (s: ReturnType<typeof shapeOf>) => (s.wood.getIndex()!.count + s.foliage.getIndex()!.count) / 3;
    for (const kind of KINDS) {
      const near = shapeOf(kind, 7, true);
      const far = shapeOf(kind, 7, false);
      const [a, b] = [extent(near), extent(far)];
      expect(b.top, kind).toBeGreaterThan(a.top * 0.8);
      expect(b.top, kind).toBeLessThan(a.top * 1.2);
      expect(b.reach, kind).toBeLessThan(a.reach * 1.25);
      expect(triangles(far), kind).toBeLessThan(triangles(near) / 5);
    }
  });

  it('grows the town\'s planes and olives over their trunks, and plants nothing else inside the walls', () => {
    const inside = plants.filter((p) => beyondTown(town, p.x, p.z) === 0);
    const trunks = CALABIANCA.walls.filter((w) => w.look === 'plane' || w.look === 'olive');
    expect(inside.length).toBe(trunks.length);
    for (const t of trunks) {
      const [x, z] = [(t.minX + t.maxX) / 2, (t.minZ + t.maxZ) / 2];
      expect(inside.some((p) => p.kind === t.look && Math.hypot(p.x - x, p.z - z) < 1e-6)).toBe(true);
    }
    // Beyond them, far enough out that no crown reaches over a wall but a cypress's or a shrub's.
    for (const p of plants.filter((p) => beyondTown(town, p.x, p.z) > 0)) {
      const out = beyondTown(town, p.x, p.z);
      expect(out, `${p.kind} at ${p.x.toFixed(1)}, ${p.z.toFixed(1)}`).toBeGreaterThan(p.kind === 'cypress' || p.kind === 'shrub' ? 1.5 : 4);
      expect(p.y, `${p.kind} at ${p.x.toFixed(1)}, ${p.z.toFixed(1)}`).toBeGreaterThan(0);
    }
  });

  it('plants the map\'s own trees where it says', () => {
    for (const m of CALABIANCA.plants ?? []) expect(plants.some((p) => p.kind === m.kind && p.x === m.x && p.z === m.z)).toBe(true);
  });

  it('grows olives in rows along the terraces, halfway up each, between dry-stone walls on the contours', () => {
    const olives = plants.filter((p) => p.kind === 'olive' && beyondTown(town, p.x, p.z) > 0);
    expect(olives.length).toBeGreaterThan(300);
    // Halfway between one contour and the next, give or take the ground's bends.
    const off = olives.map((p) => Math.abs((town.terrainHeight(p.x, p.z) / TERRACE_RISE) % 1 - 0.5));
    expect(off.filter((d) => d < 0.25).length / off.length).toBeGreaterThan(0.85);
    const walls = terraces(town);
    expect(walls.length).toBeGreaterThan(500);
    for (const w of walls.slice(0, 2000)) {
      const level = w.y1 - 0.8;
      expect(Math.abs(level / TERRACE_RISE - Math.round(level / TERRACE_RISE))).toBeLessThan(1e-6);
      for (const [x, z] of [[w.x0, w.z0], [w.x1, w.z1]]) expect(Math.abs(town.terrainHeight(x, z) - level)).toBeLessThan(0.35);
      expect(groveAt(town, (w.x0 + w.x1) / 2, (w.z0 + w.z1) / 2)).toBeGreaterThan(0.1);
    }
  });

  it('breaks the hillside with outcrops beyond the walls', () => {
    const rocks = outcrops(town);
    expect(rocks.length).toBeGreaterThan(50);
    for (const r of rocks) expect(beyondTown(town, r.x, r.z)).toBeGreaterThan(5);
  });

  it('bleaches the hillside\'s grass but leaves the ground inside the walls and the island as they were', () => {
    const island = new World(1);
    expect(plantings(island)).toEqual([]);
    expect(terraces(island)).toEqual([]);
    // Inside the walls nothing of the hillside reaches the paint, which the bots see the grass by.
    const b = town.bounds;
    for (let k = 0; k < 200; k++) {
      const x = b.minX + ((k * 37) % 100) / 100 * (b.maxX - b.minX);
      const z = b.minZ + ((k * 61) % 100) / 100 * (b.maxZ - b.minZ);
      expect(beyondTown(town, x, z)).toBe(0);
      expect(groveAt(town, x, z)).toBe(0);
    }
    // Out on the hillside, dry grass and earth, no green.
    const out = plants.filter((p) => p.kind === 'shrub').slice(0, 50);
    for (const p of out) expect(paint(town, p.x, town.terrainHeight(p.x, p.z), p.z, 0.95).weights[0]).toBeLessThan(0.05);
  });
});
