import { PLAYER_HEIGHT, PLAYER_RADIUS, STEP_HEIGHT, WATER_LEVEL } from '../shared/constants.ts';
import { vegetationOf } from '../shared/vegetation.ts';
import { leafRect, type Box, type World } from '../shared/world.ts';

// Where bots can walk: a 1 m grid over the island, each cell open, wet
// (walkable but slow, so paths avoid it) or blocked by something taller than a
// step. Cells are worked out a tile at a time, the first time a path needs
// them, so only the parts of the island bots actually visit cost anything.
//
// Over the ground there can be floors: stairs, an upper storey, a watchtower's
// platform. A cell under or on one has up to MAX_LEVELS more places to stand,
// one per floor, each a node of its own at the spot in the cell where a body
// fits. Whether a body gets from one of these to a node next door is found by
// walking the line between them as the game would, stepping up and down.

const CELL = 1;
const TILE = 32;
const UNKNOWN = 0;
const OPEN = 1;
const WET = 2;
const BLOCKED = 3;
/** Wading is this many times the cost of walking. */
const WET_COST = 4;
/** For a bot sneaking, ground without bushes or tall grass is this many times the cost of walking. */
const BARE_COST = 1.7;
/** Clearance kept from obstacles beyond the body's radius, so paths don't scrape corners. */
const MARGIN = 0.15;
/** Obstacles this far above the feet or less are stepped onto, not walked round. */
const STEP_UP = STEP_HEIGHT * 0.95;
/** Terrain below this counts as wet. */
const WET_BELOW = WATER_LEVEL + 0.3;
/** Above 1, A* goes greedier: slightly longer paths for far fewer cells searched. */
const HEURISTIC_WEIGHT = 1.4;
/** Cells a search may expand before settling for the closest cell it reached. */
const MAX_EXPANSIONS = 30000;
/** How far a blocked start or goal is moved to the nearest walkable cell. */
const SNAP_RADIUS = 6;
const SQRT2 = Math.SQRT2;
/** 8-connected neighbours: x step, z step. Then the cell itself, whose nodes on stairs are a step apart. */
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1], [0, 0]];
const SAME = 8;
/** Floors a cell can have over its ground, and the most there can be on the island. */
const MAX_LEVELS = 3;
const MAX_FLOOR_NODES = 1 << 16;
/**
 * A floor node stands where a body fits this close to anything in the way,
 * and a walk between nodes keeps this far off: tighter than the ground's, for
 * narrow stairs, but as far as the game pushes a body off what it meets.
 */
const FLOOR_PAD = PLAYER_RADIUS;
/** Where in a cell a floor node's spot is looked for, from its middle: the middle first. */
const SPOTS = [[0, 0], [0.3, 0], [-0.3, 0], [0, 0.3], [0, -0.3], [0.3, 0.3], [-0.3, 0.3], [0.3, -0.3], [-0.3, -0.3]];
/** Two floor nodes in one cell are at least this far apart in height. */
const LEVEL_GAP = 0.3;
/** How far apart the checks along a walk between two nodes are, and the deepest drop a walk may take. */
const WALK_STEP = 0.15;
const MAX_DROP = 1.2;
/** A walk keeps this far from an edge dropping more than a step to either side of it: a stair's open side. */
const EDGE = 0.3;
const EDGE_DROP = STEP_UP;
/** How near in height a walk has to end to the node it's going to. */
const LANDED = 0.1;
/**
 * A height asked for, such as someone's feet or where a shot was heard from,
 * is on the floor it's at most ABOVE under, or BELOW over: the highest such.
 */
const ABOVE = 0.6;
const BELOW = 2.5;

function onLevel(h: number, y: number): boolean {
  return h <= y + ABOVE && h >= y - BELOW;
}
/** Links worked out between nodes: not yet, linked, or not. */
const LINK_YES = 1;
const LINK_NO = 2;

export interface Waypoint {
  x: number;
  z: number;
  /** Height to stand at, for a spot up on a floor or a step; left out on the ground. */
  y?: number;
}

/** A body is at a waypoint this close to it, at its height; or this close whatever the height, where it can't do better. */
const REACHED = 0.6;
const ON_TOP = 0.2;
const LEVEL = 0.3;

/** Whether a body walking a path with its feet at (x, y, z) has reached waypoint `p` and can go on to the next. */
export function reached(p: Waypoint, x: number, y: number, z: number): boolean {
  const d = Math.hypot(p.x - x, p.z - z);
  return d < ON_TOP || (d < REACHED && (p.y === undefined || Math.abs(p.y - y) < LEVEL));
}

