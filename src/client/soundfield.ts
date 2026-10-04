import { leafRect, type World } from '../shared/world.ts';

// The ways sound can travel round walls near the listener: a 1 m grid over the
// island, each cell open or blocked at head height, flooded outward from the
// listener. Any sound within reach then knows the shortest way to the ear
// round corners and through doorways, and the corner it seems to come from.
// Unlike the bots' nav grid, a shut door blocks it, low walls and fences
// don't (sound gets over them, see hearing.ts), and only half a cell of
// clearance is kept, so a doorway is always at least one cell wide.
//
// Over the ground there can be floors: stairs, an upper storey, a
// watchtower's platform, a roof. A cell under or on one has a node for each,
// a place in the air over it that sound passes through, and so has a broken
// window, in its gap. These are joined to the nodes in the cells round them
// by straight lines checked against the world, rising or falling through the
// air beside the higher one where they're far apart in height: so sound goes
// up a stairwell, over the edge of a roof and out of a window upstairs.
// A sound beyond the flood's reach, but not too far, is heard along the way
// out of it that leaves it nearest, then straight on.

const CELL = 1;
const TILE = 32;
const UNKNOWN = 0;
const OPEN = 1;
const BLOCKED = 2;
/** Cells from the listener the flood reaches. */
export const FIELD_RADIUS = 48;
const SIDE = FIELD_RADIUS * 2 + 1;
/** Local ids below this are the ground's cells in the window round the ear; the floors there come after. */
const WINDOW = SIDE * SIDE;
/** Obstacles no higher than this over the ground don't stop sound going round; it goes over them. */
const LOW = 1.2;
/** Heights that count: from the ground to this, the height of a doorway. */
const HIGH = 2.2;
/** Anything within this of a cell's middle blocks it, so no wall is thin enough to slip between cells. */
const PAD = CELL * 0.45;
/** A corner is heard this high over the ground or floor under it. */
export const CORNER_HEIGHT = 1.5;
const SQRT2 = Math.SQRT2;
/** 8-connected neighbours, straight ones first. */
const DX = [1, -1, 0, 0, 1, 1, -1, -1];
const DZ = [0, 0, 1, -1, 1, -1, 1, -1];
/** Cells the ear moves from where it was flooded from before it's flooded again. */
const REFLOOD = 2;
/** Floors a cell can have over its ground; tops nearer than this in height, as a stair's steps, count as one, the highest. */
const MAX_LEVELS = 3;
const LEVEL_GAP = 1;
/** A floor's node is where nothing comes this near, at one of these spots in its cell, the middle first. */
const FLOOR_PAD = 0.25;
const SPOTS = [[0, 0], [0.3, 0], [-0.3, 0], [0, 0.3], [0, -0.3], [0.3, 0.3], [-0.3, 0.3], [0.3, -0.3], [-0.3, -0.3]];
/** Nodes nearer than this in height are joined straight; further apart, sound goes up or down beside the higher one first. */
const RISE = 1;
/** The most floors the flood takes in round the ear. */
const MAX_FLOORS = 8192;
/** Sounds beyond the flood's reach, up to this far, find their way out of it along a straight leg. */
export const FAR_REACH = 150;
/** Ways out of the flood tried toward a sound beyond it, the nearest first. */
const EXITS = 3;
/** An ear this far over a floor or more is on it; a sound this far over it or less. */
const EAR_OVER = 0.4;
const SOUND_OVER = 0.3;

export interface Corner {
  x: number;
  y: number;
  z: number;
}

/** A way round from a sound to the ear. */
export interface Route {
  /** Metres along the way, ear to sound. */
  length: number;
  /** The bends, nearest the ear first: the first is where the sound seems to come from. */
  corners: Corner[];
  /** How sharply it turns at each bend, in radians. */
  turns: number[];
}

/** A point along a way, and whether it's up on a floor (so its legs are checked in 3D, not on the grid). */
interface Waypoint extends Corner {
  up: boolean;
}

