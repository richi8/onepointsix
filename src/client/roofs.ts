import * as THREE from 'three';
import { Layer } from '../shared/layers.ts';
import type { World } from '../shared/world.ts';
import { OVERHANG } from './structures.ts';
import { Boxes, Shapes, stuff, type Stuff } from './townparts.ts';

// What a map's pitched roofs carry besides their slopes (see structures.ts):
// half-round tiles along the ridge and up each verge, a row of their ends
// along the eaves, rafters and boards under the overhang, a gutter along each
// eave that looks out over the street and a downpipe from it down the wall.
// Drawn only, out of reach.

const TILE = stuff(Layer.rooftiles, 0xf0e2d6, 0x8a4330);
const GUTTER = stuff(Layer.metal, 0x9ca09c, 0x6e726e);
const RAFTER = stuff(Layer.boards, 0x8a6a50, 0x4a3828);
const BOARDS = stuff(Layer.planks, 0xc8b8a4, 0x6b5a44);

/** A half-round tile's radius and length along its run, and how far apart they lie. */
const COPPO_R = 0.11;
const COPPO_L = 0.42;
const COPPO_GAP = 0.24;
const GUTTER_R = 0.075;
const PIPE_R = 0.05;
/** How far off its wall a downpipe stands, and how far apart its brackets are. */
const PIPE_OFF = 0.17;
const BRACKET = 1.6;

/**
 * A half-round tile: a half tube along local y from 0 to `length`, bulging
 * toward local z, its radius `r0` at one end and `r1` at the other.
 */
function halfTube(r0: number, r1: number, length: number, segments = 6): THREE.BufferGeometry {
  return new THREE.CylinderGeometry(r1, r0, length, segments, 1, true, -Math.PI / 2, Math.PI).translate(0, length / 2, 0);
}

/** A matrix taking local y along `axis` and local z toward `bulge` (made square to it), its origin at `at`. */
function frame(at: THREE.Vector3, axis: THREE.Vector3, bulge: THREE.Vector3): THREE.Matrix4 {
  const y = axis.clone().normalize();
  const z = bulge.clone().addScaledVector(y, -bulge.dot(y)).normalize();
  const x = new THREE.Vector3().crossVectors(y, z);
  return new THREE.Matrix4().makeBasis(x, y, z).setPosition(at);
}

/** A round pipe from a to b. */
function pipe(shapes: Shapes, a: THREE.Vector3, b: THREE.Vector3, r: number, s: Stuff): void {
  const len = a.distanceTo(b);
  if (len < 1e-3) return;
  const g = new THREE.CylinderGeometry(r, r, len, 8, 1, true).translate(0, len / 2, 0);
  shapes.add(g, frame(a, b.clone().sub(a), Math.abs(b.y - a.y) > 0.9 * len ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0)), s);
}

