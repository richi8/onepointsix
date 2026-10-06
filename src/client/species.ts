import * as THREE from 'three';
import { mulberry32 } from '../shared/rng.ts';
import { filled } from './cardtexture.ts';
import { tube, type Species, type TreeShape } from './trees.ts';

// The trees and shrubs of a southern Italian hillside, generated as the
// spruces are (see trees.ts): olives, gnarled and silver-grey; plane trees
// with a pale mottled trunk under a broad dome of big leaves; cypresses, dark
// narrow flames; umbrella pines, a tall bare trunk under a flat crown; holm
// oaks, round and dark; and the maquis's shrubs. Each grows a skeleton of
// boughs from a seed (a trunk, limbs, and branches forking off them level by
// level, with the habit of its kind) and carries its foliage as cards round
// the tips of its last branches, showing a picture of a spray of its leaves
// drawn on a canvas. Up close the cards are smaller, many and bent, and every
// bough is drawn; farther off the same tree has a few large flat cards and
// only its trunk and limbs, as the spruces do.

export type Kind = 'olive' | 'plane' | 'cypress' | 'pine' | 'oak' | 'shrub';
export const KINDS: readonly Kind[] = ['olive', 'plane', 'cypress', 'pine', 'oak', 'shrub'];

const UP = new THREE.Vector3(0, 1, 0);

/** One level of a kind's branching: how long its branches grow, how many forks each, how far they splay and how they bend up (+) or droop (-). */
interface Level {
  len: number;
  kids: number;
  spread: number;
  rise: number;
}

interface Bough {
  points: THREE.Vector3[];
  radii: number[];
  /** -1 for a trunk, then each level of branching. */
  depth: number;
}

/** Where foliage grows: the end of a branch, and the way it was growing. */
interface Tip {
  at: THREE.Vector3;
  dir: THREE.Vector3;
}

interface Skeleton {
  boughs: Bough[];
  tips: Tip[];
}

/** The crown's middle and its radii, for shading the foliage as one mass. */
interface Crown {
  c: THREE.Vector3;
  r: THREE.Vector3;
}

/** `dir` turned `angle` off itself, toward `azimuth` round it. */
function deviate(dir: THREE.Vector3, angle: number, azimuth: number): THREE.Vector3 {
  const u = new THREE.Vector3().crossVectors(dir, Math.abs(dir.y) < 0.95 ? UP : new THREE.Vector3(1, 0, 0)).normalize();
  const v = new THREE.Vector3().crossVectors(dir, u);
  return dir.clone().multiplyScalar(Math.cos(angle)).add(u.multiplyScalar(Math.cos(azimuth) * Math.sin(angle))).add(v.multiplyScalar(Math.sin(azimuth) * Math.sin(angle))).normalize();
}

/** The point `t` of the way along a polyline. */
function along(points: readonly THREE.Vector3[], t: number): THREE.Vector3 {
  const f = Math.min(Math.max(t, 0), 1) * (points.length - 1);
  const i = Math.min(Math.floor(f), points.length - 2);
  return points[i].clone().lerp(points[i + 1], f - i);
}

/** A bough from `at` along `dir`, `r` thick at its foot, forking level by level. */
function grow(sk: Skeleton, rand: () => number, at: THREE.Vector3, dir: THREE.Vector3, r: number, levels: readonly Level[], depth = 0): void {
  const lv = levels[depth];
  const len = lv.len * (0.75 + rand() * 0.5);
  const segs = depth === 0 ? 4 : 3;
  const points = [at.clone()];
  const d = dir.clone();
  for (let k = 1; k <= segs; k++) {
    d.y += lv.rise * (len / segs);
    d.x += (rand() - 0.5) * 0.3;
    d.z += (rand() - 0.5) * 0.3;
    d.normalize();
    points.push(points[k - 1].clone().addScaledVector(d, len / segs));
  }
  const radii = points.map((_, k) => r * (1 - (0.5 * k) / segs));
  sk.boughs.push({ points, radii, depth });
  if (depth === levels.length - 1) {
    sk.tips.push({ at: points[segs], dir: d.clone() }, { at: along(points, 0.5), dir: d.clone() });
    return;
  }
  const turn = rand() * Math.PI * 2;
  for (let i = 0; i < lv.kids; i++) {
    // The last carries on from the tip; the rest fork off along the way.
    const last = i === lv.kids - 1;
    const t = last ? 1 : 0.4 + (0.55 * (i + rand())) / lv.kids;
    const nd = deviate(d, lv.spread * (last ? 0.45 : 0.8 + rand() * 0.4), turn + i * 2.4 + rand() * 0.6);
    grow(sk, rand, along(points, t), nd, r * (1 - 0.5 * t) * 0.72, levels, depth + 1);
  }
}

/** A trunk up through `points`, `r0` thick at its foot flaring wider, to `r1` at its top. */
function trunk(sk: Skeleton, points: THREE.Vector3[], r0: number, r1: number, flare = 0.4): void {
  const top = points[points.length - 1].y || 1;
  sk.boughs.push({ points, radii: points.map((p) => r0 + (r1 - r0) * (p.y / top) + r0 * flare * Math.max(0, 1 - p.y / 0.6) ** 2), depth: -1 });
}

