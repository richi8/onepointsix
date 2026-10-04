import { EYE_HEIGHT, PLAYER_HEIGHT, PLAYER_RADIUS } from '../shared/constants.ts';
import { angleDiff, yawToward } from '../shared/geom.ts';
import { inBuilding, type Point, type World } from '../shared/world.ts';

// Places on a map to watch the streets from, for bots: just inside an upper
// window, or at a flat roof's edge over a drop. Worked out once per world from
// its window panes and walked roofs, where a body stands clear; the nav grid
// isn't asked, as that would survey the whole town at once.

export interface Vantage extends Point {
  /** Which way it looks out. */
  yaw: number;
  kind: 'window' | 'roof';
}

/** How far in from a window's glass, or a roof's edge, a watcher stands. */
const WINDOW_IN = 0.8;
const ROOF_IN = 0.9;
/** A window is a vantage only this far or more above the ground outside it; a roof's edge only over a drop this deep. */
const OVER = 2;
/** Spots along a roof's edge are this far apart. */
const ROOF_EVERY = 5;

const cache = new WeakMap<World, Vantage[]>();

/** The world's vantages, none off a map. */
export function vantages(world: World): Vantage[] {
  let out = cache.get(world);
  if (out) return out;
  out = world.map ? find(world) : [];
  cache.set(world, out);
  return out;
}

function find(world: World): Vantage[] {
  const out: Vantage[] = [];
  /** A spot for a watcher at (x, z) on a floor at y looking toward `yaw`, if a body stands there: on that floor, nothing in the way, room overhead, as the world was built. */
  const add = (x: number, y: number, z: number, yaw: number, kind: Vantage['kind']) => {
    if (!world.inBounds(x, z, 1) || Math.abs(world.groundHeight(x, z, y + 0.1) - y) > 0.05) return;
    if (!world.clearAsBuilt(x, y, z, PLAYER_HEIGHT, PLAYER_RADIUS)) return;
    out.push({ x, y, z, yaw, kind });
  };
  for (const panel of world.panels) {
    if (panel.kind !== 'glass') continue;
    const b = panel.box;
    const cx = (b.minX + b.maxX) / 2;
    const cz = (b.minZ + b.maxZ) / 2;
    // The pane is thin across its wall: look out across that way, from whichever side is indoors.
    const acrossX = b.maxX - b.minX < b.maxZ - b.minZ;
    for (const s of [-1, 1]) {
      const [ix, iz] = acrossX ? [cx + s * WINDOW_IN, cz] : [cx, cz + s * WINDOW_IN];
      const [ox, oz] = acrossX ? [cx - s * WINDOW_IN * 2, cz] : [cx, cz - s * WINDOW_IN * 2];
      if (!world.buildings.some((h) => inBuilding(h, ix, iz)) || world.buildings.some((h) => inBuilding(h, ox, oz))) continue;
      const floor = world.groundHeight(ix, iz, b.minY - 0.5);
      if (floor - world.groundHeight(ox, oz, floor) < OVER) continue;
      add(ix, floor, iz, yawToward(ix, iz, ox, oz), 'window');
    }
  }
  for (const p of world.props) {
    const b = p.box;
    if (p.box.part !== 'roof' || !b.walk) continue;
    const y = b.maxY;
    const edges: [number, number, number, number, number, number][] = [
      // From (x, z) along (ux, uz) for len, looking out along (nx, nz).
      [b.minX, b.minZ, 1, 0, 0, -1],
      [b.minX, b.maxZ, 1, 0, 0, 1],
      [b.minX, b.minZ, 0, 1, -1, 0],
      [b.maxX, b.minZ, 0, 1, 1, 0],
    ];
    for (const [x0, z0, ux, uz, nx, nz] of edges) {
      const len = ux ? b.maxX - b.minX : b.maxZ - b.minZ;
      const n = Math.max(1, Math.floor(len / ROOF_EVERY));
      for (let i = 0; i < n; i++) {
        const t = ((i + 0.5) / n) * len;
        const x = x0 + ux * t - nx * ROOF_IN;
        const z = z0 + uz * t - nz * ROOF_IN;
        const below = world.groundHeight(x + nx * (ROOF_IN + 1.5), z + nz * (ROOF_IN + 1.5), y);
        if (y - below < OVER) continue;
        add(x, y, z, yawToward(0, 0, nx, nz), 'roof');
      }
    }
  }
  return out;
}

/**
 * A vantage `near` to `far` metres from `at` that sees it, standing, nearest
 * `from` by the way there (up counting as across); null if none of those
 * tried does. `taken` are spots others hold, kept clear of.
 */
export function vantageOver(world: World, list: readonly Vantage[], at: Point, from: Point, [near, far]: [number, number], taken: readonly Point[] = [], rand = Math.random): Vantage | null {
  const tried: { v: Vantage; cost: number }[] = [];
  for (const v of list) {
    const d = Math.hypot(v.x - at.x, v.z - at.z);
    if (d < near || d > far) continue;
    // Looking out its way, more or less.
    if (Math.abs(angleDiff(yawToward(v.x, v.z, at.x, at.z), v.yaw)) > 1.3) continue;
    if (taken.some((t) => Math.hypot(t.x - v.x, t.z - v.z) < 4 && Math.abs(t.y - v.y) < 2)) continue;
    tried.push({ v, cost: Math.hypot(v.x - from.x, v.z - from.z) + Math.abs(v.y - from.y) * 2 + rand() * 15 });
  }
  tried.sort((a, b) => a.cost - b.cost);
  for (const { v } of tried.slice(0, 8)) {
    if (world.hasLineOfSight(v.x, v.y + EYE_HEIGHT, v.z, at.x, at.y + 1, at.z)) return v;
  }
  return null;
}
