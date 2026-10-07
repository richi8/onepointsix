import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { MODES } from '../src/server/directory.ts';
import { NavGrid } from '../src/server/nav.ts';
import { GameServer } from '../src/server/server.ts';
import { Btn, CMD_DT, DEATHMATCH_CAPACITY, MANTLE_MAX_HEIGHT, SERVER_DT, SERVER_TICK_RATE } from '../src/shared/constants.ts';
import { yawToward } from '../src/shared/geom.ts';
import { launchGrenade, stepGrenade } from '../src/shared/grenade.ts';
import { flightSteps, KIT_WALL, placeBlocks, rampSteps, SLAB, STOREY } from '../src/shared/kit.ts';
import { groundWeights } from '../src/shared/ground.ts';
import { Layer } from '../src/shared/layers.ts';
import { lootCrates } from '../src/shared/loot.ts';
import { CALABIANCA } from '../src/shared/maps/calabianca.ts';
import { CALABIANCA_2 } from '../src/shared/maps/calabianca2.ts';
import { area, standIn } from './calabianca.ts';
import { mapFor, type GameMap, type MapBlock } from '../src/shared/maps/index.ts';
import { KIT_YARD } from '../src/shared/maps/kityard.ts';
import { TEST_STREET } from '../src/shared/maps/teststreet.ts';
import { reached } from '../src/server/nav.ts';
import { applyCmd, spawnState } from '../src/shared/sim.ts';
import { inBuilding, type Rect, World } from '../src/shared/world.ts';
import { roofHeights, ROOF_CELL, ROOF_CELLS } from '../src/client/rain.ts';
import { SKETCH } from '../dev/townsketch.ts';

/** Everything a world is built from, hashed. */
function fingerprint(w: World): string {
  const h = createHash('sha256');
  h.update(Buffer.from(w.heights.buffer));
  h.update(Buffer.from(groundWeights(w).buffer));
  // Rounded to a micrometre: the last bit of a float can differ between machines (a rock's x on Mac arm64 and Linux x64).
  const strip = (o: unknown): string => JSON.stringify(o, (k, v: unknown) => (k === 'stamp' ? undefined : typeof v === 'number' ? Math.round(v * 1e6) / 1e6 : v));
  for (const part of [w.trees, w.rocks, w.props, w.panels, w.outposts, w.extracts, w.walls, w.buildings, w.towers, w.colliders]) h.update(strip(part));
  return h.digest('hex').slice(0, 16);
}

const street = new World(1, TEST_STREET);
const town = new World(1, CALABIANCA);
const yard = new World(1, KIT_YARD);
/** The kit yard's ground. */
const GROUND_AT = KIT_YARD.ground.heights[0][0];
/** The test street's buildings' ground floors. */
const FLOOR_AT = TEST_STREET.buildings[0].floor;

