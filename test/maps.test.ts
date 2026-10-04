import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { MODES } from '../src/server/directory.ts';
import { NavGrid } from '../src/server/nav.ts';
import { GameServer } from '../src/server/server.ts';
import { Btn, CMD_DT, SERVER_DT, SERVER_TICK_RATE } from '../src/shared/constants.ts';
import { yawToward } from '../src/shared/geom.ts';
import { launchGrenade, stepGrenade } from '../src/shared/grenade.ts';
import { flightSteps, KIT_WALL, SLAB, STOREY } from '../src/shared/kit.ts';
import { groundWeights } from '../src/shared/ground.ts';
import { Layer } from '../src/shared/layers.ts';
import { lootCrates } from '../src/shared/loot.ts';
import { CALABIANCA } from '../src/shared/maps/calabianca.ts';
import { mapFor, type GameMap, type MapBlock } from '../src/shared/maps/index.ts';
import { TEST_STREET } from '../src/shared/maps/teststreet.ts';
import { reached } from '../src/server/nav.ts';
import { applyCmd, spawnState } from '../src/shared/sim.ts';
import { inBuilding, type Rect, World } from '../src/shared/world.ts';
import { roofHeights, ROOF_CELL, ROOF_CELLS } from '../src/client/rain.ts';

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
const town = new World(1, CALABIANCA);
/** The test street's buildings' ground floors. */
const FLOOR_AT = TEST_STREET.buildings[0].floor;

/** Every room of a map's buildings, a storey of a block at a time, and every roof: where its floor is, and the inside of its walls. */
interface Room {
  name: string;
  block: MapBlock;
  y: number;
  inner: Rect;
  roof: boolean;
}
function roomsOf(map: GameMap): Room[] {
  return map.buildings.flatMap((b, i) => b.blocks.flatMap((block, j) => {
    const inner = { minX: block.minX + KIT_WALL / 2, minZ: block.minZ + KIT_WALL / 2, maxX: block.maxX - KIT_WALL / 2, maxZ: block.maxZ - KIT_WALL / 2 };
    const rooms = Array.from({ length: block.storeys - (block.from ?? 0) }, (_, k): Room => {
      const s = k + (block.from ?? 0);
      return { name: `building ${i} block ${j} storey ${s}`, block, y: b.floor + STOREY * s, inner, roof: false };
    });
    rooms.push({ name: `building ${i} block ${j} roof`, block, y: b.floor + STOREY * block.storeys + SLAB, inner, roof: true });
    return rooms;
  }));
}

/** The footprints of a map's flights of stairs, inside and out. */
function flightsOf(map: GameMap): Rect[] {
  return [
    ...map.buildings.flatMap((b) => (b.flights ?? []).flatMap((f) => flightSteps(f.x, f.z, f.width ?? 1.5, f.climbs, 0, 3.2).map((s) => s.r))),
    ...map.stairs.flatMap((s) => flightSteps(s.x, s.z, s.width, s.climbs, s.y0, s.y1).map((st) => st.r)),
  ];
}
const onFlight = (flights: Rect[], x: number, z: number) => flights.some((r) => x > r.minX - 0.2 && x < r.maxX + 0.2 && z > r.minZ - 0.2 && z < r.maxZ + 0.2);

/** A clear spot in a room, as near its middle as there is one: off its stairs, crates and railings, and its bell tower. */
function spotIn(w: World, flights: Rect[], room: Room): { x: number; z: number } {
  const cx = (room.inner.minX + room.inner.maxX) / 2;
  const cz = (room.inner.minZ + room.inner.maxZ) / 2;
  let best: { x: number; z: number } | null = null;
  for (let x = room.inner.minX + 0.6; x < room.inner.maxX - 0.6; x += 0.25) {
    for (let z = room.inner.minZ + 0.6; z < room.inner.maxZ - 0.6; z += 0.25) {
      if (onFlight(flights, x, z) || !w.clear(x, room.y, z, 1.8, 0.6) || Math.abs(w.groundHeight(x, z, room.y + 0.3) - room.y) > 0.01) continue;
      if (!best || Math.hypot(x - cx, z - cz) < Math.hypot(best.x - cx, best.z - cz)) best = { x, z };
    }
  }
  if (!best) throw new Error(`Nowhere to stand in ${room.name}`);
  return best;
}

describe('Worlds by mode', () => {
  it('plays Deathmatch on its map and every other mode on the island from the seed', () => {
    expect(mapFor('deathmatch')).toBe(CALABIANCA);
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
    expect(server.world.map).toBe(CALABIANCA);
    expect(fingerprint(server.world)).toBe(fingerprint(town));
    expect(fingerprint(new World(99, CALABIANCA))).toBe(fingerprint(town));
    expect(new GameServer(7, MODES.extraction.options).world.map).toBeNull();
  });
});