export class NavGrid {
  readonly world: World;
  /** Cells per side. */
  readonly n: number;
  private readonly cells: Uint8Array;
  private readonly tiles: Uint8Array;
  private readonly tilesPerSide: number;
  /** Each surveyed cell's ground height at its middle. */
  private readonly groundY: Float32Array;
  /** Cells that a floor reaches over, found once: only these are looked at for floors. */
  private readonly floored = new Set<number>();
  /** The door leaves that come near each cell when open. */
  private readonly leaves = new Map<number, number[]>();
  /** The floor nodes of each cell that has any, lowest first, by id. */
  private readonly floors = new Map<number, number[]>();
  /** Each floor node's spot and cell, by its id less n². */
  private readonly fx: number[] = [];
  private readonly fy: number[] = [];
  private readonly fz: number[] = [];
  private readonly fcell: number[] = [];
  /**
   * Links worked out from a node to a node next door, by the tile of the
   * node's cell, then by (node, direction, which of that cell's nodes).
   */
  private readonly links = new Map<number, Map<number, number>>();
  // A* scratch, reused between searches; `gen` marks which entries are current.
  private g: Float32Array | null = null;
  private parent: Int32Array | null = null;
  private seen: Uint32Array | null = null;
  private closed: Uint32Array | null = null;
  private gen = 0;
  /** Whether each ground cell asked about gives someone sneaking cover. */
  private readonly coverCells = new Map<number, boolean>();
  /** Searches run so far, for budgeting and tests. */
  searches = 0;

  constructor(world: World) {
    this.world = world;
    this.n = Math.round(world.size / CELL);
    this.cells = new Uint8Array(this.n * this.n);
    this.groundY = new Float32Array(this.n * this.n);
    this.tilesPerSide = Math.ceil(this.n / TILE);
    this.tiles = new Uint8Array(this.tilesPerSide * this.tilesPerSide);
    const cells = (x0: number, z0: number, x1: number, z1: number, pad: number, each: (cell: number) => void) => {
      for (let iz = this.cellX(z0 - pad); iz <= this.cellX(z1 + pad); iz++) {
        for (let ix = this.cellX(x0 - pad); ix <= this.cellX(x1 + pad); ix++) {
          if (ix >= 0 && iz >= 0 && ix < this.n && iz < this.n) each(iz * this.n + ix);
        }
      }
    };
    for (const c of world.colliders) {
      if (c.kind === 'box' && c.walk) cells(c.minX, c.minZ, c.maxX, c.maxZ, CELL, (i) => this.floored.add(i));
    }
    world.doors.forEach((d, id) => {
      const [x0, z0, x1, z1] = leafRect(d, true);
      cells(x0, z0, x1, z1, PLAYER_RADIUS + MARGIN + CELL, (i) => {
        const list = this.leaves.get(i);
        if (list) list.push(id);
        else this.leaves.set(i, [id]);
      });
    });
  }

  /**
   * Whether a door leaf, standing open, comes within `pad` of (x, z) at a
   * body's height with its feet at `feet`. Paths go through doorways as if
   * every door stood open, and bots open the shut ones on the way: so the
   * leaves count where they'd be open, lining the doorway, and not shut.
   */
  private nearLeaf(i: number, x: number, feet: number, z: number, pad: number): boolean {
    for (const id of this.leaves.get(i) ?? []) {
      const d = this.world.doors[id];
      if (this.world.panels[d.panel].box.gone || feet > d.y1 || feet + PLAYER_HEIGHT < d.y0) continue;
      const [x0, z0, x1, z1] = leafRect(d, true);
      if (x > x0 - pad && x < x1 + pad && z > z0 - pad && z < z1 + pad) return true;
    }
    return false;
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
    // Links from a cell next to these may lead into them.
    for (let tz = Math.floor(Math.max(z0 - 1, 0) / TILE); tz <= Math.floor(Math.min(z1 + 1, this.n - 1) / TILE); tz++) {
      for (let tx = Math.floor(Math.max(x0 - 1, 0) / TILE); tx <= Math.floor(Math.min(x1 + 1, this.n - 1) / TILE); tx++) this.links.delete(tz * this.tilesPerSide + tx);
    }
  }

  /** Whether a body can stand at (x, z) on the ground, wading included. */
  walkable(x: number, z: number): boolean {
    return this.state(this.cellX(x), this.cellX(z)) !== BLOCKED;
  }

