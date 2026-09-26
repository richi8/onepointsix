import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { patchFog } from '../src/client/fogbanks.ts';
import { OPEN_SKY, ROOF_CELL, ROOF_CELLS, roofHeights } from '../src/client/rain.ts';
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
