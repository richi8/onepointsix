import * as THREE from 'three';
import { Layer } from '../shared/layers.ts';
import { pavingAt, type Paving } from '../shared/maps/index.ts';
import type { World } from '../shared/world.ts';
import { faces, type TownPaint } from './surfaces.ts';

// How a map's town is textured, where the island's props would be concrete,
// corrugated iron and planks: walls in their building's plaster, floors and
// flat roofs in terracotta tiles over plastered ceilings, stairs, terraces,
// freestanding walls and the quay in cut stone, terraces topped with the
// paving round them. And the paving over its ground: the
// lanes' flagstones, the squares' cobbles, the gardens' grass, and how worn
// it is where people walk.

/** Each paving's texture layer. */
const PAVING_LAYER: Record<Paving, number> = {
  flagstones: Layer.flagstones,
  cobbles: Layer.cobbles,
  grass: Layer.grass,
  earth: Layer.dirt,
};

/** Metres a texel of the paving's texture covers. */
const PAINT_TEXEL = 0.5;
/** Metres from a lane's line its paving is worn, falling off as a bell; how worn it is on the line. */
const LANE_WEAR = 1.6;
const LANE_WORN = 0.8;
/** Metres round a doorway on the ground, or a stair's foot, the paving is worn, wholly at the middle. */
const DOOR_WEAR = 1.5;
/** How far above the ground a door's foot may be and count as on it. */
const DOOR_GROUND = 0.6;

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
  wear(world, data, rect.minX, rect.minZ, w, h);
  const texture = new THREE.DataTexture(data, w, h, THREE.RGBAFormat);
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return { texture, rect: { minX: rect.minX, minZ: rect.minZ, maxX: rect.minX + w * PAINT_TEXEL, maxZ: rect.minZ + h * PAINT_TEXEL } };
}

/**
 * How worn the paving is, 0 to 255, into the alpha of `data`, the paint's
 * w × h texels from (x0, z0): darker and smoother along the map's lanes, at
 * the doorways on the ground and at the stairs' feet, where people walk.
 */
function wear(world: World, data: Uint8Array, x0: number, z0: number, w: number, h: number): void {
  const map = world.map!;
  /** Wear `f(x, z)` over the texels from (minX, minZ) to (maxX, maxZ), the most of it and what's there. */
  const stamp = (minX: number, minZ: number, maxX: number, maxZ: number, f: (x: number, z: number) => number) => {
    const i0 = Math.max(Math.floor((minX - x0) / PAINT_TEXEL), 0);
    const i1 = Math.min(Math.ceil((maxX - x0) / PAINT_TEXEL), w - 1);
    const j0 = Math.max(Math.floor((minZ - z0) / PAINT_TEXEL), 0);
    const j1 = Math.min(Math.ceil((maxZ - z0) / PAINT_TEXEL), h - 1);
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const o = (j * w + i) * 4 + 3;
        data[o] = Math.max(data[o], Math.round(255 * Math.min(f(x0 + (i + 0.5) * PAINT_TEXEL, z0 + (j + 0.5) * PAINT_TEXEL), 1)));
      }
    }
  };
  const reach = LANE_WEAR * 2.5;
  for (const lane of map.lanes ?? []) {
    for (let k = 1; k < lane.points.length; k++) {
      const [ax, az] = lane.points[k - 1];
      const [bx, bz] = lane.points[k];
      const dx = bx - ax;
      const dz = bz - az;
      const len2 = Math.max(dx * dx + dz * dz, 1e-6);
      stamp(Math.min(ax, bx) - reach, Math.min(az, bz) - reach, Math.max(ax, bx) + reach, Math.max(az, bz) + reach, (x, z) => {
        const t = Math.min(Math.max(((x - ax) * dx + (z - az) * dz) / len2, 0), 1);
        const d = Math.hypot(x - ax - dx * t, z - az - dz * t) / LANE_WEAR;
        return LANE_WORN * Math.exp(-d * d);
      });
    }
  }
  const spot = (cx: number, cz: number) =>
    stamp(cx - DOOR_WEAR, cz - DOOR_WEAR, cx + DOOR_WEAR, cz + DOOR_WEAR, (x, z) => Math.max(1 - Math.hypot(x - cx, z - cz) / DOOR_WEAR, 0));
  for (const f of world.facades) {
    for (const o of f.openings) {
      if (o.kind !== 'door') continue;
      const [cx, cz] = f.axis === 'x' ? [o.at, f.line] : [f.line, o.at];
      if (Math.abs(f.y - world.terrainHeight(cx, cz)) < DOOR_GROUND) spot(cx, cz);
    }
  }
  for (const s of map.stairs) spot(s.x, s.z);
}

/** The layer of the paving at (x, z), flagstones beyond the paving's area. */
function paveLayer(world: World, x: number, z: number): number {
  return PAVING_LAYER[(world.map && pavingAt(world.map, x, z)) ?? 'flagstones'];
}

/** What the plain surfaces are tinted: stone and terracotta as they are. */
const NEUTRAL = 0xf0ece4;
/** Flat colours, before the textures: stone and terracotta. */
const STONE_FLAT = 0x9c9482;
const COTTO_FLAT = 0x8e5a44;

/** What a map's prop is made of, or null for one drawn as on the island (crates, containers, glass). */
type Stuff = 'plaster' | 'stone' | 'floor';

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
    default:
      return null;
  }
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
    // A terrace's or a stair's top is paved as the ground round it.
    case 'stone': return b.walk ? faces(paveLayer(world, x, z), Layer.ashlar) : Layer.ashlar;
  }
}

/** Prop `i`'s tint in a map's town, over its texture (`textured`) or as its flat colour, or null if it's drawn as on the island. */
export function townTint(world: World, i: number, textured: boolean, out: THREE.Color): THREE.Color | null {
  const stuff = stuffOf(world, i);
  if (!stuff || stuff === 'plaster') return null;
  // The flat roofs' tiles, out in the sun, have bleached.
  if (textured) return world.props[i].box.part === 'roof' ? out.setHex(NEUTRAL).multiplyScalar(1.35) : out.setHex(NEUTRAL);
  return out.setHex(stuff === 'floor' ? COTTO_FLAT : STONE_FLAT);
}