/** A path rising from `from` to `height`, leaning `lean` metres toward `azimuth`, bowed, in `n` steps, wobbling by `wobble`. */
function stem(rand: () => number, from: THREE.Vector3, height: number, lean: number, azimuth: number, n: number, wobble: number): THREE.Vector3[] {
  const out: THREE.Vector3[] = [];
  for (let k = 0; k <= n; k++) {
    const f = k / n;
    // Leaning more toward the top, as a bow.
    const l = lean * f ** 1.4;
    const w = k ? wobble : 0;
    out.push(new THREE.Vector3(from.x + Math.cos(azimuth) * l + (rand() - 0.5) * w, from.y + height * f, from.z + Math.sin(azimuth) * l + (rand() - 0.5) * w));
  }
  return out;
}

/** The middle and radii of the crown round `tips`, grown by `pad`. */
function crownOf(tips: readonly Tip[], pad: number): Crown {
  const box = new THREE.Box3();
  for (const t of tips) box.expandByPoint(t.at);
  const c = box.getCenter(new THREE.Vector3());
  const r = box.getSize(new THREE.Vector3()).multiplyScalar(0.5).addScalar(pad);
  return { c, r };
}

/** A tree's geometry as it's built: its wood, and its foliage cards. */
class Builder {
  readonly wood = { pos: [] as number[], nrm: [] as number[], index: [] as number[] };
  readonly leaf = { pos: [] as number[], nrm: [] as number[], uv: [] as number[], color: [] as number[], index: [] as number[] };

  /** Every bough up to `depth`, round with `sides(depth)`. */
  boughs(sk: Skeleton, depth: number, sides: (depth: number) => number): void {
    for (const b of sk.boughs) if (b.depth <= depth) tube(this.wood, b.points, b.radii.map((r) => Math.max(r, 0.01)), sides(b.depth));
  }

  /**
   * A card from `base` along `dir`, `len` long and `width` across `side`,
   * its tip drooping by `droop`, showing row `row` of the picture. Its
   * normals point out of the crown, and it darkens deep inside it and
   * toward its foot. `bent` arches it, up close.
   */
  card(base: THREE.Vector3, dir: THREE.Vector3, side: THREE.Vector3, len: number, width: number, droop: number, row: number, bent: boolean, crown: Crown, axial = false): void {
    const steps = bent ? [0, 0.5, 1] : [0, 1];
    const first = this.leaf.pos.length / 3;
    const q = new THREE.Vector3();
    for (const u of steps) {
      for (const w of steps) {
        const p = base.clone().addScaledVector(dir, len * u).addScaledVector(side, (w - 0.5) * width);
        p.y -= droop * len * u * u + (bent && w !== 0.5 ? width * 0.15 : 0);
        this.leaf.pos.push(p.x, p.y, p.z);
        q.subVectors(p, crown.c).divide(crown.r);
        // Out from the crown, and for a column (`axial`) from its axis, a little up.
        const n = axial ? new THREE.Vector3(q.x, 0.3, q.z).normalize() : new THREE.Vector3(q.x, q.y + 0.35, q.z).normalize();
        this.leaf.nrm.push(n.x, n.y, n.z);
        this.leaf.uv.push(u, row * 0.5 + w * 0.5);
        const deep = Math.min(1, axial ? Math.hypot(q.x, q.z) : q.length());
        const foot = Math.min(1, Math.max(0, (q.y + 1) / 2));
        const dark = (0.34 + 0.66 * deep ** 1.2) * (0.76 + 0.24 * foot);
        this.leaf.color.push(dark, dark, dark);
      }
    }
    const cols = steps.length;
    for (let r = 0; r < cols - 1; r++) {
      for (let c = 0; c < cols - 1; c++) {
        const a = first + r * cols + c;
        this.leaf.index.push(a, a + cols, a + 1, a + 1, a + cols, a + cols + 1);
      }
    }
  }

  /** `per` cards round each tip, on average, within `spread` of it, `len` long, from a stream of their own. */
  sprays(tips: readonly Tip[], rand: () => number, per: number, len: number, width: number, spread: number, droop: number, bent: boolean, crown: Crown, lift = 0): void {
    for (const t of tips) {
      const n = Math.floor(per + rand());
      for (let k = 0; k < n; k++) {
        const off = new THREE.Vector3(rand() - 0.5, (rand() - 0.5) * 0.7, rand() - 0.5).multiplyScalar(spread * 2);
        const l = len * (0.8 + rand() * 0.4);
        const dir = t.dir.clone().multiplyScalar(0.8).add(new THREE.Vector3(rand() - 0.5, rand() - 0.5 + lift, rand() - 0.5)).normalize();
        const side = new THREE.Vector3().crossVectors(dir, new THREE.Vector3(rand() - 0.5, rand() - 0.5, rand() - 0.5)).normalize();
        const centre = t.at.clone().add(off);
        this.card(centre.addScaledVector(dir, -l * 0.45), dir, side, l, width * (0.85 + rand() * 0.3), droop, rand() < 0.5 ? 0 : 1, bent, crown);
      }
    }
  }

