import { leafRect, type World } from '../shared/world.ts';

// The ways sound can travel round walls near the listener: a 1 m grid over the
// island, each cell open or blocked at head height, flooded outward from the
// listener's cell. Any sound within reach then knows the shortest way to the
// ear round corners and through doorways, and the corner it seems to come from.
// Unlike the bots' nav grid, a shut door blocks it, low walls and fences
// don't (sound gets over them, see hearing.ts), and only half a cell of
// clearance is kept, so a doorway is always at least one cell wide.

const CELL = 1;
const TILE = 32;
const UNKNOWN = 0;
const OPEN = 1;
const BLOCKED = 2;
/** Cells from the listener the flood reaches: sounds further off go straight or over. */
export const FIELD_RADIUS = 48;
const SIDE = FIELD_RADIUS * 2 + 1;
/** Obstacles no higher than this over the ground don't stop sound going round; it goes over them. */
const LOW = 1.2;
/** Heights that count: from the ground to this, the height of a doorway. */
const HIGH = 2.2;
/** Anything within this of a cell's middle blocks it, so no wall is thin enough to slip between cells. */
const PAD = CELL * 0.45;
/** A corner is heard this high over the ground. */
export const CORNER_HEIGHT = 1.5;
const SQRT2 = Math.SQRT2;
/** 8-connected neighbours, straight ones first. */
const DX = [1, -1, 0, 0, 1, 1, -1, -1];
const DZ = [0, 0, 1, -1, 1, -1, 1, -1];
/** Cells the ear moves from where it was flooded from before it's flooded again. */
const REFLOOD = 2;

export interface Corner {
  x: number;
  z: number;
}

/** A way round from a sound to the ear. */
export interface Route {
  /** Metres along the ground, ear to sound. */
  length: number;
  /** The bends, nearest the ear first: the first is where the sound seems to come from. */
  corners: Corner[];
  /** How sharply it turns at each bend, in radians. */
  turns: number[];
}

export class SoundField {
  private readonly world: World;
  private readonly n: number;
  private readonly cells: Uint8Array;
  private readonly tiles: Uint8Array;
  private readonly tilesPerSide: number;
  /** The flood: metres to the ear and the next cell toward it, in the window round the ear. */
  private readonly dist = new Float32Array(SIDE * SIDE);
  private readonly next = new Int32Array(SIDE * SIDE);
  /** Which cells of the window are open, copied out for the flood. */
  private readonly open = new Uint8Array(SIDE * SIDE);
  private readonly heap = new CellHeap(SIDE * SIDE * 4);
  /** The window's lowest cell, and the ear's cell it was flooded from. */
  private x0 = 0;
  private z0 = 0;
  private earX = -1;
  private earZ = -1;
  private stale = true;
  /** Floods run, for tests and the frame budget. */
  floods = 0;

  constructor(world: World) {
    this.world = world;
    this.n = Math.round(world.size / CELL);
    this.cells = new Uint8Array(this.n * this.n);
    this.tilesPerSide = Math.ceil(this.n / TILE);
    this.tiles = new Uint8Array(this.tilesPerSide * this.tilesPerSide);
  }

  /** Something changed between (x0, z0) and (x1, z1), such as a door or broken cover: look again. */
  changed(x0: number, z0: number, x1: number, z1: number): void {
    const a = Math.max(this.cell(x0) - 1, 0);
    const b = Math.min(this.cell(x1) + 1, this.n - 1);
    const c = Math.max(this.cell(z0) - 1, 0);
    const d = Math.min(this.cell(z1) + 1, this.n - 1);
    for (let iz = c; iz <= d; iz++) {
      for (let ix = a; ix <= b; ix++) {
        const i = iz * this.n + ix;
        if (this.cells[i] !== UNKNOWN) this.cells[i] = this.survey(ix, iz);
      }
    }
    this.stale = true;
  }

  /** A door swung: both where its leaf was and where it is now. */
  door(id: number): void {
    const d = this.world.doors[id];
    if (!d) return;
    for (const open of [false, true]) {
      const [x0, z0, x1, z1] = leafRect(d, open);
      this.changed(x0, z0, x1, z1);
    }
  }

  /** Everything may have changed, as after a death cam: survey afresh. */
  reset(): void {
    this.cells.fill(UNKNOWN);
    this.tiles.fill(0);
    this.stale = true;
  }

