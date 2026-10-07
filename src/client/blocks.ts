import * as THREE from 'three';
import { Layer } from '../shared/layers.ts';
import type { MapBox, MapFacade } from '../shared/maps/index.ts';
import { mulberry32 } from '../shared/rng.ts';
import type { Rect, World } from '../shared/world.ts';
import { plasterColor } from './structures.ts';
import { coveredLamps } from './townbake.ts';
import { Boxes, IRON, painted, plain, STONE, stuff, type Stuff } from './townparts.ts';

// A map's solid blocks dressed as the houses they stand for, where it has
// blocks in place of buildings (see maps/calabianca2.ts), drawn only like
// the buildings' dressing (see dressing.ts): on every face of a block that
// looks outdoors, a stone plinth along its foot, following the ground, and
// a cornice under its top; stone at its outside corners; a stone lintel
// over every tunnel's mouth and doorway, its corners' stones the jambs; a
// few windows high up, out of reach, framed in stone with their shutters
// shut; and a stone cap along the low blocks, the parapets, in place of
// all that. Thin walls are capped as the buildings' freestanding walls are.
// And under the covered ways, the lamps their light is baked from
// (townbake.ts): iron lanterns hung from the ceiling.

/** How far apart along a face it's sampled for where it looks outdoors. */
const STEP = 0.25;
/** How far out from a face a point is taken as in front of it. */
const OUT = 0.15;
/** How high a block stands over the ground in front of it to be a house; lower, it's a parapet. */
const HOUSE = 2.5;
/** The plinth's height over the ground and how far it stands out. */
const PLINTH = 0.45;
const PLINTH_OUT = 0.06;
/** The cornice's depth, how far it stands out, and how far its upper band reaches over the top. */
const CORNICE = 0.26;
const CORNICE_OUT = 0.12;
const CORNICE_OVER = 0.08;
/** A course of stone at the corners, how far it stands out, and its long and short lengths. */
const COURSE = 0.36;
const PROUD = 0.03;
const LONG = 0.7;
const SHORT = 0.42;
/** A lintel's depth and how far it stands out; how far past the mouth it reaches either side. */
const LINTEL = 0.42;
const LINTEL_OUT = 0.1;
const LINTEL_PAST = 0.3;
/** A parapet's cap: how thick, how far it reaches back over the top, how far out. */
const CAP = 0.08;
const CAP_BACK = 0.36;
const CAP_OUT = 0.05;
/** The windows: width, height, their sill under the top, how far apart, and the share of their places that have one. */
const WINDOW = 1;
const WINDOW_HIGH = 1.4;
const WINDOW_SILL = 2.5;
const WINDOW_EVERY = 3.4;
const WINDOWS = 0.55;
/** The windows' stone surround's width and how far it stands out. */
const JAMB = 0.12;
const REVEAL = 0.06;
/** Each plaster's shutters, one picked for each window. */
const SHUTTERS: Record<number, number[]> = {
  0xf4f1ea: [0x4f7d55, 0x3f7f7c, 0x46709a],
  0xeee2c4: [0x4a6a50, 0x6f5a44, 0x5d6a72],
  0xe8bd6a: [0x5b7b3d, 0x6b4a2f],
  0xe8b09c: [0x7d8f6a, 0x4c5e7a],
  0xc8dce4: [0x3d6a8f, 0x8a3b32, 0xd8d4c8],
};
const PAINT = new Map(Object.entries(SHUTTERS).map(([k, v]) => [Number(k), v.map(painted)]));

/** One side of a block: positions on it as `a` along it, `o` out from it, and y. */
class Side {
  /** Whether it runs along x (facing ±z) or along z. */
  readonly alongX: boolean;
  /** Its plane's x or z. */
  readonly line: number;
  /** Which way out it faces, -1 or 1. */
  readonly s: 1 | -1;
  readonly a0: number;
  readonly a1: number;
  private readonly boxes: Boxes;

