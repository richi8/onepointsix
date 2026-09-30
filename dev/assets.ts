import * as THREE from 'three';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { KTX2Loader, type KTX2LoaderWorkerConfig } from 'three/addons/loaders/KTX2Loader.js';
import { transcoder } from '../src/client/assets.ts';
import { LAYERS } from '../src/shared/layers.ts';

// The packed assets measured against the originals they were made from, run
// by the browser tests (e2e/assets.e2e.ts) or by hand at /dev/assets.html on
// the dev server, with the originals committed in scripts/originals.
//
// - Textures: every layer of the KTX2 arrays, decoded as the GPU sees it (in
//   the format the transcoder picks here, and in each other format it could
//   pick), against the 1k JPEGs scaled to the same size. Colours as PSNR in
//   8-bit sRGB, normals as the angle between them.
// - The sky: spheres lit only by the prefiltered sky, from shiny metal to
//   rough white, drawn with the game's sky (half size, drawn into a 256 px
//   cube, prefiltered) against the full-size original prefiltered directly,
//   and with the half-size sky prefiltered directly, for how far off that
//   was. Then the rough white sphere, where it faces each of six ways,
//   against the light the original's pixels actually cast on it.
//
// `?textures=<dir>` measures other KTX2 files. It sets window.report to the
// results and document.title to "done".

const q = new URLSearchParams(location.search);
const ORIGINALS = '/scripts/originals/';
const TEXTURES = q.get('textures') ?? '/assets/textures/';
const SIZE = 512;
/** The sky's cube size, as in src/client/assets.ts. */
const SKY_CUBE = 256;

const renderer = new THREE.WebGLRenderer();
renderer.setSize(64, 64);
document.body.append(renderer.domElement);

// ------------------------------------------------------------- textures

type Config = KTX2LoaderWorkerConfig;
const NONE: Config = {
  astcSupported: false, astcHDRSupported: false, etc1Supported: false, etc2Supported: false,
  dxtSupported: false, bptcSupported: false, pvrtcSupported: false,
};
/** What the GPU is sent for each way the transcoder could go with ETC1S. */
const TARGETS: Record<string, Config> = {
  rgba: NONE,
  bc1: { ...NONE, dxtSupported: true },
  etc: { ...NONE, etc2Supported: true },
};

async function loadArray(config: Config, file: string): Promise<THREE.Texture> {
  const loader = new KTX2Loader().setTranscoderPath('/assets/basis/');
  loader.workerConfig = config;
  try {
    return await loader.loadAsync(`${TEXTURES}${file}`);
  } finally {
    loader.dispose();
  }
}

/** Layer `layer` of an array texture's top level as 8-bit RGBA, sRGB colours encoded again. */
function readLayer(tex: THREE.Texture, layer: number, srgb: boolean): Uint8Array {
  const target = new THREE.WebGLRenderTarget(SIZE, SIZE);
  const material = new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3,
    uniforms: { tex: { value: tex }, layer: { value: layer } },
    vertexShader: 'in vec3 position; void main() { gl_Position = vec4(position.xy * 2.0, 0.0, 1.0); }',
    fragmentShader: `
      precision highp float;
      precision highp sampler2DArray;
      uniform sampler2DArray tex;
      uniform int layer;
      out vec4 color;
      void main() {
        vec4 c = texelFetch(tex, ivec3(ivec2(gl_FragCoord.xy), layer), 0);
        ${srgb ? 'c.rgb = mix(c.rgb * 12.92, 1.055 * pow(c.rgb, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c.rgb));' : ''}
        color = c;
      }`,
  });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(), material);
  const camera = new THREE.Camera();
  renderer.setRenderTarget(target);
  renderer.render(quad, camera);
  const out = new Uint8Array(SIZE * SIZE * 4);
  renderer.readRenderTargetPixels(target, 0, 0, SIZE, SIZE, out);
  renderer.setRenderTarget(null);
  target.dispose();
  material.dispose();
  return out;
}

/** An original JPEG scaled to SIZE, rows bottom first like the packed layers. */
async function original(name: string): Promise<Uint8ClampedArray> {
  const blob = await (await fetch(`${ORIGINALS}${name}.jpg`)).blob();
  const bitmap = await createImageBitmap(blob, {
    resizeWidth: SIZE, resizeHeight: SIZE, resizeQuality: 'high', imageOrientation: 'flipY', colorSpaceConversion: 'none',
  });
  const ctx = new OffscreenCanvas(SIZE, SIZE).getContext('2d')!;
  ctx.drawImage(bitmap, 0, 0);
  return ctx.getImageData(0, 0, SIZE, SIZE).data;
}

