// Dead bodies and the guns they drop, as balls joined by rods (Verlet
// integration with position constraints). A body takes over from the death
// clip partway through and falls, rolls and slides on its own: onto the
// ground, off walls, props, fences and trees, and onto other dead bodies. It
// steps at a fixed rate counted from its start, from nothing but the kill
// event and the world, so a death cam falls exactly the same way
// whatever the frame rate. Plain numbers only, so the server's tests can run it.

/** Seconds per step. */
export const RAGDOLL_STEP = 1 / 60;
const GRAVITY = 9.81;
/** Velocity kept per step, against the air. */
const DRAG = 0.995;
/** Passes over the constraints each step. */
const ITERATIONS = 8;
/** How hard surfaces grip: things slide on slopes steeper than atan(FRICTION). */
const FRICTION = 1;
/** Metres per step below which a body counts as still, and how many still steps put it to sleep. */
const STILL = 0.0012;
const STILL_STEPS = 45;
/** Every body is put to sleep after this many steps, however it lies. */
const MAX_STEPS = 12 * 60;
/** Fastest a joint may move, in metres per step, so nothing tunnels through a thin fence. */
const MAX_MOVE = 0.12;

/** What bodies and guns fall onto: the ground and every collider. */
export interface Solid {
  floorHeight(x: number, z: number): number;
  sphereOut(x: number, y: number, z: number, r: number, out: { x: number; y: number; z: number }): boolean;
}

/** A body's joints, in the order a ragdoll keeps them. */
export const JOINTS = [
  'pelvis', 'chest', 'head',
  'lShoulder', 'lElbow', 'lHand', 'rShoulder', 'rElbow', 'rHand',
  'lHip', 'lKnee', 'lAnkle', 'rHip', 'rKnee', 'rAnkle', 'lToe', 'rToe',
  // An operator's pack.
  'pack',
] as const;
export type Joint = (typeof JOINTS)[number];
const J = Object.fromEntries(JOINTS.map((name, i) => [name, i])) as Record<Joint, number>;
export { J as JOINT };

/** How thick the body is round each joint, in metres. */
const RADIUS: Record<Joint, number> = {
  pelvis: 0.13, chest: 0.13, head: 0.12,
  lShoulder: 0.08, lElbow: 0.06, lHand: 0.05, rShoulder: 0.08, rElbow: 0.06, rHand: 0.05,
  lHip: 0.09, lKnee: 0.07, lAnkle: 0.06, rHip: 0.09, rKnee: 0.07, rAnkle: 0.06, lToe: 0.04, rToe: 0.04,
  pack: 0.1,
};
/** Heavier joints move less when a constraint pulls them: the trunk more than the hands. */
const MASS: Record<Joint, number> = {
  pelvis: 3, chest: 3, head: 1.2,
  lShoulder: 1.5, lElbow: 0.8, lHand: 0.5, rShoulder: 1.5, rElbow: 0.8, rHand: 0.5,
  lHip: 1.5, lKnee: 1, lAnkle: 0.6, rHip: 1.5, rKnee: 1, rAnkle: 0.6, lToe: 0.3, rToe: 0.3,
  pack: 1.5,
};

/** A distance between two balls: held (stiffness 0 to 1), or only kept from getting shorter or longer. */
interface Link {
  a: number;
  b: number;
  length: number;
  stiffness: number;
  /** Only pushes apart. */
  min: boolean;
  /** Only pulls together. */
  max?: boolean;
}

/** Someone alive, as an upright capsule: its feet, the top of its shoulders and its girth. Bodies are pushed off them. */
export interface Living {
  x: number;
  z: number;
  bottom: number;
  top: number;
  r: number;
}

/** Balls joined by links, stepped on a fixed clock. */
export class Verlet {
  readonly n: number;
  readonly pos: Float64Array;
  readonly prev: Float64Array;
  readonly radius: Float64Array;
  /** Inverse masses. */
  readonly w: Float64Array;
  readonly links: Link[] = [];
  /** Steps taken, and whether it has come to rest. */
  steps = 0;
  asleep = false;
  /** The step of the game's clock it starts on, and how many of the clock's steps it has had since, asleep or not. */
  start = 0;
  ticks = 0;
  /** Which body it belongs to: a dropped gun falls clear of its own body. */
  owner = -1;
  /** A ball round every joint, for skipping far-off bodies quickly. */
  readonly bounds = { x: 0, y: 0, z: 0, r: 0 };
  private still = 0;
  /** How far each ball was pushed out of things this step. */
  private readonly pushed: Float64Array;