  constructor(alongX: boolean, line: number, s: 1 | -1, a0: number, a1: number, boxes: Boxes) {
    this.alongX = alongX;
    this.line = line;
    this.s = s;
    this.a0 = a0;
    this.a1 = a1;
    this.boxes = boxes;
  }

  at(a: number, o: number): [number, number] {
    const c = this.line + this.s * o;
    return this.alongX ? [a, c] : [c, a];
  }

  box(a0: number, a1: number, o0: number, o1: number, y0: number, y1: number, s: Stuff): void {
    const [p, q] = [this.at(Math.min(a0, a1), Math.min(o0, o1)), this.at(Math.max(a0, a1), Math.max(o0, o1))];
    this.boxes.box(Math.min(p[0], q[0]), y0, Math.min(p[1], q[1]), Math.max(p[0], q[0]), y1, Math.max(p[1], q[1]), s);
  }

  /** A box as `box`, from y0 to y1 at its middle along, rising `g` a metre along. */
  sloped(a0: number, a1: number, o0: number, o1: number, y0: number, y1: number, g: number, s: Stuff): void {
    const [p, q] = [this.at(Math.min(a0, a1), Math.min(o0, o1)), this.at(Math.max(a0, a1), Math.max(o0, o1))];
    const [gx, gz] = this.alongX ? [g, 0] : [0, g];
    this.boxes.sheared(Math.min(p[0], q[0]), y0, Math.min(p[1], q[1]), Math.max(p[0], q[0]), y1, Math.max(p[1], q[1]), gx, gz, s);
  }
}

/** What's in front of a face at a point along it: the ground, and how high it's open to the sky or a ceiling; null if nothing is. */
interface Front {
  a: number;
  bottom: number;
  top: number;
}

/** The blocks a map dresses: solid, thick, drawn as they are. */
export function dressedBlocks(world: World): MapBox[] {
  return (world.map?.walls ?? []).filter((w) => !w.look && !w.walk && Math.min(w.maxX - w.minX, w.maxZ - w.minZ) > 0.6);
}

/** The props drawn as door leaves (MapBox.look 'doors'), which take no cap. */
export function doorProps(world: World): Set<number> {
  const out = new Set<number>();
  const doors = (world.map?.walls ?? []).filter((w) => w.look === 'doors');
  if (!doors.length) return out;
  const same = (r: Rect, q: Rect) => Math.abs(r.minX - q.minX) < 1e-6 && Math.abs(r.maxX - q.maxX) < 1e-6 && Math.abs(r.minZ - q.minZ) < 1e-6 && Math.abs(r.maxZ - q.maxZ) < 1e-6;
  world.props.forEach((p, i) => {
    if (p.box.part === 'wall' && doors.some((d) => same(d, p.box))) out.add(i);
  });
  return out;
}

/** Every block of a map dressed, into `boxes`. */
export function dressBlocks(world: World, boxes: Boxes): void {
  for (const b of dressedBlocks(world)) {
    const sides = [
      new Side(true, b.minZ, -1, b.minX, b.maxX, boxes),
      new Side(true, b.maxZ, 1, b.minX, b.maxX, boxes),
      new Side(false, b.minX, -1, b.minZ, b.maxZ, boxes),
      new Side(false, b.maxX, 1, b.minZ, b.maxZ, boxes),
    ];
    for (const side of sides) dressSide(world, b, side);
  }
  for (const f of world.map?.facades ?? []) facade(world, boxes, f);
  for (const s of world.map?.stones ?? []) {
    // Turned about the vertical, its own x along its width: a box of cut stone with a stone cap.
    const q = new THREE.Quaternion().setFromAxisAngle(UP, -s.turn);
    boxes.turned(new THREE.Vector3(s.x, (s.y0 + s.y1) / 2 - 0.04, s.z), new THREE.Vector3(s.width, s.y1 - s.y0 - 0.08, s.depth), q, STONE);
    boxes.turned(new THREE.Vector3(s.x, s.y1 - 0.04, s.z), new THREE.Vector3(s.width + 0.06, 0.08, s.depth + 0.06), q, STONE);
  }
  for (const [x, y, z] of coveredLamps(world)) lantern(boxes, x, y, z);
}

