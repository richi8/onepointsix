import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { MODES } from '../src/server/directory.ts';
import { NavGrid } from '../src/server/nav.ts';
import { GameServer } from '../src/server/server.ts';
import { Btn, CMD_DT } from '../src/shared/constants.ts';
import { groundWeights } from '../src/shared/ground.ts';
import { Layer } from '../src/shared/layers.ts';
import { lootCrates } from '../src/shared/loot.ts';
import { mapFor } from '../src/shared/maps/index.ts';
import { TEST_STREET } from '../src/shared/maps/teststreet.ts';
import { applyCmd, spawnState } from '../src/shared/sim.ts';
import { inBuilding, World } from '../src/shared/world.ts';

/** Everything a world is built from, hashed. */
function fingerprint(w: World): string {
  const h = createHash('sha256');
  h.update(Buffer.from(w.heights.buffer));
  h.update(Buffer.from(groundWeights(w).buffer));
  const strip = (o: unknown): string => JSON.stringify(o, (k, v: unknown) => (k === 'stamp' ? undefined : v));
  for (const part of [w.trees, w.rocks, w.props, w.panels, w.outposts, w.extracts, w.walls, w.buildings, w.doors, w.towers, w.colliders]) h.update(strip(part));
  return h.digest('hex').slice(0, 16);
}

const street = new World(1, TEST_STREET);

describe('Worlds by mode', () => {
  it('plays Deathmatch on its map and every other mode on the island from the seed', () => {
    expect(mapFor('deathmatch')).toBe(TEST_STREET);
    expect(mapFor('extraction')).toBeNull();
    expect(mapFor('range')).toBeNull();
  });

  it('keeps an Extraction island exactly as it was before the maps', () => {
    // Taken from the islands as chunk 49 left them.
    const before: Record<number, string> = { 1: 'fa686eecfeb0dfd1', 2: 'ee37bf0eb8e7bff9', 3: '73657f5ac3f13169', 4242: '24c836172faa1656' };
    for (const [seed, hash] of Object.entries(before)) {
      const w = new World(Number(seed));
      expect(w.map).toBeNull();
      expect(w.spawns).toEqual([]);
      expect(fingerprint(w)).toBe(hash);
    }
  });

  it('builds the same map on the server as on the client, whatever the game\'s seed', () => {
    const server = new GameServer(7, MODES.deathmatch.options);
    expect(server.world.map).toBe(TEST_STREET);
    expect(fingerprint(server.world)).toBe(fingerprint(street));
    expect(fingerprint(new World(99, TEST_STREET))).toBe(fingerprint(street));
    expect(new GameServer(7, MODES.extraction.options).world.map).toBeNull();
  });
});