  constructor(n: number) {
    this.n = n;
    this.pos = new Float64Array(n * 3);
    this.prev = new Float64Array(n * 3);
    this.radius = new Float64Array(n);
    this.w = new Float64Array(n).fill(1);
    this.pushed = new Float64Array(n * 3);
  }

  /** Join two balls at the distance they are now. */
  link(a: number, b: number, stiffness = 1, min = false, scale = 1): void {
    const p = this.pos;
    const length = Math.hypot(p[a * 3] - p[b * 3], p[a * 3 + 1] - p[b * 3 + 1], p[a * 3 + 2] - p[b * 3 + 2]) * scale;
    this.links.push({ a, b, length, stiffness, min });
  }

  /** Give ball `i` a velocity, in metres per second. */
  push(i: number, vx: number, vy: number, vz: number): void {
    this.prev[i * 3] -= vx * RAGDOLL_STEP;
    this.prev[i * 3 + 1] -= vy * RAGDOLL_STEP;
    this.prev[i * 3 + 2] -= vz * RAGDOLL_STEP;
  }

  /** Wake it, as when what it rests on breaks. */
  wake(): void {
    if (this.steps >= MAX_STEPS) this.steps = MAX_STEPS - STILL_STEPS * 2;
    this.asleep = false;
    this.still = 0;
  }

  /** One step. `others` are the other bodies it can land on, and `living` those it's pushed off; neither is moved. */
  step(solid: Solid, others: readonly Verlet[], living: readonly Living[] = []): void {
    if (this.asleep) return;
    const { n, pos, prev } = this;
    const g = GRAVITY * RAGDOLL_STEP * RAGDOLL_STEP;
    for (let i = 0; i < n * 3; i += 3) {
      let vx = (pos[i] - prev[i]) * DRAG;
      let vy = (pos[i + 1] - prev[i + 1]) * DRAG - g;
      let vz = (pos[i + 2] - prev[i + 2]) * DRAG;
      const v = Math.hypot(vx, vy, vz);
      if (v > MAX_MOVE) (vx *= MAX_MOVE / v), (vy *= MAX_MOVE / v), (vz *= MAX_MOVE / v);
      prev[i] = pos[i];
      prev[i + 1] = pos[i + 1];
      prev[i + 2] = pos[i + 2];
      pos[i] += vx;
      pos[i + 1] += vy;
      pos[i + 2] += vz;
    }
    this.measure();
    const near = others.filter((o) => o !== this && (this.owner < 0 || o.owner !== this.owner) && overlaps(this.bounds, o.bounds));
    const b = this.bounds;
    const standing = living.filter((l) => Math.hypot(l.x - b.x, l.z - b.z) < b.r + l.r && b.y - b.r < l.top + l.r && b.y + b.r > l.bottom - l.r);
    this.pushed.fill(0);
    for (let k = 0; k < ITERATIONS; k++) {
      this.solve();
      this.constrain();
      // The ground on every pass, so the joints' limits and the ground settle together; the rest
      // on the last passes only. The ground has the last word.
      this.collide(solid, near, standing, k >= ITERATIONS - 2);
    }
    this.grip();
    this.measure();
    let moved = 0;
    for (let i = 0; i < n * 3; i += 3) moved = Math.max(moved, Math.hypot(pos[i] - prev[i], pos[i + 1] - prev[i + 1], pos[i + 2] - prev[i + 2]));
    this.still = moved < STILL ? this.still + 1 : 0;
    this.steps++;
    if (this.still >= STILL_STEPS || this.steps >= MAX_STEPS) this.asleep = true;
  }

  /** Extra rules, such as knees that only bend one way. */
  protected constrain(): void {}

