import * as THREE from 'three';
import type { Face } from './dressing.ts';
import { BLOOMS, LEAVES, plain, Shapes, STEM, TERRACOTTA, type Stuff } from './townparts.ts';

// What people grow by their doors and up their walls in a southern town,
// drawn over the facades with the rest of their dressing (see dressing.ts):
// geraniums, lemon trees and agaves in terracotta pots, bougainvillea
// climbing beside a door and spilling over its head, and vines trained along
// a wall on a wire. All drawn only, low or flat against the walls.

const UP = new THREE.Vector3(0, 1, 0);
/** Bougainvillea's papery bracts: magenta, purple and a hot pink. */
const BRACTS = [plain(0xc0287e), plain(0xa8288e), plain(0xd8407a)];
/** A vine's broad leaves, fresher than the creepers'. */
const VINE = [plain(0x587a2a), plain(0x6a8a34), plain(0x4a6a24)];
const GRAPES = plain(0x3a2a40);
const LEMON = plain(0xe8c828);
const LEMON_LEAVES = [plain(0x2e4a1e), plain(0x3a5a24), plain(0x284018)];
/** An agave's thick blue-grey leaves, and their yellowed edges. */
const AGAVE = [plain(0x6a8478), plain(0x748e7c), plain(0x5e7a6e)];
/** A pot's terracotta, some paler and some redder. */
const POTS = [TERRACOTTA, plain(0xb86a48), plain(0x9a5034), plain(0xc8a080)];

/** A rod from a to b, radius r at a and r1 at b. */
function rod(shapes: Shapes, a: THREE.Vector3, b: THREE.Vector3, r: number, s: Stuff, r1 = r, sides = 5): void {
  const g = new THREE.CylinderGeometry(r1, r, a.distanceTo(b), sides, 1, true);
  const q = new THREE.Quaternion().setFromUnitVectors(UP, b.clone().sub(a).normalize());
  shapes.add(g, new THREE.Matrix4().compose(a.clone().add(b).multiplyScalar(0.5), q, new THREE.Vector3(1, 1, 1)), s);
}

/** A terracotta pot `r` across its rim and `h` tall, its foot at `at`, with a rolled rim and the soil in it. */
function pot(shapes: Shapes, at: THREE.Vector3, r: number, h: number, s: Stuff): void {
  const m = (y: number) => new THREE.Matrix4().makeTranslation(at.x, at.y + y, at.z);
  shapes.add(new THREE.CylinderGeometry(r, r * 0.72, h, 12, 1, true), m(h / 2), s);
  shapes.add(new THREE.TorusGeometry(r, h * 0.07, 4, 12).rotateX(Math.PI / 2), m(h - h * 0.05), s);
  shapes.add(new THREE.CircleGeometry(r * 0.96, 12).rotateX(-Math.PI / 2), m(h * 0.9), plain(0x3a2a1e));
}

/** A geranium's mound of round leaves and its heads of flowers, from the soil at `at`, `r` across. */
function geranium(shapes: Shapes, at: THREE.Vector3, r: number, rand: () => number): void {
  const bloom = BLOOMS[Math.floor(rand() * 3)];
  for (let k = 0; k < Math.round(r * 260); k++) {
    const a = rand() * Math.PI * 2;
    const d = Math.sqrt(rand()) * r;
    const base = at.clone().add(new THREE.Vector3(Math.cos(a) * d * 0.5, 0, Math.sin(a) * d * 0.5));
    const tip = new THREE.Vector3(Math.cos(a) * d, 0.15 + rand() * 0.25, Math.sin(a) * d);
    shapes.leaf(base, tip, UP.clone().add(new THREE.Vector3(Math.cos(a), 0, Math.sin(a)).multiplyScalar(0.5)), 0.07 + rand() * 0.05, LEAVES[Math.floor(rand() * LEAVES.length)]);
  }
  for (let k = 0; k < Math.round(r * 30); k++) {
    const a = rand() * Math.PI * 2;
    const d = Math.sqrt(rand()) * r * 0.8;
    const top = at.clone().add(new THREE.Vector3(Math.cos(a) * d, r * 0.9 + 0.08 + rand() * 0.12, Math.sin(a) * d));
    rod(shapes, at.clone().add(new THREE.Vector3(Math.cos(a) * d * 0.4, 0, Math.sin(a) * d * 0.4)), top, 0.005, LEAVES[0], 0.005, 3);
    for (let f = 0; f < 6; f++) {
      const p = top.clone().add(new THREE.Vector3((rand() - 0.5) * 0.08, rand() * 0.05, (rand() - 0.5) * 0.08));
      shapes.add(new THREE.OctahedronGeometry(1, 0), new THREE.Matrix4().compose(p, new THREE.Quaternion(), new THREE.Vector3(0.026, 0.02, 0.026)), bloom);
    }
  }
}

