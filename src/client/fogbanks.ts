import * as THREE from 'three';

// Fog that isn't the same everywhere. On top of three.js's distance fog, a
// mist lies on low ground: thickest at the sea and in the hollows near it,
// thinning with height, and deeper in some places than others, so banks of it
// stand across the island and a hilltop can rise clear. How much mist there
// is follows the fog's own reach, so it needs no uniforms of its own: none on
// a clear day, a little under rain, a lot in fog. Patched into three.js's fog
// chunks once, so every fogged material, the stock ones and our own, gets it.

/** Distance fog reaching this far or farther has no mist; at MIST_FULL or nearer, all of it. */
const MIST_NONE = 1000;
const MIST_FULL = 100;

const PARS_VERTEX = /* glsl */ `
#ifdef USE_FOG
	varying float vFogDepth;
	varying vec3 vFogWorld;
#endif
`;

const VERTEX = /* glsl */ `
#ifdef USE_FOG
	vFogDepth = - mvPosition.z;
	// The view turns and moves rigidly, so its inverse is its turn transposed.
	vFogWorld = cameraPosition + transpose( mat3( viewMatrix ) ) * mvPosition.xyz;
#endif
`;

const PARS_FRAGMENT = /* glsl */ `
#ifdef USE_FOG
	uniform vec3 fogColor;
	varying float vFogDepth;
	varying vec3 vFogWorld;
	#ifdef FOG_EXP2
		uniform float fogDensity;
	#else
		uniform float fogNear;
		uniform float fogFar;
	#endif

	float mistHash( vec2 p ) {
		return fract( sin( dot( p, vec2( 269.5, 183.3 ) ) ) * 43758.5453 );
	}
	float mistNoise( vec2 p ) {
		vec2 i = floor( p );
		vec2 f = fract( p );
		f = f * f * ( 3.0 - 2.0 * f );
		return mix( mix( mistHash( i ), mistHash( i + vec2( 1.0, 0.0 ) ), f.x ), mix( mistHash( i + vec2( 0.0, 1.0 ) ), mistHash( i + vec2( 1.0, 1.0 ) ), f.x ), f.y );
	}

	// How much of the view from the camera to p the low mist hides, 0 to 1.
	float mistAlong( vec3 p ) {
		#ifdef FOG_EXP2
			return 0.0;
		#else
			float amount = clamp( ( ${MIST_NONE.toFixed(1)} - fogFar ) / ${(MIST_NONE - MIST_FULL).toFixed(1)}, 0.0, 1.0 );
			if ( amount <= 0.0 ) return 0.0;
			vec3 c = cameraPosition;
			// The banks: where the mist stands deep, sampled along the way there.
			vec2 mid = ( c.xz + p.xz ) * 0.5;
			float bank = mistNoise( mid / 90.0 ) * 0.7 + mistNoise( mid / 35.0 + 7.3 ) * 0.3;
			float depth = mix( 3.0, 22.0, smoothstep( 0.35, 0.8, bank ) );
			// Density falls off exponentially with height; integrated along the straight line.
			float ya = max( c.y, 0.0 ) / depth;
			float yb = max( p.y, 0.0 ) / depth;
			float dy = yb - ya;
			float mean = abs( dy ) < 1e-3 ? exp( - ya ) : ( exp( - ya ) - exp( - yb ) ) / dy;
			float thick = 0.035 * amount * amount;
			return 1.0 - exp( - thick * mean * distance( c, p ) );
		#endif
	}
#endif
`;

const FRAGMENT = /* glsl */ `
#ifdef USE_FOG
	#ifdef FOG_EXP2
		float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
	#else
		float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
	#endif
	fogFactor = 1.0 - ( 1.0 - fogFactor ) * ( 1.0 - mistAlong( vFogWorld ) );
	gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );
#endif
`;

let patched = false;

/** Patch three.js's fog chunks; must run before any material compiles. */
export function patchFog(): void {
  if (patched) return;
  patched = true;
  THREE.ShaderChunk.fog_pars_vertex = PARS_VERTEX;
  THREE.ShaderChunk.fog_vertex = VERTEX;
  THREE.ShaderChunk.fog_pars_fragment = PARS_FRAGMENT;
  THREE.ShaderChunk.fog_fragment = FRAGMENT;
}
