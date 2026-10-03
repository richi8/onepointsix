import type { Plan, Rect, Town, TownStyle } from './world.ts';

// How Deathmatch's towns are laid out: blocks of buildings with streets
// between, each building facing its street with a back yard behind it, low
// garden walls round the yards and narrow alleys behind them, and an open
// place in each town. Everything is axis-aligned, as the world's boxes are,
// and worked out in a frame of the town's own: `a` across it one way and `b`
// the other, which for the harbour points out to sea and for the village up
// its slope. Only the plan is made here; the world builds it.

/** A building's size: `L` along its length and `D` deep, and an L's wing (`W` wide, jutting `E` out in front). */
export interface Spec {
  plan: Plan;
  L: number;
  D: number;
  W: number;
  E: number;
}

/** A plan's size, drawn from `rng`. */
export function specFor(plan: Plan, rng: () => number): Spec {
  switch (plan) {
    case 'one':
      return { plan, L: 6 + rng(), D: 4.8 + rng() * 0.6, W: 0, E: 0 };
    case 'two':
      return { plan, L: 10 + rng() * 1.5, D: 6.5 + rng(), W: 0, E: 0 };
    case 'ell': {
      const E = 3.6 + rng() * 0.6;
      return { plan, L: 9.5 + rng(), D: 6 + rng() * 0.6 + E, W: 4.4 + rng() * 0.4, E };
    }
    case 'tall':
      return { plan, L: 7.4 + rng() * 0.8, D: 6 + rng() * 0.5, W: 0, E: 0 };
  }
}

/** Which way a building's front, with its door, faces. */
export type Facing = '-x' | '+x' | '-z' | '+z';

export interface TownHouse {
  spec: Spec;
  /** Its footprint. */
  rect: Rect;
  facing: Facing;
  /** Whether its plan runs the other way along the street. */
  flipU: boolean;
  floor: number;
  crates: number;
}

/** A box standing on the ground: its footprint, bottom and top. */
export interface TownBox {
  r: Rect;
  y0: number;
  y1: number;
}

export interface TownPlan {
  houses: TownHouse[];
  /** Garden walls round the yards. */
  walls: TownBox[];
  /** Solid blocks the ground steps down from, their tops flush with it: the terraces' retaining walls and the quay. */
  blocks: TownBox[];
  containers: (TownBox & { tint: number })[];
  /** Crates, each standing on the ground or on the crate `on` in this list. */
  crates: (TownBox & { on: number })[];
  /** Piers' decks, and the posts they stand on. */
  decks: TownBox[];
  posts: TownBox[];
  /** The open places: a square, a green, a main street, a quay. */
  open: Rect[];
  /** Yards with grass in them. */
  greens: Rect[];
  /** What the ground is levelled to at (x, z), given the land's height there. */
  ground: (x: number, z: number, land: number) => number;
}

/** Each town's walls and roofs, as a prop's tint: picking from the colours the client keeps for them. */
export const TOWN_LOOK: Record<TownStyle, { wall: number; roof: number }> = {
  old: { wall: 0.3, roof: 0.3 },
  village: { wall: 0.55, roof: 0.55 },
  harbour: { wall: 0.8, roof: 0.8 },
};

/** How far the village's terraces step up, metres: gentle enough to walk up the ramp where a street crosses. */
export const TERRACE = 1.6;
/** The sea bed off the harbour's quay. */
const BASIN = -3.5;
/** The harbour's ground, metres above the sea: a quay's height. */
export const HARBOUR_HEIGHT = 2.5;
/** A garden wall's thickness. */
const WALL = 0.3;
/** Wide enough for a bot's path, as a doorway is: the gap between two buildings, a yard's gate. */
const PASSAGE = 2.2;
/** Nothing of a town is built closer than this to the edge of its site. */
const MARGIN = 2;
/** A shipping container: half its length and width, and its height. */
const CONTAINER = [3, 1.2, 2.8];

interface RowStyle {
  plans: [Plan, number][];
  /** The gap left beside each building, a way through to its yard. */
  gap: [number, number];
  yard: [number, number];
  /** How tall the garden walls stand. */
  wall: number;
  /**
   * Chance a building is built against the next one, with no gap between:
   * each then has its door at the end turned to its open side.
   */
  pairs: number;
  /** Lots left empty. */
  vacant: number;
  /** Chance of a crate in a yard. */
  yardCrate: number;
  green: boolean;
  /** A size other than the plans', for the harbour's warehouses. */
  size?: (rng: () => number) => Spec;
}