/** An agave's rosette from `at`, `r` across: thick pointed leaves arching out and up, folded along their middles. */
export function agave(shapes: Shapes, at: THREE.Vector3, r: number, rand: () => number): void {
  const n = 18 + Math.floor(rand() * 8);
  const turn = rand() * Math.PI * 2;
  for (let k = 0; k < n; k++) {
    // Outer leaves long and low, inner ones short and upright.
    const f = k / n;
    const a = turn + k * 2.4;
    const out = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
    const len = r * (1.15 - 0.55 * f) * (0.85 + rand() * 0.3);
    const rise = 0.35 + f * 1.1;
    const width = len * 0.16;
    const side = new THREE.Vector3(-out.z, 0, out.x);
    // A V across, from a broad base to a point, bending out over its length.
    const pts: number[] = [];
    const ring = (t: number) => {
      const dir = out.clone().multiplyScalar(Math.cos(rise * (1 - t * 0.6))).addScaledVector(UP, Math.sin(rise * (1 - t * 0.6)));
      const c = at.clone().addScaledVector(dir, len * t).addScaledVector(UP, 0.05);
      const w = width * (1 - t) ** 0.8;
      return [c.clone().addScaledVector(side, -w).addScaledVector(UP, w * 0.4), c, c.clone().addScaledVector(side, w).addScaledVector(UP, w * 0.4)];
    };
    const steps = [0, 0.35, 0.7, 1];
    for (let i = 0; i + 1 < steps.length; i++) {
      const [p, q] = [ring(steps[i]), ring(steps[i + 1])];
      for (const [x, y] of [[0, 1], [1, 2]]) pts.push(...p[x].toArray(), ...q[x].toArray(), ...q[y].toArray(), ...p[x].toArray(), ...q[y].toArray(), ...p[y].toArray());
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    shapes.add(g, new THREE.Matrix4(), AGAVE[Math.floor(rand() * AGAVE.length)]);
  }
}

/** A lemon tree in a big pot, its foot at `at`: a short trunk, a round head of dark glossy leaves, and lemons in it. */
function lemonTree(shapes: Shapes, at: THREE.Vector3, rand: () => number): void {
  pot(shapes, at, 0.3, 0.5, POTS[Math.floor(rand() * POTS.length)]);
  const head = at.clone().add(new THREE.Vector3((rand() - 0.5) * 0.1, 1.35 + rand() * 0.2, (rand() - 0.5) * 0.1));
  rod(shapes, at.clone().setY(at.y + 0.45), head.clone().setY(head.y - 0.3), 0.035, STEM, 0.025);
  const r = 0.45 + rand() * 0.1;
  for (let k = 0; k < 420; k++) {
    const d = new THREE.Vector3(rand() - 0.5, (rand() - 0.5) * 0.85, rand() - 0.5).normalize();
    const p = head.clone().addScaledVector(d, r * (0.55 + 0.45 * Math.sqrt(rand())));
    shapes.leaf(p, d.clone().add(new THREE.Vector3(rand() - 0.5, rand() - 0.3, rand() - 0.5)), d, 0.07 + rand() * 0.04, LEMON_LEAVES[Math.floor(rand() * LEMON_LEAVES.length)]);
  }
  for (let k = 0; k < 14; k++) {
    const d = new THREE.Vector3(rand() - 0.5, (rand() - 0.6) * 0.8, rand() - 0.5).normalize();
    shapes.add(new THREE.IcosahedronGeometry(1, 1), new THREE.Matrix4().compose(head.clone().addScaledVector(d, r * 0.95), new THREE.Quaternion(), new THREE.Vector3(0.04, 0.055, 0.04)), LEMON);
  }
}

/**
 * Pots at the foot of the face beside a doorway, against the wall from `a0`
 * to `a1` along it, the ground at `y`: a geranium or two, or an agave, or
 * where it's clear overhead (`tall`) a lemon tree.
 */
export function pots(face: Face, shapes: Shapes, a0: number, a1: number, y: number, tall: boolean, rand: () => number): void {
  const pick = rand();
  if (pick < 0.2 && tall && a1 - a0 > 0.7) {
    lemonTree(shapes, face.point((a0 + a1) / 2, 0.36, y), rand);
    return;
  }
  if (pick < 0.3 && a1 - a0 > 0.7) {
    const r = 0.3;
    pot(shapes, face.point((a0 + a1) / 2, r + 0.04, y), r, 0.38, POTS[Math.floor(rand() * POTS.length)]);
    agave(shapes, face.point((a0 + a1) / 2, r + 0.04, y + 0.34), 0.55, rand);
    return;
  }
  // Geraniums, a row of pots of sizes.
  for (let a = a0; a < a1 - 0.25; ) {
    const r = 0.13 + rand() * 0.09;
    if (a + r * 2 > a1) break;
    const at = face.point(a + r, r + 0.03, y);
    const h = r * (1.2 + rand() * 0.4);
    pot(shapes, at, r, h, POTS[Math.floor(rand() * POTS.length)]);
    geranium(shapes, at.clone().setY(at.y + h * 0.9), r * 1.3, rand);
    a += r * 2 + 0.04 + rand() * 0.1;
  }
}

/**
 * Bougainvillea climbing from the ground beside a doorway, from `a0` to `a1`
 * along the face, and over its head, the ground at `y`, up to `top`: a few
 * twisting woody stems, then a mass of small leaves and papery bracts arching
 * over the door and hanging down its sides.
 */
export function bougainvillea(face: Face, shapes: Shapes, a0: number, a1: number, root: number, head: number, y: number, top: number, rand: () => number): void {
  const out = face.out();
  let p = face.point(root, 0.06, y - 0.1);
  for (let k = 1; k <= 5; k++) {
    const q = face.point(root + (rand() - 0.5) * 0.2, 0.06 + rand() * 0.05, y + ((head - y + 0.3) * k) / 5);
    rod(shapes, p, q, 0.04 - k * 0.004, STEM, 0.04 - (k + 1) * 0.004);
    p = q;
  }
  for (let k = 0; k < 4; k++) {
    rod(shapes, p, face.point(a0 + rand() * (a1 - a0), 0.08, head + rand() * (top - head)), 0.018, STEM, 0.01);
  }
  const bract = BRACTS[Math.floor(rand() * BRACTS.length)];
  const n = Math.round((a1 - a0) * 380);
  for (let k = 0; k < n; k++) {
    const a = a0 + rand() * (a1 - a0);
    // Over the head, thickest there; down the sides it hangs only near the ends.
    const edge = Math.min(a - a0, a1 - a) / (a1 - a0);
    const low = head - (edge < 0.18 ? (0.18 - edge) * 7 : 0) * (0.5 + rand() * 0.5);
    const yy = low + rand() ** 0.7 * (top - low);
    const at = face.point(a, 0.05 + rand() * 0.3, yy);
    const flower = rand() < 0.55;
    shapes.leaf(at, new THREE.Vector3(rand() - 0.5, rand() - 0.8, rand() - 0.5), out.clone().add(new THREE.Vector3(0, 0.5, 0)), flower ? 0.06 + rand() * 0.03 : 0.08 + rand() * 0.04, flower ? bract : LEAVES[Math.floor(rand() * LEAVES.length)]);
  }
}

/**
 * A vine trained along the face from `a0` to `a1`, the ground at `y`: its
 * gnarled trunk up from one end to a wire `height` over the ground, its arms
 * along the wire, and broad leaves hanging from them with a few bunches of
 * grapes.
 */
export function vine(face: Face, shapes: Shapes, a0: number, a1: number, y: number, height: number, rand: () => number): void {
  const root = rand() < 0.5 ? a0 + 0.2 : a1 - 0.2;
  const wire = y + height;
  let p = face.point(root, 0.08, y - 0.1);
  for (let k = 1; k <= 4; k++) {
    const q = face.point(root + (rand() - 0.5) * 0.15, 0.08 + rand() * 0.05, y + (height * k) / 4);
    rod(shapes, p, q, 0.05 - k * 0.006, STEM, 0.05 - (k + 1) * 0.006);
    p = q;
  }
  rod(shapes, face.point(a0, 0.05, wire + 0.02), face.point(a1, 0.05, wire + 0.02), 0.004, plain(0x3a3a3a), 0.004, 3);
  for (const end of [a0 + 0.1, a1 - 0.1]) {
    if (Math.abs(end - root) < 0.3) continue;
    let q = p;
    const steps = Math.max(1, Math.round(Math.abs(end - root) / 0.6));
    for (let k = 1; k <= steps; k++) {
      const r = face.point(root + ((end - root) * k) / steps, 0.08, wire + (rand() - 0.5) * 0.08);
      rod(shapes, q, r, 0.025, STEM, 0.018);
      q = r;
    }
  }
  const out = face.out();
  const n = Math.round((a1 - a0) * 160);
  for (let k = 0; k < n; k++) {
    const a = a0 + rand() * (a1 - a0);
    const at = face.point(a, 0.06 + rand() * 0.28, wire - 0.05 + (rand() - 0.6) * 0.55);
    shapes.leaf(at, new THREE.Vector3(rand() - 0.5, -0.6 - rand(), rand() - 0.5), out.clone().add(new THREE.Vector3(0, 0.3, 0)), 0.13 + rand() * 0.07, VINE[Math.floor(rand() * VINE.length)]);
  }
  for (let k = 0; k < Math.round(a1 - a0); k++) {
    const at = face.point(a0 + rand() * (a1 - a0), 0.18, wire - 0.25);
    for (let g = 0; g < 14; g++) {
      const p2 = at.clone().add(new THREE.Vector3((rand() - 0.5) * 0.08, -rand() * 0.18, (rand() - 0.5) * 0.08));
      shapes.add(new THREE.IcosahedronGeometry(1, 0), new THREE.Matrix4().compose(p2, new THREE.Quaternion(), new THREE.Vector3(0.022, 0.022, 0.022)), GRAPES);
    }
  }
}