  shape(): TreeShape {
    const wood = new THREE.BufferGeometry();
    wood.setAttribute('position', new THREE.Float32BufferAttribute(this.wood.pos, 3));
    wood.setAttribute('normal', new THREE.Float32BufferAttribute(this.wood.nrm, 3));
    wood.setIndex(this.wood.index);
    const foliage = new THREE.BufferGeometry();
    foliage.setAttribute('position', new THREE.Float32BufferAttribute(this.leaf.pos, 3));
    foliage.setAttribute('normal', new THREE.Float32BufferAttribute(this.leaf.nrm, 3));
    foliage.setAttribute('uv', new THREE.Float32BufferAttribute(this.leaf.uv, 2));
    foliage.setAttribute('color', new THREE.Float32BufferAttribute(this.leaf.color, 3));
    foliage.setIndex(this.leaf.index);
    return { wood, foliage };
  }
}

/** Sides round a bough, near or far, by its depth. */
const SIDES = (near: boolean) => (d: number) => (near ? [8, 5, 4, 3, 3, 3][d + 1] : [5, 3, 3, 3, 3, 3][d + 1]);

/**
 * An olive: two or three stems twisting up from a gnarled foot and leaning
 * apart, limbs spreading wide from them, and an open, uneven crown of
 * grey-green sprays, drooping at the tips.
 */
function olive(seed: number, near: boolean): TreeShape {
  const rand = mulberry32(seed);
  const sk: Skeleton = { boughs: [], tips: [] };
  const stems = rand() < 0.4 ? 3 : 2;
  const turn = rand() * Math.PI * 2;
  const levels: Level[] = [
    { len: 1.5, kids: 3, spread: 0.6, rise: 0.12 },
    { len: 1.0, kids: 3, spread: 0.65, rise: 0 },
    { len: 0.6, kids: 2, spread: 0.7, rise: -0.3 },
  ];
  for (let s = 0; s < stems; s++) {
    const a = turn + (s / stems) * Math.PI * 2 + (rand() - 0.5) * 0.8;
    const foot = new THREE.Vector3(Math.cos(a) * 0.12, 0, Math.sin(a) * 0.12);
    const path = stem(rand, foot, 1.3 + rand() * 0.5, 0.45 + rand() * 0.3, a, 4, 0.14);
    trunk(sk, path, 0.19, 0.1, 0.6);
    const top = path[path.length - 1];
    const limbs = 2 + Math.floor(rand() * 2);
    for (let k = 0; k < limbs; k++) {
      const az = a + (k - (limbs - 1) / 2) * 1.1 + (rand() - 0.5) * 0.5;
      const elev = 0.5 + rand() * 0.5;
      const dir = new THREE.Vector3(Math.cos(az) * Math.cos(elev), Math.sin(elev), Math.sin(az) * Math.cos(elev));
      grow(sk, rand, top, dir, 0.1, levels);
    }
  }
  const crown = crownOf(sk.tips, 0.5);
  const b = new Builder();
  b.boughs(sk, near ? 2 : -1, SIDES(near));
  const leaves = mulberry32(seed + 1);
  if (near) b.sprays(sk.tips, leaves, 3, 0.7, 0.62, 0.5, 0.08, true, crown);
  else b.sprays(sk.tips, leaves, 1, 1.3, 1.05, 0.3, 0.05, false, crown);
  return b.shape();
}

/**
 * A plane tree: a straight trunk forking at a little over head height into
 * steep limbs, and a broad dome of big leaves on the branches spreading out
 * from them.
 */
function plane(seed: number, near: boolean): TreeShape {
  const rand = mulberry32(seed);
  const sk: Skeleton = { boughs: [], tips: [] };
  const path = stem(rand, new THREE.Vector3(), 4.4, 0.25, rand() * Math.PI * 2, 4, 0.05);
  trunk(sk, path, 0.36, 0.22, 0.35);
  const top = path[path.length - 1];
  const levels: Level[] = [
    { len: 3.4, kids: 3, spread: 0.5, rise: 0.02 },
    { len: 2.3, kids: 3, spread: 0.55, rise: -0.02 },
    { len: 1.4, kids: 2, spread: 0.6, rise: -0.08 },
    { len: 0.8, kids: 2, spread: 0.6, rise: -0.15 },
  ];
  const limbs = 4;
  const turn = rand() * Math.PI * 2;
  for (let k = 0; k < limbs; k++) {
    const az = turn + (k / limbs) * Math.PI * 2 + (rand() - 0.5) * 0.5;
    const elev = 0.95 + rand() * 0.25;
    grow(sk, rand, top, new THREE.Vector3(Math.cos(az) * Math.cos(elev), Math.sin(elev), Math.sin(az) * Math.cos(elev)), 0.2, levels);
  }
  const crown = crownOf(sk.tips, 0.8);
  const b = new Builder();
  b.boughs(sk, near ? 3 : 1, SIDES(near));
  const leaves = mulberry32(seed + 1);
  if (near) b.sprays(sk.tips, leaves, 3, 1.7, 1.3, 0.6, 0.15, true, crown);
  else b.sprays(sk.tips, leaves, 0.9, 3, 2.4, 0.35, 0.1, false, crown);
  return b.shape();
}