const OLD: RowStyle = {
  plans: [['tall', 0.45], ['two', 0.4], ['one', 0.15]],
  gap: [PASSAGE, 2.4], yard: [2, 3.2], wall: 1.5, pairs: 0.7, vacant: 0.03, yardCrate: 0.3, green: false,
};
const VILLAGE: RowStyle = {
  plans: [['one', 0.4], ['ell', 0.3], ['two', 0.25], ['tall', 0.05]],
  gap: [3, 7], yard: [3.5, 9], wall: 1, pairs: 0, vacant: 0.12, yardCrate: 0.4, green: true,
};
const PORT: RowStyle = {
  plans: [['two', 0.35], ['one', 0.3], ['tall', 0.2], ['ell', 0.15]],
  gap: [PASSAGE, 4], yard: [2.5, 5], wall: 1.2, pairs: 0.25, vacant: 0.08, yardCrate: 0.3, green: true,
};
const WAREHOUSE: RowStyle = {
  plans: [['two', 1]], gap: [5, 8], yard: [0, 0], wall: 0, pairs: 0, vacant: 0, yardCrate: 0, green: false,
  size: (rng) => ({ plan: 'two', L: 15 + rng() * 4, D: 9.5 + rng() * 1.5, W: 0, E: 0 }),
};

/**
 * Lay out a town on its site. `grid` is the terrain's, for the terraces' and
 * the quay's edges to fall on its lines; `uphill` is which way the land rose
 * across the site before it was levelled.
 */
export function planTown(t: Town, rng: () => number, grid: { half: number; cell: number }, uphill: [number, number]): TownPlan {
  const toward: [number, number] = t.style === 'harbour' ? [t.seaX, t.seaZ] : t.style === 'village' ? uphill : [1, 0];
  const lay = new Layout(t, rng, grid, toward);
  if (t.style === 'old') lay.oldTown();
  else if (t.style === 'village') lay.village();
  else lay.harbour();
  return lay.plan;
}

type Axis = 'a' | 'b';
/** What closes a yard at the back: a wall with a gate, a wall, or nothing of its own. */
type Back = 'gate' | 'wall' | 'open';

class Layout {
  readonly plan: TownPlan;
  private readonly t: Town;
  private readonly rng: () => number;
  private readonly grid: { half: number; cell: number };
  /** Local a runs along world x (or z with `swap`), `sa` its sign; b along the other, `sb` its sign. */
  private readonly swap: boolean;
  private readonly sa: number;
  private readonly sb: number;
  /** How far from the middle anything may be built. */
  private readonly R: number;

  constructor(t: Town, rng: () => number, grid: { half: number; cell: number }, toward: [number, number]) {
    this.t = t;
    this.rng = rng;
    this.grid = grid;
    this.swap = Math.abs(toward[1]) > Math.abs(toward[0]);
    this.sa = Math.sign(this.swap ? toward[1] : toward[0]) || 1;
    this.sb = rng() < 0.5 ? 1 : -1;
    this.R = t.r - MARGIN;
    this.plan = {
      houses: [], walls: [], blocks: [], containers: [], crates: [], decks: [], posts: [], open: [], greens: [],
      ground: () => t.y,
    };
  }

  // -------------------------------------------------------------- the towns

  /**
   * The old town: blocks of tall houses back to back across narrow alleys,
   * tight gaps between them, small yards, round a square in the middle; the
   * cross streets of each band of blocks fall where they will, not in line.
   */
  oldTown(): void {
    const rowDepth = 10;
    const block = rowDepth * 2 + 2.2;
    for (const [c0, c1, middle] of this.bands(block, [3.5, 5], (this.rng() - 0.5) * 4)) {
      for (const [s0, s1, square] of this.segments(middle ? [-11, 11] : null, [24, 34], [3.5, 5])) {
        if (middle && square) {
          this.open(s0, s1, c0, c1);
          // A crate at two of the square's corners.
          for (const k of [0, 1]) this.crate(k ? s1 - 2.6 : s0 + 1.4, k ? c0 + 1.4 : c1 - 2.6, 1.2, this.t.y);
          continue;
        }
        this.row('a', s0, s1, c1, -1, rowDepth, this.t.y, OLD, 'gate');
        this.row('a', s0, s1, c0, 1, rowDepth, this.t.y, OLD, 'gate');
      }
    }
  }