/** A facade's way along, unit, its length, and the way out of it toward the floor. */
function frame(f: MapFacade): { ux: number; uz: number; len: number; nx: number; nz: number } {
  const len = Math.hypot(f.x1 - f.x0, f.z1 - f.z0);
  const [ux, uz] = [(f.x1 - f.x0) / len, (f.z1 - f.z0) / len];
  // The house is on its right looking along it, the floor on its left.
  return { ux, uz, len, nx: uz, nz: -ux };
}

/** Whether (x, z) is behind one of the map's straightened diagonal walls, or within `pad` in front of it. */
function behindFacade(world: World, x: number, z: number, pad: number): boolean {
  for (const f of world.map?.facades ?? []) {
    const { ux, uz, len, nx, nz } = frame(f);
    const t = (x - f.x0) * ux + (z - f.z0) * uz;
    if (t < -pad || t > len + pad) continue;
    const s = (x - f.x0) * nx + (z - f.z0) * nz;
    if (s <= f.out + pad && s >= -f.depth - pad) return true;
  }
  return false;
}

const UP = new THREE.Vector3(0, 1, 0);
const ALONG = new THREE.Vector3(0, 0, 1);

/**
 * A house's diagonal wall drawn straight over the stair of corners its boxes
 * make: a plastered face from its foot to its top, a cornice along the top,
 * and a stone plinth along its foot, following the ground's slope.
 */
function facade(world: World, boxes: Boxes, f: MapFacade): void {
  const { ux, uz, len, nx, nz } = frame(f);
  const c = new THREE.Color();
  const plaster = stuff(Layer.plaster, plasterColor(f.colour, true, c).getHex(), plasterColor(f.colour, false, c).getHex());
  // Its own x along it, z out of it.
  const turn = new THREE.Quaternion().setFromAxisAngle(UP, Math.atan2(-uz, ux));
  /** A box along it from `o0` to `o1` out of its line (toward the floor), `y0` to `y1`, `past` beyond its ends, tilted up its length by `rise` a metre. */
  const piece = (o0: number, o1: number, y0: number, y1: number, past: number, s: Stuff, rise = 0) => {
    const o = (o0 + o1) / 2;
    const at = new THREE.Vector3((f.x0 + f.x1) / 2 + nx * o, (y0 + y1) / 2, (f.z0 + f.z1) / 2 + nz * o);
    const q = turn.clone().multiply(new THREE.Quaternion().setFromAxisAngle(ALONG, Math.atan(rise)));
    boxes.turned(at, new THREE.Vector3(len + 2 * past, y1 - y0, o1 - o0), q, s);
  };
  // The turned box's z is out of the wall: its local +z is toward -n or +n as the turn has it; a box spans o0..o1 either way.
  piece(-f.depth, f.out, f.y0, f.y1, 0.05, plaster);
  piece(f.out, f.out + 0.12, f.y1 - 0.1, f.y1 + 0.08, 0.05, STONE);
  piece(f.out, f.out + 0.06, f.y1 - 0.26, f.y1 - 0.1, 0.02, STONE);
  // The plinth, a metre at a time, following the ground in front from end to end of each; none where the ground steps.
  const ground = (t: number) => world.groundHeight(f.x0 + ux * t + nx * (f.out + 0.4), f.z0 + uz * t + nz * (f.out + 0.4), f.y1);
  const n = Math.max(1, Math.round(len));
  for (let k = 0; k < n; k++) {
    const [t0, t1] = [(len * k) / n, (len * (k + 1)) / n];
    const [g0, g1] = [ground(t0 + 0.05), ground(t1 - 0.05)];
    const rise = (g1 - g0) / (t1 - t0 - 0.1);
    if (Math.abs(rise) > 0.5 || g0 > f.y1 - 1 || g1 > f.y1 - 1) continue;
    const mid = (g0 + g1) / 2;
    const at = new THREE.Vector3(f.x0 + ux * (t0 + t1) / 2 + nx * (f.out + 0.03), mid + 0.15, f.z0 + uz * (t0 + t1) / 2 + nz * (f.out + 0.03));
    const q = turn.clone().multiply(new THREE.Quaternion().setFromAxisAngle(ALONG, Math.atan(rise)));
    boxes.turned(at, new THREE.Vector3((t1 - t0) * Math.hypot(1, rise), 0.6, 0.06), q, STONE);
  }
}