  /** Whether (x, z) is walkable and dry, on the ground. */
  dry(x: number, z: number): boolean {
    return this.state(this.cellX(x), this.cellX(z)) === OPEN;
  }

  /** Whether a body can stand dry at (x, z) at about height y: on the ground or on a floor. */
  stands(x: number, y: number, z: number): boolean {
    const id = this.nodeAt(x, z, y);
    return id >= 0 && (id >= this.n * this.n || this.cells[id] === OPEN);
  }

  /**
   * The nearest walkable spot within `radius` metres, preferring dry ones: a
   * cell's middle on the ground, or with `y`, the spot nearest that height.
   */
  nearestWalkable(x: number, z: number, radius = SNAP_RADIUS, y?: number): Waypoint | null {
    const id = this.nearestNode(x, z, radius, y);
    return id < 0 ? null : this.waypoint(id);
  }

  /** Whether a body can walk the straight line from a to b on the ground without meeting anything or wading. */
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
   * start, smoothed so each leg on the ground is a straight walkable line.
   * With heights, the start and goal are the places nearest them, up on a
   * floor if that's nearer. If the goal is too far to reach within the search
   * budget, the route ends at the closest point reached; walking it and
   * searching again gets there. Null if the goal has nowhere walkable near it.
   * With `hidden`, it goes through bushes and tall grass where it can, as a bot sneaking does.
   */
  findPath(sx: number, sz: number, gx: number, gz: number, sy?: number, gy?: number, hidden = false): Waypoint[] | null {
    this.searches++;
    const n = this.n;
    const size = n * n;
    let s0 = this.nodeAt(sx, sz, sy);
    if (s0 < 0 || (s0 < size && this.cells[s0] !== OPEN)) s0 = this.nearestNode(sx, sz, SNAP_RADIUS, sy);
    let target = this.nodeAt(gx, gz, gy);
    if (target < 0) target = this.nearestNode(gx, gz, SNAP_RADIUS, gy);
    if (s0 < 0 || target < 0) return null;
    const start = s0 === this.nodeAt(sx, sz, sy) ? { x: sx, z: sz, ...this.height(s0) } : this.waypoint(s0);
    const goal = target === this.nodeAt(gx, gz, gy) ? { x: gx, z: gz, ...this.height(target) } : this.waypoint(target);
    const cost = (cell: number, s: number) => (s === WET ? WET_COST : 1) * (hidden && !this.covered(cell) ? BARE_COST : 1);
    if (s0 < size && target < size && this.lineWalkable(start.x, start.z, goal.x, goal.z) &&
      !(hidden && this.lineBare(start.x, start.z, goal.x, goal.z) > 0)) return [goal];

    if (!this.g) {
      const all = size + MAX_FLOOR_NODES;
      this.g = new Float32Array(all);
      this.parent = new Int32Array(all);
      this.seen = new Uint32Array(all);
      this.closed = new Uint32Array(all);
    }
    const g = this.g;
    const parent = this.parent!;
    const seen = this.seen!;
    const closed = this.closed!;
    const gen = ++this.gen;

    const tcell = this.cellOf(target);
    const tx = tcell % n;
    const tz = (tcell - tx) / n;
    const h = (ix: number, iz: number) => {
      const ddx = Math.abs(ix - tx);
      const ddz = Math.abs(iz - tz);
      return (ddx + ddz + (SQRT2 - 2) * Math.min(ddx, ddz)) * HEURISTIC_WEIGHT;
    };

    const heap = new MinHeap();
    g[s0] = 0;
    parent[s0] = -1;
    seen[s0] = gen;
    const scell = this.cellOf(s0);
    heap.push(s0, h(scell % n, Math.floor(scell / n)));
    let closest = s0;
    let closestH = h(scell % n, Math.floor(scell / n));
    let expanded = 0;
    let found = false;

    const visit = (cur: number, ni: number, cost: number, nx: number, nz: number) => {
      if (closed[ni] === gen) return;
      if (seen[ni] === gen && cost >= g[ni]) return;
      seen[ni] = gen;
      g[ni] = cost;
      parent[ni] = cur;
      heap.push(ni, cost + h(nx, nz));
    };

    while (heap.size > 0 && expanded < MAX_EXPANSIONS) {
      const cur = heap.pop();
      if (closed[cur] === gen) continue;
      closed[cur] = gen;
      expanded++;
      if (cur === target) {
        found = true;
        break;
      }
      const ccell = this.cellOf(cur);
      const cx = ccell % n;
      const cz = (ccell - cx) / n;
      const ch = h(cx, cz);
      if (ch < closestH) (closest = cur), (closestH = ch);
      const onGround = cur < size;
      for (let k = 0; k <= SAME; k++) {
        const [ddx, ddz] = DIRS[k];
        const nx = cx + ddx;
        const nz = cz + ddz;
        if (nx < 0 || nz < 0 || nx >= n || nz >= n) continue;
        const s = this.state(nx, nz);
        const ni = nz * n + nx;
        const step = k === SAME ? 0.5 : k >= 4 ? SQRT2 : 1;
        if (s !== BLOCKED && ni !== cur) {
          // Near a floor, the ground can be a stair's step: those are walked too.
          if (onGround && k !== SAME && !this.floored.has(cur) && !this.floored.has(ni)) {
            // No cutting corners past a blocked cell.
            if (k < 4 || (this.state(cx + ddx, cz) !== BLOCKED && this.state(cx, cz + ddz) !== BLOCKED)) {
              visit(cur, ni, g[cur] + step * cost(ni, s), nx, nz);
            }
          } else if (this.linked(cur, k, 0, ni)) visit(cur, ni, g[cur] + step * cost(ni, s), nx, nz);
        }
        const up = this.floors.get(ni);
        if (up) up.forEach((f, j) => f !== cur && this.linked(cur, k, j + 1, f) && visit(cur, f, g[cur] + step, nx, nz));
      }
    }

    const end = found ? target : closest;
    const nodes: number[] = [];
    for (let i = end; i !== -1; i = parent[i]) nodes.push(i);
    nodes.reverse();
    const points = nodes.map((i) => this.waypoint(i));
    if (found) points[points.length - 1] = goal;
    else if (points.length <= 1) return null;
    points[0] = start;
    return this.smooth(points, hidden);
  }