  /**
   * The village: three terraces up its slope, each a step higher, held up by
   * retaining walls. A lane runs along each terrace with houses either side
   * and long yards behind; a main street climbs straight up the middle,
   * crossing a green on the middle terrace, and an alley climbs each side.
   */
  village(): void {
    const { cell } = this.grid;
    const R = this.R;
    const k1 = this.snapA(-R / 3 - cell / 2);
    const k2 = this.snapA(R / 3 - cell / 2);
    const tierOf = (a: number): number => (a < k1 + cell / 2 ? 0 : a < k2 + cell / 2 ? 1 : 2);
    const height = (tier: number): number => this.t.y + (tier - 1) * TERRACE;
    this.plan.ground = (x, z) => height(tierOf(this.local(x, z)[0]));

    const main = 5;
    const green = 15;
    const side = Math.round(R * 0.55);
    const reach = this.t.r + cell;
    // The retaining walls, with gaps where the main street and the alleys go up the ramps.
    for (const [k, tier] of [[k1, 1], [k2, 2]]) {
      const w = Math.sqrt(Math.max(0, reach * reach - (k + cell / 2) ** 2));
      for (const [b0, b1] of [[-w, -side - 1.5], [-side + 1.5, -main], [main, side - 1.5], [side + 1.5, w]]) {
        if (b1 - b0 > 1) this.plan.blocks.push({ r: this.rect(k, k + cell, b0, b1), y0: height(tier - 1) - 0.5, y1: height(tier) });
      }
    }
    this.open(-R, R, -main, main);
    this.open(k1 + cell, k2, -green, green);

    const tiers: [number, number][] = [[-R, k1], [k1 + cell, k2], [k2 + cell, R]];
    tiers.forEach(([lo, hi], tier) => {
      const y = height(tier);
      const m = (lo + hi) / 2;
      const lane = 2.25;
      // Downhill, the yards reach over the retaining wall's top to its edge, walled there; uphill they meet the wall above.
      const down = tier > 0 ? lo - cell : lo;
      const middle = tier === 1 ? green : main;
      for (const [s0, s1] of [[-R, -side - 1.5], [-side + 1.5, -middle], [middle, side - 1.5], [side + 1.5, R]]) {
        this.row('b', s0, s1, m - lane, -1, m - lane - down, y, VILLAGE, tier > 0 ? 'wall' : 'gate');
        this.row('b', s0, s1, m + lane, 1, hi - m - lane, y, VILLAGE, tier === 2 ? 'gate' : 'open');
      }
    });
  }