  private solve(): void {
    const { pos, w } = this;
    for (const l of this.links) {
      const a = l.a * 3;
      const b = l.b * 3;
      const dx = pos[b] - pos[a];
      const dy = pos[b + 1] - pos[a + 1];
      const dz = pos[b + 2] - pos[a + 2];
      const d = Math.hypot(dx, dy, dz);
      if (d < 1e-9 || (l.min && d >= l.length) || (l.max && d <= l.length)) continue;
      const wa = w[l.a];
      const wb = w[l.b];
      const k = ((d - l.length) / (d * (wa + wb))) * l.stiffness;
      pos[a] += dx * k * wa;
      pos[a + 1] += dy * k * wa;
      pos[a + 2] += dz * k * wa;
      pos[b] -= dx * k * wb;
      pos[b + 1] -= dy * k * wb;
      pos[b + 2] -= dz * k * wb;
    }
  }

  /** Out of the ground, and unless `all` is false, colliders, other bodies and the living. */
  private collide(solid: Solid, near: readonly Verlet[], living: readonly Living[], all = true): void {
    const { pos, prev, radius, pushed } = this;
    for (let i = 0; i < this.n; i++) {
      const j = i * 3;
      const x = pos[j];
      const y = pos[j + 1];
      const z = pos[j + 2];
      const r = radius[i];
      let px = 0;
      let py = 0;
      let pz = 0;
      // The ground, as the plane under the ball.
      const h = solid.floorHeight(x, z);
      if (y - r < h + 0.3) {
        const e = 0.2;
        const hx = solid.floorHeight(x + e, z) - solid.floorHeight(x - e, z);
        const hz = solid.floorHeight(x, z + e) - solid.floorHeight(x, z - e);
        const len = Math.hypot(hx, 2 * e, hz);
        const nx = -hx / len;
        const ny = (2 * e) / len;
        const nz = -hz / len;
        const pen = r - (y - h) * ny;
        if (pen > 0) (px += nx * pen), (py += ny * pen), (pz += nz * pen);
      }
      if (all && solid.sphereOut(x + px, y + py, z + pz, r, OUT)) (px += OUT.x), (py += OUT.y), (pz += OUT.z);
      for (const o of all ? near : NONE) {
        for (let k = 0; k < o.n; k++) {
          const dx = x + px - o.pos[k * 3];
          const dy = y + py - o.pos[k * 3 + 1];
          const dz = z + pz - o.pos[k * 3 + 2];
          const min = r + o.radius[k];
          const d2 = dx * dx + dy * dy + dz * dz;
          if (d2 >= min * min || d2 < 1e-12) continue;
          const d = Math.sqrt(d2);
          const s = (min - d) / d;
          px += dx * s;
          py += dy * s;
          pz += dz * s;
        }
      }
      for (const l of all ? living : NONE) {
        // From the nearest point on the capsule's upright segment.
        const cy = Math.min(Math.max(y + py, l.bottom), l.top);
        const dx = x + px - l.x;
        const dy = y + py - cy;
        const dz = z + pz - l.z;
        const min = r + l.r;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 >= min * min || d2 < 1e-12) continue;
        const d = Math.sqrt(d2);
        const s = (min - d) / d;
        px += dx * s;
        py += dy * s;
        pz += dz * s;
      }
      const p = Math.hypot(px, py, pz);
      if (p < 1e-9) continue;
      pos[j] += px;
      pos[j + 1] += py;
      pos[j + 2] += pz;
      pushed[j] += px;
      pushed[j + 1] += py;
      pushed[j + 2] += pz;
      // Friction, as a move back along the surface: all of this step's slide while it's less than the push
      // times the grip, so it holds on gentle slopes, and that much of it on steep ones.
      const nx = px / p;
      const ny = py / p;
      const nz = pz / p;
      let tx = pos[j] - prev[j];
      let ty = pos[j + 1] - prev[j + 1];
      let tz = pos[j + 2] - prev[j + 2];
      const tn = tx * nx + ty * ny + tz * nz;
      (tx -= tn * nx), (ty -= tn * ny), (tz -= tn * nz);
      const t = Math.hypot(tx, ty, tz);
      if (t < 1e-12) continue;
      const k = Math.min(1, (FRICTION * p) / t);
      pos[j] -= tx * k;
      pos[j + 1] -= ty * k;
      pos[j + 2] -= tz * k;
    }
  }

  /**
   * Whatever was pushed out of something loses its speed into it, and away
   * from it too: nothing bounces, and being pushed out doesn't fling it.
   */
  private grip(): void {
    const { pos, prev, pushed } = this;
    for (let j = 0; j < this.n * 3; j += 3) {
      const p = Math.hypot(pushed[j], pushed[j + 1], pushed[j + 2]);
      if (p < 1e-9) continue;
      const nx = pushed[j] / p;
      const ny = pushed[j + 1] / p;
      const nz = pushed[j + 2] / p;
      const vn = (pos[j] - prev[j]) * nx + (pos[j + 1] - prev[j + 1]) * ny + (pos[j + 2] - prev[j + 2]) * nz;
      prev[j] += vn * nx;
      prev[j + 1] += vn * ny;
      prev[j + 2] += vn * nz;
    }
  }

  private measure(): void {
    const { pos, n, bounds } = this;
    let x = 0;
    let y = 0;
    let z = 0;
    for (let i = 0; i < n * 3; i += 3) (x += pos[i]), (y += pos[i + 1]), (z += pos[i + 2]);
    (x /= n), (y /= n), (z /= n);
    let r = 0;
    for (let i = 0; i < n; i++) r = Math.max(r, Math.hypot(pos[i * 3] - x, pos[i * 3 + 1] - y, pos[i * 3 + 2] - z) + this.radius[i]);
    Object.assign(bounds, { x, y, z, r });
  }
}