export class SoundField {
  private readonly world: World;
  private readonly n: number;
  /** n², where the floors' ids start. */
  private readonly nn: number;
  private readonly cells: Uint8Array;
  private readonly groundY: Float32Array;
  private readonly tiles: Uint8Array;
  private readonly tilesPerSide: number;
  /** Cells a floor, roof or window reaches over: only these are looked at for floors. */
  private readonly floored = new Set<number>();
  /** The windows' glass, by the cell its middle is in. */
  private readonly windows = new Map<number, number[]>();
  /** Each cell's floor nodes, lowest first, as ids less n², and each node's point in the air and cell. */
  private readonly floors = new Map<number, number[]>();
  private readonly fx: number[] = [];
  private readonly fy: number[] = [];
  private readonly fz: number[] = [];
  private readonly fcell: number[] = [];
  /** Each floor node's neighbours it's joined to, by id: a ground cell, or n² on for a floor. */
  private readonly links = new Map<number, number[]>();
  /** The flood: metres to the ear and the next node toward it, in the window round the ear, then its floors. */
  private readonly dist = new Float32Array(WINDOW + MAX_FLOORS);
  private readonly next = new Int32Array(WINDOW + MAX_FLOORS);
  /** Which cells of the window are open, copied out for the flood. */
  private readonly open = new Uint8Array(WINDOW);
  private readonly heap = new CellHeap(WINDOW * 4 + MAX_FLOORS * 8);
  /** The floors in the window, by local id less WINDOW; each one's local id; and the floors joined to each ground cell. */
  private readonly inWindow: number[] = [];
  private readonly local = new Map<number, number>();
  private readonly up = new Map<number, number[]>();
  /** The window's lowest cell, the ear's cell it was flooded from, and the node it started from (local, or -1 if none). */
  private x0 = 0;
  private z0 = 0;
  private earX = -1;
  private earZ = -1;
  private earNode = -1;
  private start = -1;
  private stale = true;
  /** Floods run, for tests and the frame budget. */
  floods = 0;