/** Every pitched roof's tiles, rafters, gutters and downpipes, into `boxes` and `shapes`. */
export function roofs(world: World, boxes: Boxes, shapes: Shapes): void {
  /** Inside a building's walls, rooms and roof space being open air to collide with. */
  const within = (p: THREE.Vector3) => world.buildings.some((b) => b.parts.some((r) => p.x > r.minX && p.x < r.maxX && p.z > r.minZ && p.z < r.maxZ) && p.y > b.floor - 0.5 && p.y < b.roof + 6);
  const open = (p: THREE.Vector3) => p.y > world.terrainHeight(p.x, p.z) + 0.05 && world.clearAsBuilt(p.x, p.y - 0.05, p.z, 0.1, 0.02) && !within(p);
  for (const g of world.gables) {
    const alongX = g.ridge === 'x';
    /** World point at u along the ridge, v across it and y up. */
    const at = (u: number, v: number, y: number) => (alongX ? new THREE.Vector3(u, y, v) : new THREE.Vector3(v, y, u));
    /** A world direction from its parts along, across and up. */
    const dir = (du: number, dv: number, dy: number) => (alongX ? new THREE.Vector3(du, dy, dv) : new THREE.Vector3(dv, dy, du));
    const [u0, u1] = alongX ? [g.rect.minX, g.rect.maxX] : [g.rect.minZ, g.rect.maxZ];
    const [v0, v1] = alongX ? [g.rect.minZ, g.rect.maxZ] : [g.rect.minX, g.rect.maxX];
    const vm = (v0 + v1) / 2;
    const half = vm - v0;
    const top = g.y + g.rise;
    const drop = (OVERHANG * g.rise) / half;
    // Out past each gable, unless it stands against another building.
    const free = (u: number, out: number) => open(at(u + out * 0.45, vm, g.y + 0.3)) && open(at(u + out * 0.45, vm, g.y + g.rise * 0.7));
    const [free0, free1] = [free(u0, -1), free(u1, 1)];
    const [a0, a1] = [free0 ? u0 - OVERHANG : u0 + 0.02, free1 ? u1 + OVERHANG : u1 - 0.02];
    const angle = Math.atan2(g.rise, half);
    const up = dir(0, 0, 1);

    // The ridge: tiles one over the next along it.
    const n = Math.max(1, Math.round((a1 - a0) / (COPPO_L - 0.05)));
    const step = (a1 - a0) / n;
    for (let k = 0; k < n; k++) {
      const m = frame(at(a0 + k * step, vm, top - 0.04), dir(1, 0, 0), up);
      shapes.add(halfTube(COPPO_R * 1.25, COPPO_R * 1.1, Math.min(step + 0.04, a1 - a0 - k * step), 6), m, TILE);
    }

    for (const side of [-1, 1] as const) {
      const ve = side < 0 ? v0 - OVERHANG : v1 + OVERHANG;
      const eave = g.y - drop;
      const wall = side < 0 ? v0 : v1;
      // Down the slope, and out of it.
      const down = dir(0, side * Math.cos(angle), -Math.sin(angle));
      const normal = dir(0, side * Math.sin(angle), Math.cos(angle));
      // Only an eave that looks out over open air.
      const beyond = at((u0 + u1) / 2, ve + side * 0.4, eave - 0.6);
      if (!open(beyond)) continue;

      // Along it as far as no other building stands in its way.
      let [e0, e1] = [a0, a1];
      const clear = (u: number) => !within(at(u, ve, eave - 0.1)) && !within(at(u, (ve + wall) / 2, eave));
      while (e0 < e1 && !clear(e0)) e0 += 0.05;
      while (e1 > e0 && !clear(e1)) e1 -= 0.05;
      if (e1 - e0 < 1) continue;
      // The tiles' ends along the eave, each a half-round tile lying down the slope.
      for (let u = e0 + COPPO_GAP / 2; u < e1 - COPPO_GAP / 4; u += COPPO_GAP) {
        const foot = at(u, ve, eave).addScaledVector(normal, 0.02);
        shapes.add(halfTube(COPPO_R * 0.95, COPPO_R * 0.85, COPPO_L, 4), frame(foot, down.clone().negate(), normal), TILE);
      }
      // Rafters under the overhang, from the wall out to the eave, and boards over them.
      for (let u = u0 + 0.3; u < u1 - 0.1; u += 0.6) {
        const mid = at(u, (wall + ve) / 2, (g.y + eave) / 2 - 0.07);
        const len = OVERHANG / Math.cos(angle) + 0.02;
        const q = new THREE.Quaternion().setFromRotationMatrix(frame(new THREE.Vector3(), down, normal));
        boxes.turned(mid, new THREE.Vector3(0.07, len, 0.1), q, RAFTER);
      }
      {
        const q = new THREE.Quaternion().setFromRotationMatrix(frame(new THREE.Vector3(), down, normal));
        // Local x along the ridge, y down the slope, z out of it.
        boxes.turned(at((e0 + e1) / 2, (wall + ve) / 2, (g.y + eave) / 2 - 0.015), new THREE.Vector3(e1 - e0 - 0.02, OVERHANG / Math.cos(angle), 0.02), q, BOARDS);
      }

      // The gutter, hung just under the tiles' ends.
      const gy = eave - 0.05;
      const gv = ve + side * 0.04;
      const gm = frame(at(e0, gv, gy), dir(1, 0, 0), dir(0, 0, -1));
      shapes.add(halfTube(GUTTER_R, GUTTER_R, e1 - e0, 8), gm, GUTTER);
      for (let u = e0 + 0.4; u < e1; u += 0.9) boxes.box(...corners(at(u - 0.015, ve - side * 0.02, gy - GUTTER_R - 0.01), at(u + 0.015, gv + side * GUTTER_R, gy - GUTTER_R + 0.015)), GUTTER);

      // A downpipe from one end, or both on a long roof, down the wall to the ground or the roof below.
      const ends = a1 - a0 > 9 ? [u0 + 0.4, u1 - 0.4] : [(g.y * 13.7 + u0) % 2 < 1 ? u0 + 0.4 : u1 - 0.4];
      for (const u of ends) {
        const pv = wall + side * PIPE_OFF;
        // The way down: as far as it stays out in the open.
        let bottom = gy - 0.5;
        for (let y = gy - 0.6; y > gy - 30; y -= 0.25) {
          // Its brackets too, back to the wall.
          if (!open(at(u, pv, y)) || !open(at(u, wall + side * 0.06, y))) break;
          bottom = y;
        }
        const ground = Math.max(world.groundHeight(...xz(at(u, pv, 0)), bottom + 0.1, 0.02), bottom - 0.25);
        if (gy - ground < 1.2) continue;
        // From the gutter's foot back to the wall, then straight down, its shoe turned out at the foot.
        const neck = at(u, pv, gy - 0.45);
        pipe(shapes, at(u, gv, gy - GUTTER_R), neck, PIPE_R * 0.9, GUTTER);
        pipe(shapes, neck, at(u, pv, ground + 0.2), PIPE_R, GUTTER);
        pipe(shapes, at(u, pv, ground + 0.22), at(u, pv + side * 0.18, ground + 0.06), PIPE_R, GUTTER);
        for (let y = gy - 0.9; y > ground + 0.5; y -= BRACKET) {
          boxes.box(...corners(at(u - 0.07, pv - PIPE_R - 0.01, y), at(u + 0.07, pv + PIPE_R + 0.01, y + 0.05)), GUTTER);
          boxes.box(...corners(at(u - 0.015, wall, y), at(u + 0.015, pv, y + 0.05)), GUTTER);
        }
      }
    }

    // Up each verge, half-round tiles along the slopes' edges.
    for (const u of [...(free0 ? [a0] : []), ...(free1 ? [a1] : [])]) {
      for (const side of [-1, 1] as const) {
        const ve = side < 0 ? v0 - OVERHANG : v1 + OVERHANG;
        const from = at(u, ve, g.y - drop);
        const to = at(u, vm, top);
        if (within(from) || within(from.clone().lerp(to, 0.25))) continue;
        const normal = dir(0, side * Math.sin(angle), Math.cos(angle));
        const len = from.distanceTo(to);
        shapes.add(halfTube(COPPO_R * 0.9, COPPO_R * 0.9, len, 5), frame(from.addScaledVector(normal, 0.01), to.clone().sub(from), normal), TILE);
      }
    }
  }
}

/** The two corners of a box given by any two opposite ones, as Boxes.box takes them. */
function corners(p: THREE.Vector3, q: THREE.Vector3): [number, number, number, number, number, number] {
  return [Math.min(p.x, q.x), Math.min(p.y, q.y), Math.min(p.z, q.z), Math.max(p.x, q.x), Math.max(p.y, q.y), Math.max(p.z, q.z)];
}

function xz(p: THREE.Vector3): [number, number] {
  return [p.x, p.z];
}
