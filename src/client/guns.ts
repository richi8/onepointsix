import * as THREE from 'three';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { floats } from './baked.ts';
import type { GunPoints } from './handwork.ts';

// The gun models come in their own sizes and poses. Each is fitted the same
// way: barrel along -z, the sight line on y = 0 and the grip at z = 0. Where
// the hands go comes from points marked on each model by eye (see GUNS in
// scripts/fetch-assets.mjs): empty nodes named Grip, Support, Muzzle, Sight,
// Magazine and Bolt, each then snapped onto the geometry near it. Each model
// is one mesh a material, so the parts that move in a reload (the magazine,
// and the rifle's charging handle, the pistol's slide or the bolt-action's
// bolt handle) are found as the connected pieces inside a box, and split off
// into their own meshes.

/** Which of a gun's pieces, by their bounds in fitted space, belong to a moving part. */
type Picker = (box: THREE.Box3) => boolean;

interface Fit {
  /** Metres from butt to muzzle. */
  length: number;
  /** Metres the eye sits above the Sight mark, for an added optic. */
  raise: number;
  /** The pieces that make up its magazine, and its slide or bolt handle. */
  magazine: Picker | null;
  action: Picker | null;
  /** The way the magazine leaves its well, along the grip or the magazine's own slant. */
  well: THREE.Vector3;
  /**
   * A body for a magazine whose model shows only its base plate, as the
   * pistol's in its grip: width, height, depth, and how far forward of the
   * base's middle it sits.
   */
  body: [number, number, number, number] | null;
  /**
   * A charging handle for a model without one: where the middle of its
   * latch's front meets the back of the receiver, in fitted space.
   */
  handle: THREE.Vector3 | null;
}

/** The name of the round a full magazine shows at its top, which an empty one hasn't. */
export const ROUND = 'round';

/** The charging handle's latch, across, high and deep, and the stem it draws back, deep. */
const LATCH = [0.036, 0.007, 0.012];
const STEM = 0.06;

/** In WEAPONS order. */
const FITS: Fit[] = [
  // A flat-top carbine: a red dot goes on the rail. The magazine and its base plate hang under the receiver. The
  // model has no charging handle, so one is added at the receiver's back, high enough to draw back over the stock.
  {
    length: 0.85, raise: 0.033,
    magazine: (b) => b.max.y < -0.115 && b.min.z > -0.2 && b.max.z < -0.1, action: null,
    well: new THREE.Vector3(0, -1, -0.15).normalize(), body: null, handle: new THREE.Vector3(0, -0.047, 0.025),
  },
  // Sized for the fist rather than to a real pistol's length: the model's grip is short for its slide.
  // Everything above the frame is the slide; the grip's base plate is the magazine's.
  {
    length: 0.27, raise: 0,
    magazine: (b) => b.max.y < -0.1, action: (b) => b.min.y > -0.035,
    well: new THREE.Vector3(0, -1, 0.22).normalize(), body: [0.016, 0.07, 0.02, 0.006], handle: null,
  },
  // Scoped: the eye looks down the scope. Its bolt handle is the one piece standing out to the right.
  {
    length: 1.1, raise: 0,
    magazine: null, action: (b) => b.max.x > 0.02,
    well: new THREE.Vector3(0, -1, 0), body: null, handle: null,
  },
];

export interface FittedGun extends GunPoints {
  /** The whole gun: its frame, and its moving parts at rest, each a group of meshes in the gun's space. */
  object: THREE.Object3D;
  frame: THREE.Object3D;
  magazinePart: THREE.Object3D | null;
  actionPart: THREE.Object3D | null;
  muzzle: THREE.Vector3;
}

const MARKS = ['Grip', 'Support', 'Muzzle', 'Sight', 'Magazine', 'Bolt'] as const;