const OUT = { x: 0, y: 0, z: 0 };
const NONE: readonly never[] = [];

function overlaps(a: Verlet['bounds'], b: Verlet['bounds']): boolean {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) < a.r + b.r;
}

/** The step of the game's clock that `time`, in seconds, falls in. */
export function stepOf(time: number): number {
  return Math.floor(time / RAGDOLL_STEP + 1e-6);
}

/**
 * Step every fall in `falls` up to step `due` of the game's clock, all
 * together: step by step, each fall that has reached it taking it in the
 * order given, so bodies landing on each other come out the same however the
 * frames fell. `onStep` comes first at each step (for blasts), and
 * `crowd` says where the living were then; `bodies` are what the falls land on.
 */
export function stepAll(
  falls: readonly Verlet[], due: number, solid: Solid, bodies: readonly Verlet[],
  crowd?: (step: number) => readonly Living[], onStep?: (step: number) => void,
): void {
  let g = Infinity;
  for (const v of falls) g = Math.min(g, v.start + v.ticks);
  for (; g < due; g++) {
    onStep?.(g);
    let living: readonly Living[] | null = null;
    for (const v of falls) {
      if (v.start + v.ticks !== g) continue;
      v.ticks++;
      if (v.asleep) continue;
      living ??= crowd?.(g) ?? [];
      v.step(solid, bodies, living);
    }
  }
}

/**
 * A dead body. Starts from the joints' positions now and a moment before
 * (flat x, y, z triples in JOINTS order, the pack's left out when there's
 * none), so it carries on at the speed the death clip had it falling.
 */
export class Ragdoll extends Verlet {
  readonly pack: boolean;