  /**
   * The harbour: a quay along its sea side, piers out from it and stacked
   * containers on it, a row of warehouses facing the water, and behind them
   * blocks of houses with yards, a main street running straight up from the
   * quay through them all.
   */
  harbour(): void {
    const { cell } = this.grid;
    const R = this.R;
    const y = HARBOUR_HEIGHT;
    const aq = this.snapA(this.t.r * 0.3);
    this.plan.ground = (x, z, land) => (this.local(x, z)[0] < aq + cell / 2 ? y : Math.min(land, BASIN));
    const reach = this.t.r + cell;
    const chord = (a: number): number => Math.sqrt(Math.max(0, reach * reach - a * a));
    const wq = chord(aq + cell);
    this.plan.blocks.push({ r: this.rect(aq, aq + cell, -wq, wq), y0: BASIN - 1, y1: y });

    const main = 4;
    const apron = 18;
    this.open(aq - apron, aq, -wq, wq);
    this.open(-R, aq - apron, -main, main);

    // Piers, on posts.
    const piers = 2 + Math.floor(this.rng() * 2);
    for (let i = 0; i < piers; i++) {
      const b = ((i + 0.5) / piers - 0.5) * wq * 1.4 + (this.rng() - 0.5) * 6;
      const len = 14 + this.rng() * 8;
      const a0 = aq + cell;
      const a1 = a0 + len;
      this.plan.decks.push({ r: this.rect(a0, a1, b - 1.5, b + 1.5), y0: y - 0.55, y1: y - 0.25 });
      for (let a = a0 + 1; a < a1; a += 4) {
        for (const s of [-1, 1]) this.plan.posts.push({ r: this.rect(a, a + 0.3, b + s * 1.35 - 0.15, b + s * 1.35 + 0.15), y0: BASIN - 1, y1: y - 0.55 });
      }
      // Sometimes a crate out at its end: cover, not loot, as it doesn't stand on the ground.
      if (this.rng() < 0.6) this.crate(a1 - 3, b - 0.6, 1.2, y - 0.25);
    }

    // Containers stacked on the quay, long side along it, and crates among them.
    for (let b = -wq + 4; b < wq - 8;) {
      const wide = 1 + Math.floor(this.rng() * 2);
      const ac = aq - 4 - this.rng() * 8;
      const span = CONTAINER[0] * 2;
      if (Math.abs(b + span / 2) < main + span / 2 + 2 || !this.inside(this.rect(ac - wide * 2.5, ac + 2.5, b, b + span))) {
        b += 3;
        continue;
      }
      for (let k = 0; k < wide; k++) {
        const high = 1 + Math.floor(this.rng() * 3);
        const a = ac - k * CONTAINER[1] * 2;
        for (let level = 0; level < high; level++) {
          const y0 = y - 0.2 + level * CONTAINER[2];
          this.plan.containers.push({ r: this.rect(a - CONTAINER[1], a + CONTAINER[1], b, b + span), y0, y1: y0 + CONTAINER[2], tint: this.rng() });
        }
      }
      // A crate beside the stack, toward the water, sometimes with another on it.
      const cb = b + this.rng() * (span - 1.4);
      const base = this.crate(ac + CONTAINER[1] + 1.2, cb, 1.3, y);
      if (this.rng() < 0.35) this.crate(ac + CONTAINER[1] + 1.3, cb + 0.1, 1.1, y + 1.3, base);
      b += span + 4 + this.rng() * 6;
    }

    // Warehouses facing the water, behind the open quay.
    const front = aq - apron;
    for (const [s0, s1] of [[-R, -main], [main, R]]) this.row('b', s0, s1, front, -1, 12, y, WAREHOUSE, 'open');
    // A street behind them, then the houses.
    const street = front - 12 - 6;
    const rowDepth = 10.5;
    const block = rowDepth * 2 + 2.4;
    for (let c1 = street; c1 > -R + 6; c1 -= block + 5) {
      const c0 = c1 - block;
      for (const [s0, s1] of this.segments([-main, main], [22, 32], [4, 5])) {
        if (s1 <= -main || s0 >= main) {
          this.row('b', s0, s1, c1, -1, rowDepth, y, PORT, 'gate');
          this.row('b', s0, s1, c0, 1, rowDepth, y, PORT, 'gate');
        }
      }
    }
  }

  // ---------------------------------------------------------- the lots

