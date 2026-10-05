import * as THREE from 'three';
import { placeBlocks, sideOf, type KitOpening, type KitWall, type Placed } from '../shared/kit.ts';
import type { MapSign } from '../shared/maps/index.ts';
import { mulberry32 } from '../shared/rng.ts';
import type { World } from '../shared/world.ts';
import { Face } from './dressing.ts';
import { dimIndoors } from './indoorlight.ts';
import { Boxes, IRON, painted, plain } from './townparts.ts';

// What's written on a map town's buildings (MapBuilding.signs): painted
// boards over the shops' doors, the names of the warehouse, the boat yard and
// the fish market in faded letters on their plaster, the hotel's sign
// standing out over the street, and the tobacconist's and chemist's signs.
// The letters are drawn into one picture as the town is built, each sign a
// patch of it on a quad of its own; the boards' frames and brackets are boxes.

/** Pixels a metre of letters' height is drawn at. */
const PX = 200;
const ATLAS = 2048;
/** Boards' paint, and their letters'. */
const BOARDS = [['#23463a', '#e8d9a8'], ['#5a2026', '#ead7a0'], ['#1f3550', '#f0e4c0'], ['#e8e0cc', '#2a2a2a'], ['#2e2e2e', '#d8b860']] as const;

/** A patch of the picture: where, and how big, in pixels. */
interface Patch {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Patches handed out along rows of the picture, each row as tall as its tallest. */
class Shelf {
  private x = 0;
  private y = 0;
  private row = 0;