  /**
   * The shortest way round from (x, z) to an ear at (ex, ez), or null when
   * it's out of reach, walled off, or the way is straight (nothing to go round).
   */
  route(ex: number, ez: number, x: number, z: number): Route | null {
    this.flood(ex, ez);
    const sx = this.cell(x) - this.x0;
    const sz = this.cell(z) - this.z0;
    if (sx < 0 || sz < 0 || sx >= SIDE || sz >= SIDE) return null;
    let start = sz * SIDE + sx;
    if (this.dist[start] === Infinity) {
      // The sound may be right against a wall: from an open cell beside it.
      start = this.nearest(sx, sz, (i) => this.dist[i] < Infinity);
      if (start < 0) return null;
    }
    // The cells from the ear to the sound.
    const path: Corner[] = [];
    for (let i = start; i >= 0; i = this.next[i]) path.push({ x: this.center(i % SIDE + this.x0), z: this.center(Math.floor(i / SIDE) + this.z0) });
    path.reverse();
    path[0] = { x: ex, z: ez };
    path.push({ x, z });
    // Pulled tight: each leg as far as a straight open line goes.
    const corners: Corner[] = [];
    let anchor = 0;
    while (anchor < path.length - 1) {
      let k = anchor + 1;
      while (k + 1 < path.length && this.lineOpen(path[anchor], path[k + 1])) k++;
      if (k < path.length - 1) corners.push(path[k]);
      anchor = k;
    }
    if (!corners.length) return null;
    const points = [path[0], ...corners, path[path.length - 1]];
    let length = 0;
    const turns: number[] = [];
    for (let i = 1; i < points.length; i++) {
      const ax = points[i].x - points[i - 1].x;
      const az = points[i].z - points[i - 1].z;
      length += Math.hypot(ax, az);
      if (i + 1 < points.length) {
        const bx = points[i + 1].x - points[i].x;
        const bz = points[i + 1].z - points[i].z;
        const cos = (ax * bx + az * bz) / (Math.hypot(ax, az) * Math.hypot(bx, bz) || 1);
        turns.push(Math.acos(Math.max(-1, Math.min(1, cos))));
      }
    }
    return { length, corners, turns };
  }

  /**
   * Flood outward from the ear's cell, unless that's done already from a cell
   * near enough and nothing changed. A route starts from the ear itself, so a
   * flood from a cell or two away still gives the right corners.
   */
  private flood(ex: number, ez: number): void {
    let cx = this.cell(ex);
    let cz = this.cell(ez);
    if (!this.stale && Math.abs(cx - this.earX) < REFLOOD && Math.abs(cz - this.earZ) < REFLOOD) return;
    this.stale = false;
    this.earX = cx;
    this.earZ = cz;
    this.floods++;
    this.x0 = cx - FIELD_RADIUS;
    this.z0 = cz - FIELD_RADIUS;
    const open = this.open;
    for (let lz = 0; lz < SIDE; lz++) {
      for (let lx = 0; lx < SIDE; lx++) open[lz * SIDE + lx] = this.state(lx + this.x0, lz + this.z0) === OPEN ? 1 : 0;
    }
    const dist = this.dist;
    const next = this.next;
    dist.fill(Infinity);
    next.fill(-1);
    // An ear right against a wall hears from the open cell beside it.
    let s = FIELD_RADIUS * SIDE + FIELD_RADIUS;
    if (!open[s]) {
      s = this.nearest(FIELD_RADIUS, FIELD_RADIUS, (i) => open[i] === 1);
      if (s < 0) return;
      cx = (s % SIDE) + this.x0;
      cz = Math.floor(s / SIDE) + this.z0;
    }
    const heap = this.heap;
    heap.size = 0;
    dist[s] = 0;
    heap.push(s, 0);
    while (heap.size > 0) {
      const cur = heap.pop();
      const d = dist[cur];
      if (heap.key > d) continue;
      const lx = cur % SIDE;
      const lz = (cur - lx) / SIDE;
      for (let k = 0; k < 8; k++) {
        const dx = DX[k];
        const dz = DZ[k];
        const nx = lx + dx;
        const nz = lz + dz;
        if (nx < 0 || nz < 0 || nx >= SIDE || nz >= SIDE) continue;
        const ni = nz * SIDE + nx;
        if (!open[ni]) continue;
        // No cutting a corner past a blocked cell.
        if (k >= 4 && (!open[lz * SIDE + nx] || !open[nz * SIDE + lx])) continue;
        const nd = d + (k >= 4 ? SQRT2 : 1);
        if (nd >= dist[ni]) continue;
        dist[ni] = nd;
        next[ni] = cur;
        heap.push(ni, nd);
      }
    }
  }