describe('The test street', () => {
  it('has its buildings, all from the kit, and nothing of the island\'s: no outposts, extraction points, huts or fences', () => {
    expect(street.buildings.map((b) => b.plan)).toEqual(TEST_STREET.buildings.map(() => 'kit'));
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
    const house = street.buildings.find((b) => inBuilding(b, s.x - 2, s.z - 1))!;
    expect(p.x).toBeLessThan(house.maxX - 2);
    expect(p.y).toBeCloseTo(house.roof + SLAB, 2);
  });
});

describe('The building kit, on the test street', () => {
  it('shares a wall between blocks side by side, built once', () => {
    // The north row's fronts, on z = -4: one line of wall stretches, never two boxes over the same stretch.
    const front = street.props.filter((p) => p.box.part === 'wall' && Math.abs((p.box.minZ + p.box.maxZ) / 2 + 4) < 1e-6 && p.box.maxY - p.box.minY > 2.5);
    for (const a of front) {
      for (const b of front) {
        if (a === b || a.box.minY >= b.box.maxY || b.box.minY >= a.box.maxY) continue;
        expect(Math.min(a.box.maxX, b.box.maxX) - Math.max(a.box.minX, b.box.minX)).toBeLessThan(1e-6);
      }
    }
    // The shared wall between the two- and three-storey houses: two storeys of it, not four.
    const shared = street.props.filter((p) => p.box.part === 'wall' && Math.abs((p.box.minX + p.box.maxX) / 2 + 14) < 1e-6 && p.box.minZ > -11 && p.box.maxZ < -4);
    const at = (y: number) => shared.filter((p) => p.box.minY < y && p.box.maxY > y && p.box.minZ < -10 && p.box.maxZ > -10).length;
    expect([at(FLOOR_AT + 1), at(FLOOR_AT + 4), at(FLOOR_AT + 7)]).toEqual([1, 1, 1]);
  });

  it('stops grenades at its walls', () => {
    const walls = street.props.filter((p) => p.box.part === 'wall' && p.box.maxY - p.box.minY > 2.5 && street.buildings.some((b) => inBuilding(b, (p.box.minX + p.box.maxX) / 2, (p.box.minZ + p.box.maxZ) / 2, 0.01)));
    // A grenade thrown hard at each house's front wall from the street stays in the street.
    for (const b of street.buildings) {
      const north = b.maxZ < 0;
      const face = north ? b.maxZ : b.minZ;
      const stretch = walls.find(({ box }) => Math.abs((north ? box.maxZ : box.minZ) - face) < 1e-4 && box.minY < b.floor && box.maxX - box.minX > 0.7 && box.minX >= b.minX)!.box;
      const x = (stretch.minX + stretch.maxX) / 2;
      const z = north ? b.maxZ + 3 : b.minZ - 3;
      const g = launchGrenade(1, 1, { seq: 0, x, y: b.floor + 1.5, z, vx: 0, vy: 2, vz: north ? -18 : 18 }, 10);
      for (let i = 0; i < 3 * SERVER_TICK_RATE; i++) stepGrenade(street, g, SERVER_DT);
      expect(north ? g.z > b.maxZ : g.z < b.minZ, `grenade at building over ${b.minX}..${b.maxX}`).toBe(true);
    }
  });

  it('rails its roofs where they look out over a drop, and opens them onto a roof as high and the outside stair', () => {
    // The three-storey house's roof: railed all round.
    const top = FLOOR_AT + 3 * STOREY + SLAB;
    const tall = street.buildings.find((b) => b.roof === FLOOR_AT + 3 * STOREY)!;
    const p = spawnState(-10, top, -7.5);
    for (let i = 0; i < 3 / CMD_DT; i++) applyCmd(street, p, { seq: i, buttons: Btn.Forward, yaw: Math.PI, pitch: 0 }, CMD_DT);
    expect(p.y).toBeCloseTo(top, 2);
    expect(p.z).toBeLessThan(tall.maxZ);
    // The south side's two-storey house and its arched way: one roof, walked straight across.
    const q = spawnState(-11, FLOOR_AT + 2 * STOREY + SLAB, 4.6);
    for (let i = 0; i < 2.5 / CMD_DT; i++) applyCmd(street, q, { seq: i, buttons: Btn.Forward, yaw: -Math.PI / 2, pitch: 0 }, CMD_DT);
    expect(q.x).toBeGreaterThan(-3);
    expect(q.y).toBeCloseTo(FLOOR_AT + 2 * STOREY + SLAB, 2);
  });
});

