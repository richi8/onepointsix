import { describe, expect, it } from 'vitest';
import { NavGrid, reached, type Waypoint } from '../src/server/nav.ts';
import { Btn, CMD_DT, INTERACT_REACH } from '../src/shared/constants.ts';
import { searchSpot } from '../src/server/population.ts';
import { lootCrates } from '../src/shared/loot.ts';
import { applyCmd, spawnState, type PlayerState } from '../src/shared/sim.ts';
import { inBuilding, watchtower, World, type Box, type Building, type Point } from '../src/shared/world.ts';

const SEEDS = [1, 2, 3, 42, 1234];

/** Whether a box lies within a building's footprint, roof overhang included. */
function inside(b: Building, box: Box, pad = 0.35): boolean {
  return box.minX >= b.minX - pad && box.maxX <= b.maxX + pad && box.minZ >= b.minZ - pad && box.maxZ <= b.maxZ + pad;
}

function overlaps(b: Building, box: Box, pad: number): boolean {
  return box.maxX > b.minX - pad && box.minX < b.maxX + pad && box.maxZ > b.minZ - pad && box.minZ < b.maxZ + pad;
}

/** The building's crates: two in an outpost's, one in a hut. */
function crates(w: World, b: Building) {
  return w.props.filter((p) => p.style === 'crate' && inside(b, p.box, 0));
}

/**
 * A building's doorways, found by their lintels, 2.2 m over the floor: each
 * one's middle, and the way in from outside, or (0, 0) for one between rooms.
 */
function doorways(w: World, b: Building): { x: number; z: number; inX: number; inZ: number }[] {
  return w.props.filter((p) => p.box.part === 'wall' && inside(b, p.box, 0) && Math.abs(p.box.minY - b.floor - 2.2) < 1e-6).map(({ box }) => {
    const x = (box.minX + box.maxX) / 2;
    const z = (box.minZ + box.maxZ) / 2;
    const [ax, az] = box.maxX - box.minX < box.maxZ - box.minZ ? [1, 0] : [0, 1];
    const a = inBuilding(b, x + ax * 2, z + az * 2);
    const c = inBuilding(b, x - ax * 2, z - az * 2);
    return a === c ? { x, z, inX: 0, inZ: 0 } : a ? { x, z, inX: ax, inZ: az } : { x, z, inX: -ax, inZ: -az };
  });
}

/** Walk forward facing along (dx, dz) for `seconds`. */
function walk(w: World, p: PlayerState, dx: number, dz: number, seconds: number): void {
  const yaw = Math.atan2(-dx, -dz);
  for (let i = 0; i < seconds / CMD_DT; i++) applyCmd(w, p, { seq: i, buttons: Btn.Forward, yaw, pitch: 0 }, CMD_DT);
}

/** Walk a path's waypoints in turn, as a bot steers, for at most `seconds`. */
function follow(w: World, p: PlayerState, path: Waypoint[], seconds: number): void {
  const left = [...path];
  for (let i = 0; i < seconds / CMD_DT && left.length; i++) {
    const next = left[0];
    if (left.length > 1 ? reached(next, p.x, p.y, p.z) : Math.hypot(next.x - p.x, next.z - p.z) < 0.2) {
      left.shift();
      continue;
    }
    applyCmd(w, p, { seq: i, buttons: Btn.Forward, yaw: Math.atan2(-(next.x - p.x), -(next.z - p.z)), pitch: 0 }, CMD_DT);
  }
}

/** Where a bot stands to search a crate, as population.ts picks it. */
function searchSpotOf(w: World, nav: NavGrid, box: Box): Point | null {
  const cx = (box.minX + box.maxX) / 2;
  const cz = (box.minZ + box.maxZ) / 2;
  const reach = Math.max(box.maxX - box.minX, box.maxZ - box.minZ) / 2 + 0.9;
  const floor = Math.max(box.minY, w.floorHeight(cx, cz));
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const x = cx + Math.sin(a) * reach;
    const z = cz + Math.cos(a) * reach;
    const y = w.groundHeight(x, z, floor);
    if (Math.abs(y - floor) < 0.6 && nav.stands(x, y, z)) return { x, y, z };
  }
  return null;
}

