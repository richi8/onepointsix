import { describe, expect, it } from 'vitest';
import { NavGrid, type Waypoint } from '../src/server/nav.ts';
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
    const wall = world.props.find((p) => p.style === 'wall' && p.box.maxX - p.box.minX > 6 && p.box.maxZ - p.box.minZ < 1)!.box;
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
