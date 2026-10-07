import * as THREE from 'three';
import type { Box, World } from '../shared/world.ts';
import { BAKE_CELL, bake, bakeInput, SKY_RANGE, SUN_RANGE, type BakeInput, type Baked } from './townbake.ts';

// The light baked over a map's town (see townbake.ts), as one 3D texture
// that materials read in place of the light inside buildings' grids: four
// volumes stacked along z, the sky's share and the sun's bounced on each face
// of an ambient cube, and the colour of that bounced light; one texture, as
// materials are short of texture units. It's baked in a worker as the town is built,
// a few seconds' work, and fades in once done; till then the town is lit as
// if out in the open.

/** How much the sun's light bounced once is worth, standing in for the light bounced again. */
const SUN_GAIN = 4;
/**
 * The sky's share is shown as its power SKY_CURVE, over a floor of
 * SKY_FLOOR: a room seeing 1% of the sky through its windows is lit at
 * about 10%, as light bounced about it many times and the eye's getting used
 * to the dark would have it, and the open street is hardly changed.
 */
const SKY_CURVE = 0.45;
const SKY_FLOOR = 0.12;
/** Seconds the baked light takes to fade in. */
const FADE = 1;

/** The uniforms every material lit by the town's light shares, in with indoorUniforms. */
export const townUniforms = {
  townGrid: { value: blank() },
  /** The volume's corner, one over its size, metres, and its cells each way. */
  townCorner: { value: new THREE.Vector3() },
  townScale: { value: new THREE.Vector3() },
  townCount: { value: new THREE.Vector3(1, 1, 1) },
  /** How far the baked light has faded in, 0 for none, as on an island. */
  townMix: { value: 0 },
};

/**
 * GLSL: `townSky(p, n, sky, sun)` is whether world point `p` on a surface
 * facing `n` is in the town's volume, setting `sky` to the share of the
 * sky's light on it and `sun` to the sun's light bounced there, as a share
 * of the sun's, in red, green and blue. It reads a little off the surface,
 * so a wall's face reads the side it faces.
 */
export const TOWN_GLSL = /* glsl */ `
  uniform highp sampler3D townGrid;
  uniform vec3 townCorner;
  uniform vec3 townScale;
  uniform vec3 townCount;
  uniform float townMix;
  vec4 townPart(vec3 uvw, float part) {
    float z = clamp(uvw.z * townCount.z, 0.5, townCount.z - 0.5);
    return texture(townGrid, vec3(uvw.xy, (part * townCount.z + z) / (4.0 * townCount.z)));
  }
  bool townSky(vec3 p, vec3 n, out vec3 sky, out vec3 sun) {
    sky = vec3(1.0);
    sun = vec3(0.0);
    vec3 uvw = (p + n * 0.15 - townCorner) * townScale;
    if (townMix <= 0.0 || any(lessThan(uvw, vec3(0.0))) || any(greaterThan(uvw, vec3(1.0)))) return false;
    vec4 sides = townPart(uvw, 0.0);
    vec4 upDown = townPart(uvw, 1.0);
    vec4 sunSides = townPart(uvw, 2.0);
    vec3 tint = townPart(uvw, 3.0).rgb;
    sides *= sides;
    upDown *= upDown;
    sunSides *= sunSides;
    vec3 n2 = n * n;
    float share = n2.x * (n.x > 0.0 ? sides.r : sides.g) + n2.z * (n.z > 0.0 ? sides.b : sides.a) + n2.y * (n.y > 0.0 ? upDown.r : upDown.g);
    float bounced = n2.x * (n.x > 0.0 ? sunSides.r : sunSides.g) + n2.z * (n.z > 0.0 ? sunSides.b : sunSides.a) + n2.y * (n.y > 0.0 ? upDown.b : upDown.a);
    tint /= max(dot(tint, vec3(0.2126, 0.7152, 0.0722)), 0.05);
    share = ${SKY_FLOOR.toFixed(2)} + ${(1 - SKY_FLOOR).toFixed(2)} * pow(share * ${SKY_RANGE.toFixed(2)}, ${SKY_CURVE.toFixed(2)});
    sky = vec3(mix(1.0, share, townMix));
    sun = tint * (bounced * ${(SUN_RANGE * SUN_GAIN).toFixed(2)} * townMix);
    return true;
  }
`;

/** A map town's baked light, once a worker has baked it. */
export class TownLight {
  private readonly input: BakeInput;
  /** The four volumes, one after another, as the texture holds them, once baked. */
  private data: Uint8Array | null = null;
  private worker: Worker | null = null;
  private starting = false;
  private fadeFrom = -1;
  private disposed = false;