  /** Whether a cell's ground gives someone sneaking through it cover. */
  private covered(cell: number): boolean {
    let v = this.coverCells.get(cell);
    if (v === undefined) {
      const x = ((cell % this.n) + 0.5) * CELL - this.world.half;
      const z = (Math.floor(cell / this.n) + 0.5) * CELL - this.world.half;
      v = vegetationOf(this.world).cover(x, z);
      this.coverCells.set(cell, v);
    }
    return v;
  }

  /** Cells without cover the straight line from a to b on the ground crosses, a's own left out. */
  private lineBare(ax: number, az: number, bx: number, bz: number): number {
    const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / CELL));
    let bare = 0;
    for (let i = 1; i <= steps; i++) {
      const f = i / steps;
      const ix = this.cellX(ax + (bx - ax) * f);
      const iz = this.cellX(az + (bz - az) * f);
      if (ix >= 0 && iz >= 0 && ix < this.n && iz < this.n && !this.covered(iz * this.n + ix)) bare++;
    }
    return bare;
  }

  /**
   * Drop waypoints on the ground that a straight walkable line can skip; the
   * start is left out. With `hidden`, not by a line over more bare ground
   * than the route took.
   */
  private smooth(points: Waypoint[], hidden = false): Waypoint[] {
    const out: Waypoint[] = [];
    // Bare cells along the route up to each point.
    const bareTo = [0];
    if (hidden) for (let i = 1; i < points.length; i++) bareTo.push(bareTo[i - 1] + this.lineBare(points[i - 1].x, points[i - 1].z, points[i].x, points[i].z));
    let anchor = 0;
    while (anchor < points.length - 1) {
      let next = anchor + 1;
      if (points[anchor].y === undefined) {
        for (let k = anchor + 2; k < points.length; k++) {
          if (points[k - 1].y !== undefined || points[k].y !== undefined) break;
          if (!this.lineWalkable(points[anchor].x, points[anchor].z, points[k].x, points[k].z)) break;
          if (hidden && this.lineBare(points[anchor].x, points[anchor].z, points[k].x, points[k].z) > bareTo[k] - bareTo[anchor]) break;
          next = k;
        }
      }
      out.push(points[next]);
      anchor = next;
    }
    return out;
  }

  /**
   * The node at (x, z): its ground, or given a height, the highest of its
   * ground and floors on that level. -1 if there's none, or without a
   * height, if the ground is blocked.
   */
  private nodeAt(x: number, z: number, y?: number): number {
    const ix = this.cellX(x);
    const iz = this.cellX(z);
    const s = this.state(ix, iz);
    const cell = iz * this.n + ix;
    if (y === undefined) return s === BLOCKED ? -1 : cell;
    let best = -1;
    let bestH = -Infinity;
    if (s !== BLOCKED && onLevel(this.groundY[cell], y)) (best = cell), (bestH = this.groundY[cell]);
    for (const f of this.floors.get(cell) ?? []) {
      const h = this.fy[f - this.n * this.n];
      if (h > bestH && onLevel(h, y)) (best = f), (bestH = h);
    }
    return best;
  }

  /** The node nearest (x, z) within `radius` metres, preferring dry ones, and with `y`, those on that level; or -1. */
  private nearestNode(x: number, z: number, radius: number, y?: number): number {
    const cx = this.cellX(x);
    const cz = this.cellX(z);
    const r = Math.ceil(radius / CELL);
    let best = -1;
    let bestD = Infinity;
    for (let ring = 0; ring <= r; ring++) {
      for (let iz = cz - ring; iz <= cz + ring; iz++) {
        for (let ix = cx - ring; ix <= cx + ring; ix++) {
          if (Math.max(Math.abs(ix - cx), Math.abs(iz - cz)) !== ring) continue;
          const s = this.state(ix, iz);
          const cell = iz * this.n + ix;
          if (s !== BLOCKED && (y === undefined || onLevel(this.groundY[cell], y))) {
            const d = Math.hypot(this.center(ix) - x, this.center(iz) - z) + (s === WET ? radius : 0);
            if (d < bestD) (best = cell), (bestD = d);
          }
          if (y === undefined) continue;
          for (const f of this.floors.get(cell) ?? []) {
            const k = f - this.n * this.n;
            if (!onLevel(this.fy[k], y)) continue;
            const d = Math.hypot(this.fx[k] - x, this.fz[k] - z);
            if (d < bestD) (best = f), (bestD = d);
          }
        }
      }
      // A cell in a later ring is at least `ring` cells away.
      if (best >= 0 && bestD <= ring * CELL) break;
    }
    // Nothing near that height: anywhere on the ground will do.
    return best < 0 && y !== undefined ? this.nearestNode(x, z, radius) : best;
  }

  /** Whether a body gets from node `from` to `to`, in the cell next door in direction k, where `to` is that cell's j-th node. */
  private linked(from: number, k: number, j: number, to: number): boolean {
    const key = (from * DIRS.length + k) * (MAX_LEVELS + 1) + j;
    const cell = this.cellOf(from);
    const tile = Math.floor(Math.floor(cell / this.n) / TILE) * this.tilesPerSide + Math.floor((cell % this.n) / TILE);
    let links = this.links.get(tile);
    if (!links) this.links.set(tile, (links = new Map()));
    let v = links.get(key);
    if (v === undefined) {
      const a = this.waypoint(from);
      const b = this.waypoint(to);
      const ay = a.y ?? this.groundY[from];
      const by = b.y ?? this.groundY[to];
      v = this.walks(a.x, ay, a.z, b.x, by, b.z) ? LINK_YES : LINK_NO;
      links.set(key, v);
    }
    return v === LINK_YES;
  }

  /**
   * Whether a body walking the straight line from (ax, ay, az) to (bx, bz)
   * gets there standing at `by`: stepping up and down as it goes, never
   * dropping far or meeting anything in the way. As in the game, it meets
   * what's ahead before its feet rise onto anything there.
   */
  private walks(ax: number, ay: number, az: number, bx: number, by: number, bz: number): boolean {
    const w = this.world;
    const len = Math.hypot(bx - ax, bz - az);
    const steps = Math.max(1, Math.ceil(len / WALK_STEP));
    // Across the way, to either side.
    const sx = len > 0 ? -(bz - az) / len * EDGE : 0;
    const sz = len > 0 ? (bx - ax) / len * EDGE : 0;
    let feet = ay;
    for (let i = 1; i <= steps; i++) {
      const f = i / steps;
      const x = ax + (bx - ax) * f;
      const z = az + (bz - az) * f;
      if (!w.clear(x, feet, z, PLAYER_HEIGHT, FLOOR_PAD, false, STEP_UP)) return false;
      if (this.nearLeaf(this.cellX(z) * this.n + this.cellX(x), x, feet, z, FLOOR_PAD)) return false;
      const next = w.groundHeight(x, z, feet);
      if (next < feet - MAX_DROP) return false;
      feet = next;
      // Not along an edge, where a body carried a little wide would drop off.
      if (w.groundHeight(x + sx, z + sz, feet) < feet - EDGE_DROP || w.groundHeight(x - sx, z - sz, feet) < feet - EDGE_DROP) return false;
    }
    return Math.abs(feet - by) < LANDED && w.clear(bx, feet, bz, PLAYER_HEIGHT, FLOOR_PAD, false, STEP_UP);
  }

  /**
   * Where a node is, as a waypoint: a ground cell's middle, or a floor node's
   * spot and height. Near a floor, a cell whose ground is a step up, such as a
   * stair's bottom step, has its height too, so it's reached only once on it.
   */
  private waypoint(id: number): Waypoint {
    const size = this.n * this.n;
    if (id < size) {
      const x = this.center(id % this.n);
      const z = this.center(Math.floor(id / this.n));
      const y = this.groundY[id];
      return this.floored.has(id) && y - this.world.floorHeight(x, z) > LEVEL ? { x, y, z } : { x, z };
    }
    const k = id - size;
    return { x: this.fx[k], y: this.fy[k], z: this.fz[k] };
  }

  /** A floor node's height, to go with a point in its cell; nothing for the ground. */
  private height(id: number): { y?: number } {
    return id < this.n * this.n ? {} : { y: this.fy[id - this.n * this.n] };
  }

  private cellOf(id: number): number {
    const size = this.n * this.n;
    return id < size ? id : this.fcell[id - size];
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

  /** Work out a cell's ground, and any floors over it. */
  private survey(ix: number, iz: number): number {
    const w = this.world;
    const x = this.center(ix);
    const z = this.center(iz);
    const i = iz * this.n + ix;
    const floored = this.floored.has(i);
    // Near a floor, where the feet settle, as on the boundary between two steps.
    const y = floored ? this.settle(x, w.floorHeight(x, z), z) : w.groundHeight(x, z, w.floorHeight(x, z));
    this.groundY[i] = y;
    // Door leaves are left out: bots open a shut door on their way through.
    // So is anything low enough to step up onto, such as a raised floor's edge.
    const pad = PLAYER_RADIUS + MARGIN;
    const state = !w.clear(x, y, z, PLAYER_HEIGHT, pad, false, STEP_UP) || this.nearLeaf(i, x, y, z, pad) ? BLOCKED
      : w.terrainHeight(x, z) < WET_BELOW ? WET : OPEN;
    if (floored) this.surveyFloors(i, x, state === BLOCKED ? -Infinity : y, z);
    return state;
  }

  /** Where a body's feet settle at (x, z) from `feet`, as the game lifts them onto whatever is a step higher under them. */
  private settle(x: number, feet: number, z: number): number {
    for (let k = 0; k < 4; k++) {
      const next = this.world.groundHeight(x, z, feet);
      if (next === feet) break;
      feet = next;
    }
    return feet;
  }

  /**
   * The places to stand up on the floors over cell `i`, whose middle is (x, z)
   * and ground `ground` (-Infinity if it's blocked): for each floor top a step
   * above the ground, the first spot in the cell where a body stands on it and
   * fits. The cell's nodes keep their ids from last time where they can.
   */
  private surveyFloors(i: number, x: number, ground: number, z: number): void {
    const w = this.world;
    const had = this.floors.get(i) ?? [];
    const spots: [number, number, number][] = [];
    for (const top of w.floorTops(x, z, CELL / 2)) {
      if (spots.length >= MAX_LEVELS) break;
      if (top <= ground + STEP_UP) continue;
      for (const [ox, oz] of SPOTS) {
        const sx = x + ox;
        const sz = z + oz;
        const sy = this.settle(sx, top, sz);
        if (Math.abs(sy - top) > 0.01) continue;
        if (sy - ground < LEVEL_GAP || spots.some((s) => Math.abs(s[1] - sy) < LEVEL_GAP)) continue;
        if (!w.clear(sx, sy, sz, PLAYER_HEIGHT, FLOOR_PAD, false, STEP_UP)) continue;
        spots.push([sx, sy, sz]);
        break;
      }
    }
    const ids: number[] = [];
    spots.forEach(([sx, sy, sz], j) => {
      let id = had[j];
      if (id === undefined) {
        if (this.fx.length >= MAX_FLOOR_NODES) return;
        id = this.n * this.n + this.fx.length;
        this.fx.push(0), this.fy.push(0), this.fz.push(0), this.fcell.push(i);
      }
      const k = id - this.n * this.n;
      this.fx[k] = sx;
      this.fy[k] = sy;
      this.fz[k] = sz;
      ids.push(id);
    });
    if (ids.length) this.floors.set(i, ids);
    else this.floors.delete(i);
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
