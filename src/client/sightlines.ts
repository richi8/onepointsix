import type { World } from '../shared/world.ts';

// What of the hillside the town can see. Nobody leaves the town, so a tree,
// a rock or a stretch of terrace wall that no spot a player can stand on sees
// is left out of what's drawn: the ground between hides it. Terrain only, and
// leaning toward seeing (a cell's lowest corner is the ground over it, a
// target is judged at its top), so nothing that could show is dropped.

/** Metres between viewpoints on the ground and on the roofs, and between the terrain samples a line of sight reads. */
const VIEW_EVERY = 12;
const CELL = 3;
/** How far under the ground a line of sight may dip and still count as clear, making up for the viewpoints between. */
const SLACK = 1.5;
/** The cells and heights, metres, that answers are kept for. */
const MEMO_CELL = 4;
/** A viewer's eye over the floor. */
const EYE = 1.7;

/** Where a player's eyes can be: over the ground inside the walls, and over each walkable roof or floor. */
function viewpoints(world: World): [number, number, number][] {
  const out: [number, number, number][] = [];
  const b = world.bounds;
  for (let x = b.minX; x <= b.maxX; x += VIEW_EVERY) {
    for (let z = b.minZ; z <= b.maxZ; z += VIEW_EVERY) out.push([x, world.terrainHeight(x, z) + EYE, z]);
  }
  for (const p of world.props) {
    const c = p.box;
    if (c.part !== 'roof' && !c.walk) continue;
    const nx = Math.max(1, Math.ceil((c.maxX - c.minX) / VIEW_EVERY));
    const nz = Math.max(1, Math.ceil((c.maxZ - c.minZ) / VIEW_EVERY));
    for (let i = 0; i < nx; i++) {
      for (let j = 0; j < nz; j++) out.push([c.minX + ((i + 0.5) * (c.maxX - c.minX)) / nx, c.maxY + EYE, c.minZ + ((j + 0.5) * (c.maxZ - c.minZ)) / nz]);
    }
  }
  // Of the eyes within one cell, the highest sees the most.
  const best = new Map<number, [number, number, number]>();
  for (const e of out) {
    const key = Math.floor(e[0] / VIEW_EVERY) * 4096 + Math.floor(e[2] / VIEW_EVERY);
    const old = best.get(key);
    if (!old || e[1] > old[1]) best.set(key, e);
  }
  return [...best.values()];
}

const made = new WeakMap<World, (x: number, top: number, z: number) => boolean>();

/** Asks whether a point `reach` metres round the town's middle, its top at `top`, can be seen from the town. */
export function sightlines(world: World, reach: number): (x: number, top: number, z: number) => boolean {
  let ask = made.get(world);
  if (!ask) made.set(world, (ask = build(world, reach)));
  return ask;
}

function build(world: World, reach: number): (x: number, top: number, z: number) => boolean {
  const eyes = viewpoints(world);
  const b = world.bounds;
  const [cx, cz] = [(b.minX + b.maxX) / 2, (b.minZ + b.maxZ) / 2];
  const n = Math.ceil((reach * 2) / CELL) + 1;
  const x0 = cx - reach;
  const z0 = cz - reach;
  const h = new Float32Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) h[j * n + i] = world.terrainHeight(x0 + i * CELL, z0 + j * CELL);
  /** The ground over the cell holding (x, z): its lowest corner. */
  const ground = (x: number, z: number) => {
    const i = Math.min(n - 2, Math.max(0, Math.floor((x - x0) / CELL)));
    const j = Math.min(n - 2, Math.max(0, Math.floor((z - z0) / CELL)));
    const k = j * n + i;
    return Math.min(h[k], h[k + 1], h[k + n], h[k + n + 1]);
  };
  const memo = new Map<number, boolean>();
  /** The viewpoint that saw the last thing seen: what's next to it is likely seen from the same spot. */
  let lucky = 0;
  const look = (x: number, top: number, z: number) => {
    for (let k = -1; k < eyes.length; k++) {
      const e = k < 0 ? lucky : k;
      const [ex, ey, ez] = eyes[e];
      const len = Math.sqrt((x - ex) * (x - ex) + (z - ez) * (z - ez));
      const steps = Math.floor(len / CELL) - 1;
      let clear = true;
      // From the target back: what hides a hillside is mostly its own ground.
      for (let s = steps; s >= 1; s--) {
        const t = (s * CELL) / len;
        if (ey + (top - ey) * t + SLACK < ground(ex + (x - ex) * t, ez + (z - ez) * t)) {
          clear = false;
          break;
        }
      }
      if (clear) {
        lucky = e;
        return true;
      }
    }
    return false;
  };
  return (x, top, z) => {
    // Judged at the top of its metre, so a cell's answer holds for all of that metre.
    const base = ground(x, z);
    const up = Math.min(255, Math.max(0, Math.ceil(top - base)));
    const key = (Math.floor((x - x0) / MEMO_CELL) * 4096 + Math.floor((z - z0) / MEMO_CELL)) * 256 + up;
    let seen = memo.get(key);
    if (seen === undefined) memo.set(key, (seen = look(x, base + up, z)));
    return seen;
  };
}