/** A holm oak, or (`shrub`) a shrub of the maquis: a short trunk or several stems from the ground, and a dense round crown of small dark leaves. */
function evergreen(seed: number, near: boolean, shrub: boolean): TreeShape {
  const rand = mulberry32(seed);
  const sk: Skeleton = { boughs: [], tips: [] };
  const b = new Builder();
  if (shrub) {
    const levels: Level[] = [
      { len: 0.7, kids: 3, spread: 0.7, rise: 0.1 },
      { len: 0.45, kids: 2, spread: 0.7, rise: -0.1 },
    ];
    const stems = 5 + Math.floor(rand() * 3);
    for (let k = 0; k < stems; k++) {
      const az = rand() * Math.PI * 2;
      const elev = 0.75 + rand() * 0.6;
      grow(sk, rand, new THREE.Vector3(Math.cos(az) * 0.1, 0, Math.sin(az) * 0.1), new THREE.Vector3(Math.cos(az) * Math.cos(elev), Math.sin(elev), Math.sin(az) * Math.cos(elev)), 0.04, levels);
    }
    // Low sprays round the foot, so the bush is thick down to the ground.
    for (let k = 0; k < 6; k++) {
      const az = (k / 6) * Math.PI * 2 + rand();
      sk.tips.push({ at: new THREE.Vector3(Math.cos(az) * 0.55, 0.35, Math.sin(az) * 0.55), dir: new THREE.Vector3(Math.cos(az), 0.3, Math.sin(az)).normalize() });
    }
    const crown = crownOf(sk.tips, 0.4);
    b.boughs(sk, near ? 1 : -1, SIDES(near));
    const leaves = mulberry32(seed + 1);
    if (near) b.sprays(sk.tips, leaves, 2.2, 0.7, 0.52, 0.32, 0.1, true, crown, 0.3);
    else b.sprays(sk.tips, leaves, 1, 1.05, 0.85, 0.15, 0.05, false, crown, 0.3);
    return b.shape();
  }
  const path = stem(rand, new THREE.Vector3(), 2, 0.3, rand() * Math.PI * 2, 3, 0.08);
  trunk(sk, path, 0.24, 0.12, 0.4);
  const top = path[path.length - 1];
  const levels: Level[] = [
    { len: 2.1, kids: 3, spread: 0.6, rise: 0.08 },
    { len: 1.3, kids: 3, spread: 0.65, rise: 0 },
    { len: 0.7, kids: 2, spread: 0.7, rise: -0.15 },
  ];
  const limbs = 5;
  const turn = rand() * Math.PI * 2;
  for (let k = 0; k < limbs; k++) {
    const az = turn + (k / limbs) * Math.PI * 2 + (rand() - 0.5) * 0.6;
    const elev = 0.6 + rand() * 0.5;
    grow(sk, rand, top, new THREE.Vector3(Math.cos(az) * Math.cos(elev), Math.sin(elev), Math.sin(az) * Math.cos(elev)), 0.12, levels);
  }
  const crown = crownOf(sk.tips, 0.6);
  b.boughs(sk, near ? 2 : -1, SIDES(near));
  const leaves = mulberry32(seed + 1);
  if (near) b.sprays(sk.tips, leaves, 2.6, 0.95, 0.75, 0.5, 0.1, true, crown);
  else b.sprays(sk.tips, leaves, 0.8, 1.7, 1.4, 0.3, 0.05, false, crown);
  return b.shape();
}

/** A cypress's radius at `f` of its height: widest a little above its foot, tapering to a flame. */
function cypressReach(f: number, phase: number): number {
  const r = f < 0.12 ? 0.75 + (0.25 * f) / 0.12 : ((1 - f) / 0.88) ** 0.8;
  return 1.05 * r * (1 + 0.07 * Math.sin(f * 13 + phase));
}

