import * as THREE from 'three';

// The colour grade a map's town is drawn with: the island's Neutral tone
// mapping, then a little more contrast round the middle greys, the shadows
// cooled toward the sky that lights them and the highlights warmed toward the
// sun, and the colours a touch richer. It's worked out in each material's
// tone mapping, as a formula rather than a look-up table, which would need a
// texture unit in every material, and they're short of them. The sky isn't
// tone mapped, so it isn't graded: the horizon stays the fog's colour.
// AgX was tried in its place and left the plaster and the sky pastel.

const GRADE = /* glsl */ `
vec3 CustomToneMapping( vec3 color ) {
  color = NeutralToneMapping( color );
  float lum = dot( color, vec3( 0.2126, 0.7152, 0.0722 ) );
  // Shadows a little blue, highlights a little gold.
  vec3 tint = mix( vec3( 0.96, 0.99, 1.05 ), vec3( 1.04, 1.0, 0.94 ), smoothstep( 0.03, 0.5, lum ) );
  color *= tint;
  // Contrast about the middle grey, in a roughly perceptual space.
  vec3 p = pow( max( color, 0.0 ), vec3( 1.0 / 2.2 ) );
  p = clamp( p + 0.12 * ( p - 0.45 ) * ( 1.0 - abs( 2.0 * p - 1.0 ) ), 0.0, 1.0 );
  color = pow( p, vec3( 2.2 ) );
  lum = dot( color, vec3( 0.2126, 0.7152, 0.0722 ) );
  return max( mix( vec3( lum ), color, 1.08 ), 0.0 );
}
`;

/** Draw with the town's grade: before any material is compiled. */
export function gradeTown(renderer: THREE.WebGLRenderer): void {
  const chunk = THREE.ShaderChunk.tonemapping_pars_fragment;
  const custom = 'vec3 CustomToneMapping( vec3 color ) { return color; }';
  if (chunk.includes(custom)) THREE.ShaderChunk.tonemapping_pars_fragment = chunk.replace(custom, GRADE);
  renderer.toneMapping = THREE.CustomToneMapping;
}