  constructor(world: World) {
    this.world = world;
    this.n = Math.round(world.size / CELL);
    this.nn = this.n * this.n;
    this.cells = new Uint8Array(this.nn);
    this.groundY = new Float32Array(this.nn);
    this.tilesPerSide = Math.ceil(this.n / TILE);
    this.tiles = new Uint8Array(this.tilesPerSide * this.tilesPerSide);
    for (const c of world.colliders) {
      if (c.kind !== 'box' || !(c.walk || c.part === 'roof' || c.part === 'tiles')) continue;
      for (let iz = this.cell(c.minZ - CELL); iz <= this.cell(c.maxZ + CELL); iz++) {
        for (let ix = this.cell(c.minX - CELL); ix <= this.cell(c.maxX + CELL); ix++) this.floored.add(this.index(ix, iz));
      }
    }
    world.panels.forEach((p, id) => {
      if (p.kind !== 'glass') return;
      const i = this.index(this.cell((p.box.minX + p.box.maxX) / 2), this.cell((p.box.minZ + p.box.maxZ) / 2));
      this.floored.add(i);
      const list = this.windows.get(i);
      if (list) list.push(id);
      else this.windows.set(i, [id]);
    });
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
    // The floors' links a cell further out may cross what changed.
    for (let iz = Math.max(c - 2, 0); iz <= Math.min(d + 2, this.n - 1); iz++) {
      for (let ix = Math.max(a - 2, 0); ix <= Math.min(b + 2, this.n - 1); ix++) {
        for (const k of this.floors.get(iz * this.n + ix) ?? []) this.links.delete(k);
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
    this.floors.clear();
    this.links.clear();
    this.stale = true;
  }

  /**
   * The shortest way round from a sound at `at` to an ear at `ear`, or null
   * when it's out of reach, walled off, or the way is straight (nothing to go
   * round).
   */
  route(ear: Corner, at: Corner): Route | null {
    this.flood(ear);
    if (this.start < 0) return null;
    const sx = this.cell(at.x) - this.x0;
    const sz = this.cell(at.z) - this.z0;
    let path: Waypoint[];
    if (sx >= 0 && sz >= 0 && sx < SIDE && sz < SIDE) {
      // The sound's node, or, right against a wall, one beside it the flood reached.
      let end = this.localNode(sx, sz, at.y, SOUND_OVER);
      if (end < 0 || this.dist[end] === Infinity) {
        end = this.nearest(sx, sz, (i) => this.dist[i] < Infinity);
        if (end < 0) return null;
      }
      path = this.trace(end);
    } else {
      if (Math.hypot(at.x - ear.x, at.z - ear.z) > FAR_REACH) return null;
      const exit = this.exit(at);
      if (exit < 0) return null;
      path = this.trace(exit);
    }
    const earUp = this.start >= WINDOW;
    path[0] = { x: ear.x, y: ear.y, z: ear.z, up: earUp };
    path.push({ x: at.x, y: at.y, z: at.z, up: path[path.length - 1].up });
    // Pulled tight: each leg as far as a straight open line goes.
    const corners: Corner[] = [];
    let anchor = 0;
    while (anchor < path.length - 1) {
      let k = anchor + 1;
      while (k + 1 < path.length && this.lineOpen(path[anchor], path[k + 1])) k++;
      if (k < path.length - 1) corners.push({ x: path[k].x, y: path[k].y, z: path[k].z });
      anchor = k;
    }
    if (!corners.length) return null;
    const points: Corner[] = [path[0], ...corners, path[path.length - 1]];
    let length = 0;
    const turns: number[] = [];
    for (let i = 1; i < points.length; i++) {
      const ax = points[i].x - points[i - 1].x;
      const ay = points[i].y - points[i - 1].y;
      const az = points[i].z - points[i - 1].z;
      length += Math.hypot(ax, ay, az);
      if (i + 1 < points.length) {
        const bx = points[i + 1].x - points[i].x;
        const by = points[i + 1].y - points[i].y;
        const bz = points[i + 1].z - points[i].z;
        const cos = (ax * bx + ay * by + az * bz) / (Math.hypot(ax, ay, az) * Math.hypot(bx, by, bz) || 1);
        turns.push(Math.acos(Math.max(-1, Math.min(1, cos))));
      }
    }
    return { length, corners, turns };
  }

  /** The nodes from the ear's to local node `end`, as waypoints. */
  private trace(end: number): Waypoint[] {
    const path: Waypoint[] = [];
    for (let i = end; i >= 0; i = this.next[i]) path.push(this.waypoint(i));
    return path.reverse();
  }

  /**
   * Toward a sound beyond the window, the edge cell the flood reached whose
   * way to the ear and straight line on to the sound is shortest, with that
   * line open; or -1.
   */
  private exit(at: Corner): number {
    const best: [number, number][] = [];
    const consider = (lx: number, lz: number) => {
      const i = lz * SIDE + lx;
      if (this.dist[i] === Infinity) return;
      const cost = this.dist[i] + Math.hypot(this.center(lx + this.x0) - at.x, this.center(lz + this.z0) - at.z);
      if (best.length === EXITS && cost >= best[EXITS - 1][1]) return;
      best.push([i, cost]);
      best.sort((a, b) => a[1] - b[1]);
      if (best.length > EXITS) best.pop();
    };
    for (let k = 0; k < SIDE; k++) {
      consider(k, 0);
      consider(k, SIDE - 1);
      if (k > 0 && k < SIDE - 1) {
        consider(0, k);
        consider(SIDE - 1, k);
      }
    }
    for (const [i] of best) {
      const w = this.waypoint(i);
      if (this.lineOpen(w, { x: at.x, y: at.y, z: at.z, up: false })) return i;
    }
    return -1;
  }

  /**
   * Flood outward from the ear's node, unless that's done already from a
   * cell near enough on the same level and nothing changed. A route starts
   * from the ear itself, so a flood from a cell or two away still gives the
   * right corners.
   */
  private flood(ear: Corner): void {
    const cx = this.cell(ear.x);
    const cz = this.cell(ear.z);
    const node = this.nodeNear(cx, cz, ear.y, -EAR_OVER);
    const onFloor = node >= this.nn;
    const sameLevel = onFloor ? node === this.earNode : this.earNode < this.nn;
    if (!this.stale && sameLevel && Math.abs(cx - this.earX) < REFLOOD && Math.abs(cz - this.earZ) < REFLOOD) return;
    this.stale = false;
    this.earX = cx;
    this.earZ = cz;
    this.earNode = node;
    this.floods++;
    this.x0 = cx - FIELD_RADIUS;
    this.z0 = cz - FIELD_RADIUS;
    const n = this.n;
    const open = this.open;
    const floors = this.inWindow;
    const local = this.local;
    floors.length = 0;
    local.clear();
    this.up.clear();
    for (let lz = 0; lz < SIDE; lz++) {
      for (let lx = 0; lx < SIDE; lx++) {
        const ix = lx + this.x0;
        const iz = lz + this.z0;
        open[lz * SIDE + lx] = this.state(ix, iz) === OPEN ? 1 : 0;
        if (ix < 0 || iz < 0 || ix >= n || iz >= n || !this.floored.has(iz * n + ix)) continue;
        for (const k of this.floors.get(iz * n + ix) ?? []) {
          if (floors.length === MAX_FLOORS) break;
          local.set(k, WINDOW + floors.length);
          floors.push(k);
        }
      }
    }
    for (let j = 0; j < floors.length; j++) {
      for (const t of this.linksOf(floors[j])) {
        if (t >= this.nn) continue;
        const g = this.localGround(t);
        if (g < 0) continue;
        const list = this.up.get(g);
        if (list) list.push(WINDOW + j);
        else this.up.set(g, [WINDOW + j]);
      }
    }
    const dist = this.dist;
    const next = this.next;
    dist.fill(Infinity);
    next.fill(-1);
    // An ear right against a wall hears from the open cell beside it.
    let s = node < 0 ? -1 : onFloor ? (local.get(node - this.nn) ?? -1) : this.localGround(node);
    if (s < 0) s = this.nearest(FIELD_RADIUS, FIELD_RADIUS, (i) => open[i] === 1);
    this.start = s;
    if (s < 0) return;
    const heap = this.heap;
    heap.size = 0;
    dist[s] = 0;
    heap.push(s, 0);
    while (heap.size > 0) {
      const cur = heap.pop();
      const d = dist[cur];
      if (heap.key > d) continue;
      if (cur >= WINDOW) {
        const k = floors[cur - WINDOW];
        for (const t of this.linksOf(k)) {
          const ni = t >= this.nn ? (local.get(t - this.nn) ?? -1) : this.localGround(t);
          if (ni >= 0) this.relax(cur, ni, d + this.gap(cur, ni));
        }
        continue;
      }
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
        this.relax(cur, ni, d + (k >= 4 ? SQRT2 : 1));
      }
      for (const ni of this.up.get(cur) ?? []) this.relax(cur, ni, d + this.gap(cur, ni));
    }
  }

  private relax(from: number, to: number, d: number): void {
    if (d >= this.dist[to]) return;
    this.dist[to] = d;
    this.next[to] = from;
    this.heap.push(to, d);
  }

  /** Metres between two local nodes' points. */
  private gap(a: number, b: number): number {
    const p = this.waypoint(a);
    const q = this.waypoint(b);
    return Math.hypot(q.x - p.x, q.y - p.y, q.z - p.z);
  }

  /** A local node's point in the air. */
  private waypoint(i: number): Waypoint {
    if (i >= WINDOW) {
      const k = this.inWindow[i - WINDOW];
      return { x: this.fx[k], y: this.fy[k] + CORNER_HEIGHT, z: this.fz[k], up: true };
    }
    const ix = (i % SIDE) + this.x0;
    const iz = Math.floor(i / SIDE) + this.z0;
    return { x: this.center(ix), y: this.groundY[iz * this.n + ix] + CORNER_HEIGHT, z: this.center(iz), up: false };
  }

  /** A ground cell's local id in the window, or -1 if it's outside it or blocked. */
  private localGround(g: number): number {
    const lx = (g % this.n) - this.x0;
    const lz = Math.floor(g / this.n) - this.z0;
    if (lx < 0 || lz < 0 || lx >= SIDE || lz >= SIDE) return -1;
    const i = lz * SIDE + lx;
    return this.open[i] ? i : -1;
  }

  /** The local node at window cell (lx, lz) for something at height y, or -1. */
  private localNode(lx: number, lz: number, y: number, over: number): number {
    const node = this.nodeNear(lx + this.x0, lz + this.z0, y, over);
    if (node < 0) return -1;
    return node >= this.nn ? (this.local.get(node - this.nn) ?? -1) : this.localGround(node);
  }

  /**
   * The node in cell (ix, iz) that something at height y is on: the highest
   * floor, or the ground, no more than `over` under it (for an ear, at least
   * -`over`). The ground if nothing is; -1 if the ground is blocked too.
   */
  private nodeNear(ix: number, iz: number, y: number, over: number): number {
    if (this.state(ix, iz) === UNKNOWN) return -1;
    const i = iz * this.n + ix;
    const ground = this.cells[i] === OPEN;
    let best = ground && this.groundY[i] <= y + over ? i : -1;
    let bestH = best >= 0 ? this.groundY[i] : -Infinity;
    for (const k of this.floors.get(i) ?? []) {
      if (this.fy[k] <= y + over && this.fy[k] > bestH) (best = this.nn + k), (bestH = this.fy[k]);
    }
    return best >= 0 ? best : ground ? i : -1;
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

  /** Whether the straight line from a to b is open: over the grid on the ground, in the air when either end is up on a floor. */
  private lineOpen(a: Waypoint, b: Waypoint): boolean {
    if (a.up || b.up) return this.airOpen(a.x, a.y, a.z, b.x, b.y, b.z);
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

  /** Whether nothing solid lies on the line from a to b. */
  private airOpen(ax: number, ay: number, az: number, bx: number, by: number, bz: number): boolean {
    const dx = bx - ax;
    const dy = by - ay;
    const dz = bz - az;
    const d = Math.hypot(dx, dy, dz);
    if (d < 1e-3) return true;
    return this.world.raycast(ax, ay, az, dx / d, dy / d, dz / d, d) >= d;
  }

  /**
   * The nodes floor node `k` is joined to in its own cell and the ones
   * round it, worked out once until something there changes. Two nodes near
   * in height are joined by the straight line between them; further apart,
   * by a line up (or down) through the air over the lower one, then across.
   */
  private linksOf(k: number): number[] {
    let out = this.links.get(k);
    if (out) return out;
    out = [];
    const n = this.n;
    const cell = this.fcell[k];
    const cx = cell % n;
    const cz = Math.floor(cell / n);
    const a = { x: this.fx[k], y: this.fy[k], z: this.fz[k] };
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const ix = cx + dx;
        const iz = cz + dz;
        if (ix < 0 || iz < 0 || ix >= n || iz >= n) continue;
        if (this.state(ix, iz) === UNKNOWN) continue;
        const i = iz * n + ix;
        if (this.joined(a, { x: this.center(ix), y: this.groundY[i], z: this.center(iz) })) out.push(i);
        for (const f of this.floors.get(i) ?? []) {
          if (f !== k && this.joined(a, { x: this.fx[f], y: this.fy[f], z: this.fz[f] })) out.push(this.nn + f);
        }
      }
    }
    this.links.set(k, out);
    return out;
  }

  /** Whether sound gets between nodes standing at a and b (their floors' heights). */
  private joined(a: Corner, b: Corner): boolean {
    const [lo, hi] = a.y <= b.y ? [a, b] : [b, a];
    const y0 = lo.y + CORNER_HEIGHT;
    const y1 = hi.y + CORNER_HEIGHT;
    if (y1 - y0 <= RISE) return this.airOpen(lo.x, y0, lo.z, hi.x, y1, hi.z);
    return this.airOpen(lo.x, y0, lo.z, lo.x, y1, lo.z) && this.airOpen(lo.x, y1, lo.z, hi.x, y1, hi.z);
  }

  private cell(v: number): number {
    return Math.floor((v + this.world.half) / CELL);
  }

  private index(ix: number, iz: number): number {
    return Math.min(Math.max(iz, 0), this.n - 1) * this.n + Math.min(Math.max(ix, 0), this.n - 1);
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

  /** Open if nothing stands near the cell's middle between knee and doorway height; and any floors over it. */
  private survey(ix: number, iz: number): number {
    const w = this.world;
    const x = this.center(ix);
    const z = this.center(iz);
    const i = iz * this.n + ix;
    const y = w.groundHeight(x, z, w.floorHeight(x, z));
    this.groundY[i] = y;
    if (this.floored.has(i)) this.surveyFloors(i, x, y, z);
    return w.clear(x, y, z, HIGH, PAD, true, LOW) ? OPEN : BLOCKED;
  }

  /**
   * The nodes over cell `i`, whose middle is (x, z) and ground `ground`: one
   * for each floor or roof top well above the ground where there's room over
   * it, and one in the gap of each broken window. The cell's nodes keep
   * their ids from last time where they can.
   */
  private surveyFloors(i: number, x: number, ground: number, z: number): void {
    const w = this.world;
    const nodes: [number, number, number][] = [];
    const levels: number[] = [];
    for (const top of w.floorTops(x, z, CELL / 2, true)) {
      if (top <= ground + LEVEL_GAP * 0.5) continue;
      if (levels.length && top - levels[levels.length - 1] < LEVEL_GAP) levels[levels.length - 1] = top;
      else levels.push(top);
    }
    for (const top of levels.slice(0, MAX_LEVELS)) {
      for (const [ox, oz] of SPOTS) {
        const sx = x + ox;
        const sz = z + oz;
        if (Math.abs(w.groundHeight(sx, sz, top) - top) > LEVEL_GAP * 0.5) continue;
        if (!w.clear(sx, top, sz, HIGH, FLOOR_PAD, true, LOW)) continue;
        nodes.push([sx, top, sz]);
        break;
      }
    }
    for (const id of this.windows.get(i) ?? []) {
      const b = w.panels[id].box;
      if (b.gone) nodes.push([(b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2 - CORNER_HEIGHT, (b.minZ + b.maxZ) / 2]);
    }
    const had = this.floors.get(i) ?? [];
    const ids: number[] = [];
    nodes.forEach(([sx, sy, sz], j) => {
      let k = had[j];
      if (k === undefined) {
        k = this.fx.length;
        this.fx.push(0), this.fy.push(0), this.fz.push(0), this.fcell.push(i);
      }
      this.fx[k] = sx;
      this.fy[k] = sy;
      this.fz[k] = sz;
      this.links.delete(k);
      ids.push(k);
    });
    if (ids.length) this.floors.set(i, ids);
    else this.floors.delete(i);
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
