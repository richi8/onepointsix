import * as THREE from 'three';
import { GRID_RES, WORLD_SIZE } from '../shared/constants.ts';
import type { World } from '../shared/world.ts';

// Fog that isn't the same everywhere. On top of three.js's distance fog, a
// mist lies on low ground: thickest at the sea and in the island's hollows,
// thinning with height above the ground round about (see setMistGround), and
// deeper in some places than others, so banks of it stand across the island
// and a hilltop can rise clear. How much mist there is follows the fog's own
// reach: none on a clear day, a little under rain, a lot in fog. Ahead of a fog it gathers in the hollows before the air
// thickens; three.js sends a linear fog only its near and far, so that mist
// rides in the near distance's whole multiples of MIST_STEP (see mistNear).
// As there's more of it, the banks spread out from where they lie deepest.
// Patched into three.js's fog chunks once, so every fogged material, the
// stock ones and our own, gets it.

/** Distance fog reaching this far or farther has no mist; at MIST_FULL or nearer, all of it. */
const MIST_NONE = 1000;
const MIST_FULL = 100;
/** The fog's near distance carries the mist ahead of a fog in steps of this, 255 of them. */
const MIST_STEP = 4096;

/** Below the ground round about by this much, the mist is as thick as at the sea; metres. */
const HOLLOW = 6;
/** How far round a place the ground counts for its hollows: the box blur's reach, cells, run twice. */
const ROUND = 10;

/** A texture every fogged material shares: cloning uniforms, as three.js does per material, keeps the one. */
class SharedTexture extends THREE.DataTexture {
  override clone(): this {
    return this;
  }
}

/** The height the mist lies from at each terrain vertex: the sea, or a little under the ground round about. */
const ground = new SharedTexture(new Uint16Array(1), 1, 1, THREE.RedFormat, THREE.HalfFloatType);
ground.magFilter = ground.minFilter = THREE.LinearFilter;

/** Lay the mist on `world`'s ground: it settles in hollows below the ground round them. */
export function setMistGround(world: World): void {
  const n = world.res + 1;
  let a = Float32Array.from(world.heights);
  let b = new Float32Array(n * n);
  for (let pass = 0; pass < 4; pass++) {
    // Box blurs along x then z, twice, clamping at the edges.
    const along = pass % 2 === 0 ? 1 : n;
    for (let row = 0; row < n; row++) {
      for (let i = 0; i < n; i++) {
        let sum = 0;
        for (let k = -ROUND; k <= ROUND; k++) {
          const j = Math.min(Math.max(i + k, 0), n - 1);
          sum += along === 1 ? a[row * n + j] : a[j * n + row];
        }
        b[along === 1 ? row * n + i : i * n + row] = sum / (2 * ROUND + 1);
      }
    }
    [a, b] = [b, a];
  }
  const data = new Uint16Array(n * n);
  for (let i = 0; i < n * n; i++) data[i] = THREE.DataUtils.toHalfFloat(Math.max(a[i] - HOLLOW, 0));
  ground.image = { data, width: n, height: n };
  ground.needsUpdate = true;
}

/** The fog's near distance `near` carrying `mist` ahead of a fog, 0 to 1. */
export function mistNear(near: number, mist: number): number {
  return near + MIST_STEP * Math.round(Math.min(Math.max(mist, 0), 1) * 255);
}

const PARS_VERTEX = /* glsl */ `
#ifdef USE_FOG
	uniform sampler2D mistGround;
	varying float vFogDepth;
	varying vec3 vFogWorld;
	// The camera's and this vertex's heights above where the mist lies.
	varying vec2 vMistHeights;

	// The height the mist lies from at x and z.
	float mistBase( vec2 xz ) {
		vec2 cells = ( xz + ${(WORLD_SIZE / 2).toFixed(1)} ) / ${(WORLD_SIZE / GRID_RES).toFixed(1)} + 0.5;
		return textureLod( mistGround, cells / vec2( textureSize( mistGround, 0 ) ), 0.0 ).r;
	}
#endif
`;

const VERTEX = /* glsl */ `
#ifdef USE_FOG
	vFogDepth = - mvPosition.z;
	// The view turns and moves rigidly, so its inverse is its turn transposed.
	vFogWorld = cameraPosition + transpose( mat3( viewMatrix ) ) * mvPosition.xyz;
	// Read per vertex, not per pixel, for speed; it changes slowly across the ground.
	vMistHeights = vec2( cameraPosition.y - mistBase( cameraPosition.xz ), vFogWorld.y - mistBase( vFogWorld.xz ) );
#endif
`;

const PARS_FRAGMENT = /* glsl */ `
#ifdef USE_FOG
	uniform vec3 fogColor;
	varying float vFogDepth;
	varying vec3 vFogWorld;
	varying vec2 vMistHeights;
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
			float ahead = floor( fogNear / ${MIST_STEP.toFixed(1)} ) / 255.0;
			float amount = max( clamp( ( ${MIST_NONE.toFixed(1)} - fogFar ) / ${(MIST_NONE - MIST_FULL).toFixed(1)}, 0.0, 1.0 ), ahead );
			if ( amount <= 0.0 ) return 0.0;
			vec3 c = cameraPosition;
			// The banks: where the mist stands deep, sampled along the way there,
			// spreading from the deepest as there's more of it.
			vec2 mid = ( c.xz + p.xz ) * 0.5;
			float bank = mistNoise( mid / 90.0 ) * 0.7 + mistNoise( mid / 35.0 + 7.3 ) * 0.3;
			// Ahead of a fog it stands deeper, up into the island's hollows.
			float depth = mix( 3.0, 22.0, smoothstep( 0.8 - 0.45 * amount, 0.8, bank ) ) * ( 1.0 + 0.8 * ahead );
			// Density falls off exponentially with height above where it lies, taken
			// as changing evenly from the camera to p; integrated along the straight line.
			float ya = max( vMistHeights.x, 0.0 ) / depth;
			float yb = max( vMistHeights.y, 0.0 ) / depth;
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
		float fogFactor = smoothstep( mod( fogNear, ${MIST_STEP.toFixed(1)} ), fogFar, vFogDepth );
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
  // Stock materials clone their ShaderLib uniforms when they compile, after this.
  const uniform = { mistGround: { value: ground } };
  Object.assign(THREE.UniformsLib.fog, uniform);
  for (const shader of Object.values(THREE.ShaderLib)) {
    if ('fogColor' in shader.uniforms) Object.assign(shader.uniforms, uniform);
  }
}
