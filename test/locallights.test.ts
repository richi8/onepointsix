import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { LocalLights, MAX_LIGHTS } from '../src/client/locallights.ts';

// The lamps and others' flashlights over their budgets (see locallights.ts):
// every one lit gets a shadow tile, and none jumps as it crosses a budget.

const renderer = { initRenderTarget() {} } as unknown as THREE.WebGLRenderer;
/** The list every material reads, four vec4s a light. */
const data = THREE.ShaderLib.standard.uniforms.localLights.value as Float32Array;
const info = THREE.ShaderLib.standard.uniforms.localInfo.value as Float32Array;

/** Draw lights at these distances from the camera, all casting shadows; each one's brightness, tile and share lit fully, by distance. */
function draw(nears: number[]): Map<number, { bright: number; tile: number; full: number }> {
  const lights = new LocalLights();
  lights.begin();
  for (const near of nears) {
    const l = lights.add();
    Object.assign(l, { intensity: 1, shadow: true, near, range: 10, angle: 0.5 });
    l.color.setRGB(1, 1, 1);
    // Tagged by where it stands, to find it again once sorted.
    l.x = near;
  }
  lights.draw(renderer, new THREE.Scene());
  const out = new Map<number, { bright: number; tile: number; full: number }>();
  for (let i = 0; i < info[0]; i++) out.set(data[i * 16], { bright: data[i * 16 + 8], tile: data[i * 16 + 13], full: data[i * 16 + 14] });
  return out;
}

describe('local lights', () => {
  it('gives every light in the budget a shadow tile', () => {
    const lit = draw(Array.from({ length: MAX_LIGHTS }, (_, i) => i * 10));
    expect(lit.size).toBe(MAX_LIGHTS);
    expect(new Set([...lit.values()].map((l) => l.tile)).size).toBe(MAX_LIGHTS);
    for (const l of lit.values()) expect(l.tile).toBeGreaterThanOrEqual(0);
  });

  it('lights everything fully under both budgets', () => {
    for (const l of draw([0, 5, 10, 20]).values()) {
      expect(l.bright).toBe(1);
      expect(l.full).toBe(1);
    }
  });

  it('fades the last light in out as the first left out nears it', () => {
    const base = Array.from({ length: MAX_LIGHTS - 1 }, (_, i) => i);
    // The 16th at 50 m, the 17th closing on it: 50 m off, then level.
    expect(draw([...base, 50, 100]).get(50)!.bright).toBe(1);
    expect(draw([...base, 50, 53]).get(50)!.bright).toBeCloseTo(0.5);
    expect(draw([...base, 50, 50.001]).get(50)!.bright).toBeCloseTo(0, 2);
  });

  it('blends the specular out as a light crosses the budget lit fully', () => {
    const base = [0, 1, 2, 3, 4];
    expect(draw([...base, 20, 40]).get(20)!.full).toBe(1);
    expect(draw([...base, 20, 23]).get(20)!.full).toBeCloseTo(0.5);
    expect(draw([...base, 20, 20.001]).get(20)!.full).toBeCloseTo(0, 2);
    expect(draw([...base, 20, 23]).get(23)!.full).toBe(0);
  });
});