/** A cypress: a narrow column of dark sprays rising round a hidden trunk to a point. */
function cypress(seed: number, near: boolean): TreeShape {
  const rand = mulberry32(seed);
  const H = 12;
  const phase = rand() * 6;
  const sk: Skeleton = { boughs: [], tips: [] };
  trunk(sk, stem(rand, new THREE.Vector3(), H * 0.93, 0.15, rand() * Math.PI * 2, 5, 0.04), 0.17, 0.02, 0.3);
  // Short branches climbing steeply out of it, hidden but for the lowest.
  if (near) {
    for (let y = 0.6; y < H * 0.85; y += 0.5) {
      for (let k = 0; k < 3; k++) {
        const a = rand() * Math.PI * 2;
        const r = cypressReach(y / H, phase) * 0.75;
        const foot = new THREE.Vector3(0, y, 0);
        sk.boughs.push({ points: [foot, new THREE.Vector3(Math.cos(a) * r, y + r * 1.6, Math.sin(a) * r)], radii: [0.03, 0.008], depth: 1 });
      }
    }
  }
  const crown: Crown = { c: new THREE.Vector3(0, H / 2, 0), r: new THREE.Vector3(1.1, H / 2, 1.1) };
  const b = new Builder();
  b.boughs(sk, near ? 1 : -1, SIDES(near));
  const leaves = mulberry32(seed + 1);
  const [n, len, width] = near ? [460, 1, 0.6] : [120, 1.7, 1.05];
  for (let k = 0; k < n; k++) {
    const y = 0.3 + (H - 0.6) * leaves() ** 0.9;
    const f = y / H;
    const a = leaves() * Math.PI * 2;
    const reach = cypressReach(f, phase);
    const r = reach * (0.35 + 0.65 * Math.sqrt(leaves())) - (near ? 0 : 0.15);
    const out = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
    const l = Math.min(len * (0.8 + leaves() * 0.4), (H - y) * 1.3 + 0.2);
    const dir = out.clone().multiplyScalar(0.25 + (leaves() - 0.5) * 0.3).add(new THREE.Vector3((leaves() - 0.5) * 0.3, 1, (leaves() - 0.5) * 0.3)).normalize();
    const side = new THREE.Vector3(-out.z, 0, out.x).applyAxisAngle(dir, (leaves() - 0.5) * 1.2).normalize();
    const base = out.multiplyScalar(Math.max(r, 0.05)).setY(y - l * 0.45);
    b.card(base, dir, side, l, Math.min(width, reach * 1.4) * (0.8 + leaves() * 0.4), -0.05, leaves() < 0.5 ? 0 : 1, near, crown, true);
  }
  return b.shape();
}

/**
 * An umbrella pine: a tall bare trunk, often leaning, forking high up into
 * limbs that spread out and up, and on their ends tufts of needles making a
 * broad, flat-topped crown.
 */
function pine(seed: number, near: boolean): TreeShape {
  const rand = mulberry32(seed);
  const sk: Skeleton = { boughs: [], tips: [] };
  const lean = rand() * Math.PI * 2;
  const path = stem(rand, new THREE.Vector3(), 8.2 + rand() * 0.8, 0.8 + rand() * 0.8, lean, 5, 0.12);
  trunk(sk, path, 0.3, 0.14, 0.35);
  const levels: Level[] = [
    { len: 3.8, kids: 3, spread: 0.45, rise: -0.02 },
    { len: 2.4, kids: 3, spread: 0.55, rise: -0.02 },
    { len: 1.3, kids: 2, spread: 0.6, rise: 0.1 },
  ];
  const limbs = 4 + Math.floor(rand() * 2);
  for (let k = 0; k < limbs; k++) {
    const az = (k / limbs) * Math.PI * 2 + rand() * 0.6;
    const elev = 0.45 + rand() * 0.3;
    // The last from the trunk's top, the rest forking off up its last stretch.
    const from = along(path, k === limbs - 1 ? 1 : 0.82 + rand() * 0.15);
    grow(sk, rand, from, new THREE.Vector3(Math.cos(az) * Math.cos(elev), Math.sin(elev), Math.sin(az) * Math.cos(elev)), 0.15, levels);
  }
  // Pressed into a flat band, as a pine's crown is: the highest tips held down and the lowest lifted toward the rest.
  let highest = -Infinity;
  for (const t of sk.tips) highest = Math.max(highest, t.at.y);
  const [lo, hi] = [highest - 2.6, highest - 1];
  for (const t of sk.tips) {
    if (t.at.y > hi) t.at.y = hi + (t.at.y - hi) * 0.4;
    else if (t.at.y < lo) t.at.y = lo - (lo - t.at.y) * 0.3;
  }
  const crown = crownOf(sk.tips, 0.7);
  const b = new Builder();
  b.boughs(sk, near ? 2 : 0, SIDES(near));
  const leaves = mulberry32(seed + 1);
  // Tufts lying out flat or tipped up a little, so the crown is a flat, dark mass from below.
  const [per, len, width, spread] = near ? [5, 1.4, 1.2, 0.85] : [1.4, 2.6, 2.2, 0.5];
  for (const t of sk.tips) {
    const n = Math.floor(per + leaves());
    for (let k = 0; k < n; k++) {
      const az = leaves() * Math.PI * 2;
      const tilt = 0.15 + leaves() * 0.6;
      const dir = new THREE.Vector3(Math.cos(az) * Math.cos(tilt), Math.sin(tilt), Math.sin(az) * Math.cos(tilt));
      const side = new THREE.Vector3(-Math.sin(az), 0, Math.cos(az)).applyAxisAngle(dir, (leaves() - 0.5) * 0.8);
      const off = new THREE.Vector3(leaves() - 0.5, (leaves() - 0.5) * 0.5, leaves() - 0.5).multiplyScalar(spread * 2);
      const l = len * (0.8 + leaves() * 0.4);
      b.card(t.at.clone().add(off).addScaledVector(dir, -l * 0.45), dir, side, l, width * (0.85 + leaves() * 0.3), 0, leaves() < 0.5 ? 0 : 1, near, crown);
    }
  }
  return b.shape();
}

