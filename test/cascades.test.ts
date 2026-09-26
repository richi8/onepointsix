import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { cascadedChunk } from '../src/client/cascades.ts';

// The shadow cascades patch three.js's lighting chunk by its text (see
// cascades.ts). These pin the text they rely on, so a three.js update that
// changes it fails here rather than in a shader compiled in the browser.

/** three.js's loop over directional lights, as the patch was written against. */
const LOOP = [
  '\t#pragma unroll_loop_start',
  '\tfor ( int i = 0; i < NUM_DIR_LIGHTS; i ++ ) {',
  '\t\tdirectionalLight = directionalLights[ i ];',
  '\t\tgetDirectionalLightInfo( directionalLight, directLight );',
  '\t\t#if defined( USE_SHADOWMAP ) && ( UNROLLED_LOOP_INDEX < NUM_DIR_LIGHT_SHADOWS )',
  '\t\tdirectionalLightShadow = directionalLightShadows[ i ];',
  '\t\tdirectLight.color *= ( directLight.visible && receiveShadow ) ? getShadow( directionalShadowMap[ i ], directionalLightShadow.shadowMapSize, directionalLightShadow.shadowIntensity, directionalLightShadow.shadowBias, directionalLightShadow.shadowRadius, vDirectionalShadowCoord[ i ] ) : 1.0;',
  '\t\t#endif',
  '\t\tRE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );',
  '\t}',
  '\t#pragma unroll_loop_end',
].join('\n');

const chunk = THREE.ShaderChunk.lights_fragment_begin;

describe('shadow cascades', () => {
  it("find three.js's directional light loop as it was when written", () => {
    // Blank lines are stripped from the built chunk; compare without them.
    const lines = (s: string) => s.split('\n').filter((l) => l.trim()).join('\n');
    expect(lines(chunk)).toContain(LOOP);
  });

  it('keep the stock loop for other scenes, behind the cascades', () => {
    const out = cascadedChunk(chunk);
    const cascades = out.indexOf('NUM_DIR_LIGHTS == 3 && NUM_DIR_LIGHT_SHADOWS == 3');
    const stock = out.indexOf('for ( int i = 0; i < NUM_DIR_LIGHTS; i ++ )');
    expect(cascades).toBeGreaterThan(0);
    expect(stock).toBeGreaterThan(cascades);
    expect(out.slice(cascades, stock)).toContain('#else');
    expect(out.slice(stock)).toMatch(/#pragma unroll_loop_end\n\t#endif/);
    // Everything else is untouched.
    expect(out.replace(/\n\t#if defined\( USE_SHADOWMAP \) && NUM_DIR_LIGHTS == 3[\s\S]*?#else\n/, '').replace(/(< NUM_DIR_LIGHTS;[\s\S]*?#pragma unroll_loop_end)\n\t#endif\n/, '$1')).toBe(chunk);
  });

  it('call getShadow and read the uniforms as three.js declares them', () => {
    const pars = THREE.ShaderChunk.shadowmap_pars_fragment;
    expect(pars).toContain('float getShadow( sampler2DShadow shadowMap, vec2 shadowMapSize, float shadowIntensity, float shadowBias, float shadowRadius, vec4 shadowCoord )');
    for (const name of ['directionalShadowMap[ NUM_DIR_LIGHT_SHADOWS ]', 'vDirectionalShadowCoord[ NUM_DIR_LIGHT_SHADOWS ]', 'directionalLightShadows[ NUM_DIR_LIGHT_SHADOWS ]']) {
      expect(pars).toContain(name);
    }
    for (const field of ['shadowIntensity', 'shadowBias', 'shadowRadius', 'shadowMapSize']) {
      expect(THREE.ShaderChunk.lights_pars_begin + pars).toMatch(new RegExp(`struct DirectionalLightShadow \\{[^}]*${field}`));
    }
  });

  it('fail loudly when the loop is gone', () => {
    expect(() => cascadedChunk(chunk.replace('NUM_DIR_LIGHTS; i ++', 'NUM_DIR_LIGHTS; ++ i'))).toThrow(/cascaded shadows need a new patch/);
  });
});