  /** Baked over `world`'s map, its boxes coloured by `colourOf` (sRGB), lit by a sun toward `sun`; null for an island. */
  static build(world: World, colourOf: (box: Box) => number, sun: THREE.Vector3): TownLight | null {
    const input = bakeInput(world, colourOf, [sun.x, sun.y, sun.z]);
    return input ? new TownLight(input) : null;
  }

  private constructor(input: BakeInput) {
    this.input = input;
    const { x0, y0, z0, nx, ny, nz } = input;
    townUniforms.townCorner.value.set(x0, y0, z0);
    townUniforms.townScale.value.set(1 / (nx * BAKE_CELL), 1 / (ny * BAKE_CELL), 1 / (nz * BAKE_CELL));
    townUniforms.townCount.value.set(nx, ny, nz);
    townUniforms.townMix.value = 0;
  }

  /** Bake in a worker, the light fading in once it's done. */
  start(): void {
    if (this.worker || this.data || this.starting) return;
    this.starting = true;
    const key = cacheKey(this.input);
    void cached(key).then((hit) => {
      this.starting = false;
      if (this.disposed || this.worker || this.data) return;
      if (hit) this.show(hit, false);
      else this.bakeInWorker(key);
    });
  }

  private bakeInWorker(key: string): void {
    this.worker = new Worker(new URL('./townworker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (e: MessageEvent<Baked>) => {
      this.worker?.terminate();
      this.worker = null;
      if (this.disposed) return;
      this.show(e.data, false);
      keep(key, e.data);
    };
    this.worker.onerror = (e) => console.warn('The town\'s light failed to bake.', e.message);
    this.worker.postMessage(this.input);
  }

  /** Bake here and now, shown at once, as a still picture needs. */
  finish(): void {
    if (this.data) return;
    this.worker?.terminate();
    this.worker = null;
    this.show(bake(this.input), true);
  }

  /** Whether the light has been baked. */
  get ready(): boolean {
    return !!this.data;
  }

  /** Once a frame, `time` in seconds: fade the light in once baked. */
  update(time: number): void {
    if (!this.data || townUniforms.townMix.value >= 1) return;
    if (this.fadeFrom < 0) this.fadeFrom = time;
    townUniforms.townMix.value = Math.min(Math.max((time - this.fadeFrom) / FADE, 0), 1);
  }

  private show(baked: Baked, now: boolean): void {
    const { nx, ny, nz } = this.input;
    const u = townUniforms;
    const n = nx * ny * nz * 4;
    const data = new Uint8Array(n * 4);
    [baked.skySides, baked.skyUpDown, baked.sunSides, baked.tint].forEach((part, i) => data.set(part, i * n));
    this.data = data;
    u.townGrid.value = texture(data, nx, ny, nz * 4);
    if (now) u.townMix.value = 1;
  }

  /**
   * The sky's share at a point, averaged over the ways a surface there might
   * face, as grey; and the sun's light bounced there, as a share of the sun's.
   * Null outside the town, or before the light is baked.
   */
  at(x: number, y: number, z: number, sky: THREE.Color, sun: THREE.Color): boolean {
    const d = this.data;
    if (!d) return false;
    const { x0, y0, z0, nx, ny, nz } = this.input;
    // Where each volume starts.
    const n = nx * ny * nz * 4;
    const cx = (x - x0) / BAKE_CELL - 0.5;
    const cy = (y - y0) / BAKE_CELL - 0.5;
    const cz = (z - z0) / BAKE_CELL - 0.5;
    if (cx < -0.5 || cy < -0.5 || cz < -0.5 || cx > nx - 0.5 || cy > ny - 0.5 || cz > nz - 0.5) return false;
    const mix = townUniforms.townMix.value;
    const share = (cube: number[]) => cube.reduce((s, v) => s + (v / 255) ** 2, 0) / cube.length;
    const s = blend(cx, cy, cz, nx, ny, nz, (c) => share([d[c], d[c + 1], d[c + 2], d[c + 3], d[n + c], d[n + c + 1]]));
    const g = blend(cx, cy, cz, nx, ny, nz, (c) => share([d[2 * n + c], d[2 * n + c + 1], d[2 * n + c + 2], d[2 * n + c + 3], d[n + c + 2], d[n + c + 3]]));
    const v = 1 + (SKY_FLOOR + (1 - SKY_FLOOR) * (s * SKY_RANGE) ** SKY_CURVE - 1) * mix;
    sky.setRGB(v, v, v, THREE.LinearSRGBColorSpace);
    const k = g * SUN_RANGE * SUN_GAIN * mix;
    sun.setRGB(k, k, k, THREE.LinearSRGBColorSpace);
    return true;
  }

  dispose(): void {
    this.disposed = true;
    this.worker?.terminate();
    this.worker = null;
    const u = townUniforms;
    u.townGrid.value.dispose();
    u.townGrid.value = blank();
    u.townMix.value = 0;
  }
}

// The bake is kept in the browser between visits, under a key hashed from
// everything it's baked from and the bake's own code, so a changed map, sun
// or bake simply misses.
const CACHE_DB = 'town-light';
const CACHE_STORE = 'bakes';
/** Bakes kept; the oldest go first. */
const CACHE_KEEP = 3;

function cacheKey(input: BakeInput): string {
  let h = 0x811c9dc5;
  const mix = (bytes: Uint8Array) => {
    for (let i = 0; i < bytes.length; i++) h = Math.imul(h ^ bytes[i], 0x01000193);
  };
  const nums = (a: ArrayLike<number>) => mix(new Uint8Array(Float64Array.from(a).buffer));
  const { boxes, albedo, tilts, ground, horizon, lamps } = input;
  nums([input.x0, input.y0, input.z0, input.nx, input.ny, input.nz, ...input.groundAlbedo, ...input.sun]);
  for (const a of [boxes, albedo, tilts ?? [], ground, horizon, lamps ?? []]) {
    nums([a.length]);
    mix(new Uint8Array(Float32Array.from(a).buffer));
  }
  mix(new TextEncoder().encode(bake.toString() + BAKE_CELL + SKY_RANGE + SUN_RANGE));
  return (h >>> 0).toString(16);
}

function openCache(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      const r = indexedDB.open(CACHE_DB, 1);
      r.onupgradeneeded = () => r.result.createObjectStore(CACHE_STORE);
      r.onsuccess = () => resolve(r.result);
      r.onerror = r.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function cached(key: string): Promise<Baked | null> {
  const db = await openCache();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const r = db.transaction(CACHE_STORE).objectStore(CACHE_STORE).get(key);
      r.onsuccess = () => {
        const v = r.result as { baked?: Baked } | undefined;
        resolve(v?.baked ?? null);
        db.close();
      };
      r.onerror = () => {
        resolve(null);
        db.close();
      };
    } catch {
      resolve(null);
      db.close();
    }
  });
}