/** Every room of a map's buildings, a storey of a block at a time, and every flat roof: where its floor is, its height, and the inside of its walls. */
interface Room {
  name: string;
  block: MapBlock;
  y: number;
  height: number;
  inner: Rect;
  roof: boolean;
}
function roomsOf(map: GameMap): Room[] {
  const placed = placeBlocks(map.buildings);
  return placed.flatMap((p) => {
    const { block } = p;
    const i = map.buildings.indexOf(p.building);
    const j = placed.filter((q) => q.building === p.building).indexOf(p);
    const inner = { minX: block.minX + KIT_WALL / 2, minZ: block.minZ + KIT_WALL / 2, maxX: block.maxX - KIT_WALL / 2, maxZ: block.maxZ - KIT_WALL / 2 };
    const rooms = Array.from({ length: block.storeys - (block.from ?? 0) }, (_, k): Room => {
      const s = k + (block.from ?? 0);
      return { name: `building ${i} block ${j} storey ${s}`, block, y: p.floor + p.height * s, height: p.height, inner, roof: false };
    });
    if (!p.pitched) rooms.push({ name: `building ${i} block ${j} roof`, block, y: p.top + SLAB, height: p.height, inner, roof: true });
    return rooms;
  });
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
    expect(mapFor('deathmatch')).toBe(CALABIANCA_2);
    expect(mapFor('extraction')).toBeNull();
    expect(mapFor('range')).toBeNull();
  });

  it('keeps an Extraction island exactly as it was before the maps', () => {
    // Taken from the islands as chunk 49 left them, on Mac arm64 and Linux x64 alike, less their door leaves (chunk 65).
    const before: Record<number, string> = { 1: 'bd3e513dad3f02e9', 2: '5f747692e565274a', 3: '55514464fdffb23a', 4242: '0c3b4f1f998e9769' };
    for (const [seed, hash] of Object.entries(before)) {
      const w = new World(Number(seed));
      expect(w.map).toBeNull();
      expect(w.spawns).toEqual([]);
      expect(fingerprint(w)).toBe(hash);
    }
  });

  it('builds the same map on the server as on the client, whatever the game\'s seed', () => {
    const server = new GameServer(7, MODES.deathmatch.options);
    expect(server.world.map).toBe(CALABIANCA_2);
    expect(fingerprint(server.world)).toBe(fingerprint(new World(1, CALABIANCA_2)));
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

describe('The building kit\'s later pieces, in the kit yard', () => {
  const [house, cottage, court, arcade, hall, lane, terrace] = KIT_YARD.buildings;
  const middle = (r: Rect) => ({ x: (r.minX + r.maxX) / 2, z: (r.minZ + r.maxZ) / 2 });

  it('pitches roofs over the walls, out of reach and shedding the rain, the shots stopping at the slopes', () => {
    expect(yard.gables.length).toBe(3);
    for (const b of [house, cottage, hall]) {
      const k = b.blocks[0];
      const { x, z } = middle(k);
      const g = yard.gables.find((q) => x > q.rect.minX && x < q.rect.maxX && z > q.rect.minZ && z < q.rect.maxZ)!;
      expect(g.colour).toBe(b.colour);
      const eaves = b.floor + (b.storey ?? STOREY) * k.storeys + SLAB;
      expect(g.y).toBeCloseTo(eaves, 6);
      expect(g.ridge).toBe(k.ridge ?? (k.maxX - k.minX >= k.maxZ - k.minZ ? 'x' : 'z'));
      // Its layers aren't walked, and none is a ledge to climb onto.
      for (const i of g.props) {
        expect(yard.props[i].box.part).toBe('tiles');
        expect(yard.props[i].box.walk).toBe(false);
      }
      expect(yard.ledgeHeight(x, z, eaves, eaves + g.rise + 1)).toBe(-Infinity);
      expect(yard.floorTops(x, z, 0.5).some((y) => y > eaves - 0.5)).toBe(false);
      // A round from above stops at the ridge's layers, not the slab under them; a round along the slope from beside the eaves too.
      expect(yard.raycast(x, eaves + 10, z, 0, -1, 0, 20)).toBeLessThan(10 - g.rise + 0.7);
      const across = g.ridge === 'x' ? [0, 1] : [1, 0];
      const half = g.ridge === 'x' ? (g.rect.maxZ - g.rect.minZ) / 2 : (g.rect.maxX - g.rect.minX) / 2;
      expect(yard.raycast(x - across[0] * (half + 3), eaves + g.rise / 4, z - across[1] * (half + 3), across[0], 0, across[1], 10)).toBeLessThan(3 + half / 2 + 0.7);
      // The rain stays off the floor under it.
      const x0 = x - (ROOF_CELLS * ROOF_CELL) / 2;
      const z0 = z - (ROOF_CELLS * ROOF_CELL) / 2;
      const cover = roofHeights(yard, x0, z0);
      expect(cover[Math.floor((z - z0) / ROOF_CELL) * ROOF_CELLS + Math.floor((x - x0) / ROOF_CELL)]).toBeGreaterThan(eaves);
    }
  });

  it('builds a block round a courtyard open to the sky, its rooms going round it on every storey', () => {
    const c = court.blocks[0].court!;
    const { x, z } = middle(c);
    expect(yard.buildings.some((b) => inBuilding(b, x, z))).toBe(false);
    const x0 = x - (ROOF_CELLS * ROOF_CELL) / 2;
    const z0 = z - (ROOF_CELLS * ROOF_CELL) / 2;
    expect(roofHeights(yard, x0, z0)[Math.floor((z - z0) / ROOF_CELL) * ROOF_CELLS + Math.floor((x - x0) / ROOF_CELL)]).toBeLessThan(court.floor);
    // From the street through the south range's arches into the courtyard, at a walk.
    const nav = new NavGrid(yard);
    const from = { x: -8, z: 0 };
    const path = nav.findPath(from.x, from.z, x, z);
    expect(path).not.toBeNull();
    expect(path!.length).toBeLessThan(25);
    // Upstairs, from the north range's room to the south range's, the way round.
    const up = court.floor + STOREY;
    const north = nav.findPath(-8, -24, -8, -6, up, up);
    expect(north?.at(-1)?.y).toBeCloseTo(up, 1);
    expect(north!.every((p) => p.y === undefined || p.y > up - 0.5)).toBe(true);
  });

  it('opens an arcade between pillars along the ground storey, with the floor over it', () => {
    const k = arcade.blocks[1];
    const y = arcade.floor + 1.5;
    const arches = yard.props.filter((p) => p.box.part === 'wall' && Math.abs((p.box.minZ + p.box.maxZ) / 2 - k.maxZ) < 1e-6 && p.box.minY < y && p.box.maxY > y && p.box.maxX - p.box.minX < 1);
    // Six pillars, the corners' standing out as far as the walls either side.
    expect(arches.length).toBe(6);
    const bay = (k.maxX - k.minX - KIT_WALL - 6 * 0.6) / 5;
    for (let i = 0; i < 5; i++) {
      const ax = k.minX + KIT_WALL / 2 + 0.6 + bay / 2 + i * (bay + 0.6);
      // Through a bay to the rooms' wall behind; at the pillar beside it, stopped at the front.
      expect(yard.raycast(ax, y, k.maxZ + 3, 0, 0, -1, 20)).toBeGreaterThan(3 + (k.maxZ - k.minZ) - 0.5);
      expect(yard.raycast(ax + bay / 2 + 0.3, y, k.maxZ + 3, 0, 0, -1, 20)).toBeLessThan(3);
    }
    expect(yard.raycast(22, y, -13.5, 0, 1, 0, 10)).toBeLessThan(STOREY);
  });

  it('builds a hall a storey 6 m tall', () => {
    const { x, z } = middle(hall.blocks[0]);
    expect(yard.raycast(x, hall.floor + 1, z, 0, 1, 0, 10)).toBeCloseTo(5, 1);
    const walls = yard.props.filter((p) => p.box.part === 'wall' && inBuilding(yard.buildings[4], (p.box.minX + p.box.maxX) / 2, (p.box.minZ + p.box.maxZ) / 2, 0.01));
    expect(Math.max(...walls.map((p) => p.box.maxY))).toBeCloseTo(hall.floor + 6, 3);
  });

  it('bridges a lane with a room at the terrace\'s level, the lane walked under it', () => {
    const k = terrace.blocks[1];
    const y = terrace.floor;
    // The room over the lane is on the terrace's floor, a storey over the lane house's ground floor.
    expect(k.floor! + STOREY * k.from!).toBeCloseTo(lane.floor + STOREY, 6);
    expect(y).toBeCloseTo(lane.floor + STOREY, 6);
    const { z } = middle(k);
    expect(yard.groundHeight(34, z, y + 0.3)).toBeCloseTo(y, 2);
    // Along the lane under it, nothing in the way, and room to stand.
    expect(yard.raycast(27, GROUND_AT + 1.5, z, 1, 0, 0, 12)).toBe(Infinity);
    expect(yard.ceilingHeight(34, z, GROUND_AT + 1.8)).toBeGreaterThan(GROUND_AT + 2.5);
  });

  it('takes a player up the ramp onto the terrace', () => {
    const [r] = KIT_YARD.ramps!;
    expect(rampSteps(r).every((s, i, all) => i === 0 || s.top - all[i - 1].top < 0.3)).toBe(true);
    const zm = (r.minZ + r.maxZ) / 2;
    const p = spawnState(r.minX - 2, GROUND_AT, zm);
    for (let i = 0; i < 6 / CMD_DT && p.x < r.maxX + 4; i++) applyCmd(yard, p, { seq: i, buttons: Btn.Forward, yaw: -Math.PI / 2, pitch: 0 }, CMD_DT);
    expect(p.x).toBeGreaterThan(r.maxX + 3);
    expect(p.y).toBeCloseTo(r.y1, 2);
  });

  it('plasters each building its own colour, and only a map\'s', () => {
    const colours = new Set(yard.props.filter((p) => p.box.part === 'wall' && p.box.maxY - p.box.minY > 2.5).map((p) => p.colour));
    for (const b of KIT_YARD.buildings) expect(colours.has(b.colour)).toBe(true);
    // The yard's own walls round it are left as they were.
    expect(colours.has(undefined)).toBe(true);
    expect(new World(1).props.some((p) => p.colour !== undefined)).toBe(false);
  });
});

describe('Calabianca', () => {
  const at = SKETCH.at;
  const near = (a: number, b: number) => Math.abs(a - b) <= 2.1;

  it('follows its sketch: every building where it\'s drawn, as tall and roofed as drawn, the rooms over the lanes and the spawn zones', () => {
    // The bell tower is drawn as a building but built solid: nobody climbs it.
    const drawn = SKETCH.buildings.filter((b) => b.name !== 'bell tower');
    expect(CALABIANCA.buildings.length).toBe(drawn.length);
    for (const d of drawn) {
      const name = d.name ?? `building at ${d.x0}, ${d.z0}`;
      const built = CALABIANCA.buildings.find((b) => {
        const ground = b.blocks.filter((k) => !k.from);
        const x0 = Math.min(...ground.map((k) => k.minX)) - at.x;
        const x1 = Math.max(...ground.map((k) => k.maxX)) - at.x;
        const z0 = Math.min(...ground.map((k) => k.minZ)) - at.z;
        const z1 = Math.max(...ground.map((k) => k.maxZ)) - at.z;
        return near(x0, d.x0) && near(x1, d.x1) && near(z0, d.z0) && near(z1, d.z1);
      });
      expect(built, name).toBeDefined();
      const k = built!.blocks.find((q) => !q.from)!;
      expect(k.storeys, name).toBe(d.storeys);
      expect(k.roof ?? 'flat', name).toBe(d.roof);
      expect(built!.floor, name).toBeCloseTo(d.floor, 1);
      expect(!!k.court, name).toBe(!!d.court);
      expect(!!k.arcade, name).toBe(!!d.arcade);
      expect(built!.storey ?? STOREY, name).toBe(d.tall ? 6 : STOREY);
    }
    const bridges = CALABIANCA.buildings.flatMap((b) => b.blocks.filter((k) => k.from));
    expect(bridges.length).toBe(SKETCH.bridges.length);
    for (const d of SKETCH.bridges) {
      expect(bridges.some((k) => near(k.minX - at.x, d.x0) && near(k.maxX - at.x, d.x1) && near(k.minZ - at.z, d.z0) && near(k.maxZ - at.z, d.z1)), `bridge at ${d.x0}, ${d.z0}`).toBe(true);
    }
    // Four spawn points in each zone, each within a street or two of the zone drawn.
    const zoneOf = (s: { x: number; z: number }) => SKETCH.spawns.reduce((a, q) => (Math.hypot(q.x - s.x + at.x, q.z - s.z + at.z) < Math.hypot(a.x - s.x + at.x, a.z - s.z + at.z) ? q : a));
    for (const zone of SKETCH.spawns) {
      const mine = CALABIANCA.spawns.filter((s) => zoneOf(s) === zone);
      expect(mine.length, zone.name).toBe(4);
      for (const s of mine) expect(Math.hypot(s.x - at.x - zone.x, s.z - at.z - zone.z), zone.name).toBeLessThan(12);
    }
  });

  it('leaves nowhere to stand that bots can\'t walk to, which a search would look through the whole town for', { timeout: 60_000 }, () => {
    const nav = new NavGrid(town);
    const from = town.spawns[0];
    expect(nav.unreached(from.x, from.z, from.y, town.bounds).map((p) => `${p.x.toFixed(1)}, ${p.y?.toFixed(1)}, ${p.z.toFixed(1)}`)).toEqual([]);
  });

});

describe.each([
  ['the test street', TEST_STREET, street],
  ['Calabianca', CALABIANCA, town],
  ['the kit yard', KIT_YARD, yard],
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
          expect(world.raycast(x, room.y + 1, z, 0, 1, 0, 10), `${room.name} at ${x}, ${z}`).toBeLessThan(room.height);
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

describe('Calabianca, after the three-lane map (Phase 10)', () => {
  const world = new World(1, CALABIANCA_2);
  const areas = CALABIANCA_2.areas!;
  /** A clear spot in each place, as near its middle as there is one. */
  const spots = areas.map((a) => standIn(world, a));
  const spot = (name: string) => spots[areas.lastIndexOf(area(name))]!;

  it('is Deathmatch\'s, for 12 operators, with its own board', () => {
    expect(mapFor('deathmatch')).toBe(CALABIANCA_2);
    expect(CALABIANCA_2.id).toBe('calabianca-2');
    expect(CALABIANCA_2.name).toBe('Calabianca');
    expect(DEATHMATCH_CAPACITY).toBe(12);
    const b = CALABIANCA_2.bounds;
    // At 1:1 with the original's units at 2.54 cm, its players' height.
    expect(b.maxX - b.minX).toBeGreaterThan(100);
    expect(b.maxZ - b.minZ).toBeGreaterThan(100);
  });

  it('has room to stand in every place', () => {
    expect(areas.filter((_, i) => !spots[i]).map((a) => a.name)).toEqual([]);
  });

  it('keeps the original\'s heights: the pit lowest, A over long, the attackers\' end over the defenders\'', () => {
    const y = (name: string) => spot(name).y;
    for (const name of ['long A', 'mid', 'A site', 'B site', 'T spawn', 'CT spawn', 'upper tunnels']) expect(y('pit'), name).toBeLessThan(y(name));
    expect(y('A site')).toBeGreaterThan(y('long A'));
    expect(y('T spawn')).toBeGreaterThan(y('CT spawn') + 4);
    expect(y('upper tunnels')).toBeGreaterThan(y('lower tunnels') + 2);
  });

  it('runs the walk from short to A over the way out of the defenders\' end, with room under it', () => {
    const under = standIn(world, area('CT spawn'), true)!;
    const over = standIn(world, area('CT spawn'), false)!;
    expect(over.y - under.y).toBeGreaterThan(4);
    // Somewhere both floors have room, one over the other.
    let found = 0;
    const a = area('CT spawn');
    for (let x = a.minX; x < a.maxX; x += 0.5) {
      for (let z = a.minZ; z < a.maxZ; z += 0.5) {
        const tops = world.floorTops(x, z, 0.01);
        if (tops.length === 2 && tops.every((y) => world.fits(x, y, z, 1.8)) && world.ceilingHeight(x, z, tops[0] + 0.1) - tops[0] > 2.5) found++;
      }
    }
    expect(found).toBeGreaterThan(20);
  });

  it('roofs its tunnels', () => {
    for (const name of ['upper tunnels', 'lower tunnels', 'B tunnels']) {
      const s = spot(name);
      expect(world.ceilingHeight(s.x, s.z, s.y + 0.1) - s.y, name).toBeLessThan(4);
    }
  });

  it('stands its houses too high to climb from the floor beside them', () => {
    const houses = CALABIANCA_2.walls.filter((w) => w.colour !== undefined && w.y0 < 4);
    expect(houses.length).toBeGreaterThan(300);
    let checked = 0;
    for (const h of houses) {
      for (const [x, z] of [[(h.minX + h.maxX) / 2, h.minZ - 0.5], [(h.minX + h.maxX) / 2, h.maxZ + 0.5], [h.minX - 0.5, (h.minZ + h.maxZ) / 2], [h.maxX + 0.5, (h.minZ + h.maxZ) / 2]]) {
        const tops = world.floorTops(x, z, 0.01).filter((y) => y < h.y1 && world.fits(x, y, z, 1.8));
        if (!tops.length) continue;
        expect(h.y1, `${h.minX}, ${h.minZ} beside ${x}, ${z}`).toBeGreaterThan(Math.max(...tops) + MANTLE_MAX_HEIGHT + 0.3);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(300);
  });

  it('lets bots reach every place, and a player walk there by the same way', { timeout: 600_000 }, () => {
    const nav = new NavGrid(world);
    const from = world.spawns[0];
    for (const to of spots) {
      if (!to) continue;
      const path = nav.findPath(from.x, from.z, to.x, to.z, from.y, to.y);
      expect(path, to.name).not.toBeNull();
      expect(Math.hypot(path!.at(-1)!.x - to.x, path!.at(-1)!.z - to.z), to.name).toBeLessThan(1.5);
      const p = spawnState(from.x, from.y, from.z);
      let k = 0;
      for (let i = 0; k < path!.length && i < 240 / CMD_DT; i++) {
        const wp = path![k];
        if (reached(wp, p.x, p.y, p.z)) {
          k++;
          continue;
        }
        applyCmd(world, p, { seq: i, buttons: Btn.Forward, yaw: yawToward(p.x, p.z, wp.x, wp.z), pitch: 0 }, CMD_DT);
      }
      expect(k, `${to.name}: walked to waypoint ${k} of ${path!.length}, stuck at ${p.x.toFixed(1)}, ${p.y.toFixed(1)}, ${p.z.toFixed(1)}`).toBe(path!.length);
      // On its floor, or a step off it.
      expect(Math.abs(p.y - to.y), to.name).toBeLessThan(0.3);
    }
  });

  it('spreads 24 spawn points round the whole map, each on a floor and reached from the first', () => {
    expect(world.spawns.length).toBe(24);
    const nav = new NavGrid(world);
    const from = world.spawns[0];
    for (const s of world.spawns) {
      const at = `spawn at ${s.x}, ${s.z}`;
      expect(world.floorTops(s.x, s.z, 0.01), at).toContain(s.y);
      expect(world.inBounds(s.x, s.z, 1), at).toBe(true);
      expect(world.fits(s.x, s.y, s.z, 1.8), at).toBe(true);
      expect(Math.min(...world.spawns.filter((t) => t !== s).map((t) => Math.hypot(t.x - s.x, t.z - s.z))), at).toBeGreaterThan(8);
      const path = nav.findPath(from.x, from.z, s.x, s.z, from.y, s.y);
      expect(path, at).not.toBeNull();
    }
    // In every quarter of the map.
    const b = world.bounds;
    const [mx, mz] = [(b.minX + b.maxX) / 2, (b.minZ + b.maxZ) / 2];
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      expect(world.spawns.filter((s) => Math.sign(s.x - mx) === sx && Math.sign(s.z - mz) === sz).length).toBeGreaterThanOrEqual(4);
    }
  });

  it('sees and shoots through the gap between each pair of double doors, but not through their leaves', () => {
    const doors = CALABIANCA_2.walls.filter((w) => w.look === 'doors');
    expect(doors.length).toBe(8);
    for (let i = 0; i < doors.length; i += 2) {
      const [a, c] = [doors[i], doors[i + 1]];
      const alongX = a.maxX - a.minX > a.maxZ - a.minZ;
      const y = a.y0 + 1.6;
      // Straight across the doorway: through the gap, and into a leaf.
      const [gx, gz] = alongX ? [(a.maxX + c.minX) / 2, (a.minZ + a.maxZ) / 2] : [(a.minX + a.maxX) / 2, (a.maxZ + c.minZ) / 2];
      const [lx, lz] = alongX ? [(a.minX + a.maxX) / 2, gz] : [gx, (a.minZ + a.maxZ) / 2];
      const [dx, dz] = alongX ? [0, 1] : [1, 0];
      expect(world.raycast(gx - dx * 3, y, gz - dz * 3, dx, 0, dz, 6), `gap at ${gx}, ${gz}`).toBeGreaterThan(6);
      expect(world.raycast(lx - dx * 3, y, lz - dz * 3, dx, 0, dz, 6), `leaf at ${lx}, ${lz}`).toBeLessThan(3.1);
    }
  });
});
