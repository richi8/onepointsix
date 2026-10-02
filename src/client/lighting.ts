import * as THREE from 'three';
import { WEATHERS, type Weather } from '../shared/weather.ts';
import type { Mix } from './outlook.ts';

// How the island is lit in each weather: the sun, the sky, the fog and how
// much the sky's picture lights things. The fog is the colour of the horizon,
// so distant hills melt into the sky. Between two weathers the clouds and the
// air each blend by their own mix (see outlook.ts).

export interface Lighting {
  /** Towards the sun. */
  sunDir: THREE.Vector3;
  sunColor: THREE.Color;
  sunIntensity: number;
  /** How bright the sun's disc and glow are in the sky. */
  disc: number;
  horizon: THREE.Color;
  zenith: THREE.Color;
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

/** A clear day, before the weather greys it. */
const DAY = {
  sunDir: [0.45, 0.6, 0.35], sunColor: 0xfff1dc, sunIntensity: 3.3, horizon: 0xb9c9d6, zenith: 0x4f7fae,
  environment: 1, hemi: 1, hemiSky: 0xcfdcea, hemiGround: 0x5a5440, exposure: 0.9,
  /** The colour the weather greys the sky towards. */
  overcast: 0x9aa3aa,
} as const;

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

/** The sky under `clouds`, seen through `air`. */
function skyOf(clouds: Mix, air: Mix): Sky {
  const sky: Sky = { light: 0, grey: 0, fogNear: 0, fogFar: 0, previewFogNear: 0, previewFogFar: 0 };
  for (const k of WEATHERS) {
    const w = WEATHER[k];
    sky.light += clouds[k] * w.light;
    sky.grey += clouds[k] * w.grey;
    sky.fogNear += air[k] * w.fogNear;
    sky.previewFogNear += air[k] * w.previewFogNear;
    // The haze closes in steadily: its reach blends by ratio, not by metres.
    sky.fogFar += air[k] * Math.log(w.fogFar);
    sky.previewFogFar += air[k] * Math.log(w.previewFogFar);
  }
  sky.fogFar = Math.exp(sky.fogFar);
  sky.previewFogFar = Math.exp(sky.previewFogFar);
  return sky;
}

export function lightingOf(clouds: Mix, air: Mix = clouds): Lighting {
  const t = DAY;
  const w = skyOf(clouds, air);
  const overcast = new THREE.Color(t.overcast);
  const horizon = new THREE.Color(t.horizon).lerp(overcast, w.grey);
  // In fog the whole sky is fog; under rain clouds the top is barely darker.
  const zenith = new THREE.Color(t.zenith).lerp(overcast.clone().multiplyScalar(0.85), w.grey);
  return {
    sunDir: new THREE.Vector3(...t.sunDir).normalize(),
    sunColor: new THREE.Color(t.sunColor),
    sunIntensity: t.sunIntensity * w.light,
    disc: 1 - w.grey,
    horizon,
    zenith,
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
