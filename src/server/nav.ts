import { PLAYER_HEIGHT, PLAYER_RADIUS, WATER_LEVEL } from '../shared/constants.ts';
import type { Box, World } from '../shared/world.ts';

// Where bots can walk: a 1 m grid over the island, each cell open, wet
// (walkable but slow, so paths avoid it) or blocked by something taller than a
// step. Cells are worked out a tile at a time, the first time a path needs
// them, so only the parts of the island bots actually visit cost anything.

const CELL = 1;
const TILE = 32;
const UNKNOWN = 0;
const OPEN = 1;
const WET = 2;
const BLOCKED = 3;
/** Wading is this many times the cost of walking. */
const WET_COST = 4;
/** Clearance kept from obstacles beyond the body's radius, so paths don't scrape corners. */
const MARGIN = 0.15;
/** Terrain below this counts as wet. */
const WET_BELOW = WATER_LEVEL + 0.3;
/** Above 1, A* goes greedier: slightly longer paths for far fewer cells searched. */
const HEURISTIC_WEIGHT = 1.4;
/** Cells a search may expand before settling for the closest cell it reached. */
const MAX_EXPANSIONS = 30000;
/** How far a blocked start or goal is moved to the nearest walkable cell. */
const SNAP_RADIUS = 6;
const SQRT2 = Math.SQRT2;
/** 8-connected neighbours: x step, z step. */
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

export interface Waypoint {
  x: number;
  z: number;
}

export class NavGrid {
  readonly world: World;
  /** Cells per side. */
  readonly n: number;
  private readonly cells: Uint8Array;
  private readonly tiles: Uint8Array;
  private readonly tilesPerSide: number;
  // A* scratch, reused between searches; `gen` marks which entries are current.
  private g: Float32Array | null = null;
  private parent: Int32Array | null = null;
  private seen: Uint32Array | null = null;
  private closed: Uint32Array | null = null;
  private gen = 0;
  /** Searches run so far, for budgeting and tests. */
  searches = 0;

  constructor(world: World) {
    this.world = world;
    this.n = Math.round(world.size / CELL);
    this.cells = new Uint8Array(this.n * this.n);
    this.tilesPerSide = Math.ceil(this.n / TILE);
    this.tiles = new Uint8Array(this.tilesPerSide * this.tilesPerSide);
  }

  /** Something in the box changed, such as cover breaking: survey the cells around it again. */
  refresh(box: Box): void {
    const pad = PLAYER_RADIUS + MARGIN + CELL;
    const x0 = Math.max(this.cellX(box.minX - pad), 0);
    const x1 = Math.min(this.cellX(box.maxX + pad), this.n - 1);
    const z0 = Math.max(this.cellX(box.minZ - pad), 0);
    const z1 = Math.min(this.cellX(box.maxZ + pad), this.n - 1);
    for (let iz = z0; iz <= z1; iz++) {
      for (let ix = x0; ix <= x1; ix++) {
        // Cells not surveyed yet will see the change when they are.
        const i = iz * this.n + ix;
        if (this.cells[i] !== UNKNOWN) this.cells[i] = this.survey(ix, iz);
      }
    }
  }

  /** Whether a body can stand at (x, z), wading included. */
  walkable(x: number, z: number): boolean {
    return this.state(this.cellX(x), this.cellX(z)) !== BLOCKED;
  }

  /** Whether (x, z) is walkable and dry. */
  dry(x: number, z: number): boolean {
    return this.state(this.cellX(x), this.cellX(z)) === OPEN;
  }

  /** The centre of the nearest walkable cell within `radius` metres, preferring dry ones. */
  nearestWalkable(x: number, z: number, radius = SNAP_RADIUS): Waypoint | null {
    const cx = this.cellX(x);
    const cz = this.cellX(z);
    const r = Math.ceil(radius / CELL);
    let best: Waypoint | null = null;
    let bestD = Infinity;
    for (let ring = 0; ring <= r; ring++) {
      for (let iz = cz - ring; iz <= cz + ring; iz++) {
        for (let ix = cx - ring; ix <= cx + ring; ix++) {
          if (Math.max(Math.abs(ix - cx), Math.abs(iz - cz)) !== ring) continue;
          const s = this.state(ix, iz);
          if (s === BLOCKED) continue;
          const wx = this.center(ix);
          const wz = this.center(iz);
          const d = Math.hypot(wx - x, wz - z) + (s === WET ? radius : 0);
          if (d < bestD) (best = { x: wx, z: wz }), (bestD = d);
        }
      }
      // A cell in a later ring is at least `ring` cells away.
      if (best && bestD <= ring * CELL) break;
    }
    return best;
  }

  /** Whether a body can walk the straight line from a to b without meeting anything or wading. */
  lineWalkable(ax: number, az: number, bx: number, bz: number): boolean {
    const d = Math.hypot(bx - ax, bz - az);
    const steps = Math.max(1, Math.ceil(d / (CELL * 0.25)));
    let last = -1;
    for (let i = 0; i <= steps; i++) {
      const f = i / steps;
      const ix = this.cellX(ax + (bx - ax) * f);
      const iz = this.cellX(az + (bz - az) * f);
      const key = iz * this.n + ix;
      if (key === last) continue;
      last = key;
      if (this.state(ix, iz) !== OPEN) return false;
    }
    return true;
  }