  /** The window cell nearest (lx, lz) within two cells that passes `ok`, as a window index, or -1. */
  private nearest(lx: number, lz: number, ok: (i: number, x: number, z: number) => boolean): number {
    let best = -1;
    let bestD = Infinity;
    for (let dz = -2; dz <= 2; dz++) {
      for (let dx = -2; dx <= 2; dx++) {
        const x = lx + dx;
        const z = lz + dz;
        const d = dx * dx + dz * dz;
        if (x < 0 || z < 0 || x >= SIDE || z >= SIDE || d >= bestD) continue;
        const i = z * SIDE + x;
        if (ok(i, x, z)) (best = i), (bestD = d);
      }
    }
    return best;
  }

  /** Whether the straight line from a to b crosses only open cells. */
  private lineOpen(a: Corner, b: Corner): boolean {
    const d = Math.hypot(b.x - a.x, b.z - a.z);
    const steps = Math.max(1, Math.ceil(d / (CELL * 0.25)));
    let last = -1;
    for (let i = 1; i < steps; i++) {
      const f = i / steps;
      const ix = this.cell(a.x + (b.x - a.x) * f);
      const iz = this.cell(a.z + (b.z - a.z) * f);
      const key = iz * this.n + ix;
      if (key === last) continue;
      last = key;
      if (this.state(ix, iz) !== OPEN) return false;
    }
    return true;
  }

  private cell(v: number): number {
    return Math.floor((v + this.world.half) / CELL);
  }

  private center(i: number): number {
    return -this.world.half + (i + 0.5) * CELL;
  }

  private state(ix: number, iz: number): number {
    const n = this.n;
    if (ix < 0 || iz < 0 || ix >= n || iz >= n) return BLOCKED;
    const i = iz * n + ix;
    if (this.cells[i] === UNKNOWN) this.buildTile(Math.floor(ix / TILE), Math.floor(iz / TILE));
    return this.cells[i];
  }

  private buildTile(tx: number, tz: number): void {
    const t = tz * this.tilesPerSide + tx;
    if (this.tiles[t]) return;
    this.tiles[t] = 1;
    for (let iz = tz * TILE; iz < Math.min((tz + 1) * TILE, this.n); iz++) {
      for (let ix = tx * TILE; ix < Math.min((tx + 1) * TILE, this.n); ix++) this.cells[iz * this.n + ix] = this.survey(ix, iz);
    }
  }

  /** Open if nothing stands near the cell's middle between knee and doorway height. */
  private survey(ix: number, iz: number): number {
    const w = this.world;
    const x = this.center(ix);
    const z = this.center(iz);
    const y = w.groundHeight(x, z, w.floorHeight(x, z));
    return w.clear(x, y, z, HIGH, PAD, true, LOW) ? OPEN : BLOCKED;
  }
}

/**
 * A min-heap of cells by distance in fixed typed arrays, for the flood; a
 * cell may be in it more than once, and `key` says what the last one popped
 * was keyed by, so a caller can skip the stale ones.
 */
class CellHeap {
  private readonly items: Int32Array;
  private readonly keys: Float32Array;
  size = 0;
  key = 0;

  constructor(capacity: number) {
    this.items = new Int32Array(capacity);
    this.keys = new Float32Array(capacity);
  }

  push(item: number, key: number): void {
    if (this.size === this.items.length) return;
    const items = this.items;
    const keys = this.keys;
    let i = this.size++;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (keys[p] <= key) break;
      items[i] = items[p];
      keys[i] = keys[p];
      i = p;
    }
    items[i] = item;
    keys[i] = key;
  }

  pop(): number {
    const items = this.items;
    const keys = this.keys;
    const top = items[0];
    this.key = keys[0];
    const n = --this.size;
    const lastItem = items[n];
    const lastKey = keys[n];
    let i = 0;
    for (;;) {
      const l = 2 * i + 1;
      if (l >= n) break;
      const r = l + 1;
      const c = r < n && keys[r] < keys[l] ? r : l;
      if (keys[c] >= lastKey) break;
      items[i] = items[c];
      keys[i] = keys[c];
      i = c;
    }
    items[i] = lastItem;
    keys[i] = lastKey;
    return top;
  }
}