export function fitGun(gltf: GLTF, weapon: number): FittedGun {
  const fit = FITS[weapon];
  const model = gltf.scene.clone();
  model.updateMatrixWorld(true);
  const marks = {} as Record<(typeof MARKS)[number], THREE.Vector3>;
  for (const name of MARKS) {
    const node = model.getObjectByName(name);
    if (!node) throw new Error(`Gun ${weapon} has no ${name} mark`);
    marks[name] = node.getWorldPosition(new THREE.Vector3());
  }
  const box = new THREE.Box3();
  model.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) box.expandByObject(o);
  });
  const size = box.getSize(new THREE.Vector3());
  const k = fit.length / size.x;
  // Model space: +x runs butt to muzzle, +y up. Fitted: -z runs to the muzzle, and the grip and sight sit on the axes.
  const origin = new THREE.Vector3(marks.Grip.x, marks.Sight.y, (box.min.z + box.max.z) / 2);
  const at = (p: THREE.Vector3): THREE.Vector3 =>
    new THREE.Vector3((p.z - origin.z) * k, (p.y - origin.y) * k - fit.raise, -(p.x - origin.x) * k);
  // The same, as a matrix: turned a quarter about y, scaled, and moved.
  const fitted = new THREE.Matrix4().makeTranslation(0, -fit.raise, 0)
    .multiply(new THREE.Matrix4().makeRotationY(Math.PI / 2))
    .multiply(new THREE.Matrix4().makeScale(k, k, k))
    .multiply(new THREE.Matrix4().makeTranslation(-origin.x, -origin.y, -origin.z));

  const object = new THREE.Group();
  const frame = new THREE.Group();
  const magazine = fit.magazine ? new THREE.Group() : null;
  const action = fit.action || fit.handle ? new THREE.Group() : null;
  object.add(frame);
  if (magazine) object.add(magazine);
  if (action) object.add(action);
  const found: { part: THREE.Group; geometry: THREE.BufferGeometry }[] = [];
  let dark: THREE.Material | null = null;
  model.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    // Plain floats in fitted space, split by piece into the frame and the moving parts.
    const geometry = mesh.geometry.clone();
    for (const name of ['position', 'normal']) {
      const a = geometry.getAttribute(name);
      if (a) geometry.setAttribute(name, floats(a));
    }
    geometry.applyMatrix4(fitted.clone().multiply(mesh.matrixWorld));
    const index = geometry.getIndex();
    const corner = (i: number): number => (index ? index.getX(i) : i);
    const position = geometry.getAttribute('position');
    const kept = new Map<THREE.Group, number[]>();
    for (const tris of pieces(geometry)) {
      const bounds = new THREE.Box3();
      for (const t of tris) for (let c = 0; c < 3; c++) bounds.expandByPoint(V_A.fromBufferAttribute(position, corner(t + c)));
      const part = magazine && fit.magazine!(bounds) ? magazine : action && fit.action?.(bounds) ? action : frame;
      let list = kept.get(part);
      if (!list) kept.set(part, (list = []));
      for (const t of tris) list.push(corner(t), corner(t + 1), corner(t + 2));
    }
    const material = mesh.material as THREE.MeshStandardMaterial;
    material.roughness = 0.55;
    material.metalness = 0.35;
    if (material.name === 'MainDark') dark = material;
    for (const [part, list] of kept) {
      const g = geometry.clone();
      g.setIndex(list);
      const piece = new THREE.Mesh(g, material);
      piece.castShadow = true;
      part.add(piece);
      found.push({ part, geometry: g });
    }
  });

  if (action && fit.handle) {
    // A latch across the receiver's back, on a stem running forward into it, hidden until drawn back.
    const [w, h, d] = LATCH;
    const at = fit.handle;
    const latch = new THREE.BoxGeometry(w, h, d).translate(at.x, at.y, at.z + d / 2);
    const stem = new THREE.BoxGeometry(0.008, h * 0.8, STEM).translate(at.x, at.y, at.z - STEM / 2);
    for (const g of [latch, stem]) {
      const piece = new THREE.Mesh(g, dark ?? new THREE.MeshStandardMaterial());
      piece.castShadow = true;
      action.add(piece);
      found.push({ part: action, geometry: g });
    }
  }
  const points = snap(found, fit, {
    grip: at(marks.Grip), support: at(marks.Support), muzzle: at(marks.Muzzle), magazine: at(marks.Magazine), bolt: at(marks.Bolt),
  }, frame, magazine, action);
  if (magazine && fit.body) {
    // The magazine's body, up the well from its base, hidden in the grip when it's in: flat at the back, round at
    // the front, with the top round showing between its lips.
    const [w, h, d, ahead] = fit.body;
    const base = magazine.children[0] as THREE.Mesh;
    const up = V_A.copy(fit.well).negate();
    const turn = new THREE.Quaternion().setFromUnitVectors(V_B.set(0, 1, 0), up);
    const at = points.magazine.clone().addScaledVector(up, h / 2 + 0.004);
    at.z -= ahead;
    const place = new THREE.Matrix4().compose(at, turn, V_B.set(1, 1, 1));
    const body = new THREE.Mesh(magazineBody(w, h, d).applyMatrix4(place), base.material);
    const round = new THREE.Mesh(
      new THREE.CylinderGeometry(w * 0.28, w * 0.28, d * 0.8, 8).rotateX(Math.PI / 2).translate(0, h / 2 + w * 0.12, -d * 0.05).applyMatrix4(place),
      new THREE.MeshStandardMaterial({ color: 0xb08a3e, roughness: 0.35, metalness: 0.8 }),
    );
    round.name = ROUND;
    for (const m of [body, round]) {
      m.castShadow = true;
      magazine.add(m);
    }
  }
  return { object, frame, magazinePart: magazine, actionPart: action, ...points };
}

