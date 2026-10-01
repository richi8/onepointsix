import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { patchFog } from '../src/client/fogbanks.ts';
import { coverCode, IslandMap, NO_ROOF, shelters, underCover } from '../src/client/islandmap.ts';
import { OPEN_SKY, Rain, ROOF_CELL, ROOF_CELLS, roofHeights, Soak, type Shelter } from '../src/client/rain.ts';
import { World } from '../src/shared/world.ts';
import { DEFAULT_WORLD } from '../src/shared/worldconfig.ts';

const world = new World(DEFAULT_WORLD.seed);

describe('roof map', () => {
  // A roof map centred on a building, and the cell over a point.
  const b = world.buildings[0];
  const cx = (b.minX + b.maxX) / 2;
  const cz = (b.minZ + b.maxZ) / 2;
  const x0 = cx - (ROOF_CELLS * ROOF_CELL) / 2;
  const z0 = cz - (ROOF_CELLS * ROOF_CELL) / 2;
  const at = (map: Float32Array, x: number, z: number) =>
    map[Math.floor((z - z0) / ROOF_CELL) * ROOF_CELLS + Math.floor((x - x0) / ROOF_CELL)];

  it('keeps the rain off under a roof and not beside the building', () => {
    const map = roofHeights(world, x0, z0);
    expect(at(map, cx, cz)).toBeGreaterThan(b.roof);
    expect(at(map, cx, cz)).toBeLessThan(b.roof + 1);
    expect(at(map, b.maxX + 3, cz)).toBe(OPEN_SKY);
  });

  it('lets it in where the roof has come down', () => {
    const over = world.panels.filter((p) => p.kind === 'roof' && p.box.minX < cx && p.box.maxX > cx && p.box.minZ < cz && p.box.maxZ > cz);
    expect(over.length).toBeGreaterThan(0);
    for (const p of over) p.box.gone = true;
    try {
      expect(at(roofHeights(world, x0, z0), cx, cz)).toBe(OPEN_SKY);
    } finally {
      for (const p of over) p.box.gone = false;
    }
  });
});

describe('far roofs', () => {
  it('place a roof edge within a cell, erring onto the roof', () => {
    const mask = (covered: (i: number, j: number) => boolean) => {
      const m = new Uint8Array(256);
      for (let j = 0; j < 16; j++) for (let i = 0; i < 16; i++) m[j * 16 + i] = covered(i, j) ? 1 : 0;
      return m;
    };
    // Covered from step 5 of 16 across: from 0.3125 on, whatever the depth.
    const side = coverCode(mask((i) => i >= 5));
    expect(underCover(side, 0.32, 0.5)).toBe(true);
    expect(underCover(side, 0.3, 0.9)).toBe(false);
    // The inside corner of an L: all but the corner beyond 0.5 each way.
    const corner = coverCode(mask((i, j) => i < 8 || j < 8));
    expect(underCover(corner, 0.3, 0.9)).toBe(true);
    expect(underCover(corner, 0.9, 0.3)).toBe(true);
    expect(underCover(corner, 0.9, 0.9)).toBe(false);
    expect(coverCode(mask(() => true))).toBe(0);
  });

  it('keep the floor just inside a far wall dry and the ground outside wet', () => {
    const island = new IslandMap(world);
    const roofs = world.panels.filter(shelters);
    const exact = (x: number, z: number) =>
      roofs.reduce((top, p) => (x >= p.box.minX && x <= p.box.maxX && z >= p.box.minZ && z <= p.box.maxZ ? Math.max(top, p.box.maxY) : top), NO_ROOF);
    // Points more than a step of the edge from any roof's or floor's edge.
    const nearEdge = (x: number, z: number) => roofs.some(({ box: b }) =>
      x > b.minX - 0.13 && x < b.maxX + 0.13 && z > b.minZ - 0.13 && z < b.maxZ + 0.13
      && (Math.abs(x - b.minX) < 0.13 || Math.abs(x - b.maxX) < 0.13 || Math.abs(z - b.minZ) < 0.13 || Math.abs(z - b.maxZ) < 0.13));
    let checked = 0;
    let wrong = 0;
    for (const b of world.buildings.slice(0, 6)) {
      for (let x = b.minX - 2; x <= b.maxX + 2; x += 0.1) {
        for (let z = b.minZ - 2; z <= b.maxZ + 2; z += 0.1) {
          if (nearEdge(x, z)) continue;
          checked++;
          const want = exact(x, z);
          const got = island.roofAt(x, z);
          if (want === NO_ROOF ? got !== NO_ROOF : Math.abs(got - want) > 0.02) wrong++;
        }
      }
    }
    expect(checked).toBeGreaterThan(5000);
    expect(wrong).toBe(0);
  });
});