describe.each([
  ['the test street', TEST_STREET, street],
  ['Calabianca', CALABIANCA, town],
] as const)('The building kit, on %s', (_, map, world) => {
  const rooms = roomsOf(map);
  const flights = flightsOf(map);

  it('stands every spawn point on clear ground within the bounds, outside the buildings', () => {
    expect(world.spawns.length).toBe(map.spawns.length);
    for (const s of world.spawns) {
      const at = `spawn at ${s.x}, ${s.z}`;
      expect(world.inBounds(s.x, s.z, 1), at).toBe(true);
      expect(world.fits(s.x, s.y, s.z, 1.8), at).toBe(true);
      expect(s.y, at).toBeCloseTo(world.terrainHeight(s.x, s.z), 3);
      expect(world.buildings.some((b) => inBuilding(b, s.x, s.z, 0.5)), at).toBe(false);
    }
  });

  it('lets bots reach every room, floor and roof, and a player walk there by the same way', { timeout: 300_000 }, () => {
    const w = new World(1, map);
    w.doors.forEach((_, i) => w.setDoor(i, true));
    const nav = new NavGrid(w);
    const from = w.spawns[0];
    for (const room of rooms) {
      const to = spotIn(w, flights, room);
      const path = nav.findPath(from.x, from.z, to.x, to.z, from.y, room.y);
      expect(path, room.name).not.toBeNull();
      const end = path!.at(-1)!;
      expect(Math.hypot(end.x - to.x, end.z - to.z), room.name).toBeLessThan(1);
      expect(end.y ?? w.groundHeight(end.x, end.z, room.y + 0.3), room.name).toBeCloseTo(room.y, 1);
      // A player walks it, turning toward each waypoint in turn.
      const p = spawnState(from.x, from.y, from.z);
      let k = 0;
      for (let i = 0; k < path!.length && i < 180 / CMD_DT; i++) {
        const wp = path![k];
        if (reached(wp, p.x, p.y, p.z)) {
          k++;
          continue;
        }
        applyCmd(w, p, { seq: i, buttons: Btn.Forward, yaw: yawToward(p.x, p.z, wp.x, wp.z), pitch: 0 }, CMD_DT);
      }
      expect(k, `${room.name}: walked to waypoint ${k} of ${path!.length}, stuck at ${p.x.toFixed(1)}, ${p.y.toFixed(1)}, ${p.z.toFixed(1)}`).toBe(path!.length);
      expect(p.y, room.name).toBeCloseTo(room.y, 1);
    }
  });

  it('joins its streets: bots reach every spawn point from the first', () => {
    const nav = new NavGrid(world);
    const from = world.spawns[0];
    for (const s of world.spawns.slice(1)) {
      const path = nav.findPath(from.x, from.z, s.x, s.z, from.y, s.y);
      expect(path, `to ${s.x}, ${s.z}`).not.toBeNull();
      expect(Math.hypot(path!.at(-1)!.x - s.x, path!.at(-1)!.z - s.z), `to ${s.x}, ${s.z}`).toBeLessThan(1);
    }
  });

  it('keeps the rain off every floor indoors, and something solid over it', () => {
    for (const room of rooms.filter((r) => !r.roof)) {
      const x0 = (room.inner.minX + room.inner.maxX) / 2 - (ROOF_CELLS * ROOF_CELL) / 2;
      const z0 = (room.inner.minZ + room.inner.maxZ) / 2 - (ROOF_CELLS * ROOF_CELL) / 2;
      const cover = roofHeights(world, x0, z0);
      for (let x = room.inner.minX + 0.3; x < room.inner.maxX - 0.2; x += 0.5) {
        for (let z = room.inner.minZ + 0.3; z < room.inner.maxZ - 0.2; z += 0.5) {
          if (onFlight(flights, x, z)) continue;
          expect(cover[Math.floor((z - z0) / ROOF_CELL) * ROOF_CELLS + Math.floor((x - x0) / ROOF_CELL)], `${room.name} at ${x}, ${z}`).toBeGreaterThan(room.y + 2);
          expect(world.raycast(x, room.y + 1, z, 0, 1, 0, 10), `${room.name} at ${x}, ${z}`).toBeLessThan(STOREY);
        }
      }
    }
  });

  it('stops rounds at its walls', () => {
    const walls = world.props.filter((p) => p.box.part === 'wall' && p.box.maxY - p.box.minY > 2.5 && world.buildings.some((b) => inBuilding(b, (p.box.minX + p.box.maxX) / 2, (p.box.minZ + p.box.maxZ) / 2, 0.01)));
    expect(walls.length).toBeGreaterThan(50);
    for (const { box } of walls) {
      const alongX = box.maxX - box.minX > box.maxZ - box.minZ;
      const [mx, my, mz] = [(box.minX + box.maxX) / 2, box.maxY - 1.4, (box.minZ + box.maxZ) / 2];
      // From 3 m off one face, straight across.
      const [ox, oz, dx, dz] = alongX ? [mx, box.minZ - 3, 0, 1] : [box.minX - 3, mz, 1, 0];
      expect(world.raycast(ox, my, oz, dx, 0, dz, 6)).toBeLessThan(3.01);
    }
  });
});