  /**
   * A row of buildings along `axis` from s0 to s1, their fronts on the line
   * `front` across it, reaching `dir` away from the street to at most
   * `depth`: each with a yard behind, walled from the next yard, the gap
   * beside the building opening onto it. At the back it's walled with a gate,
   * walled without one where it looks over a drop, or left to whatever stands
   * there (a terrace's retaining wall), as `back` has it. Two buildings built
   * against each other have no gap between, and their doors at the end (a
   * two-room or two-storey building's) are turned away from each other.
   */
  private row(axis: Axis, s0: number, s1: number, front: number, dir: 1 | -1, depth: number, floor: number, style: RowStyle, back: Back): void {
    const rng = this.rng;
    const lerp = ([lo, hi]: [number, number]) => lo + rng() * (hi - lo);
    const at = (u0: number, u1: number, c0: number, c1: number): Rect => (axis === 'a' ? this.rect(u0, u1, c0, c1) : this.rect(c0, c1, u0, u1));
    const across = axis === 'a' ? 'b' : 'a';
    // Whether the world's way along the row runs with s: a plan's far end (u = L) is then toward greater s unless flipped.
    const up = (axis === 'a' ? this.sa : this.sb) > 0;
    let s = s0;
    let walled = -Infinity;
    /** Whether the last building stands against this lot. */
    let joined = false;
    while (s < s1 - 4) {
      const was: boolean = joined;
      joined = false;
      let spec = style.size ? style.size(rng) : specFor(pick(style.plans, rng), rng);
      const fits = (p: Spec) => p.D + style.yard[0] <= depth && s + p.L <= s1;
      if (!fits(spec) && !style.size) spec = specFor('one', rng);
      if (!fits(spec)) {
        s += 2;
        continue;
      }
      const pair: boolean = !was && rng() < style.pairs;
      // The gap clear of the garden wall at its far side.
      const end = Math.min(s + spec.L + (pair ? 0 : lerp(style.gap) + WALL), s1);
      const hb = front + dir * spec.D;
      const house = at(s, s + spec.L, front, hb);
      if (!this.inside(house)) {
        s += 3;
        continue;
      }
      // The yard: as deep as it was drawn, or as fits on the site.
      let yd = Math.min(depth - spec.D, lerp(style.yard));
      while (yd > style.yard[0] && !this.inside(at(s, end, front, hb + dir * yd))) yd -= 0.5;
      if (!this.inside(at(s, end, front, hb + dir * yd))) {
        s += 3;
        continue;
      }
      if (rng() < style.vacant) {
        s = end;
        continue;
      }
      // The far end toward greater s when the last building stands against this one, toward lesser s when the next will.
      const flipU = was ? !up : pair ? up : rng() < 0.5;
      this.plan.houses.push({ spec, rect: house, facing: this.facing(across, -dir), flipU, floor, crates: style.size ? 2 : 1 });
      joined = pair;
      if (yd > 1) {
        const yb = hb + dir * yd;
        const wall = (u0: number, u1: number, c0: number, c1: number) => {
          if (u1 - u0 > 0.2) this.plan.walls.push({ r: at(u0, u1, Math.min(c0, c1), Math.max(c0, c1)), y0: floor - 0.3, y1: floor + style.wall });
        };
        // A gate in the back wall, away from the corners.
        const g = s + 0.6 + rng() * (end - s - PASSAGE - 1.2);
        const gate = back === 'gate';
        if (gate) {
          wall(s, g, yb, yb - dir * WALL);
          wall(g + PASSAGE, end, yb, yb - dir * WALL);
        } else if (back === 'wall') wall(s, end, yb, yb - dir * WALL);
        const inner = yb - dir * (back === 'open' ? 0 : WALL);
        // Walled from the next yard, unless that would leave this one no way in: no gate, and the gap beside the building too narrow.
        if (gate || end - s - spec.L >= PASSAGE) wall(end - WALL, end, hb, inner);
        if (walled < s - 0.01) wall(s, s + WALL, hb, inner);
        walled = end;
        if (style.green) this.plan.greens.push(at(s, end, Math.min(hb, yb), Math.max(hb, yb)));
        // A crate in the yard, behind the building, clear of the gap beside it, and of the gate.
        // Room to walk round it either side, so it never shuts off the yard's far end.
        if (rng() < style.yardCrate && yd > 4.8 && spec.L > 4) {
          const half = (spec.L - 3.2) / 2;
          const u = s + 1 + rng() * half + (gate && g + PASSAGE / 2 < s + spec.L / 2 ? half : 0);
          const c = hb + dir * (1.6 + rng() * (yd - 4.7));
          const r = at(u, u + 1.2, Math.min(c, c + dir * 1.2), Math.max(c, c + dir * 1.2));
          this.plan.crates.push({ r, y0: floor - 0.2, y1: floor + 1.2, on: -1 });
        }
      }
      s = end;
    }
  }

  /** An open place, kept clear of the roofs' overhangs round it. */
  private open(a0: number, a1: number, b0: number, b1: number): void {
    this.plan.open.push(this.rect(a0 + 0.5, a1 - 0.5, b0 + 0.5, b1 - 0.5));
  }

  /** A crate `size` across with its near corner at local (a, b) standing at `y`, on crate `on`. Returns its index. */
  private crate(a: number, b: number, size: number, y: number, on = -1): number {
    this.plan.crates.push({ r: this.rect(a, a + size, b, b + size), y0: on >= 0 ? y : y - 0.2, y1: y + size, on });
    return this.plan.crates.length - 1;
  }

