import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';

// Everything the game downloads, all CC0 or free to use (see
// public/assets/CREDITS.md). Until it arrives, the island draws in flat
// colours, so the menu shows at once.

/** Texture layers, in the order scripts/fetch-assets.mjs lists them. */
export const Layer = {
  grass: 0,
  dryGrass: 1,
  dirt: 2,
  rock: 3,
  sand: 4,
  planks: 5,
  concrete: 6,
  metal: 7,
  boards: 8,
  bark: 9,
} as const;

const TEXTURES = [
  'grass_ground', 'withered_grass', 'dirt', 'aerial_rocks_02', 'coast_sand_01',
  'weathered_planks', 'concrete_wall_004', 'corrugated_iron', 'wood_plank_wall', 'bark_brown_02',
];
const SIZE = 512;
const BASE = `${import.meta.env.BASE_URL}assets/`;

export interface Assets {
  /** Every surface's colour, one layer each, in sRGB. */
  albedo: THREE.DataArrayTexture;
  /** Every surface's tangent-space normal map, OpenGL convention. */
  normal: THREE.DataArrayTexture;
  /** Image-based lighting from a real sky, pre-filtered. */
  environment: THREE.Texture;
  soldier: GLTF;
  /** The guns, in WEAPONS order. */
  guns: GLTF[];
}

export async function loadAssets(renderer: THREE.WebGLRenderer): Promise<Assets> {
  const gltf = new GLTFLoader();
  const [albedo, normal, sky, soldier, ...guns] = await Promise.all([
    layers('color', true),
    layers('normal', false),
    new HDRLoader().loadAsync(`${BASE}sky.hdr`),
    gltf.loadAsync(`${BASE}soldier.glb`),
    ...['rifle', 'pistol', 'bolt'].map((name) => gltf.loadAsync(`${BASE}guns/${name}.glb`)),
  ]);
  const anisotropy = Math.min(renderer.capabilities.getMaxAnisotropy(), 8);
  albedo.anisotropy = normal.anisotropy = anisotropy;
  const pmrem = new THREE.PMREMGenerator(renderer);
  const environment = pmrem.fromEquirectangular(sky).texture;
  sky.dispose();
  pmrem.dispose();
  return { albedo, normal, environment, soldier, guns };
}

/** One kind of map for every layer, stacked into a single array texture. */
async function layers(kind: 'color' | 'normal', srgb: boolean): Promise<THREE.DataArrayTexture> {
  const images = await Promise.all(TEXTURES.map((id) => image(`${BASE}textures/${id}_${kind}.jpg`)));
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = SIZE;
  const g = canvas.getContext('2d', { willReadFrequently: true })!;
  // Bottom row first, as WebGL expects, so v runs up the image.
  g.setTransform(1, 0, 0, -1, 0, SIZE);
  const data = new Uint8Array(SIZE * SIZE * 4 * images.length);
  images.forEach((img, i) => {
    g.drawImage(img, 0, 0, SIZE, SIZE);
    data.set(g.getImageData(0, 0, SIZE, SIZE).data, i * SIZE * SIZE * 4);
  });
  const tex = new THREE.DataArrayTexture(data, SIZE, SIZE, images.length);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

function image(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Couldn't load ${url}`));
    img.src = url;
  });
}
