import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { MODES } from '../src/server/directory.ts';
import { GameServer } from '../src/server/server.ts';
import { groundWeights } from '../src/shared/ground.ts';
import { Layer } from '../src/shared/layers.ts';
import { layoutFor, ROAD_WIDTH, World } from '../src/shared/world.ts';

const SEEDS = Array.from({ length: 24 }, (_, i) => i + 1);
const towns = SEEDS.map((seed) => new World(seed, 'towns'));

/** Everything an island is built from, hashed. */
function fingerprint(w: World): string {
  const h = createHash('sha256');
  h.update(Buffer.from(w.heights.buffer));
  h.update(Buffer.from(groundWeights(w).buffer));
  const strip = (o: unknown): string => JSON.stringify(o, (k, v: unknown) => (k === 'stamp' ? undefined : v));
  for (const part of [w.trees, w.rocks, w.props, w.panels, w.outposts, w.extracts, w.walls, w.buildings, w.doors, w.towers, w.colliders]) h.update(strip(part));
  return h.digest('hex').slice(0, 16);
}

describe('Islands by mode', () => {
  it('gives Deathmatch towns and every other mode outposts', () => {
    expect(layoutFor('deathmatch')).toBe('towns');
    expect(layoutFor('extraction')).toBe('outposts');
    expect(layoutFor('range')).toBe('outposts');
  });

  it('keeps an Extraction island exactly as it was before the towns', () => {
    // Taken from the islands as chunk 49 left them.
    const before: Record<number, string> = { 1: 'fa686eecfeb0dfd1', 2: 'ee37bf0eb8e7bff9', 3: '73657f5ac3f13169', 4242: '24c836172faa1656' };
    for (const [seed, hash] of Object.entries(before)) {
      const w = new World(Number(seed));
      expect(w.towns).toEqual([]);
      expect(w.roads).toEqual([]);
      expect(fingerprint(w)).toBe(hash);
    }
  });

  it('builds the same towns on the server as on the client', () => {
    const server = new GameServer(7, MODES.deathmatch.options);
    const client = new World(7, layoutFor('deathmatch'));
    expect(server.world.towns).toEqual(client.towns);
    expect(server.world.roads).toEqual(client.roads);
    expect(fingerprint(server.world)).toBe(fingerprint(client));
    expect(new GameServer(7, MODES.extraction.options).world.towns).toEqual([]);
  });
});

describe('Towns', () => {
  it('puts three towns, a harbour and two inland, on every island, and no outposts', () => {
    for (const w of towns) {
      expect(w.outposts).toEqual([]);
      expect(w.towers).toEqual([]);
      expect(w.buildings.every((b) => b.outpost === -1)).toBe(true);
      expect(w.towns.map((t) => t.style)).toEqual(['harbour', 'old', 'village']);
      expect(new Set(w.towns.map((t) => t.name)).size).toBe(3);
    }
  });

  it('spaces them round the island', () => {
    for (const w of towns) {
      const [a, b, c] = w.towns;
      for (const [p, q] of [[a, b], [a, c], [b, c]]) expect(Math.hypot(p.x - q.x, p.z - q.z)).toBeGreaterThan(p.r + q.r + 40);
    }
  });

  it('levels the ground under each, leaving the harbour its sea', () => {
    for (const w of towns) {
      for (const t of w.towns) {
        let sea = 0;
        let level = 0;
        for (let i = 0; i < 64; i++) {
          const a = (i / 64) * Math.PI * 2;
          for (const f of [0, 0.3, 0.6, 0.9]) {
            const h = w.terrainHeight(t.x + Math.sin(a) * t.r * f, t.z + Math.cos(a) * t.r * f);
            if (Math.abs(h - t.y) < 0.05) level++;
            // The harbour's ground goes down to the water where the sea was; it's never higher.
            else if (t.style === 'harbour' && h < t.y) sea++;
            else expect(h).toBeCloseTo(t.y, 1);
          }
        }
        if (t.style === 'harbour') {
          expect(sea).toBeGreaterThan(0);
          expect(level).toBeGreaterThan(64 * 4 * 0.4);
          expect(w.terrainHeight(t.x + t.seaX * (t.r + 40), t.z + t.seaZ * (t.r + 40))).toBeLessThan(0);
        } else expect(sea).toBe(0);
      }
    }
  });

  it('joins every pair of towns by a road on dry land', () => {
    for (const w of towns) {
      expect(w.roads).toHaveLength(3);
      const ends = w.roads.map((r) => [r[0], r[r.length - 1]].map((p) => w.towns.findIndex((t) => t.x === p.x && t.z === p.z)).sort().join());
      expect(ends.sort()).toEqual(['0,1', '0,2', '1,2']);
      for (const road of w.roads) {
        for (let i = 1; i < road.length; i++) {
          expect(Math.hypot(road[i].x - road[i - 1].x, road[i].z - road[i - 1].z)).toBeLessThan(20);
          expect(w.terrainHeight(road[i].x, road[i].z)).toBeGreaterThan(1.5);
        }
      }
    }
  });

  it('keeps the country as it is, but off the town sites and the roads', () => {
    for (const w of towns) {
      // Huts, fences and field cover still stand out in the country.
      expect(w.buildings.length + w.panels.length).toBeGreaterThan(0);
      const centre = (c: World['colliders'][number]): [number, number] => (c.kind === 'cyl' ? [c.x, c.z] : [(c.minX + c.maxX) / 2, (c.minZ + c.maxZ) / 2]);
      for (const c of w.colliders) {
        const [x, z] = centre(c);
        for (const t of w.towns) expect(Math.hypot(x - t.x, z - t.z)).toBeGreaterThan(t.r);
        expect(w.roadDistance(x, z)).toBeGreaterThan(ROAD_WIDTH / 2);
      }
    }
  });

  it('paints the town sites and roads as dirt', () => {
    const w = towns[0];
    const W = groundWeights(w);
    const n = w.res + 1;
    const at = (x: number, z: number): number => {
      const ix = Math.round((x + w.half) / w.cell);
      const iz = Math.round((z + w.half) / w.cell);
      return W[(iz * n + ix) * 5 + Layer.dirt];
    };
    for (const t of w.towns.filter((t) => t.style !== 'harbour')) expect(at(t.x, t.z)).toBeGreaterThan(0.9);
    const road = w.roads[0];
    const mid = road[Math.floor(road.length / 2)];
    expect(at(mid.x, mid.z)).toBeGreaterThan(0.4);
  });
});
