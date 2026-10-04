import type { World } from '../shared/world.ts';

// A picture of where a map's fights happen, for tuning it: the map from
// above in greys (the higher, the lighter), where people died as a glow from
// orange to red, where each killer stood as a dot (blue on the ground,
// magenta upstairs, cyan on a roof), and each kill from LONG metres or more
// as a yellow line from killer to victim. Written as a PNG by the Deathmatch
// simulation (dmsim.ts).

export type Where = 'ground' | 'upstairs' | 'roofs';

/** A kill: where the killer stood and on what, and where the victim fell. */
export interface KillAt {
  kx: number;
  ky: number;
  kz: number;
  vx: number;
  vz: number;
  where: Where;
}

/** Pixels to a metre, the margin drawn round the bounds, and how far a death's glow spreads. */
const SCALE = 4;
const MARGIN = 4;
const SPREAD = 2.5;
/** Kills from this far or more are drawn as lines. */
export const LONG = 40;

const DOT: Record<Where, [number, number, number]> = { ground: [60, 110, 255], upstairs: [235, 60, 235], roofs: [40, 230, 230] };

/** The picture of `kills` on `world`'s map, as a PNG's bytes. */
export async function heatPicture(world: World, kills: readonly KillAt[]): Promise<Uint8Array> {
  const b = world.bounds;
  const x0 = b.minX - MARGIN;
  const z0 = b.minZ - MARGIN;
  const W = Math.ceil((b.maxX - b.minX + 2 * MARGIN) * SCALE);
  const H = Math.ceil((b.maxZ - b.minZ + 2 * MARGIN) * SCALE);
  const rgb = new Float32Array(W * H * 3);
  const set = (i: number, c: readonly number[], a = 1) => {
    for (let k = 0; k < 3; k++) rgb[i * 3 + k] += (c[k] - rgb[i * 3 + k]) * a;
  };
  const rect = (minX: number, minZ: number, maxX: number, maxZ: number, c: readonly number[]) => {
    const i0 = Math.max(0, Math.floor((minX - x0) * SCALE));
    const i1 = Math.min(W, Math.ceil((maxX - x0) * SCALE));
    const j0 = Math.max(0, Math.floor((minZ - z0) * SCALE));
    const j1 = Math.min(H, Math.ceil((maxZ - z0) * SCALE));
    for (let j = j0; j < j1; j++) for (let i = i0; i < i1; i++) set(j * W + i, c);
  };

  // The ground and everything built on it, lowest first, as greys.
  let top = 1;
  for (const p of world.props) if (world.inBounds((p.box.minX + p.box.maxX) / 2, (p.box.minZ + p.box.maxZ) / 2, -2)) top = Math.max(top, p.box.maxY);
  const grey = (y: number, light = 0) => {
    const v = 40 + 150 * Math.min(1, Math.max(0, y / top)) + light;
    return [v, v, v + 6];
  };
  for (let j = 0; j < H; j++) {
    for (let i = 0; i < W; i++) {
      const h = world.terrainHeight(x0 + (i + 0.5) / SCALE, z0 + (j + 0.5) / SCALE);
      set(j * W + i, h < 0 ? [36, 67, 92] : grey(h, -15));
    }
  }
  const props = world.props.filter((p) => p.box.maxX > x0 && p.box.minX < x0 + W / SCALE && p.box.maxZ > z0 && p.box.minZ < z0 + H / SCALE);
  props.sort((p, q) => p.box.maxY - q.box.maxY);
  for (const { box } of props) {
    rect(box.minX, box.minZ, box.maxX, box.maxZ, box.part === 'glass' ? [127, 182, 214] : grey(box.maxY, box.part === 'wall' ? -14 : 0));
  }

  // Where people died, as a glow.
  const heat = new Float32Array(W * H);
  const r = Math.ceil(SPREAD * 2.5 * SCALE);
  for (const k of kills) {
    const ci = (k.vx - x0) * SCALE;
    const cj = (k.vz - z0) * SCALE;
    for (let j = Math.max(0, Math.floor(cj - r)); j < Math.min(H, cj + r); j++) {
      for (let i = Math.max(0, Math.floor(ci - r)); i < Math.min(W, ci + r); i++) {
        const d2 = ((i - ci) ** 2 + (j - cj) ** 2) / (SPREAD * SCALE) ** 2;
        heat[j * W + i] += Math.exp(-d2 / 2);
      }
    }
  }
  let most = 0;
  for (const h of heat) most = Math.max(most, h);
  for (let i = 0; i < W * H; i++) {
    const t = heat[i] / (most || 1);
    if (t < 0.03) continue;
    set(i, [255, 220 * (1 - t), 40 * (1 - t)], Math.min(0.85, 0.25 + t));
  }

  // Long kills as lines, then where each killer stood.
  for (const k of kills) {
    const d = Math.hypot(k.vx - k.kx, k.vz - k.kz);
    if (d < LONG) continue;
    const n = Math.ceil(d * SCALE);
    for (let s = 0; s <= n; s++) {
      const i = Math.round((k.kx + ((k.vx - k.kx) * s) / n - x0) * SCALE);
      const j = Math.round((k.kz + ((k.vz - k.kz) * s) / n - z0) * SCALE);
      if (i >= 0 && i < W && j >= 0 && j < H) set(j * W + i, [255, 240, 60], 0.5);
    }
  }
  for (const k of kills) rect(k.kx - 0.4, k.kz - 0.4, k.kx + 0.4, k.kz + 0.4, DOT[k.where]);

  const pixels = new Uint8Array(W * H * 3);
  for (let i = 0; i < pixels.length; i++) pixels[i] = Math.max(0, Math.min(255, Math.round(rgb[i])));
  return png(W, H, pixels);
}

/** An RGB picture as a PNG file's bytes. */
async function png(w: number, h: number, rgb: Uint8Array): Promise<Uint8Array> {
  const zlib = (await import('node:zlib' as string)) as { deflateSync(data: Uint8Array): Uint8Array };
  const raw = new Uint8Array((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) raw.set(rgb.subarray(y * w * 3, (y + 1) * w * 3), y * (w * 3 + 1) + 1);
  const header = new Uint8Array(13);
  const hv = new DataView(header.buffer);
  hv.setUint32(0, w);
  hv.setUint32(4, h);
  header.set([8, 2, 0, 0, 0], 8);
  const chunks = [chunk('IHDR', header), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', new Uint8Array(0))];
  const out = new Uint8Array(8 + chunks.reduce((n, c) => n + c.length, 0));
  out.set([137, 80, 78, 71, 13, 10, 26, 10]);
  let at = 8;
  for (const c of chunks) (out.set(c, at)), (at += c.length);
  return out;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const v = new DataView(out.buffer);
  v.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  v.setUint32(8 + data.length, crc(out.subarray(4, 8 + data.length)));
  return out;
}

const CRC = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});

function crc(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