/**
 * The marked points moved onto the geometry: the muzzle to the middle of the
 * barrel's end, the grip to the middle of the grip at its height, the support
 * to the underside of the fore-end, the magazine to the middle of its base
 * (or the bolt-action's loading port to the top of its receiver), and the
 * bolt to the end of its handle or the back of the slide. The pivot, which
 * the bolt handle turns about, is on the bore under the handle.
 */
function snap(
  found: { part: THREE.Object3D; geometry: THREE.BufferGeometry }[], fit: Fit,
  marks: Record<'grip' | 'support' | 'muzzle' | 'magazine' | 'bolt', THREE.Vector3>,
  frame: THREE.Object3D, magazine: THREE.Object3D | null, action: THREE.Object3D | null,
): Omit<FittedGun, 'object' | 'frame' | 'magazinePart' | 'actionPart'> {
  const all = (parts: (THREE.Object3D | null)[], keep: (v: THREE.Vector3) => boolean): THREE.Vector3[] => {
    const out: THREE.Vector3[] = [];
    for (const { part, geometry } of found) {
      if (!parts.includes(part)) continue;
      const position = geometry.getAttribute('position');
      const index = geometry.getIndex()!;
      for (let i = 0; i < index.count; i++) {
        const v = new THREE.Vector3().fromBufferAttribute(position, index.getX(i));
        if (keep(v)) out.push(v);
      }
    }
    return out;
  };
  const bounds = (vs: THREE.Vector3[]): THREE.Box3 => new THREE.Box3().setFromPoints(vs);
  const whole = [frame, magazine, action];
  const everything = bounds(all(whole, () => true));

  // The muzzle: the middle of what's within a few millimetres of the front.
  const front = bounds(all(whole, (v) => v.z < everything.min.z + 0.004));
  const muzzle = front.getCenter(new THREE.Vector3()).setZ(everything.min.z);

  // The grip: its middle across and front to back, at the marked height.
  const g = marks.grip;
  const across = bounds(all([frame], (v) => Math.abs(v.y - g.y) < 0.008 && Math.abs(v.z - g.z) < 0.04 && Math.abs(v.x - g.x) < 0.03));
  const grip = across.isEmpty() ? g.clone() : new THREE.Vector3((across.min.x + across.max.x) / 2, g.y, (across.min.z + across.max.z) / 2);
  const mid = grip.x;

  // The support: the underside of the fore-end where it's marked.
  const s = marks.support;
  const under = bounds(all([frame], (v) => Math.abs(v.z - s.z) < 0.008 && Math.abs(v.y - s.y) < 0.04 && Math.abs(v.x - mid) < 0.04));
  const support = new THREE.Vector3(mid, under.isEmpty() ? s.y : under.min.y, s.z);

  // The magazine's base: the middle of its lowest few millimetres along the well; or the top of the receiver at the port.
  let base: THREE.Vector3;
  if (magazine) {
    const depth = (v: THREE.Vector3): number => v.dot(fit.well);
    const vs = all([magazine], () => true);
    const deepest = Math.max(...vs.map(depth));
    base = bounds(vs.filter((v) => depth(v) > deepest - 0.004)).getCenter(new THREE.Vector3());
    base.x = mid;
  } else {
    const m = marks.magazine;
    const top = bounds(all([frame], (v) => Math.abs(v.z - m.z) < 0.008 && v.y > m.y - 0.03 && v.y < m.y + 0.02 && Math.abs(v.x - mid) < 0.03));
    base = new THREE.Vector3(mid, top.isEmpty() ? m.y : top.max.y, m.z);
  }

  // What the right or left hand works: the bolt handle's end, the back of the slide, or the rifle's charging handle.
  let bolt = marks.bolt.clone().setX(mid);
  let pivot = bolt.clone();
  if (action) {
    const vs = all([action], () => true);
    const b = bounds(vs);
    if (b.max.x - mid > 0.02) {
      // A bolt handle, standing out to the right from the bore.
      bolt = bounds(vs.filter((v) => v.x > b.max.x - 0.008)).getCenter(new THREE.Vector3());
      const bore = bounds(all([frame], (v) => v.z < everything.min.z + 0.004));
      pivot = new THREE.Vector3(mid, bore.getCenter(V_A).y, bolt.z);
    } else {
      // A slide: grasped over the top at its back.
      const rear = bounds(vs.filter((v) => v.z > b.max.z - 0.02));
      bolt = new THREE.Vector3(mid, (rear.min.y + rear.max.y) / 2, b.max.z - 0.012);
      pivot = bolt.clone();
    }
  }
  return { muzzle, grip, support, magazine: base, bolt, pivot, well: fit.well.clone() };
}