  take(w: number, h: number): Patch | null {
    w = Math.min(Math.ceil(w), ATLAS);
    h = Math.ceil(h);
    if (this.x + w > ATLAS) {
      this.x = 0;
      this.y += this.row + 2;
      this.row = 0;
    }
    if (this.y + h > ATLAS) return null;
    const p = { x: this.x, y: this.y, w, h };
    this.x += w + 2;
    this.row = Math.max(this.row, h);
    return p;
  }
}

/** A sign's quad: its corners in the world and its patch of the picture. */
interface Quad {
  corners: [THREE.Vector3, THREE.Vector3, THREE.Vector3, THREE.Vector3];
  patch: Patch;
}

/** The wall each of a map's signs is on, by building and sign, or null where none is found. */
export function signWalls(world: World): (KitWall | null)[] {
  const placed = placeBlocks(world.map!.buildings);
  return world.map!.buildings.flatMap((b) => (b.signs ?? []).map((sign) => {
    const p = placed.find((q) => q.building === b);
    return p ? wallOf(world, p, sign) : null;
  }));
}

/** The storey of wall a sign on the block `p` is on. */
function wallOf(world: World, p: Placed, sign: MapSign): KitWall | null {
  const { axis, line, lo, hi } = sideOf(p.block, sign.side);
  const y = p.floor + p.height * (sign.storey ?? 0);
  const a = lo + (sign.at ?? (hi - lo) / 2);
  return world.facades.find((f) => f.axis === axis && Math.abs(f.line - line) < 1e-6 && a > f.a0 && a < f.a1 && Math.abs(f.y - y) < 0.05) ?? null;
}

/** The signs of a map's town: the quads with their letters, as one mesh, and their frames into `boxes`. */
export function signs(world: World, boxes: Boxes): THREE.Mesh | null {
  const map = world.map;
  if (!map || typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = ATLAS;
  const g = canvas.getContext('2d')!;
  const shelf = new Shelf();
  const quads: Quad[] = [];
  const placed = placeBlocks(map.buildings);
  const rand = mulberry32(map.seed + 211);
  for (const b of map.buildings) {
    const p = placed.find((q) => q.building === b);
    if (!p) continue;
    for (const sign of b.signs ?? []) {
      const { axis, out, lo, hi } = sideOf(p.block, sign.side);
      const storey = sign.storey ?? 0;
      const y = p.floor + p.height * storey;
      const a = lo + (sign.at ?? (hi - lo) / 2);
      const w = wallOf(world, p, sign);
      if (!w) continue;
      const face = new Face(w, out, boxes);
      const quad = (a0: number, a1: number, o: number, y0: number, y1: number, patch: Patch) => {
        const at = (aa: number, yy: number) => {
          const [x, z] = face.at(aa, o);
          return new THREE.Vector3(x, yy, z);
        };
        // Read left to right from outside: along the wall the way that keeps the face's frame a turn.
        const [l, r] = (axis === 'x') === (out > 0) ? [a0, a1] : [a1, a0];
        quads.push({ corners: [at(l, y0), at(r, y0), at(r, y1), at(l, y1)], patch });
      };
      // The openings under it, and the space left over them to the storey's top.
      const under = w.openings.filter((o) => Math.abs(o.at - a) < o.width / 2 + 2);
      const head = Math.max(0, ...under.map((o) => headOf(o)));
      // Up to the string course or the cornice.
      const room = w.height - 0.16 - head;
      switch (sign.kind) {
        case 'board':
        case 'painted': {
          const boardy = sign.kind === 'board';
          const h = Math.min(boardy ? 0.42 : 0.55, room - (boardy ? 0.1 : 0.04));
          if (h < 0.25 || !sign.text) continue;
          const font = boardy ? `bold ${Math.round(h * PX * 0.62)}px Georgia, 'Times New Roman', serif` : `bold ${Math.round(h * PX * 0.8)}px 'Arial Narrow', 'Helvetica Neue', Arial, sans-serif`;
          g.font = font;
          const pad = boardy ? h * 0.6 : h * 0.15;
          const width = Math.min(g.measureText(sign.text).width / PX + pad * 2, w.a1 - w.a0 - 0.6);
          const a0 = Math.max(w.a0 + 0.3, a - width / 2);
          const a1 = Math.min(w.a1 - 0.3, a0 + width);
          const y0 = y + head + (room - h) / 2;
          const patch = shelf.take((a1 - a0) * PX, h * PX);
          if (!patch) continue;
          const [paint, ink] = BOARDS[Math.floor(rand() * BOARDS.length)];
          lettering(g, patch, sign.text, font, boardy ? paint : null, boardy ? ink : '#4a3a2e', rand);
          if (boardy) {
            // A moulded frame round the board, standing out from the wall.
            const frame = painted(parseInt(paint.slice(1), 16));
            face.box(a0 - 0.05, a1 + 0.05, 0, 0.05, y0 - 0.05, y0 + h + 0.05, frame);
            face.box(a0 - 0.08, a1 + 0.08, 0, 0.07, y0 + h + 0.03, y0 + h + 0.08, frame);
            quad(a0, a1, 0.052, y0, y0 + h, patch);
          } else quad(a0, a1, 0.004, y0, y0 + h, patch);
          break;
        }
        case 'blade':
        case 'tabacchi':
        case 'farmacia': {
          // Standing out square to the wall on a bracket, read from along the street both ways.
          const blade = sign.kind === 'blade';
          const [bw, bh] = blade ? [0.5, Math.min(0.32 * (sign.text?.length ?? 4) + 0.2, w.height - 0.6)] : [0.55, 0.55];
          const y0 = y + (blade ? w.height - 0.35 - bh : 2.45);
          const patch = shelf.take(bw * PX, bh * PX);
          if (!patch) continue;
          symbol(g, patch, sign);
          const [o0, o1] = [0.3, 0.3 + bw];
          for (const yy of [y0 + bh * 0.85, y0 + bh * 0.15]) face.box(a - 0.015, a + 0.015, 0, o0 + 0.05, yy - 0.015, yy + 0.015, IRON);
          face.box(a - 0.04, a + 0.04, 0, 0.02, y0 + 0.05, y0 + bh - 0.05, IRON);
          // Both faces, a few millimetres apart, each turned to be read from its side.
          for (const s of [-1, 1]) {
            const [x0, z0] = face.at(a + s * 0.012, o0);
            const [x1, z1] = face.at(a + s * 0.012, o1);
            const p0 = new THREE.Vector3(x0, 0, z0);
            const p1 = new THREE.Vector3(x1, 0, z1);
            const flip = (axis === 'x') === (out > 0) ? s > 0 : s < 0;
            const [l, r] = flip ? [p1, p0] : [p0, p1];
            quads.push({ corners: [l.clone().setY(y0), r.clone().setY(y0), r.clone().setY(y0 + bh), l.clone().setY(y0 + bh)], patch });
          }
          face.box(a - 0.01, a + 0.01, o0 - 0.02, o1 + 0.02, y0 - 0.02, y0 + bh + 0.02, plain(0x2a2a2a));
          break;
        }
      }
    }
  }
  if (!quads.length) return null;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  const pos: number[] = [];
  const uv: number[] = [];
  for (const { corners: c, patch: p } of quads) {
    const [u0, u1] = [p.x / ATLAS, (p.x + p.w) / ATLAS];
    const [v0, v1] = [1 - (p.y + p.h) / ATLAS, 1 - p.y / ATLAS];
    const uvs = [[u0, v0], [u1, v0], [u1, v1], [u0, v1]];
    for (const k of [0, 1, 2, 0, 2, 3]) {
      pos.push(c[k].x, c[k].y, c[k].z);
      uv.push(...uvs[k]);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geometry.computeVertexNormals();
  const material = new THREE.MeshStandardMaterial({ map: texture, roughness: 0.85, alphaTest: 0.5, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
  dimIndoors(material);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.receiveShadow = true;
  return mesh;
}

/** How high an opening reaches over its floor, its surround and moulding over it. */
function headOf(o: KitOpening): number {
  return (o.kind === 'window' ? 2 : o.kind === 'door' ? 2.2 : (o.height ?? 2.6)) + 0.27;
}

/**
 * `text` into `patch`: on a board of `paint` with a line round it, or
 * painted straight on the wall, worn, where the paint (`null`) is none.
 */
function lettering(g: CanvasRenderingContext2D, p: Patch, text: string, font: string, paint: string | null, ink: string, rand: () => number): void {
  g.save();
  g.beginPath();
  g.rect(p.x, p.y, p.w, p.h);
  g.clip();
  if (paint) {
    g.fillStyle = paint;
    g.fillRect(p.x, p.y, p.w, p.h);
    g.strokeStyle = ink;
    g.lineWidth = Math.max(2, p.h * 0.04);
    g.strokeRect(p.x + p.h * 0.1, p.y + p.h * 0.1, p.w - p.h * 0.2, p.h - p.h * 0.2);
  }
  g.font = font;
  g.fillStyle = ink;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const width = g.measureText(text).width;
  const room = p.w - (paint ? p.h * 0.8 : p.h * 0.1);
  g.translate(p.x + p.w / 2, p.y + p.h * 0.54);
  // Squeezed to fit, if it must be.
  if (width > room) g.scale(room / width, 1);
  g.fillText(text, 0, 0);
  g.setTransform(1, 0, 0, 1, 0, 0);
  // Worn: flecks of paint gone, more on the wall than on a board.
  g.globalCompositeOperation = paint ? 'source-atop' : 'destination-out';
  g.fillStyle = paint ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,1)';
  const flecks = Math.round((p.w * p.h) / (paint ? 900 : 120));
  for (let k = 0; k < flecks; k++) {
    const r = 1 + rand() * (paint ? 3 : 5);
    g.fillRect(p.x + rand() * p.w, p.y + rand() * p.h, r, r * (0.5 + rand()));
  }
  g.restore();
}

/** A sign standing out from the wall: the hotel's name down a blade, the tobacconist's T, the chemist's cross. */
function symbol(g: CanvasRenderingContext2D, p: Patch, sign: MapSign): void {
  g.save();
  const [cx, cy] = [p.x + p.w / 2, p.y + p.h / 2];
  if (sign.kind === 'blade') {
    g.fillStyle = '#1f3550';
    g.fillRect(p.x, p.y, p.w, p.h);
    g.strokeStyle = '#e8c860';
    g.lineWidth = 4;
    g.strokeRect(p.x + 6, p.y + 6, p.w - 12, p.h - 12);
    const text = sign.text ?? '';
    const step = (p.h - 24) / Math.max(text.length, 1);
    g.font = `bold ${Math.round(Math.min(step * 0.8, p.w * 0.7))}px Georgia, serif`;
    g.fillStyle = '#f0e4c0';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    [...text].forEach((c, i) => g.fillText(c, cx, p.y + 12 + step * (i + 0.5)));
  } else if (sign.kind === 'tabacchi') {
    g.fillStyle = '#1e2a4a';
    g.fillRect(p.x, p.y, p.w, p.h);
    g.fillStyle = '#f2f0e8';
    g.font = `bold ${Math.round(p.h * 0.8)}px Georgia, serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('T', cx, cy + p.h * 0.04);
  } else {
    g.fillStyle = '#f2f0e8';
    g.fillRect(p.x, p.y, p.w, p.h);
    g.fillStyle = '#2a9a4a';
    const [l, t] = [p.w * 0.22, p.w * 0.6];
    g.fillRect(cx - l / 2, cy - t / 2, l, t);
    g.fillRect(cx - t / 2, cy - l / 2, t, l);
  }
  g.restore();
}
