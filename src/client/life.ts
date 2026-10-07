import * as THREE from 'three';
import { KIT_WALL } from '../shared/kit.ts';
import { mulberry32 } from '../shared/rng.ts';
import type { World } from '../shared/world.ts';
import type { Face } from './dressing.ts';
import { Boxes, IRON, plain, Shapes, STONE, TERRACOTTA, type Stuff } from './townparts.ts';

// What people have put up on a map town's buildings, drawn only: lanterns on
// brackets by the street, air conditioners beside upper windows, power and
// phone cables clipped along the walls and strung across the lanes, washing
// lines between facing windows hung with clothes, aerials and satellite
// dishes on the roofs, and spouts through the parapets to shed a flat roof's
// rain. The façades (see dressing.ts) say where on their walls there's room;
// the lines across the lanes are strung once every wall has had its say.

const CABLE = plain(0x161616);
const LINE = plain(0xd8d4c8);
const AC = plain(0xdcdad2);
const AC_DARK = plain(0x3a3c3c);
const LANTERN = plain(0x1e1e1c);
const LANTERN_GLASS = plain(0xe8dcb0);
const ALU = plain(0xa8aaa6);
const DISH = plain(0xe8e6e0);
const CLOTHES = [0xf2f0ea, 0xf2f0ea, 0xe0e4ea, 0x3a5a8a, 0xb84a3a, 0xe8c84a, 0x6a8a5a, 0xd88aa0, 0x2a2a30, 0x8ab0d0].map(plain);

const UP = new THREE.Vector3(0, 1, 0);

/** A point on a wall to string a line from, out across what it faces. */
interface Anchor {
  at: THREE.Vector3;
  /** The way out of the wall, level. */
  out: THREE.Vector3;
  kind: 'cable' | 'line';
}

/** A rod from a to b, radius r. */
function rod(shapes: Shapes, a: THREE.Vector3, b: THREE.Vector3, r: number, s: Stuff, seg = 5): void {
  const len = a.distanceTo(b);
  if (len < 1e-3) return;
  const q = new THREE.Quaternion().setFromUnitVectors(UP, b.clone().sub(a).normalize());
  shapes.add(new THREE.CylinderGeometry(r, r, len, seg, 1, true), new THREE.Matrix4().compose(a.clone().add(b).multiplyScalar(0.5), q, new THREE.Vector3(1, 1, 1)), s);
}

/** A line hanging from a to b, sagging `sag` at its middle, as `n` straight pieces; its points. */
function hang(shapes: Shapes, a: THREE.Vector3, b: THREE.Vector3, sag: number, r: number, s: Stuff, n = 8): THREE.Vector3[] {
  const points = Array.from({ length: n + 1 }, (_, k) => {
    const t = k / n;
    return a.clone().lerp(b, t).add(new THREE.Vector3(0, -4 * sag * t * (1 - t), 0));
  });
  for (let k = 0; k < n; k++) rod(shapes, points[k], points[k + 1], r, s, 4);
  return points;
}

export class Life {
  private readonly anchors: Anchor[] = [];
  /** Every line strung across a lane: its ends, how far it sags and what it is. */
  readonly strung: { from: THREE.Vector3; to: THREE.Vector3; sag: number; kind: Anchor['kind'] }[] = [];
  private readonly world: World;
  private readonly boxes: Boxes;
  private readonly shapes: Shapes;

  constructor(world: World, boxes: Boxes, shapes: Shapes) {
    this.world = world;
    this.boxes = boxes;
    this.shapes = shapes;
  }