/**
 * A magazine's body, `w` across, `h` high and `d` deep, about its middle:
 * flat at the back (+z), rounded across its front.
 */
function magazineBody(w: number, h: number, d: number): THREE.BufferGeometry {
  // Drawn across (x) and front to back (y, the front up), then stood up its height.
  const r = w / 2;
  const shape = new THREE.Shape()
    .moveTo(-r, -d / 2)
    .lineTo(r, -d / 2)
    .lineTo(r, d / 2 - r)
    .absarc(0, d / 2 - r, r, 0, Math.PI, false)
    .lineTo(-r, -d / 2);
  return new THREE.ExtrudeGeometry(shape, { depth: h, bevelEnabled: false, curveSegments: 6 })
    .rotateX(-Math.PI / 2)
    .translate(0, -h / 2, 0)
    .deleteAttribute('uv');
}

/**
 * A geometry's connected pieces: sets of triangles (as indices of their first
 * corner) that share corners, with corners at the same place counted as
 * shared, as a model's hard edges split them.
 */
export function pieces(geometry: THREE.BufferGeometry): number[][] {
  const position = geometry.getAttribute('position');
  const index = geometry.getIndex();
  const corner = (i: number): number => (index ? index.getX(i) : i);
  const count = index ? index.count : position.count;
  // Corners welded by where they are, to the tenth of a millimetre.
  const weld = new Map<string, number>();
  const id = new Int32Array(position.count);
  for (let v = 0; v < position.count; v++) {
    const key = `${Math.round(position.getX(v) * 1e4)},${Math.round(position.getY(v) * 1e4)},${Math.round(position.getZ(v) * 1e4)}`;
    let w = weld.get(key);
    if (w === undefined) weld.set(key, (w = weld.size));
    id[v] = w;
  }
  const parent = Int32Array.from({ length: weld.size }, (_, i) => i);
  const find = (a: number): number => {
    while (parent[a] !== a) a = parent[a] = parent[parent[a]];
    return a;
  };
  for (let i = 0; i < count; i += 3) {
    const a = find(id[corner(i)]);
    for (const k of [1, 2]) {
      const b = find(id[corner(i + k)]);
      if (a !== b) parent[b] = a;
    }
  }
  const groups = new Map<number, number[]>();
  for (let i = 0; i < count; i += 3) {
    const root = find(id[corner(i)]);
    let g = groups.get(root);
    if (!g) groups.set(root, (g = []));
    g.push(i);
  }
  return [...groups.values()];
}

const V_A = new THREE.Vector3();
const V_B = new THREE.Vector3();