describe('The test street', () => {
  it('has its two buildings and nothing of the island\'s: no outposts, extraction points, huts or fences', () => {
    expect(street.buildings.map((b) => b.plan)).toEqual(['tall', 'two']);
    expect(street.outposts).toEqual([]);
    expect(street.extracts).toEqual([]);
    expect(street.towers).toEqual([]);
    expect(street.panels.filter((p) => p.kind === 'fence')).toEqual([]);
  });

  it('lays its ground as the map has it, and the island\'s beyond the blend', () => {
    const g = TEST_STREET.ground;
    g.heights.forEach((row, r) => row.forEach((h, c) => expect(street.terrainHeight(g.x0 + c * g.cell, g.z0 + r * g.cell)).toBeCloseTo(h, 4)));
    const island = new World(TEST_STREET.seed);
    const far = g.x0 - g.blend - 8;
    expect(street.terrainHeight(far, 0)).toBeCloseTo(island.terrainHeight(far, 0), 4);
  });

  it('keeps trees and rocks off its ground, and the grass: it is bare', () => {
    const g = TEST_STREET.ground;
    const x1 = g.x0 + (g.heights[0].length - 1) * g.cell;
    const z1 = g.z0 + (g.heights.length - 1) * g.cell;
    for (const t of [...street.trees, ...street.rocks]) expect(t.x < g.x0 || t.x > x1 || t.z < g.z0 || t.z > z1).toBe(true);
    // Some of the backdrop's still stand round it.
    expect(street.trees.length).toBeGreaterThan(100);
    const weights = groundWeights(street);
    const n = street.res + 1;
    const at = (x: number, z: number) => weights[(Math.round((z + street.half) / street.cell) * n + Math.round((x + street.half) / street.cell)) * 5 + Layer.dirt];
    expect(at(0, 0)).toBeCloseTo(1, 3);
    expect(at(-20, 12)).toBeCloseTo(1, 3);
  });

  it('stands every spawn point on clear ground within the bounds, outside the buildings', () => {
    expect(street.spawns.length).toBe(TEST_STREET.spawns.length);
    for (const s of street.spawns) {
      expect(street.inBounds(s.x, s.z, 1)).toBe(true);
      expect(street.fits(s.x, s.y, s.z, 1.8)).toBe(true);
      expect(s.y).toBeCloseTo(street.terrainHeight(s.x, s.z), 3);
      expect(street.buildings.some((b) => inBuilding(b, s.x, s.z, 0.5))).toBe(false);
    }
  });

  it('lets bots reach every building, upstairs and every crate from a spawn point, and nothing beyond the bounds', () => {
    const nav = new NavGrid(street);
    const from = street.spawns[0];
    for (const b of street.buildings) {
      const cx = (b.minX + b.maxX) / 2;
      const cz = (b.minZ + b.maxZ) / 2;
      const path = nav.findPath(from.x, from.z, cx, cz);
      expect(path, `into the ${b.plan}`).not.toBeNull();
      expect(Math.hypot(path!.at(-1)!.x - cx, path!.at(-1)!.z - cz)).toBeLessThan(2);
      if (b.upper !== null) {
        const up = nav.findPath(from.x, from.z, cx, cz, undefined, b.upper);
        expect(up?.at(-1)?.y).toBeCloseTo(b.upper, 1);
      }
    }
    for (const c of lootCrates(street)) {
      const x = (c.box.minX + c.box.maxX) / 2;
      const z = (c.box.minZ + c.box.maxZ) / 2;
      expect(nav.nearestWalkable(x, z, 3, Math.max(c.box.minY, street.floorHeight(x, z)))).not.toBeNull();
    }
    const b = street.bounds;
    expect(nav.walkable(b.maxX + 3, 0)).toBe(false);
    expect(nav.walkable(0, b.minZ - 3)).toBe(false);
    expect(nav.findPath(from.x, from.z, b.maxX + 10, 0)).toBeNull();
  });

  it('keeps a player within its bounds', () => {
    const p = spawnState(street.bounds.maxX - 1, street.terrainHeight(27, 0), 0);
    // East, and on past the wall and the edge.
    for (let i = 0; i < 4 / CMD_DT; i++) applyCmd(street, p, { seq: i, buttons: Btn.Forward | Btn.Jump, yaw: -Math.PI / 2, pitch: 0 }, CMD_DT);
    expect(p.x).toBeLessThanOrEqual(street.bounds.maxX);
  });

  it('takes a player up the outside stair onto the roof', () => {
    const [s] = TEST_STREET.stairs;
    const p = spawnState(s.x, street.terrainHeight(s.x, s.z + 1), s.z + 1);
    // Up it, northward, and from its top west onto the roof.
    let i = 0;
    for (; p.z > 7.5 && i < 3 / CMD_DT; i++) applyCmd(street, p, { seq: i, buttons: Btn.Forward, yaw: 0, pitch: 0 }, CMD_DT);
    for (const end = i + 1.5 / CMD_DT; i < end; i++) applyCmd(street, p, { seq: i, buttons: Btn.Forward, yaw: Math.PI / 2, pitch: 0 }, CMD_DT);
    expect(p.x).toBeLessThan(street.buildings[1].maxX - 2);
    expect(p.y).toBeCloseTo(street.buildings[1].roof + 0.2, 2);
  });
});
