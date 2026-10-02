import * as THREE from 'three';

// Sun shadows in three cascades: a sharp map close around the player, a
// coarse one reaching far out round them, and one over the whole island that
// stands still and is only drawn again when the sun moves. three.js's CSM
// addon would take over every material's onBeforeCompile and light each
// cascade separately, so instead the stock lighting chunk is patched once: in
// a scene with exactly three shadow-casting directional lights where the
// second and third are black, the flag that they give no light and only lend
// their shadow maps, the first lights the scene with its map, each of the
// others' used wherever the one before it runs out. Any other scene is lit as
// three.js lights it.

/** Metres the coarse cascade reaches from the player in play. */
export const FAR_SHADOWS = 230;

const NEAR_MAP = 2048;
const FAR_MAP = 2048;
const ISLAND_MAP = 2048;
/** Share of the near and far maps, at their edges, over which each fades into the next. */
const BLEND = 0.1;

/** The start of the directional lights' loop; blank lines may be stripped from the chunk. */
const LOOP_START = /[ \t]*#pragma unroll_loop_start\s*for \( int i = 0; i < NUM_DIR_LIGHTS; i \+\+ \) \{/;

/** Whether the cascades apply, and after the stock loop, the end of their test. */
const CASCADES_IF = '#if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHTS == 3 && NUM_DIR_LIGHT_SHADOWS == 3 && defined( SHADOWMAP_TYPE_PCF )';

const CASCADED = /* glsl */ `
	${CASCADES_IF}

	if ( sunCascades() ) {

		// Cascades: light 0 is the sun with the near map; lights 1 and 2 are dark
		// and hold the far map and the island's. Only the maps needed are read.
		directionalLight = directionalLights[ 0 ];
		getDirectionalLightInfo( directionalLight, directLight );
		if ( directLight.visible && receiveShadow ) {
			float nearWeight = cascadeWeight( vDirectionalShadowCoord[ 0 ] );
			float farWeight = cascadeWeight( vDirectionalShadowCoord[ 1 ] );
			float cascadeShadow = 1.0;
			if ( farWeight < 1.0 && nearWeight < 1.0 ) {
				directionalLightShadow = directionalLightShadows[ 2 ];
				cascadeShadow = getShadow( directionalShadowMap[ 2 ], directionalLightShadow.shadowMapSize, directionalLightShadow.shadowIntensity, directionalLightShadow.shadowBias, directionalLightShadow.shadowRadius, vDirectionalShadowCoord[ 2 ] );
			}
			if ( farWeight > 0.0 && nearWeight < 1.0 ) {
				directionalLightShadow = directionalLightShadows[ 1 ];
				float farShadow = getShadow( directionalShadowMap[ 1 ], directionalLightShadow.shadowMapSize, directionalLightShadow.shadowIntensity, directionalLightShadow.shadowBias, directionalLightShadow.shadowRadius, vDirectionalShadowCoord[ 1 ] );
				cascadeShadow = mix( cascadeShadow, farShadow, farWeight );
			}
			if ( nearWeight > 0.0 ) {
				directionalLightShadow = directionalLightShadows[ 0 ];
				float nearShadow = getShadow( directionalShadowMap[ 0 ], directionalLightShadow.shadowMapSize, directionalLightShadow.shadowIntensity, directionalLightShadow.shadowBias, directionalLightShadow.shadowRadius, vDirectionalShadowCoord[ 0 ] );
				cascadeShadow = mix( cascadeShadow, nearShadow, nearWeight );
			}
			directLight.color *= cascadeShadow;
		}
		RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );

	} else {

	#endif
`;

const CASCADED_END = /* glsl */ `
	${CASCADES_IF}
	}
	#endif
`;

/** How fully a cascade covers a point, from its shadow coordinate: 1 inside, fading to 0 over its edge. */
const WEIGHT = /* glsl */ `
	${CASCADES_IF}
	// The flag: lights 1 and 2 give no light, and are there for their maps.
	bool sunCascades() {
		return directionalLights[ 1 ].color == vec3( 0.0 ) && directionalLights[ 2 ].color == vec3( 0.0 );
	}
	float cascadeWeight( vec4 coord ) {
		vec3 uv = coord.xyz / coord.w;
		float edge = min( min( uv.x, 1.0 - uv.x ), min( uv.y, 1.0 - uv.y ) );
		// Past the map's depth range it holds nothing either.
		return uv.z > 1.0 ? 0.0 : smoothstep( 0.0, ${BLEND.toFixed(3)}, edge );
	}
	#endif
`;

