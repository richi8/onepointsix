import * as THREE from 'three';
import { kitBalconies, placeBlocks, RAIL, SLAB, type KitBalcony } from '../shared/kit.ts';
import type { World } from '../shared/world.ts';
import { Boxes, IRON, Shapes, STONE } from './townparts.ts';

// A map's balconies drawn as the town's are: wrought-iron railings of bars
// between a flat top rail and a bottom one, with a band of rings along them,
// in place of the plastered railings they collide as, which still stop
// rounds and hide whoever's behind them from bots; and under each slab a
// moulded stone edge and stone brackets.

/** The bars' thickness and how far apart they stand. */
const BAR = 0.018;
const BARS = 0.11;
/** The band of rings: its middle's height over the floor and the rings' radius. */
const BAND = 0.78;
const RING = 0.045;

/** The props of a map's balconies' railings, drawn here in iron rather than as boxes. */
export function railProps(world: World): Set<number> {
  const out = new Set<number>();
  if (!world.map) return out;
  const near = (a: number, b: number) => Math.abs(a - b) < 1e-6;
  const rails = kitBalconies(placeBlocks(world.map.buildings)).flatMap((b) => b.rails.map((r) => ({ ...r, y: b.y })));
  world.props.forEach((p, i) => {
    const b = p.box;
    if (b.part !== 'wall') return;
    if (rails.some((r) => near(r.minX, b.minX) && near(r.maxX, b.maxX) && near(r.minZ, b.minZ) && near(r.maxZ, b.maxZ) && b.minY > r.y - 1e-6 && b.minY < r.y + RAIL - 1e-6)) out.add(i);
  });
  return out;
}

/** Every balcony of a map's buildings, into `boxes` and `shapes`. */
export function balconies(world: World, boxes: Boxes, shapes: Shapes): void {
  for (const b of kitBalconies(placeBlocks(world.map!.buildings))) balcony(b, boxes, shapes);
}

function balcony(b: KitBalcony, boxes: Boxes, shapes: Shapes): void {
  const o = b.out;
  /** A box from a0 to a1 along the wall, c0 to c1 out from its line, y0 to y1 up. */
  const put = (a0: number, a1: number, c0: number, c1: number, y0: number, y1: number, s = IRON) => {
    const [p0, p1] = [Math.min(c0, c1), Math.max(c0, c1)];
    if (b.axis === 'x') boxes.box(a0, y0, p0, a1, y1, p1, s);
    else boxes.box(p0, y0, a0, p1, y1, a1, s);
  };
  const y = b.y;
  // Under the slab: a moulded edge round its front and ends, and brackets back to the wall.
  const front = b.c1;
  put(b.a0 - 0.04, b.a1 + 0.04, b.c0, front + o * 0.04, y - SLAB - 0.02, y - SLAB + 0.08, STONE);
  put(b.a0 - 0.04, b.a1 + 0.04, b.c0, front + o * 0.06, y - 0.06, y + 0.02, STONE);
  const depth = Math.abs(b.c1 - b.c0);
  const n = Math.max(2, Math.round((b.a1 - b.a0) / 1.2) + 1);
  for (let k = 0; k < n; k++) {
    const a = b.a0 + 0.2 + ((b.a1 - b.a0 - 0.4) * k) / (n - 1);
    // Stepped in toward the wall as it goes down.
    for (let s = 0; s < 4; s++) put(a - 0.09, a + 0.09, b.c0, b.c0 + o * (depth - 0.1) * (1 - s * 0.24), y - SLAB - 0.12 * (s + 1), y - SLAB - 0.12 * s, STONE);
  }

  // The railings: along the front and back to the wall at each end, a line at a time.
  const lines: [THREE.Vector2, THREE.Vector2][] = [];
  const at = (a: number, c: number) => new THREE.Vector2(a, c);
  const inset = 0.05;
  const [fa0, fa1] = [b.a0 + inset, b.a1 - inset];
  const fc = front - o * inset;
  lines.push([at(fa0, b.c0), at(fa0, fc)], [at(fa0, fc), at(fa1, fc)], [at(fa1, fc), at(fa1, b.c0)]);
  const world = (p: THREE.Vector2, h: number) => (b.axis === 'x' ? new THREE.Vector3(p.x, h, p.y) : new THREE.Vector3(p.y, h, p.x));
  for (const [p, q] of lines) {
    const len = p.distanceTo(q);
    const d = q.clone().sub(p).normalize();
    // Rails along the top, and near the foot, and the band's two bars.
    for (const [h0, h1, w] of [[RAIL - 0.04, RAIL, 0.05], [0.08, 0.11, 0.025], [BAND - RING - 0.02, BAND - RING, 0.02], [BAND + RING, BAND + RING + 0.02, 0.02]] as const) {
      bar(boxes, world(p, y + h0), world(q, y + h0), w, h1 - h0);
    }
    // Bars from foot to top, a gap in each for the band.
    const count = Math.max(1, Math.round(len / BARS));
    for (let k = 0; k <= count; k++) {
      const c = p.clone().addScaledVector(d, (len * k) / count);
      const [x, z] = b.axis === 'x' ? [c.x, c.y] : [c.y, c.x];
      for (const [h0, h1] of [[0, BAND - RING - 0.02], [BAND + RING + 0.02, RAIL - 0.04]]) boxes.box(x - BAR / 2, y + h0, z - BAR / 2, x + BAR / 2, y + h1, z + BAR / 2, IRON);
      // A ring between each pair of bars.
      if (k < count) {
        const m = p.clone().addScaledVector(d, (len * (k + 0.5)) / count);
        const centre = world(m, y + BAND);
        const facing = world(new THREE.Vector2(d.y, -d.x), 0).normalize();
        const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), facing);
        shapes.add(new THREE.TorusGeometry(RING - 0.006, 0.006, 3, 8), new THREE.Matrix4().compose(centre, q, new THREE.Vector3(1, 1, 1)), IRON);
      }
    }
  }
}

/** A flat bar from a to b at its foot, `w` wide across and `h` high. */
function bar(boxes: Boxes, a: THREE.Vector3, b: THREE.Vector3, w: number, h: number): void {
  const [x0, x1] = [Math.min(a.x, b.x), Math.max(a.x, b.x)];
  const [z0, z1] = [Math.min(a.z, b.z), Math.max(a.z, b.z)];
  boxes.box(x0 - (x1 - x0 < 1e-6 ? w / 2 : 0), a.y, z0 - (z1 - z0 < 1e-6 ? w / 2 : 0), x1 + (x1 - x0 < 1e-6 ? w / 2 : 0), a.y + h, z1 + (z1 - z0 < 1e-6 ? w / 2 : 0), IRON);
}
