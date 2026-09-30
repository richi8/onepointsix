import { describe, expect, it } from 'vitest';
import { NavGrid, type Waypoint } from '../src/server/nav.ts';
import { World } from '../src/shared/world.ts';
import { DEFAULT_WORLD } from '../src/shared/worldconfig.ts';

const world = new World(1);
const nav = new NavGrid(world);

/** Every leg of a route from `from` is a straight walkable line. */
function walkableRoute(from: Waypoint, path: Waypoint[]): boolean {
  let prev = from;
  for (const p of path) {
    if (!nav.walkable(p.x, p.z)) return false;
    if (prev !== from && !nav.lineWalkable(prev.x, prev.z, p.x, p.z)) return false;
    prev = p;
  }
  return true;
}

const length = (from: Waypoint, path: Waypoint[]) =>
  path.reduce((sum, p, i) => sum + Math.hypot(p.x - (i ? path[i - 1] : from).x, p.z - (i ? path[i - 1] : from).z), 0);

describe('NavGrid', () => {
  it('blocks obstacles and leaves open ground walkable', () => {
    const container = world.props.find((p) => p.style === 'metal')!.box;
    expect(nav.walkable((container.minX + container.maxX) / 2, (container.minZ + container.maxZ) / 2)).toBe(false);
    const open = world.randomLandPoint(() => 0.37);
    expect(nav.nearestWalkable(open.x, open.z)).not.toBeNull();
  });

  it('routes into every outpost from outside its walls', () => {
    for (const o of world.outposts) {
      const from = nav.nearestWalkable(o.x + 40, o.z + 40, 10)!;
      const to = nav.nearestWalkable(o.x + 3, o.z + 3)!;
      const path = nav.findPath(from.x, from.z, to.x, to.z)!;
      expect(path.at(-1)).toEqual(to);
      expect(walkableRoute(from, path)).toBe(true);
    }
  });

  it('goes around a wall rather than through it', () => {
    const wall = world.walls.find((b) => b.maxX - b.minX > 6 && b.maxZ - b.minZ < 1)!;
    const x = (wall.minX + wall.maxX) / 2;
    const a = nav.nearestWalkable(x, wall.minZ - 2, 2)!;
    const b = nav.nearestWalkable(x, wall.maxZ + 2, 2)!;
    expect(nav.lineWalkable(a.x, a.z, b.x, b.z)).toBe(false);
    const path = nav.findPath(a.x, a.z, b.x, b.z)!;
    expect(path.length).toBeGreaterThan(1);
    expect(walkableRoute(a, path)).toBe(true);
    expect(length(a, path)).toBeGreaterThan(Math.hypot(b.x - a.x, b.z - a.z));
  });

  it('crosses the island between outposts', () => {
    const [a, b] = [world.outposts[0], world.outposts[3]];
    const from = nav.nearestWalkable(a.x + 30, a.z)!;
    const path = nav.findPath(from.x, from.z, b.x + 30, b.z)!;
    const end = path.at(-1)!;
    expect(Math.hypot(end.x - b.x - 30, end.z - b.z)).toBeLessThan(2);
    expect(walkableRoute(from, path)).toBe(true);
  });

  it('moves a goal inside an obstacle to the nearest walkable spot', () => {
    const crate = world.props.find((p) => p.style === 'crate')!.box;
    const cx = (crate.minX + crate.maxX) / 2;
    const cz = (crate.minZ + crate.maxZ) / 2;
    const from = nav.nearestWalkable(cx + 15, cz, 10)!;
    const end = nav.findPath(from.x, from.z, cx, cz)!.at(-1)!;
    expect(nav.walkable(end.x, end.z)).toBe(true);
    expect(Math.hypot(end.x - cx, end.z - cz)).toBeLessThan(3);
  });
});

describe('NavGrid after dark', () => {
  const lit = new World(DEFAULT_WORLD.seed);
  const litNav = new NavGrid(lit);
  /** Half-metre steps along a route that are lamplit. */
  const inLight = (from: Waypoint, path: Waypoint[]) => {
    let n = 0;
    let prev = from;
    for (const p of path) {
      const steps = Math.ceil(Math.hypot(p.x - prev.x, p.z - prev.z) / 0.5);
      for (let i = 1; i <= steps; i++) {
        const x = prev.x + ((p.x - prev.x) * i) / steps;
        const z = prev.z + ((p.z - prev.z) * i) / steps;
        if (lit.inLamplight(x, lit.floorHeight(x, z) + 1.2, z)) n++;
      }
      prev = p;
    }
    return n;
  };

  it('keeps a shy route out of the lamps\' light, where a plain one crosses it', () => {
    let tried = 0;
    let plainLit = 0;
    let shyLit = 0;
    for (const l of lit.lamps) {
      // Across the patch the lamp lights, from one dark side to the other.
      const cx = l.hx + l.dx * 4;
      const cz = l.hz + l.dz * 4;
      const from = { x: cx - l.dz * 9, z: cz + l.dx * 9 };
      const to = { x: cx + l.dz * 9, z: cz - l.dx * 9 };
      if (!litNav.dry(from.x, from.z) || !litNav.dry(to.x, to.z)) continue;
      if (lit.inLamplight(from.x, lit.floorHeight(from.x, from.z) + 1.2, from.z)) continue;
      if (lit.inLamplight(to.x, lit.floorHeight(to.x, to.z) + 1.2, to.z)) continue;
      const plain = litNav.findPath(from.x, from.z, to.x, to.z)!;
      if (!plain || inLight(from, plain) === 0) continue;
      tried++;
      const shy = litNav.findPath(from.x, from.z, to.x, to.z, undefined, undefined, true)!;
      expect(shy.at(-1)!.x).toBeCloseTo(to.x, 0);
      // Never more light, and much less over all: some patches have no way round.
      expect(inLight(from, shy)).toBeLessThanOrEqual(inLight(from, plain));
      plainLit += inLight(from, plain);
      shyLit += inLight(from, shy);
    }
    expect(tried).toBeGreaterThan(4);
    expect(shyLit).toBeLessThan(plainLit / 5);
  });

  it('walks through lamplight again once the lamp is shot out', () => {
    const l = lit.lamps[0];
    const cx = l.hx + l.dx * 4;
    const cz = l.hz + l.dz * 4;
    const others = lit.lamps.filter((o) => o.outpost === l.outpost);
    for (const o of others) lit.breakPanel(o.panel);
    expect(lit.inLamplight(cx, lit.floorHeight(cx, cz) + 1.2, cz)).toBe(false);
    const from = { x: cx - l.dz * 9, z: cz + l.dx * 9 };
    const shy = litNav.findPath(from.x, from.z, cx + l.dz * 9, cz - l.dx * 9, undefined, undefined, true);
    const plain = litNav.findPath(from.x, from.z, cx + l.dz * 9, cz - l.dx * 9);
    expect(shy && plain && Math.abs(length(from, shy) - length(from, plain))).toBeLessThan(0.5);
  });
});