/** A unit tree of `kind` from `seed`: in full (`near`), or plainer for farther off. */
export function shapeOf(kind: Kind, seed: number, near: boolean): TreeShape {
  switch (kind) {
    case 'olive':
      return olive(seed, near);
    case 'plane':
      return plane(seed, near);
    case 'cypress':
      return cypress(seed, near);
    case 'pine':
      return pine(seed, near);
    case 'oak':
      return evergreen(seed, near, false);
    case 'shrub':
      return evergreen(seed, near, true);
  }
}

/**
 * How each kind sways, from where up; how its bark is tinted, brightened by
 * `gain` past the bark's dark texture (a plane's is pale and mottled, an
 * olive's grey); its wood's colour before the textures; and how far out
 * it's drawn in full detail, less for the small and the many, and for them
 * how far out before they turn into their impostors.
 */
const HABITS: Record<Kind, { stiff: number; sway: number; bark: number; gain: number; wood: number; near: [number, number]; fade?: [number, number] }> = {
  olive: { stiff: 1, sway: 0.1, bark: 0xc8c4bc, gain: 1.6, wood: 0x6e6a60, near: [16, 24], fade: [60, 80] },
  plane: { stiff: 4, sway: 0.3, bark: 0xf2ead0, gain: 2.3, wood: 0xa8a088, near: [30, 40] },
  cypress: { stiff: 1, sway: 0.5, bark: 0xa08878, gain: 1.2, wood: 0x4a3a2c, near: [18, 26] },
  pine: { stiff: 7, sway: 0.25, bark: 0xd8a888, gain: 1.4, wood: 0x6a4a36, near: [24, 32] },
  oak: { stiff: 1.5, sway: 0.15, bark: 0xa8a49c, gain: 1.3, wood: 0x4a4440, near: [18, 26], fade: [70, 90] },
  shrub: { stiff: 0.2, sway: 0.08, bark: 0xa09080, gain: 1.2, wood: 0x4a3a2c, near: [10, 16], fade: [40, 55] },
};

/** How tall and how far round a shape reaches. */
export function extent(shape: TreeShape): { reach: number; top: number } {
  let reach = 0;
  let top = 0;
  for (const g of [shape.wood, shape.foliage]) {
    const pos = g.getAttribute('position');
    for (let i = 0; i < pos.count; i++) {
      reach = Math.max(reach, Math.hypot(pos.getX(i), pos.getZ(i)));
      top = Math.max(top, pos.getY(i));
    }
  }
  return { reach, top };
}

const pictures = new Map<string, THREE.Texture>();

/** A kind of tree, from `seed`, with its picture: for the browser, which draws the picture. */
export function species(kind: Kind, seed: number): Species {
  const near = shapeOf(kind, seed, true);
  const far = shapeOf(kind, seed, false);
  const a = extent(near);
  const b = extent(far);
  const height = Math.max(a.top, b.top) * 1.02;
  const half = Math.max(a.reach, b.reach) * 1.04 + 0.05;
  const scale = 256 / Math.max(half * 2, height);
  const h = HABITS[kind];
  const picture = kind === 'shrub' ? 'oak' : kind;
  let map = pictures.get(picture);
  if (!map) pictures.set(picture, (map = leafPicture(picture)));
  return {
    name: kind,
    height,
    half,
    stiff: h.stiff,
    sway: h.sway,
    near,
    far,
    map,
    woodColor: new THREE.Color(h.wood),
    bark: new THREE.Color(h.bark).multiplyScalar(h.gain),
    bake: [Math.max(64, Math.round(half * 2 * scale)), Math.max(64, Math.round(height * scale))],
    nearRange: h.near,
    ...(h.fade ? { fadeRange: h.fade } : {}),
  };
}

// ---------------------------------------------------------------- pictures

/**
 * Two sprays of a kind's leaves, one over the other, each from its stalk at
 * the left to its tip at the right, as the cards show them.
 */
function leafPicture(kind: Exclude<Kind, 'shrub'>): THREE.Texture {
  const w = 512;
  const h = 256;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const g = canvas.getContext('2d')!;
  g.lineCap = 'round';
  g.lineJoin = 'round';
  const rand = mulberry32(KINDS.indexOf(kind) * 31 + 5);
  for (const row of [0, 1]) {
    g.save();
    g.beginPath();
    g.rect(0, row * (h / 2), w, h / 2);
    g.clip();
    const mid = row * (h / 2) + h / 4;
    DRAW[kind](g, rand, w, mid, h / 4 - 4, row);
    g.restore();
  }
  const tex = filled(canvas);
  tex.anisotropy = 4;
  return tex;
}

type Draw = (g: CanvasRenderingContext2D, rand: () => number, w: number, mid: number, room: number, row: number) => void;

/** A twig from (x0, y0) to (x1, y1), `width` thick. */
function twig(g: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, width: number, colour: string): void {
  g.strokeStyle = colour;
  g.lineWidth = width;
  g.beginPath();
  g.moveTo(x0, y0);
  g.lineTo(x1, y1);
  g.stroke();
}