  constructor(now: ArrayLike<number>, before: ArrayLike<number>, pack: boolean) {
    super(pack ? JOINTS.length : JOINTS.length - 1);
    this.pack = pack;
    this.pos.set(Array.from(now).slice(0, this.n * 3));
    this.prev.set(Array.from(before).slice(0, this.n * 3));
    for (let i = 0; i < this.n; i++) {
      this.radius[i] = RADIUS[JOINTS[i]];
      this.w[i] = 1 / MASS[JOINTS[i]];
    }
    const {
      pelvis, chest, head, lShoulder, lElbow, lHand, rShoulder, rElbow, rHand,
      lHip, lKnee, lAnkle, rHip, rKnee, rAnkle, lToe, rToe,
    } = J;
    // The bones.
    for (const [a, b] of [
      [pelvis, chest], [chest, head], [chest, lShoulder], [chest, rShoulder], [lShoulder, lElbow], [lElbow, lHand],
      [rShoulder, rElbow], [rElbow, rHand], [pelvis, lHip], [pelvis, rHip], [lHip, lKnee], [lKnee, lAnkle],
      [rHip, rKnee], [rKnee, rAnkle], [lAnkle, lToe], [rAnkle, rToe],
    ]) this.link(a, b);
    // The shoulders and hips hold their shape; the spine between bends and twists a little.
    this.link(lShoulder, rShoulder);
    this.link(lHip, rHip);
    for (const [a, b] of [[lShoulder, lHip], [rShoulder, rHip], [lShoulder, rHip], [rShoulder, lHip], [chest, lHip], [chest, rHip]]) {
      this.link(a, b, 0.25);
    }
    // The neck nods but doesn't fold.
    this.link(head, lShoulder, 0.5);
    this.link(head, rShoulder, 0.5);
    this.link(head, pelvis, 0.3, true, 0.95);
    // The feet turn at the ankle, from drawn up to pointed, as far as the knee to the toe allows, and ease back
    // toward how they stood (see constrain for which way they point).
    for (const [knee, ankle, toe] of [[lKnee, lAnkle, lToe], [rKnee, rAnkle, rToe]]) {
      const shin = this.distance(knee, ankle);
      const foot = this.distance(ankle, toe);
      const across = (angle: number): number => Math.sqrt(shin * shin + foot * foot - 2 * shin * foot * Math.cos(angle));
      const now = this.distance(knee, toe);
      this.links.push({ a: knee, b: toe, length: Math.min(across(ANKLE_BENT), now), stiffness: 1, min: true });
      this.links.push({ a: knee, b: toe, length: Math.max(across(ANKLE_POINTED), now), stiffness: 1, min: false, max: true });
      this.links.push({ a: knee, b: toe, length: now, stiffness: 0.02, min: false });
    }
    // Limp legs slowly straighten under their own weight rather than staying as the clip bent them.
    for (const [hip, knee, ankle] of [[lHip, lKnee, lAnkle], [rHip, rKnee, rAnkle]]) {
      this.links.push({ a: hip, b: ankle, length: (this.distance(hip, knee) + this.distance(knee, ankle)) * 0.96, stiffness: 0.004, min: false });
    }
    // Elbows and knees bend, but not all the way; the limbs don't pass through each other.
    // Never more than they are now, so nothing jumps apart at the start.
    const apart = (a: number, b: number, length: number): void => {
      this.links.push({ a, b, length: Math.min(length, this.distance(a, b)), stiffness: 1, min: true });
    };
    const reachOf = (a: number, b: number, c: number): number => this.distance(a, b) + this.distance(b, c);
    apart(lShoulder, lHand, reachOf(lShoulder, lElbow, lHand) * 0.35);
    apart(rShoulder, rHand, reachOf(rShoulder, rElbow, rHand) * 0.35);
    apart(lHip, lAnkle, reachOf(lHip, lKnee, lAnkle) * 0.45);
    apart(rHip, rAnkle, reachOf(rHip, rKnee, rAnkle) * 0.45);
    apart(lKnee, rKnee, 0.13);
    apart(lAnkle, rAnkle, 0.11);
    for (const hand of [lHand, rHand]) {
      apart(hand, pelvis, 0.16);
      apart(hand, chest, 0.17);
      apart(hand, head, 0.15);
    }
    // The pack rides on the chest and shoulders, which hold their shape; tied to the hips too, it would fight the spine.
    if (pack) for (const k of [chest, lShoulder, rShoulder]) this.link(J.pack, k);
    // How far the hinges are bent now: none is made to straighten further than it starts.
    const f = this.forward(new Float64Array(3));
    if (f) {
      for (const [k, [a, b, c]] of ELBOWS.entries()) {
        const back = -this.bend(a, b, c, f, ELBOW_UP);
        if (Number.isFinite(back)) this.elbowFrom[k] = Math.min(ELBOW_BENT, back);
      }
      for (const [k, [ankle, toe]] of ANKLES.entries()) this.toeFrom[k] = Math.min(TOE_AHEAD * this.distance(ankle, toe), this.ahead(ankle, toe, f));
    }
  }

  /** How far each elbow is bent, and each toe ahead of its ankle, when the ragdoll took over, if less than they're kept to. */
  private readonly elbowFrom = [ELBOW_BENT, ELBOW_BENT];
  private readonly toeFrom = [0, 0];