function psnr(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let sum = 0;
  for (let i = 0; i < a.length; i += 4) for (let c = 0; c < 3; c++) sum += (a[i + c] - b[i + c]) ** 2;
  return 10 * Math.log10(255 ** 2 / (sum / (a.length / 4) / 3));
}

/** Degrees between the original's normals and the packed ones (X in RGB, Y in alpha, Z rebuilt). */
function normalError(packed: Uint8Array, orig: Uint8ClampedArray): { mean: number; p95: number } {
  const angles: number[] = [];
  for (let i = 0; i < packed.length; i += 4) {
    const x = packed[i] / 127.5 - 1;
    const y = packed[i + 3] / 127.5 - 1;
    const z = Math.sqrt(Math.max(1 - x * x - y * y, 0));
    let ox = orig[i] / 127.5 - 1;
    let oy = orig[i + 1] / 127.5 - 1;
    let oz = orig[i + 2] / 127.5 - 1;
    const n = Math.hypot(ox, oy, oz) || 1;
    ox /= n;
    oy /= n;
    oz /= n;
    const l = Math.hypot(x, y, z) || 1;
    angles.push(Math.acos(Math.min((x * ox + y * oy + z * oz) / l, 1)) * 180 / Math.PI);
  }
  angles.sort((a, b) => a - b);
  return { mean: angles.reduce((s, v) => s + v, 0) / angles.length, p95: angles[Math.floor(angles.length * 0.95)] };
}

const round = (v: number, d = 2) => Math.round(v * 10 ** d) / 10 ** d;

async function textures() {
  const gpu = transcoder(renderer).workerConfig;
  const picked = gpu.etc2Supported ? 'etc' : gpu.dxtSupported ? 'bc1' : 'rgba';
  const targets = Object.entries(TARGETS).filter(([, c]) => (Object.keys(c) as (keyof Config)[]).every((k) => !c[k] || gpu[k]));
  const originals = { color: [] as Uint8ClampedArray[], normal: [] as Uint8ClampedArray[] };
  for (const l of LAYERS) {
    originals.color.push(await original(`${l.polyHaven}_color`));
    originals.normal.push(await original(`${l.polyHaven}_normal`));
  }
  const color: Record<string, number[]> = {};
  const normal: Record<string, { mean: number; p95: number }[]> = {};
  for (const [name, config] of targets) {
    const c = await loadArray(config, 'color.ktx2');
    const n = await loadArray(config, 'normal.ktx2');
    color[name] = LAYERS.map((_, i) => round(psnr(readLayer(c, i, true), originals.color[i])));
    normal[name] = LAYERS.map((_, i) => {
      const e = normalError(readLayer(n, i, false), originals.normal[i]);
      return { mean: round(e.mean), p95: round(e.p95) };
    });
    c.dispose();
    n.dispose();
  }
  return { layers: LAYERS.map((l) => l.polyHaven), picked, color, normal };
}

// ------------------------------------------------------------------ sky

const ROUGHNESS = [0, 0.25, 0.5, 0.75, 1];
/** Directions the spheres are seen from, so every part of the sky is reflected in one of them. */
const VIEWS: [number, number, number][] = [[0, 0, 1], [1, 0, 0], [0, 0, -1], [-1, 0, 0], [0, 1, 0.001], [0, -1, 0.001]];
const SPHERE_PX = 48;

/** Linear light off each sphere, seen from each view, lit only by `env`: shiny to rough metal, then rough white. */
function spheres(env: THREE.Texture): Float32Array[] {
  const target = new THREE.WebGLRenderTarget(SPHERE_PX, SPHERE_PX, { type: THREE.FloatType });
  const scene = new THREE.Scene();
  const material = new THREE.MeshStandardMaterial({ color: 0xffffff, envMap: env });
  scene.add(new THREE.Mesh(new THREE.SphereGeometry(1, 96, 48), material));
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
  const out: Float32Array[] = [];
  for (const [metal, roughness] of [...ROUGHNESS.map((r) => [1, r]), [0, 1]]) {
    material.metalness = metal;
    material.roughness = roughness;
    const px = new Float32Array(SPHERE_PX * SPHERE_PX * VIEWS.length * 4);
    VIEWS.forEach(([x, y, z], v) => {
      camera.position.set(x * 3, y * 3, z * 3);
      camera.lookAt(0, 0, 0);
      renderer.setRenderTarget(target);
      renderer.render(scene, camera);
      renderer.readRenderTargetPixels(target, 0, 0, SPHERE_PX, SPHERE_PX, px.subarray(v * SPHERE_PX * SPHERE_PX * 4));
    });
    out.push(px);
  }
  renderer.setRenderTarget(null);
  target.dispose();
  return out;
}