  /**
   * A walkable route from (sx, sz) toward (gx, gz) as waypoints after the
   * start, smoothed so each leg is a straight walkable line. If the goal is
   * too far to reach within the search budget, the route ends at the closest
   * point reached; walking it and searching again gets there. Null if the
   * goal has nowhere walkable near it.
   */
  findPath(sx: number, sz: number, gx: number, gz: number): Waypoint[] | null {
    this.searches++;
    const start = this.dry(sx, sz) ? { x: sx, z: sz } : this.nearestWalkable(sx, sz);
    const goal = this.walkable(gx, gz) ? { x: gx, z: gz } : this.nearestWalkable(gx, gz);
    if (!start || !goal) return null;
    if (this.lineWalkable(start.x, start.z, goal.x, goal.z)) return [goal];

    const n = this.n;
    const size = n * n;
    if (!this.g) {
      this.g = new Float32Array(size);
      this.parent = new Int32Array(size);
      this.seen = new Uint32Array(size);
      this.closed = new Uint32Array(size);
    }
    const g = this.g;
    const parent = this.parent!;
    const seen = this.seen!;
    const closed = this.closed!;
    const gen = ++this.gen;

    const s0x = this.cellX(start.x);
    const s0z = this.cellX(start.z);
    const tx = this.cellX(goal.x);
    const tz = this.cellX(goal.z);
    const target = tz * n + tx;
    const h = (ix: number, iz: number) => {
      const ddx = Math.abs(ix - tx);
      const ddz = Math.abs(iz - tz);
      return (ddx + ddz + (SQRT2 - 2) * Math.min(ddx, ddz)) * HEURISTIC_WEIGHT;
    };

    const heap = new MinHeap();
    const s0 = s0z * n + s0x;
    g[s0] = 0;
    parent[s0] = -1;
    seen[s0] = gen;
    heap.push(s0, h(s0x, s0z));
    let closest = s0;
    let closestH = h(s0x, s0z);
    let expanded = 0;
    let found = false;

    while (heap.size > 0 && expanded < MAX_EXPANSIONS) {
      const cur = heap.pop();
      if (closed[cur] === gen) continue;
      closed[cur] = gen;
      expanded++;
      if (cur === target) {
        found = true;
        break;
      }
      const cx = cur % n;
      const cz = (cur - cx) / n;
      const ch = h(cx, cz);
      if (ch < closestH) (closest = cur), (closestH = ch);
      for (let k = 0; k < 8; k++) {
        const [ddx, ddz] = DIRS[k];
        const nx = cx + ddx;
        const nz = cz + ddz;
        const s = this.state(nx, nz);
        if (s === BLOCKED) continue;
        // No cutting corners past a blocked cell.
        if (k >= 4 && (this.state(cx + ddx, cz) === BLOCKED || this.state(cx, cz + ddz) === BLOCKED)) continue;
        const ni = nz * n + nx;
        if (closed[ni] === gen) continue;
        const cost = g[cur] + (k >= 4 ? SQRT2 : 1) * (s === WET ? WET_COST : 1);
        if (seen[ni] === gen && cost >= g[ni]) continue;
        seen[ni] = gen;
        g[ni] = cost;
        parent[ni] = cur;
        heap.push(ni, cost + h(nx, nz));
      }
    }

    const end = found ? target : closest;
    const cells: Waypoint[] = [];
    for (let i = end; i !== -1; i = parent[i]) cells.push({ x: this.center(i % n), z: this.center(Math.floor(i / n)) });
    cells.reverse();
    if (found) cells[cells.length - 1] = goal;
    else if (cells.length <= 1) return null;
    cells[0] = start;
    return this.smooth(cells);
  }

  /** Drop waypoints that a straight walkable line can skip; the start is left out. */
  private smooth(points: Waypoint[]): Waypoint[] {
    const out: Waypoint[] = [];
    let anchor = 0;
    while (anchor < points.length - 1) {
      let next = anchor + 1;
      for (let k = anchor + 2; k < points.length; k++) {
        if (!this.lineWalkable(points[anchor].x, points[anchor].z, points[k].x, points[k].z)) break;
        next = k;
      }
      out.push(points[next]);
      anchor = next;
    }
    return out;
  }

  private cellX(v: number): number {
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

  private survey(ix: number, iz: number): number {
    const w = this.world;
    const x = this.center(ix);
    const z = this.center(iz);
    const y = w.groundHeight(x, z, w.floorHeight(x, z));
    if (!w.clear(x, y, z, PLAYER_HEIGHT, PLAYER_RADIUS + MARGIN)) return BLOCKED;
    return w.terrainHeight(x, z) < WET_BELOW ? WET : OPEN;
  }
}

/** Binary min-heap of cell indices keyed by priority. */
class MinHeap {
  private readonly items: number[] = [];
  private readonly keys: number[] = [];

  get size(): number {
    return this.items.length;
  }

  push(item: number, key: number): void {
    const items = this.items;
    const keys = this.keys;
    let i = items.length;
    items.push(item);
    keys.push(key);
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
    const lastItem = items.pop()!;
    const lastKey = keys.pop()!;
    const n = items.length;
    if (n > 0) {
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
    }
    return top;
  }
}