  distance(a: number, b: number): number {
    const p = this.pos;
    return Math.hypot(p[a * 3] - p[b * 3], p[a * 3 + 1] - p[b * 3 + 1], p[a * 3 + 2] - p[b * 3 + 2]);
  }

  /** Which way the body faces, from the hips across and the spine up, into `out`; null when they line up. */
  forward(out: Float64Array): Float64Array | null {
    const p = this.pos;
    const at = (i: number, k: number): number => p[i * 3 + k];
    const rx = at(J.rHip, 0) - at(J.lHip, 0);
    const ry = at(J.rHip, 1) - at(J.lHip, 1);
    const rz = at(J.rHip, 2) - at(J.lHip, 2);
    const ux = at(J.chest, 0) - at(J.pelvis, 0);
    const uy = at(J.chest, 1) - at(J.pelvis, 1);
    const uz = at(J.chest, 2) - at(J.pelvis, 2);
    const fx = uy * rz - uz * ry;
    const fy = uz * rx - ux * rz;
    const fz = ux * ry - uy * rx;
    const fl = Math.hypot(fx, fy, fz);
    if (fl < 1e-9) return null;
    out[0] = fx / fl;
    out[1] = fy / fl;
    out[2] = fz / fl;
    return out;
  }

  /**
   * How far the middle joint `b` stands out from the line from `a` to `c`,
   * along `f` (plus `up` of the way up the spine) made square to that line:
   * how far a knee is bent forward, or, negated, an elbow back.
   */
  private bend(a: number, b: number, c: number, f: ArrayLike<number>, up = 0, dir = DIR): number {
    const p = this.pos;
    const lx = p[c * 3] - p[a * 3];
    const ly = p[c * 3 + 1] - p[a * 3 + 1];
    const lz = p[c * 3 + 2] - p[a * 3 + 2];
    const ll = Math.hypot(lx, ly, lz) || 1;
    let dx = f[0];
    let dy = f[1];
    let dz = f[2];
    if (up) {
      const ux = p[J.chest * 3] - p[J.pelvis * 3];
      const uy = p[J.chest * 3 + 1] - p[J.pelvis * 3 + 1];
      const uz = p[J.chest * 3 + 2] - p[J.pelvis * 3 + 2];
      const ul = Math.hypot(ux, uy, uz) || 1;
      (dx += (ux / ul) * up), (dy += (uy / ul) * up), (dz += (uz / ul) * up);
    }
    const along = (dx * lx + dy * ly + dz * lz) / (ll * ll);
    (dx -= lx * along), (dy -= ly * along), (dz -= lz * along);
    const dl = Math.hypot(dx, dy, dz);
    // Along the limb, which way it bends is anyone's guess: left alone.
    if (dl < 0.2) return Infinity;
    dir[0] = dx / dl;
    dir[1] = dy / dl;
    dir[2] = dz / dl;
    const mx = p[b * 3] - (p[a * 3] + p[c * 3]) / 2;
    const my = p[b * 3 + 1] - (p[a * 3 + 1] + p[c * 3 + 1]) / 2;
    const mz = p[b * 3 + 2] - (p[a * 3 + 2] + p[c * 3 + 2]) / 2;
    return mx * dir[0] + my * dir[1] + mz * dir[2];
  }

  /** How far the toe is ahead of the ankle, along `f` made square to the shin. */
  private ahead(ankle: number, toe: number, f: ArrayLike<number>, dir = DIR): number {
    const knee = ankle === J.lAnkle ? J.lKnee : J.rKnee;
    const p = this.pos;
    const sx = p[ankle * 3] - p[knee * 3];
    const sy = p[ankle * 3 + 1] - p[knee * 3 + 1];
    const sz = p[ankle * 3 + 2] - p[knee * 3 + 2];
    const sl2 = sx * sx + sy * sy + sz * sz || 1;
    const along = (f[0] * sx + f[1] * sy + f[2] * sz) / sl2;
    let dx = f[0] - sx * along;
    let dy = f[1] - sy * along;
    let dz = f[2] - sz * along;
    const dl = Math.hypot(dx, dy, dz);
    if (dl < 0.2) return Infinity;
    (dx /= dl), (dy /= dl), (dz /= dl);
    dir[0] = dx;
    dir[1] = dy;
    dir[2] = dz;
    return (p[toe * 3] - p[ankle * 3]) * dx + (p[toe * 3 + 1] - p[ankle * 3 + 1]) * dy + (p[toe * 3 + 2] - p[ankle * 3 + 2]) * dz;
  }

