import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { reporter } from './loading.ts';

// Everything the game downloads, all CC0 (see public/assets/CREDITS.md), as
// packed by scripts/fetch-assets.mjs. The main bundle imports this module
// lazily, so the loaders it pulls in don't hold up the first frame. Textures
// are KTX2 array textures, transcoded off the main thread; models are
// meshopt-compressed. The Basis transcoder is a build of our own with only
// what ETC1S needs (see scripts/build-transcoder.mjs), half the size of
// three.js's.

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

/** Everything downloaded, each reported to the loading bar as it comes in. */
export async function loadAssets(renderer: THREE.WebGLRenderer): Promise<Assets> {
  const ktx2 = transcoder(renderer);
  const gltf = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const load = <T>(loader: { loadAsync(url: string, onProgress: (e: ProgressEvent) => void): Promise<T> }, file: string) => {
    const url = `${BASE}${file}`;
    return loader.loadAsync(url, reporter(url));
  };
  try {
    const [albedo, normal, sky, soldier, ...guns] = await Promise.all([
      load<THREE.Texture>(ktx2, 'textures/color.ktx2'),
      load<THREE.Texture>(ktx2, 'textures/normal.ktx2'),
      load<THREE.Texture>(new HDRLoader(), 'sky.hdr'),
      load<GLTF>(gltf, 'soldier.glb'),
      ...['rifle', 'pistol', 'bolt'].map((name) => load<GLTF>(gltf, `guns/${name}.glb`)),
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
 * A KTX2 loader using our transcoder, which can't make BC7 or PVRTC: told
 * the GPU lacks them, it picks the next best, BC1/BC3 or plain RGBA.
 */
export function transcoder(renderer: THREE.WebGLRenderer): KTX2Loader {
  const loader = new KTX2Loader().setTranscoderPath(`${BASE}basis/`).detectSupport(renderer);
  Object.assign(loader.workerConfig, { bptcSupported: false, pvrtcSupported: false });
  return loader;
}