describe('buildings', () => {
  it('stand one to an outpost, inside its walls and clear of everything else', () => {
    for (const seed of SEEDS) {
      const w = new World(seed);
      const own = w.buildings.filter((b) => b.outpost >= 0);
      expect(own).toHaveLength(w.outposts.length);
      own.forEach((b, i) => {
        expect(b.outpost).toBe(i);
        const o = w.outposts[i];
        expect(Math.max(Math.abs(b.minX - o.x), Math.abs(b.maxX - o.x), Math.abs(b.minZ - o.z), Math.abs(b.maxZ - o.z))).toBeLessThan(13);
        const t = watchtower(o);
        expect(b.maxX < t.x - 3 || b.minX > t.x + 10.5 || b.maxZ < t.z - 3 || b.minZ > t.z + 3).toBe(true);
        for (const p of w.props) {
          if (inside(b, p.box)) continue;
          if (overlaps(b, p.box, 1)) throw new Error(`seed ${seed}: a ${p.style} crowds building ${i}`);
        }
        expect(new World(seed).buildings[i]).toEqual(b);
      });
    }
  });

  it('come in four plans, a different one in each of the first four outposts', () => {
    for (const seed of SEEDS) {
      const w = new World(seed);
      const plans = w.buildings.filter((b) => b.outpost >= 0).map((b) => b.plan);
      expect(new Set(plans.slice(0, 4)).size).toBe(4);
      for (const b of w.buildings) {
        expect(b.parts).toHaveLength(b.plan === 'ell' ? 2 : 1);
        expect(b.upper !== null).toBe(b.plan === 'tall');
      }
    }
  });

  it('stand out in the country too, away from the outposts, each with a crate', () => {
    for (const seed of SEEDS) {
      const w = new World(seed);
      const huts = w.buildings.filter((b) => b.outpost < 0);
      expect(huts.length, `seed ${seed}`).toBeGreaterThanOrEqual(3);
      const loot = lootCrates(w);
      for (const b of huts) {
        const cx = (b.minX + b.maxX) / 2;
        const cz = (b.minZ + b.maxZ) / 2;
        for (const o of w.outposts) expect(Math.hypot(o.x - cx, o.z - cz)).toBeGreaterThan(40);
        const [c] = crates(w, b);
        expect(loot.some((l) => l.box === c.box && !l.rich)).toBe(true);
      }
    }
  });

  it('give every crate in them a spot bots search it from, walked to from outside', { timeout: 60_000 }, () => {
    let n = 0;
    for (let seed = 1; seed <= 6; seed++) {
      const w = new World(seed);
      const nav = new NavGrid(w);
      for (const b of w.buildings) {
        for (const c of crates(w, b)) {
          n++;
          const at = `seed ${seed} crate at ${c.box.minX.toFixed(1)}, ${c.box.minZ.toFixed(1)}`;
          const spot = searchSpot(w, nav, c.box);
          expect(spot, at).not.toBeNull();
          const from = nav.nearestWalkable((b.minX + b.maxX) / 2, b.minZ - 6)!;
          const path = nav.findPath(from.x, from.z, spot!.x, spot!.z, undefined, spot!.y);
          expect(path, at).not.toBeNull();
          const p = spawnState(from.x, w.groundHeight(from.x, from.z, w.floorHeight(from.x, from.z)), from.z);
          follow(w, p, path!, 40);
          // Within reach of the crate's side, where the server lets it be searched.
          const d = Math.hypot(p.x - Math.min(Math.max(p.x, c.box.minX), c.box.maxX), p.z - Math.min(Math.max(p.z, c.box.minZ), c.box.maxZ));
          expect(d, at).toBeLessThan(INTERACT_REACH);
          expect(Math.abs(p.y - spot!.y), at).toBeLessThan(0.3);
        }
      }
    }
    expect(n).toBeGreaterThan(90);
  });

  it('can be walked into, room by room, by bots from outside', () => {
    for (const seed of SEEDS) {
      const w = new World(seed);
      const nav = new NavGrid(w);
      w.buildings.forEach((b, i) => {
        const room = crates(w, b);
        expect(room).toHaveLength(b.outpost >= 0 ? 2 : 1);
        const mx = (b.minX + b.maxX) / 2;
        const mz = (b.minZ + b.maxZ) / 2;
        // From 30 m off toward the island's middle, or the outpost's gate.
        const from = b.outpost >= 0 ? { x: w.outposts[b.outpost].x, z: w.outposts[b.outpost].z - 30 } : { x: mx * 0.9, z: mz * 0.9 - 20 };
        for (const c of room) {
          // A step out from the crate toward the room it's in.
          const cx = (c.box.minX + c.box.maxX) / 2;
          const cz = (c.box.minZ + c.box.maxZ) / 2;
          const part = b.parts.find((r) => cx > r.minX && cx < r.maxX && cz > r.minZ && cz < r.maxZ)!;
          const px = (part.minX + part.maxX) / 2;
          const pz = (part.minZ + part.maxZ) / 2;
          const d = Math.hypot(px - cx, pz - cz);
          const g = nav.nearestWalkable(cx + ((px - cx) / d) * 1.4, cz + ((pz - cz) / d) * 1.4, 1)!;
          expect(g, `seed ${seed} building ${i}`).not.toBeNull();
          expect(inBuilding(b, g.x, g.z)).toBe(true);
          const path = nav.findPath(from.x, from.z, g.x, g.z)!;
          expect(path, `seed ${seed} building ${i}`).not.toBeNull();
          const end = path.at(-1)!;
          expect(Math.hypot(end.x - g.x, end.z - g.z), `seed ${seed} building ${i} (${b.plan})`).toBeLessThan(0.5);
        }
      });
    }
  });

  it('can be climbed by bots: upstairs to the crate there, and up a watchtower', () => {
    let tall = 0;
    for (const seed of SEEDS) {
      const w = new World(seed);
      const nav = new NavGrid(w);
      for (const b of w.buildings.filter((h) => h.plan === 'tall')) {
        tall++;
        const [c] = crates(w, b).filter((k) => k.box.minY >= b.upper! - 1e-6);
        expect(c, `seed ${seed}`).toBeDefined();
        const spot = searchSpotOf(w, nav, c.box);
        expect(spot, `seed ${seed}`).not.toBeNull();
        const o = w.outposts[b.outpost];
        const from = nav.nearestWalkable(o.x, o.z - 30)!;
        const path = nav.findPath(from.x, from.z, spot!.x, spot!.z, undefined, spot!.y)!;
        expect(path.at(-1)!.y, `seed ${seed}`).toBeCloseTo(b.upper!, 1);
        const p = spawnState(from.x, w.groundHeight(from.x, from.z, w.floorHeight(from.x, from.z)), from.z);
        follow(w, p, path, 40);
        expect(Math.hypot(p.x - spot!.x, p.z - spot!.z), `seed ${seed}`).toBeLessThan(1);
        expect(p.y, `seed ${seed}`).toBeCloseTo(b.upper!, 1);
        // And back down.
        const down = nav.findPath(p.x, p.z, from.x, from.z, p.y, undefined)!;
        follow(w, p, down, 40);
        expect(Math.hypot(p.x - from.x, p.z - from.z), `seed ${seed}`).toBeLessThan(1.5);
      }
      w.outposts.forEach((o, i) => {
        const t = watchtower(o);
        const from = nav.nearestWalkable(o.x, o.z)!;
        const up = nav.findPath(from.x, from.z, t.x, t.z, o.y, t.y)!;
        expect(up.at(-1)!.y, `seed ${seed} tower ${i}`).toBeCloseTo(t.y, 1);
        const p = spawnState(from.x, w.groundHeight(from.x, from.z, o.y), from.z);
        follow(w, p, up, 30);
        expect(p.y, `seed ${seed} tower ${i}`).toBeCloseTo(t.y, 1);
      });
    }
    expect(tall).toBeGreaterThan(0);
  });

  it('leave nowhere on their floors that bots can\'t walk to from outside', { timeout: 60_000 }, () => {
    for (let seed = 1; seed <= 6; seed++) {
      const w = new World(seed);
      const nav = new NavGrid(w);
      for (const b of w.buildings) {
        const from = nav.nearestWalkable((b.minX + b.maxX) / 2, b.minZ - 6)!;
        const area = { minX: b.minX - 8, minZ: b.minZ - 8, maxX: b.maxX + 8, maxZ: b.maxZ + 8 };
        const left = nav.unreached(from.x, from.z, w.groundHeight(from.x, from.z, w.floorHeight(from.x, from.z)), area)
          .filter((q) => inBuilding(b, q.x, q.z));
        expect(left, `seed ${seed} ${b.plan} at ${b.minX.toFixed(0)}, ${b.minZ.toFixed(0)}`).toEqual([]);
      }
    }
  });

  it('let a player in through a doorway but not a wall', () => {
    let n = 0;
    for (const seed of [1, 2]) {
      const w = new World(seed);
      for (const b of w.buildings.filter((h) => h.outpost >= 0)) {
        // Each outside doorway, walked through from 2 m out.
        for (const d of doorways(w, b).filter((d) => d.inX || d.inZ)) {
          const sx = d.x - d.inX * 2;
          const sz = d.z - d.inZ * 2;
          const p = spawnState(sx, w.groundHeight(sx, sz, b.floor), sz);
          walk(w, p, d.inX, d.inZ, 3);
          expect(inBuilding(b, p.x, p.z), `seed ${seed} ${b.plan} doorway at ${d.x}, ${d.z}`).toBe(true);
          n++;
        }
      }
    }
    expect(n).toBeGreaterThan(10);

    // Beside a doorway, the wall holds.
    const w = new World(1);
    const b = w.buildings[0];
    const wall = w.props.find((p) => p.box.part === 'wall' && inside(b, p.box, 0) && p.box.minY < b.floor && p.box.maxY > b.floor + 1.2
      && p.box.maxX - p.box.minX > 1 && Math.abs(p.box.minZ - b.minZ) < 1e-6)!.box;
    const x = (wall.minX + wall.maxX) / 2;
    const p = spawnState(x, w.groundHeight(x, wall.minZ - 2, b.floor), wall.minZ - 2);
    walk(w, p, 0, 1, 3);
    expect(p.z).toBeLessThan(wall.minZ);
  });

  it('glaze their windows with glass that stops bodies and rounds but not sight, and breaks at a touch', () => {
    const w = new World(1);
    const glass = w.panels.map((p, i) => ({ p, i })).filter(({ p }) => p.kind === 'glass');
    expect(glass.length).toBeGreaterThan(20);
    const { p, i } = glass[0];
    const b = p.box;
    expect(b.clear).toBe(true);
    expect(p.restsOn).toEqual([]);
    // On a sill.
    expect(w.props.some((q) => q.box.part === 'sill' && Math.abs(q.box.maxY - b.minY) < 1e-9
      && q.box.minX <= b.minX + 1e-9 && q.box.maxX >= b.maxX - 1e-9 && q.box.minZ <= b.minZ + 1e-9 && q.box.maxZ >= b.maxZ - 1e-9)).toBe(true);
    // Across the pane, through its middle.
    const alongX = b.maxX - b.minX > b.maxZ - b.minZ;
    const cx = (b.minX + b.maxX) / 2;
    const cy = (b.minY + b.maxY) / 2;
    const cz = (b.minZ + b.maxZ) / 2;
    const [ox, oz, dx, dz] = alongX ? [cx, cz - 1, 0, 1] : [cx - 1, cz, 1, 0];
    expect(w.raycastPanel(ox, cy, oz, dx, 0, dz, 2)).toEqual({ t: expect.closeTo(1 - (alongX ? b.maxZ - b.minZ : b.maxX - b.minX) / 2, 6), panel: i });
    expect(w.raycast(ox, cy, oz, dx, 0, dz, 2, true)).toBe(Infinity);
    expect(w.hasLineOfSight(ox, cy, oz, ox + dx * 2, cy, oz + dz * 2)).toBe(true);
    expect(w.breakPanel(i)).toEqual([i]);
    expect(w.raycast(ox, cy, oz, dx, 0, dz, 2)).toBe(Infinity);
  });

  it('build walls, lintels, posts, roofs, floors and stairs solid, as a few boxes', () => {
    for (const seed of SEEDS) {
      const w = new World(seed);
      for (const p of w.props) {
        const solid = !['fence', 'crate', 'glass', 'table'].includes(p.box.part);
        expect(p.panel < 0, `seed ${seed} ${p.box.part}`).toBe(solid);
      }
      for (const b of w.buildings) {
        const roofs = w.props.filter((p) => p.box.part === 'roof' && inside(b, p.box));
        expect(roofs.length, `seed ${seed} ${b.plan}`).toBe(b.plan === 'ell' ? 2 : 1);
      }
      // A freestanding wall is one box.
      for (const wall of w.walls) {
        expect(w.props.filter((p) => p.box.part === 'wall' && p.box.minX === wall.minX && p.box.maxX === wall.maxX && p.box.minZ === wall.minZ && p.box.maxZ === wall.maxZ)).toHaveLength(1);
      }
    }
  });

  it('hold guarded loot crates, with a roof or an upper floor overhead', () => {
    for (const seed of [2, 3]) {
      const w = new World(seed);
      const rich = lootCrates(w).filter((c) => c.rich);
      for (const b of w.buildings.filter((h) => h.outpost >= 0)) {
        for (const c of crates(w, b)) {
          expect(rich.some((r) => r.box === c.box)).toBe(true);
          const x = (c.box.minX + c.box.maxX) / 2;
          const z = (c.box.minZ + c.box.maxZ) / 2;
          expect(w.ceilingHeight(x, z, b.floor + 1.8)).toBeCloseTo(b.upper === null ? b.roof : b.upper - 0.2, 6);
        }
      }
    }
  });

  it('take stairs up to the upper storey of a tall building', () => {
    for (const seed of SEEDS) {
      const w = new World(seed);
      for (const b of w.buildings.filter((h) => h.plan === 'tall')) {
        const upper = b.upper!;
        const steps = w.props
          .filter((p) => p.style === 'wood' && inside(b, p.box, 0) && p.box.maxY > b.floor + 0.1 && p.box.maxY <= upper + 1e-6 && p.box.maxX - p.box.minX < 1.6 && p.box.maxZ - p.box.minZ < 1.6)
          .sort((a, c) => a.box.maxY - c.box.maxY);
        expect(steps).toHaveLength(6);
        const centre = (x: Box) => [(x.minX + x.maxX) / 2, (x.minZ + x.maxZ) / 2];
        const [ax, az] = centre(steps[0].box);
        const [bx, bz] = centre(steps[5].box);
        const len = Math.hypot(bx - ax, bz - az);
        const [dx, dz] = [(bx - ax) / len, (bz - az) / len];
        const p = spawnState(ax - dx, b.floor, az - dz);
        walk(w, p, dx, dz, 4);
        expect(p.y, `seed ${seed}`).toBeCloseTo(upper, 3);
      }
    }
  });

  it('only break fences, crates, glass and tables, with nothing resting on the building', () => {
    for (const seed of SEEDS) {
      const w = new World(seed);
      for (const p of w.panels) expect(['fence', 'crate', 'glass', 'table']).toContain(p.kind);
      // Crates rest only on crates.
      for (const p of w.panels) for (const i of p.restsOn) expect(w.panels[i].kind).toBe('crate');
      // A hut's floor is concrete.
      const hut = w.buildings.find((h) => h.outpost < 0)!;
      expect(w.props.some((p) => p.box.part === 'floor' && inside(hut, p.box, 0))).toBe(true);
    }
  });
});
