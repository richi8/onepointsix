import { describe, expect, it } from 'vitest';
import { NavGrid, type Waypoint } from '../src/server/nav.ts';
import { mulberry32 } from '../src/shared/rng.ts';
import { vegetationOf } from '../src/shared/vegetation.ts';
import { World } from '../src/shared/world.ts';

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

describe('NavGrid sneaking', () => {
  it('takes a hidden route through bushes and tall grass where a plain one crosses the open', () => {
    const veg = vegetationOf(world);
    /** Metres of a route over ground without cover, sampled every half metre. */
    const bare = (from: Waypoint, path: Waypoint[]): number => {
      let m = 0;
      let prev = from;
      for (const p of path) {
        const steps = Math.ceil(Math.hypot(p.x - prev.x, p.z - prev.z) / 0.5);
        for (let i = 1; i <= steps; i++) if (!veg.cover(prev.x + ((p.x - prev.x) * i) / steps, prev.z + ((p.z - prev.z) * i) / steps)) m += 0.5;
        prev = p;
      }
      return m;
    };
    const rand = mulberry32(8);
    let tried = 0;
    let plainBare = 0;
    let hiddenBare = 0;
    let plainLength = 0;
    let hiddenLength = 0;
    while (tried < 12) {
      const from = world.randomLandPoint(rand);
      const a = rand() * Math.PI * 2;
      const to = { x: from.x + Math.sin(a) * 60, z: from.z + Math.cos(a) * 60 };
      if (!nav.dry(from.x, from.z) || !nav.dry(to.x, to.z)) continue;
      const plain = nav.findPath(from.x, from.z, to.x, to.z);
      const hidden = nav.findPath(from.x, from.z, to.x, to.z, undefined, undefined, true);
      if (!plain || !hidden || Math.hypot(plain.at(-1)!.x - to.x, plain.at(-1)!.z - to.z) > 1) continue;
      tried++;
      expect(walkableRoute(from, hidden)).toBe(true);
      expect(Math.hypot(hidden.at(-1)!.x - to.x, hidden.at(-1)!.z - to.z)).toBeLessThan(1);
      plainBare += bare(from, plain);
      hiddenBare += bare(from, hidden);
      plainLength += length(from, plain);
      hiddenLength += length(from, hidden);
    }
    // Less of it in the open, for a walk hardly longer: much of the island has no cover near,
    // and the cost of open ground is kept low so a sneaking bot doesn't wander.
    expect(hiddenBare).toBeLessThan(plainBare * 0.9);
    expect(hiddenLength).toBeLessThan(plainLength * 1.1);
  });
});

// Chunk 64: a map's paths worked out ahead in the server's spare time.
describe('NavGrid warming a map', () => {
  it('works out every link of the map in slices, and finds the same paths as a cold grid', async () => {
    const { KIT_YARD } = await import('../src/shared/maps/kityard.ts');
    const yard = new World(1, KIT_YARD);
    const cold = new NavGrid(yard);
    const warm = new NavGrid(yard);
    expect(new NavGrid(world).warm(1)).toBe(true);
    let slices = 0;
    while (!warm.warm(5)) slices++;
    expect(slices).toBeGreaterThan(0);
    expect(warm.warm(5)).toBe(true);
    const rand = mulberry32(64);
    const b = KIT_YARD.bounds;
    const spot = () => [b.minX + rand() * (b.maxX - b.minX), b.minZ + rand() * (b.maxZ - b.minZ)] as const;
    for (let i = 0; i < 12; i++) {
      const [sx, sz] = spot();
      const [gx, gz] = spot();
      expect(warm.findPath(sx, sz, gx, gz)).toEqual(cold.findPath(sx, sz, gx, gz));
    }
  });
});