  /**
   * A stretch of wall's things: `ground` if it's its building's ground
   * storey with the street at its foot, `free(b0, b1, y0, y1)` whether a
   * stretch of it from b0 to b1 along, y0 to y1 over its floor, is clear of
   * its openings; `windows` its windows' middles and widths.
   */
  wall(face: Face, a0: number, a1: number, ground: boolean, free: (b0: number, b1: number, y0: number, y1: number) => boolean, windows: { at: number; width: number }[], rand: () => number): void {
    const w = face.w;
    const top = w.y + w.height;
    const high = w.y - this.world.terrainHeight(...face.at((a0 + a1) / 2, 1)) > 2;
    // A lantern by the street, on a stretch long enough to have one.
    if (ground && a1 - a0 > 3 && rand() < 0.45) {
      for (let tries = 0; tries < 6; tries++) {
        const a = a0 + 0.6 + rand() * (a1 - a0 - 1.2);
        if (free(a - 0.3, a + 0.3, 2.2, 3)) {
          this.lantern(face, a, w.y + 2.5);
          break;
        }
      }
    }
    if (high) {
      // An air conditioner beside some windows.
      for (const o of windows) {
        if (rand() > 0.14) continue;
        const side = rand() < 0.5 ? -1 : 1;
        const a = o.at + side * (o.width + 0.15 + 0.45);
        if (a - 0.45 > a0 && a + 0.45 < a1 && free(a - 0.45, a + 0.45, 1.1, 1.75)) this.airCon(face, a, w.y + 1.15);
      }
      // A cable along under the top of the wall, now and then strung on across the street.
      if (top - this.world.terrainHeight(...face.at((a0 + a1) / 2, 1)) > 4.5 && a1 - a0 > 2 && rand() < 0.4) {
        const y = top - 0.32 - rand() * 0.15;
        const b0 = a0 + 0.2 + rand() * (a1 - a0 - 0.4) * 0.5;
        const b1 = Math.min(a1 - 0.2, b0 + 1.5 + rand() * 6);
        const [x0, z0] = face.at(b0, 0.03);
        const [x1, z1] = face.at(b1, 0.03);
        rod(this.shapes, new THREE.Vector3(x0, y, z0), new THREE.Vector3(x1, y, z1), 0.008, CABLE, 4);
        for (let a = b0 + 0.4; a < b1; a += 0.8) face.box(a - 0.01, a + 0.01, 0, 0.045, y - 0.02, y + 0.02, CABLE);
        const [ax, az] = face.at(rand() < 0.5 ? b0 : b1, 0.05);
        this.anchors.push({ at: new THREE.Vector3(ax, y, az), out: this.outOf(face), kind: 'cable' });
      }
      // A washing line from beside a window.
      for (const o of windows) {
        if (rand() > 0.2) continue;
        const a = o.at + (rand() < 0.5 ? -1 : 1) * (o.width / 2 + 0.2);
        const [x, z] = face.at(a, 0.12);
        this.anchors.push({ at: new THREE.Vector3(x, w.y + 2.05, z), out: this.outOf(face), kind: 'line' });
      }
    }
  }

  private outOf(face: Face): THREE.Vector3 {
    return face.w.axis === 'x' ? new THREE.Vector3(0, 0, face.s) : new THREE.Vector3(face.s, 0, 0);
  }

  /** A lantern on a curled bracket out from the wall at `a`, its arm at `y`. */
  private lantern(face: Face, a: number, y: number): void {
    face.box(a - 0.07, a + 0.07, 0, 0.03, y - 0.15, y + 0.15, LANTERN);
    const p = (o: number, h: number) => {
      const [x, z] = face.at(a, o);
      return new THREE.Vector3(x, h, z);
    };
    rod(this.shapes, p(0.02, y), p(0.45, y), 0.012, LANTERN, 5);
    rod(this.shapes, p(0.02, y - 0.12), p(0.3, y), 0.01, LANTERN, 5);
    // The lantern hangs from the arm's end: a cap, its glass, and a foot.
    const c = p(0.42, y - 0.24);
    this.shapes.add(new THREE.ConeGeometry(0.13, 0.12, 6), new THREE.Matrix4().makeTranslation(c.x, y - 0.08, c.z), LANTERN);
    this.shapes.add(new THREE.CylinderGeometry(0.1, 0.07, 0.24, 6), new THREE.Matrix4().makeTranslation(c.x, c.y, c.z), LANTERN_GLASS);
    for (let k = 0; k < 6; k++) {
      const t = (k / 6) * Math.PI * 2 + Math.PI / 6;
      rod(this.shapes, new THREE.Vector3(c.x + Math.cos(t) * 0.1, c.y + 0.12, c.z + Math.sin(t) * 0.1), new THREE.Vector3(c.x + Math.cos(t) * 0.07, c.y - 0.12, c.z + Math.sin(t) * 0.07), 0.008, LANTERN, 3);
    }
    this.shapes.add(new THREE.CylinderGeometry(0.075, 0.04, 0.06, 6), new THREE.Matrix4().makeTranslation(c.x, c.y - 0.15, c.z), LANTERN);
  }

