import * as THREE from 'three';
import { WATER_LEVEL } from '../shared/constants.ts';
import { Layer } from '../shared/layers.ts';
import type { MapBox, MapLook } from '../shared/maps/index.ts';
import { mulberry32 } from '../shared/rng.ts';
import type { World } from '../shared/world.ts';
import { Boxes, CANVAS, CREAM, IRON, painted, plain, Shapes, STONE, stuff, type Stuff } from './townparts.ts';

// A map's features drawn as what they are, over the boxes they collide as
// (MapBox.look): the crashed truck, the market's stalls, the carts, the
// fountain, the war memorial, the kiosk, the
// boats hauled out, the water tower, the tombs, the bell tower's belfry and
// roof, and along the quay's face its bollards and the boats moored off it.
// What stands inside its box replaces it (Features.replaces); what reaches
// past it, a canopy or a cross, is only drawn.

const WHEEL = plain(0x1c1c1c);
const HUB = plain(0x8a8a86);
const GLASS = plain(0x2a3a44);
const DARK = plain(0x14110e);
const WATER = plain(0x2e4a52);
const WOOD = stuff(Layer.boards, 0xc8b8a4, 0x6b5a44);
const PLANKS = stuff(Layer.planks, 0xe0d8c8, 0x7a6448);
const TRUCK_BOX = stuff(Layer.metal, 0xe4ded2, 0xb8b2a6);
const TRUCK_CAB = plain(0x2f5a80);
const STEEL = stuff(Layer.metal, 0xa8b0aa, 0x6e7670);
const ROOF = plain(0xa45a3c);
const FRUIT = [plain(0xe08a20), plain(0xf0d040), plain(0xc0302a), plain(0x5a8a2a), plain(0x7a3a6a)];
const HULLS = [0xeeeae0, 0x2f5f86, 0xd8c8a0, 0x3d7a5a];
const STRIPES = [0x2f5f86, 0xb83a30, 0xd0a030, 0x2f3a46];

const UP = new THREE.Vector3(0, 1, 0);

/** A rod from a to b, radius r. */
function rod(shapes: Shapes, a: THREE.Vector3, b: THREE.Vector3, r: number, s: Stuff, seg = 8, r1 = r): void {
  const len = a.distanceTo(b);
  const g = new THREE.CylinderGeometry(r1, r, len, seg);
  const q = new THREE.Quaternion().setFromUnitVectors(UP, b.clone().sub(a).normalize());
  shapes.add(g, new THREE.Matrix4().compose(a.clone().add(b).multiplyScalar(0.5), q, new THREE.Vector3(1, 1, 1)), s);
}

/** A wheel at (x, y, z), radius r and `w` wide, its axle along x or z. */
function wheel(shapes: Shapes, x: number, y: number, z: number, r: number, w: number, axleX: boolean, s = WHEEL): void {
  const q = new THREE.Quaternion().setFromAxisAngle(axleX ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0), Math.PI / 2);
  shapes.add(new THREE.CylinderGeometry(r, r, w, 14), new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(1, 1, 1)), s);
  shapes.add(new THREE.CylinderGeometry(r * 0.45, r * 0.45, w + 0.04, 10), new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(1, 1, 1)), HUB);
}

/** A lumpy ball of leaves, radius r, at (x, y, z), flattened by `squash`. */
function blob(shapes: Shapes, x: number, y: number, z: number, r: number, s: Stuff, rand: () => number, squash = 0.75): void {
  const g = new THREE.IcosahedronGeometry(1, 1);
  const pos = g.getAttribute('position');
  // Lit as a ball, soft, whatever its lumps.
  g.setAttribute('normal', pos.clone());
  for (let i = 0; i < pos.count; i++) {
    // The same jitter for the same corner, so faces stay joined.
    const k = Math.abs(Math.sin(pos.getX(i) * 12.9898 + pos.getY(i) * 78.233 + pos.getZ(i) * 37.719) * 43758.5453) % 1;
    const f = 0.8 + 0.4 * k;
    pos.setXYZ(i, pos.getX(i) * f, pos.getY(i) * f, pos.getZ(i) * f);
  }
  const q = new THREE.Quaternion().setFromAxisAngle(UP, rand() * Math.PI * 2);
  shapes.add(g, new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(r, r * squash, r)), s);
}

