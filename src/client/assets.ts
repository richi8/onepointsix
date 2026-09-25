import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

// Everything the game downloads, all CC0 (see public/assets/CREDITS.md), as
// packed by scripts/fetch-assets.mjs. The main bundle imports this module
// lazily, so the loaders it pulls in don't hold up the first frame. Textures
// are KTX2 array textures, transcoded off the main thread; models are
// meshopt-compressed.

const BASE = `${import.meta.env.BASE_URL}assets/`;
/**
 * The sky's cube size for pre-filtering. PMREM would size it from the
 * image, and the half-size sky we ship would light the island brighter.
 */
const SKY_CUBE = 256;

export interface Assets {
  /** Every surface's colour, one layer each (see layers.ts), in sRGB. */
  albedo: THREE.Texture;
  /** Every surface's tangent-space normal map, OpenGL convention, with X in RGB and Y in alpha. */
  normal: THREE.Texture;
  /** Image-based lighting from a real sky, pre-filtered. */
  environment: THREE.Texture;
  soldier: GLTF;
  /** The guns, in WEAPONS order. */
  guns: GLTF[];
}

/** Called as the downloads come in, with the fraction done. */
export type Progress = (fraction: number) => void;

export async function loadAssets(renderer: THREE.WebGLRenderer, progress: Progress = () => {}): Promise<Assets> {
  const ktx2 = new KTX2Loader().detectSupport(renderer);
  const gltf = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const track = tracker(7, progress);
  try {
    const [albedo, normal, sky, soldier, ...guns] = await Promise.all([
      ktx2.loadAsync(`${BASE}textures/color.ktx2`, track()),
      ktx2.loadAsync(`${BASE}textures/normal.ktx2`, track()),
      new HDRLoader().loadAsync(`${BASE}sky.hdr`, track()),
      gltf.loadAsync(`${BASE}soldier.glb`, track()),
      ...['rifle', 'pistol', 'bolt'].map((name) => gltf.loadAsync(`${BASE}guns/${name}.glb`, track())),
    ]);
    const anisotropy = Math.min(renderer.capabilities.getMaxAnisotropy(), 8);
    for (const tex of [albedo, normal]) {
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.anisotropy = anisotropy;
    }
    const cube = new THREE.WebGLCubeRenderTarget(SKY_CUBE, { type: THREE.HalfFloatType }).fromEquirectangularTexture(renderer, sky);
    const pmrem = new THREE.PMREMGenerator(renderer);
    const environment = pmrem.fromCubemap(cube.texture).texture;
    sky.dispose();
    cube.dispose();
    pmrem.dispose();
    return { albedo, normal, environment, soldier, guns };
  } finally {
    ktx2.dispose();
  }
}

/**
 * Combined progress over `count` downloads, by bytes. A download whose size
 * isn't known yet, because it hasn't started, is guessed to be as big as the
 * average of the others. A gzipped download's size is its compressed one, so
 * it counts as done early.
 */
function tracker(count: number, progress: Progress): () => (e: ProgressEvent) => void {
  const loaded: number[] = [];
  const total: number[] = [];
  let shown = 0;
  const report = (): void => {
    const known = total.filter((t) => t > 0);
    if (!known.length) return;
    const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
    const guess = sum(known) / known.length;
    // Never backward, even when a guess turns out too small.
    shown = Math.max(shown, sum(loaded) / (sum(known) + (count - known.length) * guess));
    progress(Math.min(shown, 1));
  };
  return () => {
    const i = loaded.push(0) - 1;
    total.push(0);
    return (e) => {
      loaded[i] = e.lengthComputable ? Math.min(e.loaded, e.total) : e.loaded;
      total[i] = e.lengthComputable ? e.total : Math.max(e.loaded, total[i]);
      report();
    };
  };
}