/** A lantern's glass. */
const GLASS = plain(0xfff0c8);

/** An iron lantern, its glass's middle at (x, y, z), hung on a rod from the ceiling over it. */
function lantern(boxes: Boxes, x: number, y: number, z: number): void {
  boxes.box(x - 0.015, y + 0.2, z - 0.015, x + 0.015, y + 0.62, z + 0.015, IRON);
  boxes.box(x - 0.13, y + 0.14, z - 0.13, x + 0.13, y + 0.2, z + 0.13, IRON);
  boxes.box(x - 0.1, y - 0.14, z - 0.1, x + 0.1, y + 0.14, z + 0.1, GLASS);
  for (const [dx, dz] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) boxes.box(x + dx * 0.1 - 0.012, y - 0.14, z + dz * 0.1 - 0.012, x + dx * 0.1 + 0.012, y + 0.14, z + dz * 0.1 + 0.012, IRON);
  boxes.box(x - 0.08, y - 0.18, z - 0.08, x + 0.08, y - 0.14, z + 0.08, IRON);
}

/** Whether (x, y, z) is in nothing built, with a little room round it. */
function air(world: World, x: number, y: number, z: number): boolean {
  return world.terrainHeight(x, z) < y && world.clearAsBuilt(x, y, z, 0.1, 0.01);
}

