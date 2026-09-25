import * as THREE from 'three';

// Sun shadows in two cascades: a sharp map close around the player and a
// coarse one reaching far out. three.js's CSM addon would take over every
// material's onBeforeCompile and light each cascade separately, so instead
// the stock lighting chunk is patched once: in a scene with exactly two
// shadow-casting directional lights, the first lights the scene and the
// second only lends its shadow map, used wherever the first one's runs out.

const NEAR_MAP = 2048;
const FAR_MAP = 2048;
/** Share of the near map, at its edges, over which it fades into the far one. */
const BLEND = 0.1;

/** The start of the directional lights' loop; blank lines may be stripped from the chunk. */
const LOOP_START = /[ \t]*#pragma unroll_loop_start\s*for \( int i = 0; i < NUM_DIR_LIGHTS; i \+\+ \) \{/;

const CASCADED = /* glsl */ `
	#if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHTS == 2 && NUM_DIR_LIGHT_SHADOWS == 2 && defined( SHADOWMAP_TYPE_PCF )

		// Cascades: light 0 is the sun with the near map, light 1 is dark and holds the far map.
		directionalLight = directionalLights[ 0 ];
		getDirectionalLightInfo( directionalLight, directLight );
		if ( directLight.visible && receiveShadow ) {
			vec4 nearCoord = vDirectionalShadowCoord[ 0 ];
			vec2 nearUv = nearCoord.xy / nearCoord.w;
			float nearEdge = min( min( nearUv.x, 1.0 - nearUv.x ), min( nearUv.y, 1.0 - nearUv.y ) );
			float nearWeight = smoothstep( 0.0, ${BLEND.toFixed(3)}, nearEdge );
			directionalLightShadow = directionalLightShadows[ 1 ];
			float farShadow = getShadow( directionalShadowMap[ 1 ], directionalLightShadow.shadowMapSize, directionalLightShadow.shadowIntensity, directionalLightShadow.shadowBias, directionalLightShadow.shadowRadius, vDirectionalShadowCoord[ 1 ] );
			directionalLightShadow = directionalLightShadows[ 0 ];
			float nearShadow = getShadow( directionalShadowMap[ 0 ], directionalLightShadow.shadowMapSize, directionalLightShadow.shadowIntensity, directionalLightShadow.shadowBias, directionalLightShadow.shadowRadius, nearCoord );
			directLight.color *= mix( farShadow, nearShadow, nearWeight );
		}
		RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );

	#else
`;

let patched = false;

/** Patch three.js's lighting chunk; must run before any material compiles. */
function patchLighting(): void {
  if (patched) return;
  patched = true;
  const chunk = THREE.ShaderChunk.lights_fragment_begin;
  const start = chunk.search(LOOP_START);
  // The directional block's loop ends at the first unroll_loop_end after it.
  const end = start < 0 ? -1 : chunk.indexOf('#pragma unroll_loop_end', start);
  if (start < 0 || end < 0) throw new Error('three.js lighting chunk changed: cascaded shadows need a new patch');
  const after = end + '#pragma unroll_loop_end'.length;
  THREE.ShaderChunk.lights_fragment_begin = `${chunk.slice(0, start)}${CASCADED}${chunk.slice(start, after)}\n\t#endif\n${chunk.slice(after)}`;
}

/** The sun, casting shadows in two cascades that follow a focus point. */
export class Sun {
  /** Lights the scene and holds the near shadow map. */
  readonly light: THREE.DirectionalLight;
  /** Gives no light; only its far shadow map is used. */
  private readonly far: THREE.DirectionalLight;
  private readonly dir: THREE.Vector3;

  constructor(color: THREE.ColorRepresentation, intensity: number, dir: THREE.Vector3) {
    patchLighting();
    this.dir = dir;
    this.light = new THREE.DirectionalLight(color, intensity);
    this.far = new THREE.DirectionalLight(0x000000, 0);
    for (const [light, size] of [[this.light, NEAR_MAP], [this.far, FAR_MAP]] as const) {
      light.castShadow = true;
      light.shadow.mapSize.set(size, size);
      light.shadow.bias = -0.0004;
      light.shadow.normalBias = 0.04;
    }
    this.far.shadow.bias = -0.0008;
    this.far.shadow.normalBias = 0.15;
  }

  /** Add to the scene, in this order: the chunk relies on the near light coming first. */
  addTo(scene: THREE.Scene): void {
    scene.add(this.light, this.light.target, this.far, this.far.target);
  }

  /** Centre both cascades on `focus`, `near` and `far` metres out. */
  update(focus: THREE.Vector3, near: number, far: number): void {
    fit(this.light, focus, near, NEAR_MAP, this.dir);
    fit(this.far, focus, far, FAR_MAP, this.dir);
  }
}

function fit(light: THREE.DirectionalLight, focus: THREE.Vector3, radius: number, size: number, dir: THREE.Vector3): void {
  const cam = light.shadow.camera;
  if (cam.right !== radius) {
    cam.left = cam.bottom = -radius;
    cam.right = cam.top = radius;
    cam.near = 1;
    cam.far = radius * 2 + 400;
    cam.updateProjectionMatrix();
  }
  // Snap to shadow texels so shadows don't shimmer as the focus moves.
  const texel = (radius * 2) / size;
  const fx = Math.round(focus.x / texel) * texel;
  const fz = Math.round(focus.z / texel) * texel;
  light.target.position.set(fx, focus.y, fz);
  light.position.copy(light.target.position).addScaledVector(dir, radius + 200);
}
