import { describe, expect, it } from 'vitest';
import { CALABIANCA } from '../src/shared/maps/calabianca.ts';
import { World } from '../src/shared/world.ts';
import * as THREE from 'three';
import { footLifts } from '../src/client/age.ts';
import { footfallBytes } from '../src/shared/maps/index.ts';
import { townPaint } from '../src/client/townlook.ts';

// Calabianca's age (chunk 61): how worn its paving is where people walk,
// carried in the alpha of the paving's texture, which the terrain's shader
// darkens and smooths by. The weathering itself is all in the shaders, seen
// in the town's screenshots. Coordinates are the town's as moved onto its
// island, 240 m south.

const town = new World(1, CALABIANCA);
const Z = 240;
const paint = townPaint(town)!;
const { data, width } = paint.texture.image as { data: Uint8Array; width: number };
/** How worn the paving is at (x, z), 0 to 1. */
const worn = (x: number, z: number) =>
  data[(Math.floor((z - paint.rect.minZ) / 0.5) * width + Math.floor((x - paint.rect.minX) / 0.5)) * 4 + 3] / 255;

describe('Calabianca\'s worn paving', () => {
  it('is worn where the bots walked, less so a few steps off it, and not at all where they never went', () => {
    const paving = town.map!.paving!;
    const f = paving.footfall!;
    const bytes = footfallBytes(f);
    // The busiest cell and the doorways' and stairs' spots aside, the wear follows what the simulation recorded.
    const busiest = bytes.indexOf(Math.max(...bytes));
    const x = paving.area.minX + ((busiest % f.w) + 0.5) * f.cell;
    const z = paving.area.minZ + (Math.floor(busiest / f.w) + 0.5) * f.cell;
    expect(worn(x, z)).toBeGreaterThan(0.7);
    // Where none of a cell's neighbours were walked either, it's unworn (but at a doorway or a stair's foot).
    let unwalked = 0;
    let unworn = 0;
    for (let j = 3; j < f.h - 3; j += 2) {
      for (let i = 3; i < f.w - 3; i += 2) {
        let sum = 0;
        for (let dj = -2; dj <= 2; dj++) for (let di = -2; di <= 2; di++) sum += bytes[(j + dj) * f.w + i + di];
        if (sum > 0) continue;
        unwalked++;
        if (worn(paving.area.minX + (i + 0.5) * f.cell, paving.area.minZ + (j + 0.5) * f.cell) < 0.05) unworn++;
      }
    }
    expect(unwalked).toBeGreaterThan(100);
    expect(unworn / unwalked).toBeGreaterThan(0.9);
    // The quay, which they cross, is worn along its length.
    expect(worn(-30, 50 + Z)).toBeGreaterThan(0.5);
  });

  it('is worn most at a doorway on the ground and at a stair\'s foot', () => {
    const middles = town.facades.flatMap((f) => f.openings.filter((o) => o.kind === 'door').map((o) => [...(f.axis === 'x' ? [o.at, f.line] : [f.line, o.at]), f.y] as const));
    const [x, z] = middles.find(([x, z, y]) => Math.abs(y - town.terrainHeight(x, z)) < 0.3)!;
    expect(worn(x, z)).toBeGreaterThan(0.7);
    const s = CALABIANCA.stairs[0];
    expect(worn(s.x, s.z)).toBeGreaterThan(0.7);
  });

  it('leaves most of the town unworn', () => {
    let n = 0;
    for (let i = 3; i < data.length; i += 4) if (data[i] < 26) n++;
    expect(n / (data.length / 4)).toBeGreaterThan(0.5);
  });
});

describe('Calabianca\'s damp', () => {
  const box = (x: number, y: number, z: number) => new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion(), new THREE.Vector3(4, 3, 0.4));

  it('starts at the ground a wall stands on, so a wall on a terrace or a lower roof is damp at its foot', () => {
    let lifted = 0;
    let walls = 0;
    for (const b of town.colliders) {
      if (b.kind !== 'box') continue;
      if (b.part !== 'wall' || b.gone) continue;
      walls++;
      const m = new THREE.Matrix4().compose(
        new THREE.Vector3((b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2, (b.minZ + b.maxZ) / 2),
        new THREE.Quaternion(),
        new THREE.Vector3(b.maxX - b.minX, b.maxY - b.minY, b.maxZ - b.minZ),
      );
      if (Math.max(...footLifts(town, m)) > 0.3) lifted++;
    }
    expect(walls).toBeGreaterThan(100);
    expect(lifted).toBeGreaterThan(0);
  });

  it('is zero for a wall hanging over open air', () => {
    expect(footLifts(town, box(0, 300, 0))).toEqual([0, 0, 0, 0]);
  });
});
