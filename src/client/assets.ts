import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { AVATAR_NAMES } from '../shared/avatars.ts';
import { reporter } from './loading.ts';

// Everything the game downloads, all CC0 but the soldiers, which are MIT (see
// public/assets/CREDITS.md), as packed by scripts/fetch-assets.mjs. The main bundle imports this module
// lazily, so the loaders it pulls in don't hold up the first frame. Textures
// are KTX2 array textures, transcoded off the main thread; models are
// meshopt-compressed. The Basis transcoder is a build of our own with only
// what ETC1S needs (see scripts/build-transcoder.mjs), half the size of
// three.js's; the soldiers' textures are inside their models, in the same form.

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
  /** Image-based lighting from a real sky, pre-filtered; on a map, its sun taken out (see loadAssets). */
  environment: THREE.Texture;
  /** The sky seen by day: a photograph of it, from the zenith down to SKY_BELOW below the horizon, in sRGB. */
  skyPhoto: THREE.Texture;
  /** The soldiers, in AVATAR_NAMES order; the first carries the clips. */
  soldiers: GLTF[];
  /** The guns, in WEAPONS order. */
  guns: GLTF[];
}

/** The sky's light brighter than this is the sun's disc and its glow: the brightest clouds are about 2. */
const SUN_CLIP = 3;

/**
 * Everything downloaded, each reported to the loading bar as it comes in.
 * With `clipSun`, as a map's town is lit, the sun is taken out of the sky's
 * light: the game's own sun gives that light, with shadows, while a sun in
 * the sky's light lights the shade from its way as brightly as the sun.
 */
export async function loadAssets(renderer: THREE.WebGLRenderer, clipSun = false): Promise<Assets> {
  const ktx2 = transcoder(renderer);
  const gltf = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).setKTX2Loader(ktx2);
  const load = <T>(loader: { loadAsync(url: string, onProgress: (e: ProgressEvent) => void): Promise<T> }, file: string) => {
    const url = `${BASE}${file}`;
    return loader.loadAsync(url, reporter(url));
  };
  try {
    const [[albedo, normal, sky, skyPhoto], models] = await Promise.all([
      Promise.all([
        load<THREE.Texture>(ktx2, 'textures/color.ktx2'),
        load<THREE.Texture>(ktx2, 'textures/normal.ktx2'),
        load<THREE.Texture>(new HDRLoader(), 'sky.hdr'),
        load<THREE.Texture>(photoLoader(), 'sky.jpg'),
      ]),
      Promise.all([...AVATAR_NAMES.map((name) => `soldiers/${name}`), ...['rifle', 'pistol', 'bolt'].map((name) => `guns/${name}`)]
        .map((file) => load<GLTF>(gltf, `${file}.glb`))),
    ]);
    const soldiers = models.slice(0, AVATAR_NAMES.length);
    const guns = models.slice(AVATAR_NAMES.length);
    const anisotropy = Math.min(renderer.capabilities.getMaxAnisotropy(), 8);
    for (const tex of [albedo, normal]) {
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.anisotropy = anisotropy;
    }
    if (clipSun) withoutSun(sky);
    const cube = new THREE.WebGLCubeRenderTarget(SKY_CUBE, { type: THREE.HalfFloatType }).fromEquirectangularTexture(renderer, sky);
    const pmrem = new THREE.PMREMGenerator(renderer);
    const environment = pmrem.fromCubemap(cube.texture).texture;
    sky.dispose();
    cube.dispose();
    pmrem.dispose();
    // Magnified on screen, so no mipmaps, which would show a seam where the picture's ends meet.
    skyPhoto.flipY = false;
    skyPhoto.colorSpace = THREE.SRGBColorSpace;
    skyPhoto.wrapS = THREE.RepeatWrapping;
    skyPhoto.minFilter = THREE.LinearFilter;
    skyPhoto.generateMipmaps = false;
    return { albedo, normal, environment, skyPhoto, soldiers, guns };
  } finally {
    ktx2.dispose();
  }
}

/**
 * Loads a picture by fetch(), which the single file can serve (see
 * vite.config.ts), where an image element can't, reporting its progress;
 * turned upside down, as a texture loaded from an image would be.
 */
function photoLoader() {
  const files = new THREE.FileLoader().setResponseType('blob');
  return {
    async loadAsync(url: string, onProgress: (e: ProgressEvent) => void): Promise<THREE.Texture> {
      const blob = (await files.loadAsync(url, onProgress)) as unknown as Blob;
      const texture = new THREE.Texture(await createImageBitmap(blob, { imageOrientation: 'flipY' }));
      texture.needsUpdate = true;
      return texture;
    },
  };
}

/** Dim every texel of the sky's light brighter than SUN_CLIP to it, keeping its colour. */
function withoutSun(sky: THREE.Texture): void {
  const data = (sky.image as { data: Uint16Array }).data;
  const { fromHalfFloat, toHalfFloat } = THREE.DataUtils;
  for (let i = 0; i < data.length; i += 4) {
    const r = fromHalfFloat(data[i]);
    const g = fromHalfFloat(data[i + 1]);
    const b = fromHalfFloat(data[i + 2]);
    const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    if (lum <= SUN_CLIP) continue;
    const k = SUN_CLIP / lum;
    data[i] = toHalfFloat(r * k);
    data[i + 1] = toHalfFloat(g * k);
    data[i + 2] = toHalfFloat(b * k);
  }
  sky.needsUpdate = true;
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