/** How `a` differs from `b`: overall brightness (+ is brighter) and the mean difference per pixel, both relative. */
function compare(a: Float32Array, b: Float32Array): { brightness: number; error: number } {
  let sa = 0;
  let sb = 0;
  let diff = 0;
  for (let i = 0; i < a.length; i += 4) {
    if (b[i + 3] === 0) continue;
    const la = 0.2126 * a[i] + 0.7152 * a[i + 1] + 0.0722 * a[i + 2];
    const lb = 0.2126 * b[i] + 0.7152 * b[i + 1] + 0.0722 * b[i + 2];
    sa += la;
    sb += lb;
    diff += Math.abs(la - lb);
  }
  return { brightness: round((sa / sb - 1) * 100), error: round((diff / sb) * 100) };
}

/**
 * Light falling on a white surface facing each view, over pi: the sky's
 * radiance averaged over the hemisphere with the cosine, straight from the
 * original's pixels, rows from the zenith down, u = 0.5 facing +x as three.js
 * maps it.
 */
function irradiance(sky: THREE.DataTexture): number[] {
  const { width: w, height: h, data } = sky.image as { width: number; height: number; data: Float32Array };
  return VIEWS.map(([nx, ny, nz]) => {
    const n = Math.hypot(nx, ny, nz);
    let sum = 0;
    let weight = 0;
    for (let r = 0; r < h; r++) {
      const lat = Math.PI / 2 - ((r + 0.5) / h) * Math.PI;
      const area = Math.cos(lat);
      for (let c = 0; c < w; c++) {
        const phi = ((c + 0.5) / w - 0.5) * 2 * Math.PI;
        const cos = (Math.cos(phi) * Math.cos(lat) * nx + Math.sin(lat) * ny + Math.sin(phi) * Math.cos(lat) * nz) / n;
        weight += area;
        if (cos <= 0) continue;
        const i = (r * w + c) * 4;
        sum += (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) * cos * area;
      }
    }
    // The whole sphere's weight is 4 pi; the cosine lobe's integral is pi.
    return (sum / weight) * 4;
  });
}

/** The middle of the rough white sphere in each view, where it faces the camera. */
function facing(px: Float32Array): number[] {
  return VIEWS.map((_, v) => {
    let sum = 0;
    for (const [x, y] of [[23, 23], [24, 23], [23, 24], [24, 24]]) {
      const i = (v * SPHERE_PX * SPHERE_PX + y * SPHERE_PX + x) * 4;
      sum += 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2];
    }
    return sum / 4;
  });
}

async function sky() {
  const hdr = new HDRLoader();
  const full = await hdr.loadAsync(`${ORIGINALS}sky.hdr`);
  const truth = irradiance(await new HDRLoader().setDataType(THREE.FloatType).loadAsync(`${ORIGINALS}sky.hdr`));
  const half = await hdr.loadAsync('/assets/sky.hdr');
  const pmrem = new THREE.PMREMGenerator(renderer);
  const reference = pmrem.fromEquirectangular(full).texture;
  const direct = pmrem.fromEquirectangular(half).texture;
  const cube = new THREE.WebGLCubeRenderTarget(SKY_CUBE, { type: THREE.HalfFloatType }).fromEquirectangularTexture(renderer, half);
  const game = pmrem.fromCubemap(cube.texture).texture;
  const want = spheres(reference);
  const got = { game: spheres(game), direct: spheres(direct) };
  const labels = [...ROUGHNESS.map((r) => `metal ${r}`), 'white 1'];
  const table = (s: Float32Array[]) => Object.fromEntries(labels.map((l, i) => [l, compare(s[i], want[i])]));
  // Each view on its own is off by the prefilter's lobe being wider than the cosine; the mean shows the energy kept.
  const ratios = (s: Float32Array[]) => {
    const each = facing(s[labels.length - 1]).map((v, i) => v / truth[i]);
    return { mean: round(each.reduce((a, b) => a + b, 0) / each.length), each: each.map((v) => round(v)) };
  };
  return {
    size: `${half.image.width}×${half.image.height} of ${full.image.width}×${full.image.height}`,
    game: table(got.game), direct: table(got.direct),
    diffuse: { full: ratios(want), game: ratios(got.game), direct: ratios(got.direct) },
  };
}

const report = { gpu: renderer.getContext().getParameter(renderer.getContext().VERSION) as string, textures: await textures(), sky: await sky() };
Object.assign(window, { report });
console.log(JSON.stringify(report, null, 1));
document.title = 'done';