/**
 * A boat's hull, `length` long along x (its bow at +x), `beam` across and
 * `depth` from the gunwale to the keel, from its gunwale at y = 0: the
 * bands of it between `f0` and `f1` of the way from the gunwale down.
 */
function hull(length: number, beam: number, depth: number, f0: number, f1: number): THREE.BufferGeometry {
  const NU = 14;
  const NV = 4;
  const pos: number[] = [];
  const point = (u: number, side: number, f: number): number[] => {
    // Full and square at the stern, narrowing to the stem at the bow.
    const half = (beam / 2) * (u < 0.55 ? 0.82 + 0.18 * Math.sin((u / 0.55) * Math.PI / 2) : Math.cos(((u - 0.55) / 0.45) * Math.PI / 2) ** 0.7);
    const phi = Math.acos(Math.min(1, f));
    const sheer = 0.25 * u * u;
    return [(u - 0.5) * length, sheer - depth * (1 - 0.15 * u) * f, side * half * Math.sin(phi)];
  };
  for (const side of [-1, 1]) {
    for (let i = 0; i < NU; i++) {
      for (let j = 0; j < NV; j++) {
        const [u0, u1] = [i / NU, (i + 1) / NU];
        const [g0, g1] = [f0 + ((f1 - f0) * j) / NV, f0 + ((f1 - f0) * (j + 1)) / NV];
        const [a, b, c, d] = [point(u0, side, g0), point(u1, side, g0), point(u1, side, g1), point(u0, side, g1)];
        if (side > 0) pos.push(...a, ...b, ...c, ...a, ...c, ...d);
        else pos.push(...a, ...c, ...b, ...a, ...d, ...c);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

/** A boat's deck and transom: the gunwale's outline filled. */
function deck(length: number, beam: number, depth: number): THREE.BufferGeometry {
  const NU = 14;
  const pos: number[] = [];
  const edge = (u: number, side: number) => {
    const half = (beam / 2) * (u < 0.55 ? 0.82 + 0.18 * Math.sin((u / 0.55) * Math.PI / 2) : Math.cos(((u - 0.55) / 0.45) * Math.PI / 2) ** 0.7);
    return [(u - 0.5) * length, 0.25 * u * u - 0.08, side * half];
  };
  for (let i = 0; i < NU; i++) {
    const [u0, u1] = [i / NU, (i + 1) / NU];
    const [a, b, c, d] = [edge(u0, -1), edge(u1, -1), edge(u1, 1), edge(u0, 1)];
    pos.push(...a, ...c, ...b, ...a, ...d, ...c);
  }
  // The transom across the stern, down to the keel.
  const [p, q] = [edge(0, -1), edge(0, 1)];
  const keel = [-length / 2, -depth, 0];
  pos.push(p[0], p[1] + 0.08, p[2], ...keel, q[0], q[1] + 0.08, q[2]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

/** A boat of `length` and `beam`, its gunwale's middle at (x, y, z), its bow toward `heading` (radians from +x toward +z). */
function boat(shapes: Shapes, x: number, y: number, z: number, length: number, beam: number, heading: number, rand: () => number): void {
  const depth = beam * 0.45;
  const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(UP, -heading), new THREE.Vector3(1, 1, 1));
  const body = plain(HULLS[Math.floor(rand() * HULLS.length)]);
  const stripe = plain(STRIPES[Math.floor(rand() * STRIPES.length)]);
  shapes.add(hull(length, beam, depth, 0, 0.12), m, stripe);
  shapes.add(hull(length, beam, depth, 0.12, 0.7), m, body);
  shapes.add(hull(length, beam, depth, 0.7, 1), m, plain(0x6a2a22));
  shapes.add(deck(length, beam, depth), m, WOOD);
  // A wheelhouse on the bigger ones, a thwart on the smaller.
  const local = (bx0: number, by0: number, bz0: number, bx1: number, by1: number, bz1: number, s: Stuff) =>
    shapes.add(new THREE.BoxGeometry(bx1 - bx0, by1 - by0, bz1 - bz0).translate((bx0 + bx1) / 2, (by0 + by1) / 2, (bz0 + bz1) / 2), m, s);
  if (length > 6) wheelhouse(shapes, m, -length * 0.25, length * 0.05, beam * 0.56, stripe);
  else local(-0.15, -0.3, -beam * 0.4, 0.15, -0.22, beam * 0.4, WOOD);
  // Old tyres hung along the sides as fenders.
  for (const side of [-1, 1]) {
    for (let k = 0; k < Math.floor(length / 2.5); k++) {
      const u = -length * 0.3 + k * 2.2;
      const at = new THREE.Vector3(u, -0.25, side * beam * 0.47).applyMatrix4(m);
      // Its ring along the hull's side.
      const q = new THREE.Quaternion().setFromRotationMatrix(m);
      shapes.add(new THREE.TorusGeometry(0.17, 0.07, 5, 10), new THREE.Matrix4().compose(at, q, new THREE.Vector3(1, 1, 1)), WHEEL);
    }
  }
}

/**
 * A wheelhouse in a boat's frame `m`, from x0 to x1 along it and `width`
 * across: walls leaning in, a band of windows with their frames, a roof
 * rounded at its ends standing out over them, a mast with its light, and a
 * lifebuoy on its side.
 */
function wheelhouse(shapes: Shapes, m: THREE.Matrix4, x0: number, x1: number, width: number, stripe: Stuff): void {
  const WHITE = plain(0xf2efe6);
  const len = x1 - x0;
  const mid = (x0 + x1) / 2;
  /** A square prism leaning in, from y0 to y1, its foot `len` by `width` and its top `lean` of that. */
  const prism = (y0: number, y1: number, scale0: number, scale1: number, s: Stuff) => {
    const g = new THREE.CylinderGeometry(Math.SQRT1_2 * scale1, Math.SQRT1_2 * scale0, 1, 4, 1, true).rotateY(Math.PI / 4);
    g.deleteAttribute('normal');
    g.scale(len, y1 - y0, width).translate(mid, (y0 + y1) / 2, 0);
    shapes.add(g, m, s);
  };
  // Lean in by 8% over its height: the walls, the windows, the band over them.
  const at = (y: number) => 1 - (0.08 * (y + 0.05)) / 1.55;
  prism(-0.05, 0.8, at(-0.05), at(0.8), WHITE);
  prism(0.8, 1.28, at(0.8), at(1.28), GLASS);
  prism(1.28, 1.5, at(1.28), at(1.5), WHITE);
  // The windows' frames.
  const put = (bx0: number, by0: number, bz0: number, bx1: number, by1: number, bz1: number, s: Stuff) =>
    shapes.add(new THREE.BoxGeometry(bx1 - bx0, by1 - by0, bz1 - bz0).translate((bx0 + bx1) / 2, (by0 + by1) / 2, (bz0 + bz1) / 2), m, s);
  const top = at(1.04);
  for (let k = 1; k < 4; k++) {
    const x = x0 + (len * (1 - top)) / 2 + (len * top * k) / 4;
    for (const side of [-1, 1]) put(x - 0.03, 0.8, side * (width * top) / 2 - 0.02, x + 0.03, 1.28, side * (width * top) / 2 + 0.02, WHITE);
  }
  for (const side of [-1, 1]) {
    const z = (width * top * side) / 4;
    put(x1 - (len * (1 - top)) / 2 - 0.02, 0.8, z - 0.03, x1 - (len * (1 - top)) / 2 + 0.02, 1.28, z + 0.03, WHITE);
  }
  // The roof: an oval slab standing out all round, in the hull's stripe.
  const roof = new THREE.CylinderGeometry(0.5, 0.5, 1, 20).scale(len + 0.5, 0.09, width + 0.3).translate(mid, 1.54, 0);
  shapes.add(roof, m, stripe);
  // The mast, with its light, and a lifebuoy on the side.
  const mast = new THREE.CylinderGeometry(0.03, 0.04, 1.4, 6).translate(mid - len * 0.2, 2.28, 0);
  shapes.add(mast, m, WHITE);
  shapes.add(new THREE.SphereGeometry(0.07, 6, 4).translate(mid - len * 0.2, 3.02, 0), m, plain(0xf0e8c0));
  const side = Math.floor(len * 10) % 2 ? 1 : -1;
  const buoy = new THREE.Matrix4().compose(new THREE.Vector3(mid, 0.45, side * ((width * at(0.45)) / 2 + 0.06)), new THREE.Quaternion(), new THREE.Vector3(1, 1, 1));
  shapes.add(new THREE.TorusGeometry(0.22, 0.06, 6, 14), m.clone().multiply(buoy), plain(0xe0502a));
}

/** The ground a feature stands on: the terrain or a terrace over it, but not below its box. */
export function standsOn(world: World, b: MapBox): number {
  const [x, z] = [(b.minX + b.maxX) / 2, (b.minZ + b.maxZ) / 2];
  let y = world.terrainHeight(x, z);
  for (const t of world.map!.walls) if (t.walk && x > t.minX && x < t.maxX && z > t.minZ && z < t.maxZ) y = Math.max(y, t.y1);
  return Math.min(Math.max(y, b.y0), b.y1);
}

/** The looks drawn in place of their boxes; the rest are drawn over them. */
const REPLACED: ReadonlySet<MapLook> = new Set(['truck', 'stall', 'cart', 'fountain', 'plane', 'olive', 'memorial', 'kiosk', 'boat', 'tank', 'tomb']);

/** The props drawn here in place of their boxes. */
export function replacedProps(world: World): Set<number> {
  const out = new Set<number>();
  if (!world.map) return out;
  const looks = world.map.walls.filter((w) => w.look && REPLACED.has(w.look));
  if (!looks.length) return out;
  world.props.forEach((p, i) => {
    const b = p.box;
    if (b.part !== 'wall') return;
    if (looks.some((w) => near(w.minX, b.minX) && near(w.maxX, b.maxX) && near(w.minZ, b.minZ) && near(w.maxZ, b.maxZ) && near(w.y0, b.minY) && near(w.y1, b.maxY))) out.add(i);
  });
  return out;
}

const near = (a: number, b: number) => Math.abs(a - b) < 1e-6;

/** Every feature of a map, into `boxes` and `shapes`. */
export function features(world: World, boxes: Boxes, shapes: Shapes): void {
  const map = world.map!;
  const rand = mulberry32(map.seed * 7 + 3);
  for (const b of map.walls) {
    if (!b.look) continue;
    const y = standsOn(world, b);
    const top = b.y1;
    const [cx, cz] = [(b.minX + b.maxX) / 2, (b.minZ + b.maxZ) / 2];
    const alongX = b.maxX - b.minX >= b.maxZ - b.minZ;
    const [len, wid] = alongX ? [b.maxX - b.minX, b.maxZ - b.minZ] : [b.maxZ - b.minZ, b.maxX - b.minX];
    /** A box in the feature's own frame: u along its length from its middle, v across, y up. */
    const local = (ua: number, va: number, y0: number, ub: number, vb: number, y1: number, s: Stuff) => {
      const [u0, u1, v0, v1] = [Math.min(ua, ub), Math.max(ua, ub), Math.min(va, vb), Math.max(va, vb)];
      if (alongX) boxes.box(cx + u0, y0, cz + v0, cx + u1, y1, cz + v1, s);
      else boxes.box(cx + v0, y0, cz + u0, cx + v1, y1, cz + u1, s);
    };
    const at = (u: number, v: number): [number, number] => (alongX ? [cx + u, cz + v] : [cx + v, cz + u]);
    const [L, W] = [len / 2, wid / 2];
    switch (b.look) {
      case 'truck': {
        // Its cab at the far end, as the hash falls.
        const dir = rand() < 0.5 ? 1 : -1;
        const cab = 2.4;
        const [b0, b1] = dir > 0 ? [-L, L - cab - 0.1] : [-L + cab + 0.1, L];
        local(b0, -W, y + 0.75, b1, W, top, TRUCK_BOX);
        local(-L + 0.3, -W + 0.3, y + 0.35, L - 0.3, W - 0.3, y + 0.75, DARK);
        const [c0, c1] = dir > 0 ? [L - cab, L] : [-L, -L + cab];
        local(c0, -W + 0.05, y + 0.6, c1, W - 0.05, top - 0.3, TRUCK_CAB);
        // Its windscreen and side windows, and the bumper.
        const front = dir > 0 ? L : -L;
        local(front - dir * 0.01, -W + 0.25, top - 1.3, front + dir * 0.01, W - 0.25, top - 0.45, GLASS);
        for (const v of [-W + 0.04, W - 0.04]) local(front - dir * 1.1, v - 0.02, top - 1.3, front - dir * 0.2, v + 0.02, top - 0.5, GLASS);
        local(front - dir * 0.15, -W, y + 0.3, front + dir * 0.05, W, y + 0.6, DARK);
        local(front - dir * 0.01, -W * 0.5, y + 0.7, front + dir * 0.02, W * 0.5, y + 1.3, DARK);
        for (const v of [-W + 0.35, W - 0.35]) local(front - dir * 0.01, v - 0.18, y + 0.8, front + dir * 0.03, v + 0.18, y + 1.05, plain(0xf0eee0));
        for (const v of [-W + 0.03, W - 0.03]) local(c0, v - 0.03, y + 1.4, c1, v + 0.03, y + 1.55, CREAM);
        for (const u of [-L + 1.3, -L + 2.5, L - 1.4].map((u) => u * dir)) {
          for (const v of [-W + 0.25, W - 0.25]) {
            const [x, z] = at(u, v);
            wheel(shapes, x, y + 0.5, z, 0.5, 0.4, !alongX);
          }
        }
        break;
      }
      case 'stall': {
        const paint = painted(CANVAS[Math.floor(rand() * CANVAS.length)]);
        local(-L, -W, y, L, W, top, WOOD);
        local(-L - 0.03, -W - 0.03, top - 0.12, L + 0.03, W + 0.03, top, paint);
        // Fruit and greens in crates along the top.
        for (let u = -L + 0.35; u < L - 0.3; u += 0.6) {
          for (const v of [-W / 2, W / 2]) {
            local(u - 0.25, v - 0.35, top, u + 0.25, v + 0.35, top + 0.12, PLANKS);
            const fruit = FRUIT[Math.floor(rand() * FRUIT.length)];
            for (let k = 0; k < 6; k++) {
              const [x, z] = at(u - 0.18 + rand() * 0.36, v - 0.28 + rand() * 0.56);
              blob(shapes, x, top + 0.14, z, 0.07, fruit, rand, 1);
            }
          }
        }
        // Poles at the corners and a striped canopy over it.
        for (const u of [-L + 0.05, L - 0.05]) for (const v of [-W + 0.05, W - 0.05]) local(u - 0.03, v - 0.03, top, u + 0.03, v + 0.03, top + 1.3, IRON);
        const stripes = Math.round(len / 0.3);
        for (let k = 0; k < stripes; k++) {
          const u0 = -L - 0.2 + ((len + 0.4) * k) / stripes;
          local(u0, -W - 0.3, top + 1.3, u0 + (len + 0.4) / stripes, W + 0.3, top + 1.34, k % 2 ? CREAM : plain(CANVAS[Math.floor(rand() * CANVAS.length)]));
        }
        break;
      }
      case 'cart': {
        // A two-wheeled cart: its bed on the axle, the shafts out in front, a load of sacks.
        local(-L, -W, y + 0.45, L, W, top - 0.1, PLANKS);
        local(-L, -W, top - 0.1, L, -W + 0.08, top + 0.2, WOOD);
        local(-L, W - 0.08, top - 0.1, L, W, top + 0.2, WOOD);
        for (const v of [-W - 0.06, W + 0.06]) {
          const [x, z] = at(0, v);
          wheel(shapes, x, y + 0.6, z, 0.6, 0.08, alongX ? false : true, WOOD);
        }
        for (const v of [-W + 0.2, W - 0.2]) {
          const [x0, z0] = at(L, v);
          const [x1, z1] = at(L + 1.2, v * 0.6);
          rod(shapes, new THREE.Vector3(x0, top - 0.3, z0), new THREE.Vector3(x1, y + 0.4, z1), 0.04, WOOD, 6);
        }
        for (let k = 0; k < 4; k++) {
          const [x, z] = at(-L + 0.4 + rand() * (len - 0.8), -W + 0.4 + rand() * (wid - 0.8));
          blob(shapes, x, top + 0.1, z, 0.35, plain(0xc8b48a), rand, 0.6);
        }
        local(-L - 0.02, -W - 0.02, y + 0.3, L + 0.02, W + 0.02, y + 0.45, DARK);
        break;
      }
      case 'fountain': {
        // A square stone basin brimming, a column in its middle and a bowl spilling over.
        const R = 0.35;
        local(-L, -W, y, L, -W + R, top + 0.06, STONE);
        local(-L, W - R, y, L, W, top + 0.06, STONE);
        local(-L, -W + R, y, -L + R, W - R, top + 0.06, STONE);
        local(L - R, -W + R, y, L, W - R, top + 0.06, STONE);
        local(-L + R, -W + R, y, L - R, W - R, top - 0.15, WATER);
        rod(shapes, new THREE.Vector3(cx, top - 0.2, cz), new THREE.Vector3(cx, top + 1.3, cz), 0.3, STONE, 10, 0.22);
        rod(shapes, new THREE.Vector3(cx, top + 1.3, cz), new THREE.Vector3(cx, top + 1.6, cz), 0.35, STONE, 14, 1);
        rod(shapes, new THREE.Vector3(cx, top + 1.55, cz), new THREE.Vector3(cx, top + 1.58, cz), 0.92, WATER, 14);
        rod(shapes, new THREE.Vector3(cx, top + 1.6, cz), new THREE.Vector3(cx, top + 2.3, cz), 0.12, STONE, 8, 0.06);
        break;
      }
      case 'plane':
      case 'olive':
        // Grown as the trees they are (see greenery.ts).
        break;
      case 'memorial': {
        // A stone block with a moulding, a bronze plaque each side, and an obelisk on it.
        local(-L, -W, y, L, W, top, STONE);
        local(-L - 0.08, -W - 0.08, y, L + 0.08, W + 0.08, y + 0.35, STONE);
        local(-L - 0.06, -W - 0.06, top - 0.2, L + 0.06, W + 0.06, top, STONE);
        local(-0.6, -W - 0.02, y + 1, 0.6, W + 0.02, y + 1.7, plain(0x4a5a40));
        rod(shapes, new THREE.Vector3(cx, top, cz), new THREE.Vector3(cx, top + 3.6, cz), 0.5, STONE, 4, 0.3);
        rod(shapes, new THREE.Vector3(cx, top + 3.6, cz), new THREE.Vector3(cx, top + 4.1, cz), 0.3, STONE, 4, 0.01);
        break;
      }
      case 'kiosk': {
        // Painted boards, a hatch and a counter on its front, a sign along the top, a roof standing out.
        const paint = painted(0x3e6a4a);
        local(-L, -W, y, L, W, top, paint);
        local(-L * 0.7, W - 0.01, y + 1, L * 0.7, W + 0.01, y + 2, DARK);
        local(-L * 0.75, W, y + 0.95, L * 0.75, W + 0.3, y + 1.02, WOOD);
        local(-L, -W - 0.02, top - 0.45, L, W + 0.02, top - 0.1, CREAM);
        local(-L - 0.4, -W - 0.4, top, L + 0.4, W + 0.4, top + 0.15, paint);
        rod(shapes, new THREE.Vector3(cx, top + 0.15, cz), new THREE.Vector3(cx, top + 0.9, cz), L * 0.7, ROOF, 8, 0.05);
        break;
      }
      case 'boat': {
        // Hauled out on chocks.
        const heading = alongX ? (rand() < 0.5 ? 0 : Math.PI) : rand() < 0.5 ? Math.PI / 2 : -Math.PI / 2;
        for (const u of [-L * 0.5, L * 0.3]) local(u - 0.2, -W * 0.6, y, u + 0.2, W * 0.6, y + 0.45, WOOD);
        boat(shapes, cx, top - 0.1, cz, len, wid, heading, rand);
        break;
      }
      case 'leg': {
        // Braces between the legs, out of reach.
        break;
      }
      case 'tank': {
        // A steel tank with bands round it, a cone of a roof, braces between its legs and a ladder up one.
        local(-L, -W, y, L, W, top, STEEL);
        for (const h of [0.15, 0.5, 0.85]) local(-L - 0.04, -W - 0.04, y + (top - y) * h - 0.06, L + 0.04, W + 0.04, y + (top - y) * h + 0.06, IRON);
        rod(shapes, new THREE.Vector3(cx, top, cz), new THREE.Vector3(cx, top + 1.8, cz), Math.hypot(L, W) + 0.1, STEEL, 4, 0.05);
        const legs = map.walls.filter((w) => w.look === 'leg' && w.minX >= b.minX - 1 && w.maxX <= b.maxX + 1 && w.minZ >= b.minZ - 1 && w.maxZ <= b.maxZ + 1);
        for (const h of [y - 6, y - 3]) {
          for (let i = 0; i < legs.length; i++) {
            for (let j = i + 1; j < legs.length; j++) {
              const [p, q] = [legs[i], legs[j]];
              const [px, pz, qx, qz] = [(p.minX + p.maxX) / 2, (p.minZ + p.maxZ) / 2, (q.minX + q.maxX) / 2, (q.minZ + q.maxZ) / 2];
              if (Math.abs(px - qx) > 1e-3 && Math.abs(pz - qz) > 1e-3) continue;
              rod(shapes, new THREE.Vector3(px, h, pz), new THREE.Vector3(qx, h, qz), 0.08, IRON, 6);
            }
          }
        }
        const foot = legs[0];
        if (foot) for (let h = standsOn(world, foot) + 0.3; h < y; h += 0.3) local(foot.minX - cx - 0.15, foot.minZ - cz - 0.25, h, foot.minX - cx + 0.35, foot.minZ - cz - 0.21, h + 0.03, IRON);
        break;
      }
      case 'tomb': {
        local(-L, -W, y, L, W, top - 0.1, STONE);
        local(-L - 0.06, -W - 0.06, top - 0.12, L + 0.06, W + 0.06, top, STONE);
        // A headstone or a cross at its head, for some.
        const r = rand();
        if (r < 0.4) local(L - 0.25, -W * 0.6, top, L - 0.1, W * 0.6, top + 0.9, STONE);
        else if (r < 0.7) {
          local(L - 0.22, -0.06, top, L - 0.1, 0.06, top + 1.1, STONE);
          local(L - 0.22, -0.35, top + 0.65, L - 0.1, 0.35, top + 0.77, STONE);
        }
        break;
      }
      case 'belltower': {
        belltower(boxes, shapes, b, y);
        break;
      }
      case 'quay': {
        // Bollards along the quay's edge, and boats moored off it.
        for (let x = b.minX + 6; x < b.maxX - 4; x += 9) {
          rod(shapes, new THREE.Vector3(x, top, b.maxZ - 0.5), new THREE.Vector3(x, top + 0.45, b.maxZ - 0.5), 0.16, IRON, 10, 0.13);
          rod(shapes, new THREE.Vector3(x, top + 0.45, b.maxZ - 0.5), new THREE.Vector3(x, top + 0.55, b.maxZ - 0.5), 0.13, IRON, 10, 0.2);
        }
        local(-L, -W, top - 0.02, L, -W + 0.4, top + 0.06, STONE);
        local(-L, W - 0.5, top - 0.02, L, W, top + 0.06, STONE);
        // Heaps of nets with their floats, by the fish market and the boat yard.
        for (const dx of [-58, -46, 52, 60]) {
          const x = cx + dx;
          blob(shapes, x, top + 0.1, b.minZ + 2, 0.9, plain(0x3e4236), rand, 0.35);
          for (let k = 0; k < 5; k++) blob(shapes, x - 0.6 + rand() * 1.2, top + 0.3, b.minZ + 1.4 + rand() * 1.2, 0.09, plain(0xe0662a), rand, 1);
        }
        const moored = [[-50, 4.5, 7.5], [-33, 3.5, 5], [-12, 5.5, 8.5], [6, 4, 5.5], [24, 5, 7], [47, 3.5, 5]];
        for (const [dx, off, length] of moored) {
          const x = cx + dx;
          const beam = length * 0.36;
          boat(shapes, x, WATER_LEVEL + beam * 0.3, b.maxZ + off, length, beam, rand() < 0.5 ? 0.08 : Math.PI - 0.08, rand);
        }
        break;
      }
    }
  }
  church(world, boxes, shapes);
}

/** The bell tower: string courses, a belfry open on each side, a cornice, a clock and a tiled pyramid roof. */
function belltower(boxes: Boxes, shapes: Shapes, b: MapBox, y: number): void {
  const top = b.y1;
  const [cx, cz] = [(b.minX + b.maxX) / 2, (b.minZ + b.maxZ) / 2];
  const g = 0.06;
  for (const h of [y + 4.5, y + 9, top - 5]) boxes.box(b.minX - g, h - 0.1, b.minZ - g, b.maxX + g, h + 0.1, b.maxZ + g, STONE);
  boxes.box(b.minX - 0.2, top - 0.35, b.minZ - 0.2, b.maxX + 0.2, top, b.maxZ + 0.2, STONE);
  // Each side's belfry: a dark arched opening between stone piers.
  const [b0, b1] = [top - 4.4, top - 1.2];
  for (const [axisX, side] of [[true, -1], [true, 1], [false, -1], [false, 1]] as const) {
    const face = axisX ? (side < 0 ? b.minZ : b.maxZ) : side < 0 ? b.minX : b.maxX;
    const mid = axisX ? cx : cz;
    const put = (a0: number, a1: number, o0: number, o1: number, y0: number, y1: number, s: Stuff) => {
      const [c0, c1] = [face + side * o0, face + side * o1];
      if (axisX) boxes.box(a0, y0, Math.min(c0, c1), a1, y1, Math.max(c0, c1), s);
      else boxes.box(Math.min(c0, c1), y0, a0, Math.max(c0, c1), y1, a1, s);
    };
    put(mid - 1, mid + 1, -0.01, 0.01, b0, b1, DARK);
    put(mid - 1.15, mid - 1, 0, 0.05, b0, b1, STONE);
    put(mid + 1, mid + 1.15, 0, 0.05, b0, b1, STONE);
    put(mid - 1.2, mid + 1.2, 0, 0.1, b0 - 0.1, b0 + 0.05, STONE);
    put(mid - 0.25, mid + 0.25, 0, 0.07, b1 - 0.1, b1 + 0.3, STONE);
    // An arch's curve, stepped.
    for (let k = 0; k < 5; k++) {
      const half = 1 - (k / 5) ** 2 * 0.8;
      put(mid - 1, mid - half, 0, 0.04, b1 - 0.9 + k * 0.18, b1 - 0.72 + k * 0.18, STONE);
      put(mid + half, mid + 1, 0, 0.04, b1 - 0.9 + k * 0.18, b1 - 0.72 + k * 0.18, STONE);
    }
  }
  // The clock over the piazza.
  const clockY = top - 7;
  const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2);
  shapes.add(new THREE.CylinderGeometry(0.9, 0.9, 0.06, 20), new THREE.Matrix4().compose(new THREE.Vector3(cx, clockY, b.maxZ + 0.03), q, new THREE.Vector3(1, 1, 1)), plain(0xeee8d8));
  boxes.box(cx - 0.03, clockY, b.maxZ + 0.06, cx + 0.03, clockY + 0.7, b.maxZ + 0.08, DARK);
  boxes.box(cx, clockY - 0.03, b.maxZ + 0.06, cx + 0.5, clockY + 0.03, b.maxZ + 0.08, DARK);
  // The roof: a pyramid of tiles, and a cross on it.
  const r = Math.hypot(b.maxX - b.minX, b.maxZ - b.minZ) / 2 + 0.15;
  shapes.add(new THREE.ConeGeometry(r, 3.6, 4).rotateY(Math.PI / 4), new THREE.Matrix4().makeTranslation(cx, top + 1.8, cz), ROOF);
  boxes.box(cx - 0.05, top + 3.5, cz - 0.05, cx + 0.05, top + 4.6, cz + 0.05, IRON);
  boxes.box(cx - 0.3, top + 4.1, cz - 0.05, cx + 0.3, top + 4.2, cz + 0.05, IRON);
}

/** The church's front: a rose window over its door. */
function church(world: World, boxes: Boxes, shapes: Shapes): void {
  const b = world.map!.buildings.find((x) => x.name === 'church');
  if (!b) return;
  const k = b.blocks[0];
  const face = k.maxZ + 0.15;
  const x = (k.minX + k.maxX) / 2;
  const y = b.floor + 4.3;
  const q = new THREE.Quaternion();
  shapes.add(new THREE.TorusGeometry(1.1, 0.14, 6, 20), new THREE.Matrix4().compose(new THREE.Vector3(x, y, face + 0.05), q, new THREE.Vector3(1, 1, 1)), STONE);
  const disc = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2);
  shapes.add(new THREE.CylinderGeometry(1.05, 1.05, 0.04, 20), new THREE.Matrix4().compose(new THREE.Vector3(x, y, face + 0.01), disc, new THREE.Vector3(1, 1, 1)), GLASS);
  // Its tracery: spokes from the middle.
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI;
    const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, face + 0.04), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), a), new THREE.Vector3(2.1, 0.06, 0.05));
    boxes.matrices.push(m);
    boxes.stuffs.push(STONE);
  }
}