/** A lance-shaped leaf from its stalk at (x, y) toward `angle`, `len` long and `width` across, with its midrib. */
function lance(g: CanvasRenderingContext2D, x: number, y: number, angle: number, len: number, width: number, fill: string, rib?: string): void {
  g.save();
  g.translate(x, y);
  g.rotate(angle);
  g.fillStyle = fill;
  g.beginPath();
  g.moveTo(0, 0);
  g.quadraticCurveTo(len * 0.35, -width, len, 0);
  g.quadraticCurveTo(len * 0.35, width, 0, 0);
  g.fill();
  if (rib) {
    g.strokeStyle = rib;
    g.lineWidth = Math.max(0.6, width * 0.12);
    g.beginPath();
    g.moveTo(0, 0);
    g.lineTo(len * 0.9, 0);
    g.stroke();
  }
  g.restore();
}

/** Where a side shoot off a stem at `s` can reach, so the spray is leaf-shaped: short at the stalk and the tip, longest past its middle. */
const roomAt = (s: number, w: number, room: number) => room * Math.sin(Math.PI * Math.min(1, 0.1 + (s / w) * 1.05));

const DRAW: Record<Exclude<Kind, 'shrub'>, Draw> = {
  // A fan of thin shoots from the stalk, wandering, with narrow leaves in
  // pairs along them at every angle, dark grey-green above and silver beneath.
  olive: (g, rand, w, mid, room) => {
    const leaf = () => (rand() < 0.45
      ? `hsl(${68 + rand() * 14}, ${8 + rand() * 8}%, ${56 + rand() * 16}%)`
      : `hsl(${72 + rand() * 18}, ${14 + rand() * 12}%, ${26 + rand() * 13}%)`);
    const shoot = (x0: number, y0: number, a: number, len: number, size: number, depth: number) => {
      let [x, y] = [x0, y0];
      for (let s = 0; s < len; s += 8 + rand() * 5) {
        // Wandering a little, kept inside the spray's outline.
        a += (rand() - 0.5) * 0.25;
        // Turned back toward the middle near the outline.
        if (Math.abs(y + Math.sin(a) * 9 - mid) > roomAt(x + 9, w, room) - 14) a = Math.atan2(mid - y, 40) * 0.6;
        const nx = x + Math.cos(a) * 9;
        const ny = y + Math.sin(a) * 9;
        if (nx > w - 6) break;
        twig(g, x, y, nx, ny, 1.6, '#6a6250');
        [x, y] = [nx, ny];
        const f = s / len;
        if (depth === 0 && rand() < 0.12) shoot(x, y, a + (rand() < 0.5 ? -1 : 1) * (0.5 + rand() * 0.5), len * (1 - f) * 0.6, size * 0.9, 1);
        for (const side of [-1, 1]) lance(g, x, y, a + side * (0.35 + rand() * 0.8) + (rand() - 0.5) * 0.4, size * (0.75 + rand() * 0.45) * (1 - f * 0.3), size * 0.13, leaf());
      }
      lance(g, x, y, a, size * 0.8, size * 0.12, leaf());
    };
    const n = 7;
    for (let k = 0; k < n; k++) {
      const a = ((k / (n - 1)) - 0.5) * 1.1 + (rand() - 0.5) * 0.2;
      shoot(0, mid, a, w * (0.55 + rand() * 0.4), 36, 0);
    }
  },
  // Big leaves of five broad pointed lobes on long stalks, overlapping, bright above and paler at the veins.
  plane: (g, rand, w, mid, room) => {
    const palm = (x: number, y: number, a: number, size: number) => {
      const hue = 80 + rand() * 20;
      const light = 22 + rand() * 16;
      g.save();
      g.translate(x, y);
      g.rotate(a);
      g.fillStyle = `hsl(${hue}, ${34 + rand() * 16}%, ${light}%)`;
      g.beginPath();
      const at = (angle: number, r: number): [number, number] => [Math.cos(angle) * r, Math.sin(angle) * r];
      g.moveTo(...at(-1.6, size * 0.3));
      for (let i = -2; i <= 2; i++) {
        const la = i * 0.6;
        const r = size * (1 - Math.abs(i) * 0.14);
        // Up a broad shoulder to the lobe's point, and down into the notch before the next.
        g.quadraticCurveTo(...at(la - 0.26, r * 0.92), ...at(la, r));
        g.quadraticCurveTo(...at(la + 0.26, r * 0.92), ...at(la + 0.3, r * 0.62));
      }
      g.lineTo(...at(1.6, size * 0.3));
      g.closePath();
      g.fill();
      g.strokeStyle = `hsl(${hue - 6}, 30%, ${light + 12}%)`;
      g.lineWidth = 1.2;
      for (let i = -2; i <= 2; i++) {
        g.beginPath();
        g.moveTo(0, 0);
        g.lineTo(...at(i * 0.6, size * (1 - Math.abs(i) * 0.14) * 0.85));
        g.stroke();
      }
      g.restore();
    };
    twig(g, 0, mid, w - 60, mid + (rand() - 0.5) * 10, 4, '#6a5a40');
    // Leaves on both sides of the stem, filling the spray, the nearer ones over the farther.
    let side = 1;
    for (let s = 30; s < w - 60; s += 16 + rand() * 14) {
      const r = roomAt(s, w, room);
      side = -side;
      const a = side * (0.5 + rand() * 0.7);
      const size = Math.min(r * 0.85, 60) * (0.85 + rand() * 0.2);
      const stalk = 6 + rand() * 12;
      const [x, y] = [s + Math.cos(a) * stalk, mid + Math.sin(a) * stalk];
      twig(g, s, mid, x, y, 1.6, '#7a6a48');
      palm(x, y, a * 0.8, size);
    }
    palm(w - 66, mid, 0, 60);
  },
  // Dense twigs of small, leathery, dark leaves, a few showing their felted grey undersides.
  oak: (g, rand, w, mid, room) => {
    const leaf = () => (rand() < 0.15
      ? `hsl(${70 + rand() * 12}, ${8 + rand() * 8}%, ${40 + rand() * 12}%)`
      : `hsl(${92 + rand() * 20}, ${22 + rand() * 16}%, ${14 + rand() * 13}%)`);
    const shoot = (x0: number, y0: number, a: number, len: number, depth: number) => {
      twig(g, x0, y0, x0 + Math.cos(a) * len, y0 + Math.sin(a) * len, 2.2 - depth * 0.6, '#4a3e30');
      for (let s = 6; s < len; s += 7 + rand() * 5) {
        const x = x0 + Math.cos(a) * s;
        const y = y0 + Math.sin(a) * s;
        if (depth === 0 && rand() < 0.25) shoot(x, y, a + (rand() < 0.5 ? -1 : 1) * (0.5 + rand() * 0.4), len * 0.4, 1);
        lance(g, x, y, a + (rand() < 0.5 ? -1 : 1) * (0.6 + rand() * 0.7), 20 + rand() * 9, 7 + rand() * 3, leaf());
      }
    };
    for (let s = 10; s < w - 40; s += 30 + rand() * 20) {
      const r = roomAt(s, w, room);
      for (const side of [-1, 1]) {
        const a = side * (0.4 + rand() * 0.5);
        shoot(s, mid, a, Math.min(r / Math.sin(Math.abs(a)), 160) * (0.6 + rand() * 0.4), 0);
      }
    }
    shoot(0, mid, 0, w - 20, 1);
  },
  // Tufts of long needles at the ends of short twigs, fanning out and up.
  pine: (g, rand, w, mid, room) => {
    const tuft = (x: number, y: number, a: number, len: number) => {
      for (let k = 0; k < 70; k++) {
        const na = a + (rand() - 0.5) * 1.9;
        const l = len * (0.55 + rand() * 0.45);
        g.strokeStyle = `hsl(${88 + rand() * 20}, ${26 + rand() * 18}%, ${18 + rand() * 20}%)`;
        g.lineWidth = 1.3;
        g.beginPath();
        g.moveTo(x, y);
        g.quadraticCurveTo(x + Math.cos(na) * l * 0.5, y + Math.sin(na) * l * 0.5 - 2, x + Math.cos(na) * l, y + Math.sin(na) * l);
        g.stroke();
      }
    };
    twig(g, 0, mid, w * 0.55, mid, 5, '#5a4030');
    const spots: [number, number, number][] = [[w * 0.55, mid, 0]];
    for (let k = 0; k < 4; k++) {
      const s = w * (0.16 + k * 0.1);
      const side = k % 2 ? 1 : -1;
      const a = side * (0.5 + rand() * 0.3);
      const r = roomAt(s, w, room) * 0.5;
      const [x, y] = [s + Math.cos(a) * r, mid + Math.sin(a) * r];
      twig(g, s, mid, x, y, 3, '#5a4030');
      spots.push([x, y, a * 0.6]);
    }
    for (const [x, y, a] of spots) tuft(x, y, a, Math.min(w - x - 4, 150));
  },
  // Sprays of tiny scale leaves packed tight into a mass, dark, with fresher tips toward its edges.
  cypress: (g, rand, w, mid, room) => {
    for (let k = 0; k < 2600; k++) {
      const x = 4 + rand() * (w - 10);
      const r = roomAt(x, w, room);
      const v = (rand() * 2 - 1) * Math.sqrt(rand());
      const y = mid + v * r;
      const edge = Math.abs(v);
      g.fillStyle = `hsl(${98 + rand() * 20}, ${22 + rand() * 16}%, ${10 + rand() * 9 + edge * 10}%)`;
      g.beginPath();
      g.ellipse(x, y, 3 + rand() * 3, 2 + rand() * 2, (rand() - 0.5) * 1.2 + v * 0.8, 0, Math.PI * 2);
      g.fill();
    }
    // A few fronds standing proud of the mass at its edges.
    for (let k = 0; k < 40; k++) {
      const x = 20 + rand() * (w - 50);
      const side = rand() < 0.5 ? -1 : 1;
      const r = roomAt(x, w, room);
      for (let t = 0; t < 1; t += 0.12) {
        g.fillStyle = `hsl(${102 + rand() * 16}, 30%, ${18 + t * 12}%)`;
        g.beginPath();
        g.ellipse(x + t * 22, mid + side * r * (0.75 + t * 0.3), 3.2 - t * 1.6, 2.2 - t, side * 0.6, 0, Math.PI * 2);
        g.fill();
      }
    }
  },
};
