import * as THREE from 'three';
import { Layer } from '../shared/layers.ts';
import { pavingAt, type Paving } from '../shared/maps/index.ts';
import type { World } from '../shared/world.ts';
import { faces, type TownPaint } from './surfaces.ts';

// How a map's town is textured, where the island's props would be concrete,
// corrugated iron and planks: walls in their building's plaster, floors and
// flat roofs in terracotta tiles over plastered ceilings, stairs, terraces,
// freestanding walls and the quay in cut stone, terraces topped with the
// paving round them; doors painted. And the paving over its ground: the
// lanes' flagstones, the squares' cobbles, the gardens' grass.

/** Each paving's texture layer. */
const PAVING_LAYER: Record<Paving, number> = {
  flagstones: Layer.flagstones,
  cobbles: Layer.cobbles,
  grass: Layer.grass,
  earth: Layer.dirt,
};

/** Metres a texel of the paving's texture covers. */
const PAINT_TEXEL = 0.5;

/** The paving of a map's ground as a texture over its area (see TownPaint), or undefined if it has none. */
export function townPaint(world: World): TownPaint | undefined {
  const map = world.map;
  if (!map?.paving) return undefined;
  const rect = map.paving.area;
  const w = Math.ceil((rect.maxX - rect.minX) / PAINT_TEXEL);
  const h = Math.ceil((rect.maxZ - rect.minZ) / PAINT_TEXEL);
  const data = new Uint8Array(w * h * 4);
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const kind = pavingAt(map, rect.minX + (i + 0.5) * PAINT_TEXEL, rect.minZ + (j + 0.5) * PAINT_TEXEL);
      const o = (j * w + i) * 4;
      if (kind === 'flagstones') data[o] = 255;
      else if (kind === 'cobbles') data[o + 1] = 255;
      else if (kind === 'grass') data[o + 2] = 255;
    }
  }
  const texture = new THREE.DataTexture(data, w, h, THREE.RGBAFormat);
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return { texture, rect: { minX: rect.minX, minZ: rect.minZ, maxX: rect.minX + w * PAINT_TEXEL, maxZ: rect.minZ + h * PAINT_TEXEL } };
}

/** The layer of the paving at (x, z), flagstones beyond the paving's area. */
function paveLayer(world: World, x: number, z: number): number {
  return PAVING_LAYER[(world.map && pavingAt(world.map, x, z)) ?? 'flagstones'];
}

/** What the plain surfaces are tinted: stone and terracotta as they are. */
const NEUTRAL = 0xf0ece4;
/** Doors' paint, as tints over the boards: green, blue, brown and oxblood, brightened past the dark wood. */
const DOOR_PAINT = [0x5e9a74, 0x5a86b0, 0x9a6a44, 0xa8504a];
const DOOR_GAIN = 1.7;
/** Flat colours, before the textures: stone, terracotta and the doors' paint. */
const STONE_FLAT = 0x9c9482;
const COTTO_FLAT = 0x8e5a44;
const DOOR_FLAT = [0x3e6450, 0x3c5a78, 0x6a4a30, 0x74363a];

/** What a map's prop is made of, or null for one drawn as on the island (crates, containers, glass). */
type Stuff = 'plaster' | 'stone' | 'floor' | 'door';

function stuffOf(world: World, i: number): Stuff | null {
  if (!world.map) return null;
  const p = world.props[i];
  switch (p.box.part) {
    case 'wall':
    case 'sill':
      return p.colour !== undefined ? 'plaster' : 'stone';
    case 'floor':
    case 'roof':
      return p.colour !== undefined || p.box.part === 'roof' ? 'floor' : 'stone';
    case 'step':
      return 'stone';
    case 'door':
      return 'door';
    default:
      return null;
  }
}

/** A door's paint, the same for both leaves of a doorway, from where it stands. */
function paintOf(world: World, i: number): number {
  const b = world.props[i].box;
  const d = b.door !== undefined ? world.doors[b.door] : null;
  const [x, z] = d ? [d.x + (d.pair >= 0 ? world.doors[d.pair].x : d.x), d.z + (d.pair >= 0 ? world.doors[d.pair].z : d.z)] : [b.minX, b.minZ];
  const h = Math.abs(Math.sin(x * 12.9898 + z * 78.233) * 43758.5453) % 1;
  return Math.floor(h * DOOR_PAINT.length);
}

/** Prop `i`'s texture layer code in a map's town, or null to texture it as on the island. */
export function townLayer(world: World, i: number): number | null {
  const stuff = stuffOf(world, i);
  if (!stuff) return null;
  const b = world.props[i].box;
  const [x, z] = [(b.minX + b.maxX) / 2, (b.minZ + b.maxZ) / 2];
  switch (stuff) {
    case 'plaster': return Layer.plaster;
    case 'floor': return faces(Layer.cotto, Layer.plaster);
    case 'door': return Layer.boards;
    // A terrace's or a stair's top is paved as the ground round it.
    case 'stone': return b.walk ? faces(paveLayer(world, x, z), Layer.ashlar) : Layer.ashlar;
  }
}

/** Prop `i`'s tint in a map's town, over its texture (`textured`) or as its flat colour, or null if it's drawn as on the island. */
export function townTint(world: World, i: number, textured: boolean, out: THREE.Color): THREE.Color | null {
  const stuff = stuffOf(world, i);
  if (!stuff || stuff === 'plaster') return null;
  if (stuff === 'door') {
    const k = paintOf(world, i);
    return textured ? out.setHex(DOOR_PAINT[k]).multiplyScalar(DOOR_GAIN) : out.setHex(DOOR_FLAT[k]);
  }
  // The flat roofs' tiles, out in the sun, have bleached.
  if (textured) return world.props[i].box.part === 'roof' ? out.setHex(NEUTRAL).multiplyScalar(1.35) : out.setHex(NEUTRAL);
  return out.setHex(stuff === 'floor' ? COTTO_FLAT : STONE_FLAT);
}