function keep(key: string, baked: Baked): void {
  void openCache().then((db) => {
    if (!db) return;
    try {
      const tx = db.transaction(CACHE_STORE, 'readwrite');
      const store = tx.objectStore(CACHE_STORE);
      store.put({ baked, at: Date.now() }, key);
      const all = store.openCursor();
      const seen: { key: IDBValidKey; at: number }[] = [];
      all.onsuccess = () => {
        const c = all.result;
        if (c) {
          seen.push({ key: c.key, at: (c.value as { at: number }).at });
          c.continue();
        } else {
          seen.sort((a, b) => b.at - a.at).slice(CACHE_KEEP).forEach((e) => store.delete(e.key));
        }
      };
      tx.oncomplete = tx.onerror = tx.onabort = () => db.close();
    } catch {
      db.close();
    }
  });
}

/** Trilinear blend of `value(cell * 4)` round fractional cell (cx, cy, cz). */
function blend(cx: number, cy: number, cz: number, nx: number, ny: number, nz: number, value: (c: number) => number): number {
  const ix = Math.min(Math.max(Math.floor(cx), 0), nx - 2);
  const iy = Math.min(Math.max(Math.floor(cy), 0), ny - 2);
  const iz = Math.min(Math.max(Math.floor(cz), 0), nz - 2);
  const fx = Math.min(Math.max(cx - ix, 0), 1);
  const fy = Math.min(Math.max(cy - iy, 0), 1);
  const fz = Math.min(Math.max(cz - iz, 0), 1);
  let sum = 0;
  for (let k = 0; k < 8; k++) {
    const ox = k & 1;
    const oy = (k >> 1) & 1;
    const oz = k >> 2;
    const w = (ox ? fx : 1 - fx) * (oy ? fy : 1 - fy) * (oz ? fz : 1 - fz);
    sum += w * value((((iz + oz) * ny + iy + oy) * nx + ix + ox) * 4);
  }
  return sum;
}

function texture(data: Uint8Array, nx: number, ny: number, nz: number): THREE.Data3DTexture {
  const t = new THREE.Data3DTexture(data, nx, ny, nz);
  t.format = THREE.RGBAFormat;
  t.type = THREE.UnsignedByteType;
  t.minFilter = t.magFilter = THREE.LinearFilter;
  t.unpackAlignment = 1;
  t.needsUpdate = true;
  return t;
}

/** A texture standing in until the light's baked. */
function blank(): THREE.Data3DTexture {
  const t = new THREE.Data3DTexture(new Uint8Array([255, 255, 255, 255]), 1, 1, 1);
  t.format = THREE.RGBAFormat;
  t.needsUpdate = true;
  return t;
}