function dressSide(world: World, b: MapBox, side: Side): void {
  const fronts: (Front | null)[] = [];
  for (let a = side.a0 + STEP / 2; a < side.a1; a += STEP) {
    const [x, z] = side.at(a, OUT);
    const ground = world.groundHeight(x, z, b.y1 - 0.3, 0.02);
    const bottom = Math.max(ground, b.y0);
    const top = Math.min(b.y1, world.ceilingHeight(x, z, bottom + 0.1));
    const open = top - bottom > 0.3 && world.clearAsBuilt(x, bottom + 0.02, z, top - bottom - 0.04, 0.02);
    // Not where a straightened diagonal wall is drawn over it.
    fronts.push(open && !behindFacade(world, x, z, 0.3) ? { a, bottom, top } : null);
  }
  /** Stretches of the side alike by `same`, from a0 to a1 along it. */
  const stretches = (same: (p: Front, q: Front) => boolean, second?: (p: Front, q: Front) => void) => {
    const out: { a0: number; a1: number; fronts: Front[] }[] = [];
    let last: (typeof out)[number] | null = null;
    for (const f of fronts) {
      if (!f) {
        last = null;
        continue;
      }
      const prev = last?.fronts[last.fronts.length - 1];
      // A stretch's second front sets what follows it, if asked (a slope's rate).
      if (last && prev && last.fronts.length === 1 && second && Math.abs(f.a - prev.a - STEP) < 1e-6 && Math.abs(f.bottom - prev.bottom) / STEP <= 0.5) second(prev, f);
      if (last && prev && same(prev, f)) {
        last.a1 = f.a + STEP / 2;
        last.fronts.push(f);
      } else out.push((last = { a0: f.a - STEP / 2, a1: f.a + STEP / 2, fronts: [f] }));
    }
    return out;
  };
  /** Whether the corner at `end` (going `dir` past it) turns outdoors at `y`: open beyond it both in front of the face and in its plane. */
  const corner = (end: number, dir: -1 | 1, y: number) =>
    air(world, ...side.at(end + dir * 0.2, 0.2), y) && air(world, ...side.at(end + dir * 0.2, -0.2), y) ? true : false;
  const atEnd = (a: number, dir: -1 | 1) => Math.abs(a - (dir < 0 ? side.a0 : side.a1)) < 1e-6;
  const rand = mulberry32(Math.floor((side.line * 7919 + side.a0 * 104729 + side.s * 1299709 + b.y1 * 31) * 1000) ^ 0x6d2b79f5);

  // Lower than a house over the ground in front: a parapet, capped, and nothing else.
  for (const st of stretches((p, q) => p.top === q.top && (b.y1 - p.bottom < HOUSE) === (b.y1 - q.bottom < HOUSE))) {
    if (b.y1 - st.fronts[0].bottom >= HOUSE || st.fronts[0].top < b.y1) continue;
    const lo = atEnd(st.a0, -1) && corner(st.a0, -1, b.y1 - 0.3) ? CAP_OUT : 0;
    const hi = atEnd(st.a1, 1) && corner(st.a1, 1, b.y1 - 0.3) ? CAP_OUT : 0;
    side.box(st.a0 - lo, st.a1 + hi, -CAP_BACK, CAP_OUT, b.y1, b.y1 + CAP, STONE);
  }

  // A house's: the plinth along its foot, a piece for each stretch of ground
  // flat or sloping evenly, following its slope.
  let rate = 0;
  for (const st of stretches((p, q) => {
    const d = (q.bottom - p.bottom) / STEP;
    // A step up or down, not a slope, breaks it.
    if (Math.abs(d) > 0.5) return false;
    return Math.abs(q.a - p.a - STEP) < 1e-6 && Math.abs(d - rate) < 0.04;
  }, (p, q) => (rate = (q.bottom - p.bottom) / STEP))) {
    const f = st.fronts[0];
    const g = st.fronts.length > 1 ? (st.fronts[st.fronts.length - 1].bottom - f.bottom) / (st.fronts.length - 1) / STEP : 0;
    // Not where the block's foot is a way's ceiling, nor along a lower block's top.
    if (b.y1 - f.bottom < HOUSE || f.bottom <= b.y0 + 0.01 || !onGround(world, side, f)) continue;
    const lo = atEnd(st.a0, -1) && corner(st.a0, -1, f.bottom + 0.3) ? PLINTH_OUT : 0;
    const hi = atEnd(st.a1, 1) && corner(st.a1, 1, f.bottom + 0.3) ? PLINTH_OUT : 0;
    const mid = f.bottom + g * ((st.a0 + st.a1) / 2 - f.a);
    side.sloped(st.a0 - lo, st.a1 + hi, 0, PLINTH_OUT, mid - 0.15, mid + PLINTH, g, STONE);
  }

  // Its cornice, along the top where the sky's over it, and a lintel along the foot where it roofs a way through.
  for (const st of stretches((p, q) => p.top === q.top && (p.bottom > b.y0 + 0.01) === (q.bottom > b.y0 + 0.01))) {
    const f = st.fronts[0];
    if (f.top < b.y1 || b.y1 - Math.min(...st.fronts.map((g) => g.bottom)) < HOUSE) continue;
    const lo = atEnd(st.a0, -1) && corner(st.a0, -1, b.y1 - 0.15) ? CORNICE_OUT : 0;
    const hi = atEnd(st.a1, 1) && corner(st.a1, 1, b.y1 - 0.15) ? CORNICE_OUT : 0;
    side.box(st.a0 - lo, st.a1 + hi, 0, CORNICE_OUT, b.y1 - 0.1, b.y1 + CORNICE_OVER, STONE);
    side.box(st.a0 - lo / 2, st.a1 + hi / 2, 0, CORNICE_OUT / 2, b.y1 - CORNICE, b.y1 - 0.1, STONE);
    // Over a tunnel's mouth or a doorway: the block's foot is the way's ceiling.
    if (f.bottom <= b.y0 + 0.01 && b.y0 - world.groundHeight(...side.at(f.a, OUT), b.y0 - 0.5, 0.02) > 1.5) {
      side.box(st.a0 - LINTEL_PAST, st.a1 + LINTEL_PAST, 0, LINTEL_OUT, b.y0, b.y0 + LINTEL, STONE);
    }
  }

  // Stone at its outside corners, from the plinth up to the cornice, while the corner turns outdoors.
  for (const [end, dir] of [[side.a0, -1], [side.a1, 1]] as const) {
    const i = dir < 0 ? 0 : fronts.length - 1;
    const f = fronts[i];
    if (!f || b.y1 - f.bottom < HOUSE) continue;
    const from = f.bottom + PLINTH;
    const to = (f.top < b.y1 ? f.top : b.y1 - CORNICE) - 0.01;
    const n = Math.max(1, Math.round((to - from) / COURSE));
    const h = (to - from) / n;
    // The courses long and short in turn, the other side's the other way round.
    const flip = side.alongX ? 0 : 1;
    for (let k = 0; k < n; k++) {
      const y0 = from + k * h;
      if (!corner(end, dir, y0 + h / 2)) continue;
      const len = (k + flip) % 2 ? SHORT : LONG;
      const [s0, s1] = dir < 0 ? [end - PROUD, end + len] : [end - len, end + PROUD];
      side.box(s0, s1, 0, PROUD, y0 + 0.01, y0 + h - 0.01, STONE);
    }
  }

  // A few windows high up on a plastered house, their shutters shut.
  const paints = b.colour !== undefined ? PAINT.get(b.colour) : undefined;
  if (!paints) return;
  for (const st of stretches((p, q) => p.top === q.top)) {
    if (st.fronts[0].top < b.y1) continue;
    const span = st.a1 - st.a0 - 2 * (LONG + 0.3);
    const n = Math.floor(span / WINDOW_EVERY) + 1;
    if (span < WINDOW) continue;
    const start = (st.a0 + st.a1) / 2 - ((n - 1) * WINDOW_EVERY) / 2;
    for (let k = 0; k < n; k++) {
      const at = start + k * WINDOW_EVERY;
      const want = rand();
      const paint = paints[Math.floor(rand() * paints.length)];
      const sill = b.y1 - WINDOW_SILL;
      const under = st.fronts.filter((f) => Math.abs(f.a - at) < WINDOW / 2 + JAMB + 0.2);
      if (want > WINDOWS || under.some((f) => sill - f.bottom < 3.2)) continue;
      window(side, at, sill, paint);
    }
  }
}