  /** Move joints along DIR by `s` times their shares. */
  private nudge(s: number, shares: readonly (readonly [number, number])[]): void {
    const p = this.pos;
    for (const [i, k] of shares) {
      p[i * 3] += DIR[0] * s * k;
      p[i * 3 + 1] += DIR[1] * s * k;
      p[i * 3 + 2] += DIR[2] * s * k;
    }
  }

  /**
   * The hinges bend one way only: each knee is kept in front of the line from
   * hip to ankle, each elbow behind the line from shoulder to hand, and each
   * toe ahead of its ankle.
   */
  protected override constrain(): void {
    const f = this.forward(FORWARD);
    if (!f) return;
    for (const [hip, knee, ankle, toe] of [[J.lHip, J.lKnee, J.lAnkle, J.lToe], [J.rHip, J.rKnee, J.rAnkle, J.rToe]]) {
      const ahead = this.bend(hip, knee, ankle, f);
      // The foot goes with the ankle, so straightening the knee doesn't turn it.
      if (ahead < KNEE_BENT) this.nudge(KNEE_BENT - ahead, [[knee, 0.6], [ankle, -0.4], [toe, -0.4]]);
    }
    for (const [k, [shoulder, elbow, hand]] of ELBOWS.entries()) {
      const back = -this.bend(shoulder, elbow, hand, f, ELBOW_UP);
      if (!Number.isFinite(back)) continue;
      // Once bent the right way, it's kept that way.
      const want = (this.elbowFrom[k] = Math.min(ELBOW_BENT, Math.max(this.elbowFrom[k], back)));
      // Behind is along -DIR.
      if (back < want) this.nudge(-(want - back), [[elbow, 0.5], [shoulder, -0.15], [hand, -0.35]]);
    }
    for (const [k, [ankle, toe]] of ANKLES.entries()) {
      const ahead = this.ahead(ankle, toe, f);
      if (!Number.isFinite(ahead)) continue;
      const want = (this.toeFrom[k] = Math.min(TOE_AHEAD * this.distance(ankle, toe), Math.max(this.toeFrom[k], ahead)));
      if (ahead < want) this.nudge(want - ahead, [[toe, 0.8], [ankle, -0.2]]);
    }
  }
}

/** How far a knee is kept bent forward, and an elbow back, at the least, in metres. */
const KNEE_BENT = 0.015;
const ELBOW_BENT = 0.01;
/** Which way an elbow points as it bends: back and down, with the body's front and up the spine by this much behind it, so an arm held forward bends up. */
const ELBOW_UP = 0.5;
/** The ankle's range, as the angle between shin and foot: drawn up, and pointed. */
const ANKLE_BENT = 1.2;
const ANKLE_POINTED = 2.6;
/** How far ahead of the ankle a toe is kept, as a share of the foot's length. */
const TOE_AHEAD = 0.25;
const ELBOWS = [[J.lShoulder, J.lElbow, J.lHand], [J.rShoulder, J.rElbow, J.rHand]] as const;
const ANKLES = [[J.lAnkle, J.lToe], [J.rAnkle, J.rToe]] as const;
const FORWARD = new Float64Array(3);
const DIR = new Float64Array(3);

/**
 * A dropped gun: three balls held rigid, at the grip, the muzzle and under
 * the middle (the magazine), so it comes to rest on its side. Or anything
 * else small that's dropped, such as a magazine, with balls of its size.
 */
export class Tumbler extends Verlet {
  /** `radius` about half the thing's thickness, so it lies on the ground: a gun's by default. */
  constructor(now: ArrayLike<number>, before: ArrayLike<number>, radius = 0.025) {
    super(3);
    this.pos.set(now);
    this.prev.set(before);
    this.radius.fill(radius);
    this.link(0, 1);
    this.link(1, 2);
    this.link(0, 2);
  }
}