describe('shelter', () => {
  it('counts a floor above as a roof once the roof has come down', () => {
    const b = world.buildings.find((b) => b.upper !== null)!;
    expect(b).toBeDefined();
    const over = world.panels.filter((p) => p.kind === 'roof' && p.box.maxX > b.minX && p.box.minX < b.maxX && p.box.maxZ > b.minZ && p.box.minZ < b.maxZ);
    for (const p of over) p.box.gone = true;
    try {
      const rain = new Rain(world);
      const floor = world.panels.find((p) => p.kind === 'floor' && p.box.maxY > b.upper! - 0.05)!;
      const x = (floor.box.minX + floor.box.maxX) / 2;
      const z = floor.box.minZ + 0.5;
      expect(rain.sheltered(x, b.floor + 1, z)).toBe(true);
      expect(rain.sheltered(x, b.upper! + 1, z)).toBe(false);
      expect(new IslandMap(world).roofAt(x, z)).toBeCloseTo(floor.box.maxY, 1);
    } finally {
      for (const p of over) p.box.gone = false;
    }
  });

  it('dries something slowly under a roof and soaks it quickly in the rain', () => {
    let roofed = false;
    const shelter: Shelter = { raining: true, sheltered: () => roofed };
    const soak = new Soak();
    soak.update(shelter, 0, 0, 0, 0.1);
    expect(soak.level.value).toBe(1);
    roofed = true;
    for (let t = 0; t < 60; t += 0.1) soak.update(shelter, 0, 0, 0, 0.1);
    expect(soak.level.value).toBeGreaterThan(0.7);
    expect(soak.level.value).toBeLessThan(0.8);
    for (let t = 0; t < 300; t += 0.1) soak.update(shelter, 0, 0, 0, 0.1);
    expect(soak.level.value).toBe(0);
    roofed = false;
    for (let t = 0; t < 25; t += 0.1) soak.update(shelter, 0, 0, 0, 0.1);
    expect(soak.level.value).toBe(1);
    // First seen under a roof, dry.
    const inside = new Soak();
    roofed = true;
    inside.update(shelter, 0, 0, 0, 0.1);
    expect(inside.level.value).toBe(0);
    soak.update({ raining: false, sheltered: () => false }, 0, 0, 0, 0.1);
    expect(soak.level.value).toBe(0);
  });
});

describe('fog banks', () => {
  // The patch replaces three.js's fog chunks whole (see fogbanks.ts). These
  // pin the ones it was written against, so a three.js update that changes
  // them fails here rather than quietly losing what it added.
  const squash = (s: string) => s.replace(/\s+/g, ' ').trim();
  const stock = {
    fog_vertex: '#ifdef USE_FOG vFogDepth = - mvPosition.z; #endif',
    fog_pars_vertex: '#ifdef USE_FOG varying float vFogDepth; #endif',
    fog_pars_fragment: '#ifdef USE_FOG uniform vec3 fogColor; varying float vFogDepth; #ifdef FOG_EXP2 uniform float fogDensity; #else uniform float fogNear; uniform float fogFar; #endif #endif',
    fog_fragment: '#ifdef USE_FOG #ifdef FOG_EXP2 float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth ); #else float fogFactor = smoothstep( fogNear, fogFar, vFogDepth ); #endif gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor ); #endif',
  };

  it("replace three.js's fog chunks as they were when written, keeping what they declare", () => {
    for (const [name, text] of Object.entries(stock)) expect(squash(THREE.ShaderChunk[name as keyof typeof stock])).toBe(text);
    patchFog();
    expect(THREE.ShaderChunk.fog_vertex).toContain('vFogDepth = - mvPosition.z;');
    for (const name of ['fogColor', 'fogNear', 'fogFar', 'fogDensity', 'vFogDepth']) expect(THREE.ShaderChunk.fog_pars_fragment).toContain(name);
    expect(THREE.ShaderChunk.fog_fragment).toContain('gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );');
  });
});
