import * as THREE from 'three';
import type { Conditions, TimeOfDay, Weather } from '../shared/conditions.ts';

// How the island is lit in each time of day and weather: the sun (or the
// moon), the sky, the fog and how much the sky's picture lights things. The
// fog is the colour of the horizon, so distant hills melt into the sky.

export interface Lighting {
  /** Towards the sun or moon. */
  sunDir: THREE.Vector3;
  sunColor: THREE.Color;
  sunIntensity: number;
  /** How bright the sun's disc and glow are in the sky. */
  disc: number;
  horizon: THREE.Color;
  zenith: THREE.Color;
  /** 0 no stars to 1 a clear night sky. */
  stars: number;
  fogNear: number;
  fogFar: number;
  /** The fog seen from high above the island on the menu: thinned so the island shows through it. */
  previewFogNear: number;
  previewFogFar: number;
  /** Image-based light from the sky's picture, once textured. */
  environment: number;
  /** The flat light in flat colours, and under the sky's picture once textured, from above and below. */
  hemi: number;
  hemiTextured: number;
  hemiSky: THREE.Color;
  hemiGround: THREE.Color;
  /** Share of a clear day's light, for lighting things kept apart from the world such as the gun in your hands. */
  ambient: number;
  exposure: number;
}

interface Time {
  sunDir: [number, number, number];
  sunColor: number;
  sunIntensity: number;
  disc: number;
  horizon: number;
  zenith: number;
  stars: number;
  environment: number;
  hemi: number;
  hemiSky: number;
  hemiGround: number;
  exposure: number;
  /** The colour the weather greys the sky towards at this hour. */
  overcast: number;
}

const TIMES: Record<TimeOfDay, Time> = {
  day: {
    sunDir: [0.45, 0.6, 0.35], sunColor: 0xfff1dc, sunIntensity: 3.3, disc: 1, horizon: 0xb9c9d6, zenith: 0x4f7fae,
    stars: 0, environment: 1, hemi: 1, hemiSky: 0xcfdcea, hemiGround: 0x5a5440, exposure: 0.9, overcast: 0x9aa3aa,
  },
  // The sun low in the west, warm and long-shadowed.
  dusk: {
    sunDir: [0.85, 0.13, 0.25], sunColor: 0xff9352, sunIntensity: 1.8, disc: 0.8, horizon: 0xd9a27e, zenith: 0x34496e,
    stars: 0.15, environment: 0.3, hemi: 0.45, hemiSky: 0xb0a8c8, hemiGround: 0x4a3c34, exposure: 1, overcast: 0x6e6a70,
  },
  // A high moon: enough to make out shapes nearby, not to see across the island.
  // Its cold light and the dark sky's leave little colour in anything.
  night: {
    sunDir: [-0.35, 0.75, -0.45], sunColor: 0x7d98ff, sunIntensity: 0.2, disc: 0.35, horizon: 0x0d1422, zenith: 0x03060d,
    stars: 1, environment: 0.02, hemi: 0.07, hemiSky: 0x6f84c8, hemiGround: 0x101216, exposure: 1.1, overcast: 0x12161d,
  },
};

interface Sky {
  /** Share of the sun and sky light the clouds let through. */
  light: number;
  /** How far the sky greys towards overcast, 0 to 1. */
  grey: number;
  fogNear: number;
  fogFar: number;
  previewFogNear: number;
  previewFogFar: number;
}

const WEATHER: Record<Weather, Sky> = {
  clear: { light: 1, grey: 0, fogNear: 120, fogFar: 1100, previewFogNear: 120, previewFogFar: 1100 },
  rain: { light: 0.3, grey: 0.75, fogNear: 20, fogFar: 380, previewFogNear: 150, previewFogFar: 1000 },
  // Thick enough that an outpost appears out of it only when you're nearly there.
  fog: { light: 0.3, grey: 1, fogNear: 0, fogFar: 100, previewFogNear: 30, previewFogFar: 700 },
};

export function lightingOf(c: Conditions): Lighting {
  const t = TIMES[c.time];
  const w = WEATHER[c.weather];
  const overcast = new THREE.Color(t.overcast);
  const horizon = new THREE.Color(t.horizon).lerp(overcast, w.grey);
  // In fog the whole sky is fog; under rain clouds the top is barely darker.
  const zenith = new THREE.Color(t.zenith).lerp(overcast.clone().multiplyScalar(0.85), w.grey);
  return {
    sunDir: new THREE.Vector3(...t.sunDir).normalize(),
    sunColor: new THREE.Color(t.sunColor),
    sunIntensity: t.sunIntensity * w.light,
    disc: t.disc * (1 - w.grey),
    horizon,
    zenith,
    stars: t.stars * (1 - w.grey),
    fogNear: w.fogNear,
    fogFar: w.fogFar,
    previewFogNear: w.previewFogNear,
    previewFogFar: w.previewFogFar,
    environment: t.environment * (0.5 + 0.5 * w.light),
    hemi: 1.1 * t.hemi * (0.5 + 0.5 * w.light),
    hemiTextured: 0.3 * t.hemi * (0.5 + 0.5 * w.light),
    hemiSky: new THREE.Color(t.hemiSky),
    hemiGround: new THREE.Color(t.hemiGround),
    ambient: t.hemi * (0.5 + 0.5 * w.light),
    exposure: t.exposure,
  };
}
