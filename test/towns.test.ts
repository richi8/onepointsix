import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { MODES } from '../src/server/directory.ts';
import { GameServer } from '../src/server/server.ts';
import { groundWeights } from '../src/shared/ground.ts';
import { Layer } from '../src/shared/layers.ts';
import { lootCrates } from '../src/shared/loot.ts';
import { TERRACE, TOWN_LOOK } from '../src/shared/towns.ts';
import { inBuilding, layoutFor, ROAD_WIDTH, World, type Box, type Building, type Rect, type Town } from '../src/shared/world.ts';
import { NavGrid } from '../src/server/nav.ts';

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

  it('levels the ground under each as it is laid out: flat, in terraces, or down to the harbour', () => {
    for (const w of towns) {
      for (const t of w.towns) {
        const tiers = t.style === 'village' ? [t.y - TERRACE, t.y, t.y + TERRACE] : [t.y];
        const on = tiers.map(() => 0);
        let sea = 0;
        let between = 0;
        for (let i = 0; i < 64; i++) {
          const a = (i / 64) * Math.PI * 2;
          for (const f of [0, 0.3, 0.6, 0.9]) {
            const h = w.terrainHeight(t.x + Math.sin(a) * t.r * f, t.z + Math.cos(a) * t.r * f);
            const k = tiers.findIndex((y) => Math.abs(h - y) < 0.05);
            if (k >= 0) on[k]++;
            // The harbour's ground goes down to the water off its quay; it's never higher.
            else if (t.style === 'harbour' && h < t.y) sea++;
            // A village's terraces ramp up from one to the next, a cell wide.
            else if (t.style === 'village' && h > tiers[0] && h < tiers[2]) between++;
            else expect(h).toBeCloseTo(t.y, 1);
          }
        }
        if (t.style === 'harbour') {
          expect(sea).toBeGreaterThan(64 * 4 * 0.1);
          expect(on[0]).toBeGreaterThan(64 * 4 * 0.4);
          expect(w.terrainHeight(t.x + t.seaX * (t.r + 40), t.z + t.seaZ * (t.r + 40))).toBeLessThan(0);
        } else expect(sea).toBe(0);
        if (t.style === 'village') {
          for (const n of on) expect(n).toBeGreaterThan(64 * 4 * 0.15);
          expect(between).toBeLessThan(64 * 4 * 0.25);
        }
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
      const own = new Set(w.towns.flatMap((t) => w.props.slice(...t.props).map((p) => p.box)));
      const centre = (c: World['colliders'][number]): [number, number] => (c.kind === 'cyl' ? [c.x, c.z] : [(c.minX + c.maxX) / 2, (c.minZ + c.maxZ) / 2]);
      for (const c of w.colliders) {
        if (c.kind === 'box' && own.has(c)) continue;
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

/** The town's own props. */
function propsOf(w: World, t: Town) {
  return w.props.slice(...t.props);
}

/** The town's buildings: those standing on its site. */
function buildingsOf(w: World, t: Town): Building[] {
  return w.buildings.filter((b) => Math.hypot((b.minX + b.maxX) / 2 - t.x, (b.minZ + b.maxZ) / 2 - t.z) < t.r);
}

function overlap(a: Rect | Box, b: Rect | Box, pad = 0): boolean {
  return a.minX < b.maxX + pad && b.minX < a.maxX + pad && a.minZ < b.maxZ + pad && b.minZ < a.maxZ + pad;
}

describe('Town layouts', () => {
  it('fills each site with buildings that stay on it and clear of each other', () => {
    for (const w of towns) {
      for (const t of w.towns) {
        const own = buildingsOf(w, t);
        expect(own.length, `${w.seed} ${t.style}`).toBeGreaterThanOrEqual(t.style === 'old' ? 18 : 10);
        for (const b of own) {
          for (const [x, z] of [[b.minX, b.minZ], [b.maxX, b.minZ], [b.minX, b.maxZ], [b.maxX, b.maxZ]]) expect(Math.hypot(x - t.x, z - t.z)).toBeLessThan(t.r);
          for (const o of own) if (o !== b) expect(overlap(b, o, -0.01)).toBe(false);
        }
      }
    }
  });

  it('packs the old town tight, buildings against each other, and spreads the village out', () => {
    let touching = 0;
    const gaps: Record<string, number[]> = { old: [], village: [] };
    for (const w of towns) {
      for (const t of w.towns.filter((t) => t.style !== 'harbour')) {
        const own = buildingsOf(w, t);
        for (const b of own) {
          const near = Math.min(...own.filter((o) => o !== b).map((o) => Math.max(o.minX - b.maxX, b.minX - o.maxX, o.minZ - b.maxZ, b.minZ - o.maxZ)));
          gaps[t.style].push(near);
          if (t.style === 'old' && near < 0.01) touching++;
        }
      }
    }
    const median = (v: number[]) => [...v].sort((a, b) => a - b)[Math.floor(v.length / 2)];
    expect(touching).toBeGreaterThan(towns.length * 6);
    expect(median(gaps.old)).toBeLessThan(1);
    expect(median(gaps.village)).toBeGreaterThan(3);
  });

  it('gives each town an open place, clear of all but crates and the quay\'s containers', () => {
    for (const w of towns) {
      for (const t of w.towns) {
        expect(t.open.length).toBeGreaterThan(0);
        const biggest = Math.max(...t.open.map((r) => (r.maxX - r.minX) * (r.maxZ - r.minZ)));
        expect(biggest, `${w.seed} ${t.style}`).toBeGreaterThan(400);
        for (const r of t.open) {
          for (const p of propsOf(w, t)) if (p.style !== 'crate' && p.style !== 'metal') expect(overlap(r, p.box), `${w.seed} ${t.style} ${p.box.part}`).toBe(false);
        }
      }
    }
  });

  it('builds each town in its own style: walls and roofs, terraces, a quay with piers and containers', () => {
    for (const w of towns) {
      for (const t of w.towns) {
        const own = propsOf(w, t);
        const roofs = own.filter((p) => p.box.part === 'roof');
        expect(roofs.every((p) => p.tint === TOWN_LOOK[t.style].roof)).toBe(true);
        expect(own.filter((p) => p.box.part === 'sill').every((p) => p.tint === TOWN_LOOK[t.style].wall)).toBe(true);
        const containers = own.filter((p) => p.box.part === 'container');
        const decks = own.filter((p) => p.box.part === 'timber' && p.box.walk);
        // A retaining wall: as tall as a terrace's step and more, with its top flush with the terrace above.
        const terraces = own.filter((p) => p.box.part === 'wall' && p.box.maxY - p.box.minY > TERRACE && Math.abs(p.box.maxY - t.y - TERRACE) < 1e-6);
        if (t.style === 'harbour') {
          expect(containers.length).toBeGreaterThan(4);
          // Stacked: one standing on another.
          expect(containers.some((c) => c.box.minY > t.y + 2)).toBe(true);
          expect(decks.length).toBeGreaterThanOrEqual(2);
          // Out over the water.
          for (const d of decks) expect(w.terrainHeight(d.box.maxX - 0.5, d.box.maxZ - 0.5) < 0 || w.terrainHeight(d.box.minX + 0.5, d.box.minZ + 0.5) < 0).toBe(true);
        } else {
          expect(containers).toHaveLength(0);
          expect(decks).toHaveLength(0);
        }
        expect(terraces.length > 0).toBe(t.style === 'village');
      }
    }
  });

  it('spreads crates through each town', () => {
    for (const w of towns) {
      const crates = lootCrates(w);
      for (const t of w.towns) {
        const own = crates.filter(({ box }) => Math.hypot((box.minX + box.maxX) / 2 - t.x, (box.minZ + box.maxZ) / 2 - t.z) < t.r);
        expect(own.length, `${w.seed} ${t.style}`).toBeGreaterThanOrEqual(15);
        // In buildings and out of them.
        expect(own.some(({ box }) => !w.buildings.some((b) => inBuilding(b, box.minX, box.minZ)))).toBe(true);
      }
    }
  });

  it('lets a bot walk from the open place into every room and up to every crate outside', () => {
    for (const w of towns.slice(0, 8)) {
      const nav = new NavGrid(w);
      const crates = lootCrates(w);
      for (const t of w.towns) {
        const o = t.open[0];
        const from = nav.nearestWalkable((o.minX + o.maxX) / 2, (o.minZ + o.maxZ) / 2)!;
        const reaches = (x: number, z: number, y?: number): boolean => {
          const end = nav.findPath(from.x, from.z, x, z, undefined, y)?.at(-1);
          return !!end && Math.hypot(end.x - x, end.z - z) < 0.6;
        };
        for (const b of buildingsOf(w, t)) {
          for (const r of b.parts) {
            const g = nav.nearestWalkable((r.minX + r.maxX) / 2, (r.minZ + r.maxZ) / 2, 2);
            expect(g && inBuilding(b, g.x, g.z), `${w.seed} ${t.style} ${b.plan}`).toBe(true);
            expect(reaches(g!.x, g!.z), `${w.seed} ${t.style} ${b.plan} at ${b.minX},${b.minZ}`).toBe(true);
          }
        }
        // A crate out of doors, from a spot beside it, as a bot goes to search one.
        for (const { box } of crates) {
          const cx = (box.minX + box.maxX) / 2;
          const cz = (box.minZ + box.maxZ) / 2;
          if (Math.hypot(cx - t.x, cz - t.z) > t.r || w.buildings.some((b) => inBuilding(b, cx, cz))) continue;
          const reach = Math.max(box.maxX - box.minX, box.maxZ - box.minZ) / 2 + 0.9;
          const spots = Array.from({ length: 8 }, (_, i) => [cx + Math.sin((i / 8) * Math.PI * 2) * reach, cz + Math.cos((i / 8) * Math.PI * 2) * reach]);
          expect(spots.some(([x, z]) => nav.dry(x, z) && reaches(x, z)), `${w.seed} ${t.style} crate at ${cx},${cz}`).toBe(true);
        }
      }
    }
  });
});