/** Whether the floor in front of a face is the ground or one walked on (a terrace, a stair, a ramp), not a lower block's top. */
function onGround(world: World, side: Side, f: Front): boolean {
  const [x, z] = side.at(f.a, OUT);
  return f.bottom - world.terrainHeight(x, z) < 0.05 || world.floorTops(x, z, 0.02).some((y) => Math.abs(y - f.bottom) < 0.01);
}

/** A window `at` along the side, its sill at `sill`: a stone surround and sill, its shutters shut in `paint`. */
function window(side: Side, at: number, sill: number, paint: Stuff): void {
  const [o0, o1] = [at - WINDOW / 2, at + WINDOW / 2];
  const head = sill + WINDOW_HIGH;
  side.box(o0 - JAMB, o0, 0, REVEAL, sill, head, STONE);
  side.box(o1, o1 + JAMB, 0, REVEAL, sill, head, STONE);
  side.box(o0 - JAMB - 0.04, o1 + JAMB + 0.04, 0, REVEAL + 0.02, head, head + 0.18, STONE);
  side.box(o0 - JAMB - 0.05, o1 + JAMB + 0.05, -0.01, 0.14, sill - 0.08, sill, STONE);
  // The two leaves, slatted, meeting in the middle.
  for (const [p, q] of [[o0, at - 0.005], [at + 0.005, o1]]) {
    side.box(p, q, 0, 0.03, sill, head, paint);
    for (let k = 0; k < 7; k++) {
      const y = sill + 0.1 + k * 0.17;
      side.box(p + 0.05, q - 0.05, 0.03, 0.045, y, y + 0.05, paint);
    }
  }
}