  /** An air conditioner's outdoor unit on brackets, its middle `a` along, its foot at `y`. */
  private airCon(face: Face, a: number, y: number): void {
    const [W, H, D] = [0.8, 0.55, 0.28];
    face.box(a - W / 2, a + W / 2, 0.06, 0.06 + D, y, y + H, AC);
    // Its fan behind a round grille, and the grille's bars.
    const [x, z] = face.at(a - 0.08, 0.06 + D + 0.005);
    const turn = new THREE.Quaternion().setFromUnitVectors(UP, this.outOf(face));
    this.shapes.add(new THREE.CylinderGeometry(0.2, 0.2, 0.012, 16), new THREE.Matrix4().compose(new THREE.Vector3(x, y + H / 2, z), turn, new THREE.Vector3(1, 1, 1)), AC_DARK);
    for (const r of [0.08, 0.14, 0.2]) {
      this.shapes.add(new THREE.TorusGeometry(r, 0.006, 3, 18), new THREE.Matrix4().compose(new THREE.Vector3(x, y + H / 2, z).addScaledVector(this.outOf(face), 0.006), new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), this.outOf(face)), new THREE.Vector3(1, 1, 1)), AC);
    }
    // Louvres down its side, the brackets under it, and its pipes into the wall.
    for (let k = 0; k < 6; k++) face.box(a + W / 2 - 0.2, a + W / 2 - 0.04, 0.06 + D, 0.07 + D, y + 0.08 + k * 0.07, y + 0.1 + k * 0.07, AC_DARK);
    for (const s of [-1, 1]) {
      face.box(a + s * 0.3 - 0.02, a + s * 0.3 + 0.02, 0, 0.06 + D + 0.02, y - 0.04, y, IRON);
      face.box(a + s * 0.3 - 0.02, a + s * 0.3 + 0.02, 0, 0.03, y - 0.35, y, IRON);
    }
    const [px, pz] = face.at(a - W / 2 - 0.08, 0.05);
    rod(this.shapes, new THREE.Vector3(px, y + 0.3, pz), new THREE.Vector3(px, y - 0.6, pz), 0.012, plain(0xe8e8e2), 5);
  }

  /** Every cable and washing line across a lane, from the walls' anchors to the wall facing them. */
  string(): void {
    const world = this.world;
    const T = KIT_WALL;
    const rand = mulberry32(world.seed + 97);
    /** Whether (x, y, z) lies on the face of one of the town's walls looking back along `out`. */
    const onWall = (p: THREE.Vector3, out: THREE.Vector3) =>
      world.facades.some((w) => {
        const [a, c] = w.axis === 'x' ? [p.x, p.z] : [p.z, p.x];
        const faces = w.axis === 'x' ? -out.z : -out.x;
        return a > w.a0 && a < w.a1 && p.y > w.y && p.y < w.y + w.height && Math.abs(c - (w.line + faces * T / 2)) < 0.05;
      });
    for (const { at, out, kind } of this.anchors) {
      const [near, far] = kind === 'cable' ? [2.5, 15] : [1.8, 7.5];
      const from = at.clone().addScaledVector(out, 0.05);
      const t = world.raycast(from.x, from.y, from.z, out.x, out.y, out.z, far);
      if (!(t >= near && t <= far)) continue;
      const end = from.clone().addScaledVector(out, t - 0.04);
      if (!onWall(end.clone().addScaledVector(out, 0.04), out)) continue;
      const mid = from.clone().lerp(end, 0.5);
      const sag = kind === 'cable' ? 0.03 * t + 0.08 : 0.04 * t + 0.05;
      // High over the lane below, with room to walk under.
      if (mid.y - sag - world.groundHeight(mid.x, mid.z, mid.y - sag) < 2.4) continue;
      if (this.strung.some((o) => crosses(o.from, o.to, from, end))) continue;
      this.strung.push({ from, to: end, sag, kind });
      if (kind === 'cable') {
        hang(this.shapes, from, end, sag, 0.009, CABLE, 10);
        for (const p of [from, end]) this.boxes.box(p.x - 0.03, p.y - 0.03, p.z - 0.03, p.x + 0.03, p.y + 0.03, p.z + 0.03, IRON);
      } else this.washing(from, end, sag, rand);
    }
  }

  /** A washing line from a to b, sagging `sag`, hung with clothes. */
  private washing(a: THREE.Vector3, b: THREE.Vector3, sag: number, rand: () => number): void {
    // A pulley at each end, the line going out on top and back below it.
    for (const lift of [0, -0.12]) hang(this.shapes, a.clone().setY(a.y + lift), b.clone().setY(b.y + lift), sag, 0.004, LINE, 8);
    for (const p of [a, b]) this.boxes.box(p.x - 0.03, p.y - 0.15, p.z - 0.03, p.x + 0.03, p.y + 0.03, p.z + 0.03, IRON);
    const len = a.distanceTo(b);
    const along = b.clone().sub(a).normalize();
    const across = new THREE.Vector3().crossVectors(along, UP).normalize();
    const turn = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(along, UP, across));
    for (let s = 0.3 + rand() * 0.4; s < len - 0.3; s += 0.15 + rand() * 0.35) {
      if (rand() < 0.25) continue;
      const width = 0.2 + rand() * 0.45;
      const height = 0.25 + rand() * 0.6;
      if (s + width > len - 0.2) break;
      const t = (s + width / 2) / len;
      // Where it hangs from the line, and pieces of it from there, along and down.
      const hook = a.clone().lerp(b, t).add(new THREE.Vector3(0, -4 * sag * t * (1 - t), 0));
      const colour = CLOTHES[Math.floor(rand() * CLOTHES.length)];
      const piece = (u: number, down: number, pw: number, ph: number) =>
        this.boxes.turned(hook.clone().addScaledVector(along, u).add(new THREE.Vector3(0, -down - ph / 2, 0)), new THREE.Vector3(pw, ph, 0.01), turn, colour);
      const kind = rand();
      if (kind < 0.35) {
        // A shirt, by its hem: its body, and its sleeves hanging either side at the bottom.
        piece(0, 0, width, height);
        for (const side of [-1, 1]) piece(side * (width / 2 + 0.06), height * 0.62, 0.12, height * 0.38);
      } else if (kind < 0.6) {
        // Trousers, by the waist: the band and two legs with a gap between.
        piece(0, 0, width, 0.12);
        for (const side of [-1, 1]) piece(side * width * 0.27, 0.1, width * 0.44, height + 0.2);
      } else piece(0, 0, width, height);
      // Pegs.
      for (const u of [-width / 2 + 0.03, width / 2 - 0.03]) this.boxes.turned(hook.clone().addScaledVector(along, u).add(new THREE.Vector3(0, -0.01, 0)), new THREE.Vector3(0.012, 0.06, 0.02), turn, CLOTHES[0]);
      s += width;
    }
  }

  /**
   * On the roofs: aerials on the pitched roofs' ridges and in a corner of
   * some flat ones, satellite dishes on some parapets, and a spout through
   * the middle of each parapet over a drop.
   */
  roofs(): void {
    const world = this.world;
    const rand = mulberry32(world.seed + 131);
    for (const g of world.gables) {
      if (rand() > 0.55) continue;
      const alongX = g.ridge === 'x';
      const [u0, u1] = alongX ? [g.rect.minX, g.rect.maxX] : [g.rect.minZ, g.rect.maxZ];
      const vm = alongX ? (g.rect.minZ + g.rect.maxZ) / 2 : (g.rect.minX + g.rect.maxX) / 2;
      const u = u0 + 1 + rand() * (u1 - u0 - 2);
      const [x, z] = alongX ? [u, vm] : [vm, u];
      this.aerial(x, g.y + g.rise, z, rand);
    }
    const open = (x: number, y: number, z: number) => y > world.terrainHeight(x, z) + 0.05 && world.clearAsBuilt(x, y - 0.05, z, 0.1, 0.02);
    for (const p of world.props) {
      const b = p.box;
      if (b.part === 'roof') {
        // An aerial in a corner of a flat roof open to the sky.
        const r = rand();
        if (r > 0.4) continue;
        const [x, z] = [rand() < 0.5 ? b.minX + 0.45 : b.maxX - 0.45, rand() < 0.5 ? b.minZ + 0.45 : b.maxZ - 0.45];
        if (!open(x, b.maxY + 0.1, z) || !open(x, b.maxY + 2.5, z)) continue;
        if (r < 0.25) this.aerial(x, b.maxY, z, rand);
        else this.dish(x, b.maxY + 0.9, z, rand);
        continue;
      }
      if (b.part !== 'wall' || b.walk || p.colour === undefined) continue;
      // A parapet: a thin wall about a metre high standing on a roof.
      const [dx, dz, dy] = [b.maxX - b.minX, b.maxZ - b.minZ, b.maxY - b.minY];
      if (Math.min(dx, dz) > 0.35 || Math.min(dx, dz) < 0.2 || Math.max(dx, dz) < 2.5 || dy < 1 || dy > 1.4) continue;
      const alongX = dx > dz;
      const [cx, cz] = [(b.minX + b.maxX) / 2, (b.minZ + b.maxZ) / 2];
      const floor = b.maxY - 1;
      for (const s of [-1, 1]) {
        // The roof on one side, a drop on the other.
        const inside = alongX ? [cx, cz - s * (dz / 2 + 0.3)] : [cx - s * (dx / 2 + 0.3), cz];
        const outside = alongX ? [cx, cz + s * (dz / 2 + 0.3)] : [cx + s * (dx / 2 + 0.3), cz];
        if (!open(inside[0], floor + 0.1, inside[1]) || world.groundHeight(inside[0], inside[1], floor + 0.3) < floor - 0.3) continue;
        if (!open(outside[0], floor - 1.5, outside[1]) || !open(outside[0], floor + 0.05, outside[1])) continue;
        const reach = 0.42;
        const [x0, z0, x1, z1] = alongX
          ? [cx - 0.08, s > 0 ? b.maxZ : b.minZ - reach, cx + 0.08, s > 0 ? b.maxZ + reach : b.minZ]
          : [s > 0 ? b.maxX : b.minX - reach, cz - 0.08, s > 0 ? b.maxX + reach : b.minX, cz + 0.08];
        this.boxes.box(x0, floor - 0.06, z0, x1, floor + 0.02, z1, TERRACOTTA);
        // Its sides, a channel.
        if (alongX) for (const e of [cx - 0.08, cx + 0.06]) this.boxes.box(e, floor + 0.02, z0, e + 0.02, floor + 0.08, z1, TERRACOTTA);
        else for (const e of [cz - 0.08, cz + 0.06]) this.boxes.box(x0, floor + 0.02, e, x1, floor + 0.08, e + 0.02, TERRACOTTA);
        // A stone under it in the wall.
        if (alongX) this.boxes.box(cx - 0.14, floor - 0.14, s > 0 ? b.maxZ : b.minZ - 0.04, cx + 0.14, floor - 0.06, s > 0 ? b.maxZ + 0.04 : b.minZ, STONE);
        else this.boxes.box(s > 0 ? b.maxX : b.minX - 0.04, floor - 0.14, cz - 0.14, s > 0 ? b.maxX + 0.04 : b.minX, floor - 0.06, cz + 0.14, STONE);
        break;
      }
    }
  }

  /** A television aerial standing at (x, y, z): a mast and a boom of rods across it. */
  private aerial(x: number, y: number, z: number, rand: () => number): void {
    const h = 1.6 + rand() * 1.2;
    rod(this.shapes, new THREE.Vector3(x, y - 0.1, z), new THREE.Vector3(x, y + h, z), 0.018, ALU, 6);
    const yaw = rand() * Math.PI;
    const d = new THREE.Vector3(Math.cos(yaw), 0, Math.sin(yaw));
    const across = new THREE.Vector3(-d.z, 0, d.x);
    for (const [hh, len, n] of [[h - 0.05, 1.3, 8], [h - 0.55, 0.8, 5]] as const) {
      const c = new THREE.Vector3(x, y + hh, z);
      rod(this.shapes, c.clone().addScaledVector(d, -len * 0.3), c.clone().addScaledVector(d, len * 0.7), 0.01, ALU, 4);
      for (let k = 0; k < n; k++) {
        const p = c.clone().addScaledVector(d, -len * 0.25 + (len * 0.9 * k) / n);
        const w = 0.5 - k * 0.03;
        rod(this.shapes, p.clone().addScaledVector(across, -w / 2), p.clone().addScaledVector(across, w / 2), 0.005, ALU, 3);
      }
    }
  }

  /** A satellite dish on a short pole at (x, y, z), looking south and up. */
  private dish(x: number, y: number, z: number, rand: () => number): void {
    rod(this.shapes, new THREE.Vector3(x, y - 0.9, z), new THREE.Vector3(x, y, z), 0.025, ALU, 6);
    const look = new THREE.Vector3((rand() - 0.5) * 0.6, 0.55, 1).normalize();
    const centre = new THREE.Vector3(x, y + 0.1, z).addScaledVector(look, 0.08);
    const q = new THREE.Quaternion().setFromUnitVectors(UP, look);
    // A shallow bowl, its rim toward `look`.
    const bowl = new THREE.SphereGeometry(0.55, 14, 4, 0, Math.PI * 2, Math.PI - 0.62, 0.62).translate(0, 0.45, 0);
    this.shapes.add(bowl, new THREE.Matrix4().compose(centre, q, new THREE.Vector3(1, 1, 1)), DISH);
    rod(this.shapes, centre, centre.clone().addScaledVector(look, 0.42), 0.012, ALU, 4);
    const lnb = centre.clone().addScaledVector(look, 0.44);
    this.boxes.box(lnb.x - 0.04, lnb.y - 0.04, lnb.z - 0.04, lnb.x + 0.04, lnb.y + 0.04, lnb.z + 0.04, AC_DARK);
  }
}

/** Whether the lines a→b and c→d cross in plan, within half a metre of each other's height where they do. */
function crosses(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3): boolean {
  const [rx, rz, sx, sz] = [b.x - a.x, b.z - a.z, d.x - c.x, d.z - c.z];
  const det = rx * sz - rz * sx;
  if (Math.abs(det) < 1e-9) return false;
  const [qx, qz] = [c.x - a.x, c.z - a.z];
  const t = (qx * sz - qz * sx) / det;
  const u = (qx * rz - qz * rx) / det;
  if (t <= 0 || t >= 1 || u <= 0 || u >= 1) return false;
  return Math.abs(a.y + (b.y - a.y) * t - (c.y + (d.y - c.y) * u)) < 0.5;
}