  /**
   * Bands of blocks `block` deep across the town along b, streets between
   * them `street` wide, the middle one centred at `off`: each its b from and
   * to, and whether it's the middle one.
   */
  private bands(block: number, street: [number, number], off: number): [number, number, boolean][] {
    const out: [number, number, boolean][] = [[off - block / 2, off + block / 2, true]];
    for (const dir of [1, -1]) {
      let edge = off + (dir * block) / 2;
      for (;;) {
        const near = edge + dir * (street[0] + this.rng() * (street[1] - street[0]));
        const far = near + dir * block;
        if (Math.min(Math.abs(near), Math.abs(far)) > this.R - 6) break;
        out.push(dir > 0 ? [near, far, false] : [far, near, false]);
        edge = far;
      }
    }
    return out;
  }

  /**
   * Stretches of a band between cross streets: from the stretch `middle` (or
   * one drawn about the middle) outward each way, `length` long with streets
   * `street` wide between. Each its from and to, and whether it's the middle.
   */
  private segments(middle: [number, number] | null, length: [number, number], street: [number, number]): [number, number, boolean][] {
    const draw = ([lo, hi]: [number, number]) => lo + this.rng() * (hi - lo);
    let mid = middle;
    if (!mid) {
      const len = draw(length);
      const at = (this.rng() - 0.5) * len;
      mid = [at - len / 2, at + len / 2];
    }
    const out: [number, number, boolean][] = [[mid[0], mid[1], true]];
    for (const dir of [1, -1]) {
      let edge = dir > 0 ? mid[1] : mid[0];
      while (Math.abs(edge) < this.R) {
        const near = edge + dir * draw(street);
        const far = near + dir * draw(length);
        out.push(dir > 0 ? [near, far, false] : [far, near, false]);
        edge = far;
      }
    }
    return out;
  }

  // ---------------------------------------------------------- the frame

  /** World (x, z) of local (a, b). */
  private world(a: number, b: number): [number, number] {
    const [u, v] = [a * this.sa, b * this.sb];
    return this.swap ? [this.t.x + v, this.t.z + u] : [this.t.x + u, this.t.z + v];
  }

  /** Local (a, b) of world (x, z). */
  private local(x: number, z: number): [number, number] {
    const [u, v] = this.swap ? [z - this.t.z, x - this.t.x] : [x - this.t.x, z - this.t.z];
    return [u * this.sa, v * this.sb];
  }

  /** A local rectangle in the world. */
  private rect(a0: number, a1: number, b0: number, b1: number): Rect {
    const [x0, z0] = this.world(a0, b0);
    const [x1, z1] = this.world(a1, b1);
    return { minX: Math.min(x0, x1), minZ: Math.min(z0, z1), maxX: Math.max(x0, x1), maxZ: Math.max(z0, z1) };
  }

  /** The world's way for local `axis` with `sign`. */
  private facing(axis: Axis, sign: number): Facing {
    const s = sign * (axis === 'a' ? this.sa : this.sb);
    const x = (axis === 'a') !== this.swap;
    return `${s > 0 ? '+' : '-'}${x ? 'x' : 'z'}` as Facing;
  }

  /** The local a nearest `a` whose world line is one of the terrain grid's. */
  private snapA(a: number): number {
    const { half, cell } = this.grid;
    const centre = this.swap ? this.t.z : this.t.x;
    const w = centre + a * this.sa;
    return (Math.round((w + half) / cell) * cell - half - centre) * this.sa;
  }

  /** Whether a rectangle lies wholly within the ground that may be built on. */
  private inside(r: Rect): boolean {
    const R = this.R;
    for (const x of [r.minX, r.maxX]) for (const z of [r.minZ, r.maxZ]) if (Math.hypot(x - this.t.x, z - this.t.z) > R) return false;
    return true;
  }
}

function pick<T>(weights: [T, number][], rng: () => number): T {
  let r = rng() * weights.reduce((s, [, w]) => s + w, 0);
  for (const [v, w] of weights) if ((r -= w) < 0) return v;
  return weights[weights.length - 1][0];
}