/** three.js's lighting chunk with the cascades patched in, or an error if it no longer has the loop they replace. */
export function cascadedChunk(chunk: string): string {
  const start = chunk.search(LOOP_START);
  // The directional block's loop ends at the first unroll_loop_end after it.
  const end = start < 0 ? -1 : chunk.indexOf('#pragma unroll_loop_end', start);
  if (start < 0 || end < 0) throw new Error('three.js lighting chunk changed: cascaded shadows need a new patch');
  const after = end + '#pragma unroll_loop_end'.length;
  return `${chunk.slice(0, start)}${CASCADED}${chunk.slice(start, after)}${CASCADED_END}${chunk.slice(after)}`;
}

/** three.js's lighting declarations with the cascades' helpers added. */
export function cascadedPars(pars: string): string {
  return `${pars}\n${WEIGHT}`;
}

let patched = false;

/** Patch three.js's lighting chunks; must run before any material compiles. */
function patchLighting(): void {
  if (patched) return;
  patched = true;
  THREE.ShaderChunk.lights_fragment_begin = cascadedChunk(THREE.ShaderChunk.lights_fragment_begin);
  THREE.ShaderChunk.lights_pars_begin = cascadedPars(THREE.ShaderChunk.lights_pars_begin);
}

/** The sun, casting shadows in three cascades: two following a focus point, one over the whole island. */
export class Sun {
  /** Lights the scene and holds the near shadow map. */
  readonly light: THREE.DirectionalLight;
  /** Give no light; only their shadow maps are used. */
  private readonly far: THREE.DirectionalLight;
  private readonly island: THREE.DirectionalLight;
  private readonly dir = new THREE.Vector3();
  /** Metres from the island's middle to its farthest corner. */
  private readonly reach: number;

  /** `half` is half the island's width. */
  constructor(color: THREE.ColorRepresentation, intensity: number, dir: THREE.Vector3, half: number) {
    patchLighting();
    this.dir.copy(dir);
    this.reach = half * Math.SQRT2;
    this.light = new THREE.DirectionalLight(color, intensity);
    // Black: the flag that marks them as the sun's cascades.
    this.far = new THREE.DirectionalLight(0x000000, 0);
    this.island = new THREE.DirectionalLight(0x000000, 0);
    for (const [light, size] of [[this.light, NEAR_MAP], [this.far, FAR_MAP], [this.island, ISLAND_MAP]] as const) {
      light.castShadow = true;
      light.shadow.mapSize.set(size, size);
      light.shadow.bias = -0.0004;
      light.shadow.normalBias = 0.04;
    }
    this.far.shadow.bias = -0.0008;
    this.far.shadow.normalBias = 0.15;
    this.island.shadow.bias = -0.0008;
    this.island.shadow.normalBias = 0.3;
    this.island.shadow.autoUpdate = false;
    fit(this.island, new THREE.Vector3(), this.reach, ISLAND_MAP, this.dir);
    this.redraw();
  }

  /** Add to the scene, in this order: the chunk relies on the near light coming first. */
  addTo(scene: THREE.Scene): void {
    scene.add(this.light, this.light.target, this.far, this.far.target, this.island, this.island.target);
  }

  /** Take out of the scene, and free the shadow maps. */
  removeFrom(scene: THREE.Scene): void {
    scene.remove(this.light, this.light.target, this.far, this.far.target, this.island, this.island.target);
    for (const l of [this.light, this.far, this.island]) l.shadow.dispose();
  }

  /** Light from `dir` (towards the sun) in `color` at `intensity`. */
  set(color: THREE.Color, intensity: number, dir: THREE.Vector3): void {
    this.light.color.copy(color);
    this.light.intensity = intensity;
    if (!dir.equals(this.dir)) {
      this.dir.copy(dir);
      fit(this.island, new THREE.Vector3(), this.reach, ISLAND_MAP, this.dir);
      this.redraw();
    }
  }

  /** Draw the island's still shadow map again on the next frame, after what casts it has changed. */
  redraw(): void {
    this.island.shadow.needsUpdate = true;
  }

  /** Centre the near and far cascades on `focus`, `near` and `far` metres out. */
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
  // The still map is drawn rarely, so its matrices mustn't wait for a scene update.
  light.updateMatrixWorld();
  light.target.updateMatrixWorld();
}
