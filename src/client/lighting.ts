import * as THREE from 'three';
import type { GameMap } from '../shared/maps/index.ts';
import { WEATHERS, type Weather } from '../shared/weather.ts';
import type { Mix } from './outlook.ts';

// How the island is lit in each weather: the sun, the sky, the fog and how
// much the sky's picture lights things. The fog is the colour of the horizon,
// so distant hills melt into the sky. Between two weathers the clouds and the
// air each blend by their own mix (see outlook.ts).

export interface Lighting {
  /** Towards the sun. */
  sunDir: THREE.Vector3;
  /** Radians the sky's picture and its light are turned about the vertical, so its sun lies the sun's way. */
  skyTurn: number;
  /** How much the sky's photograph shows, over the sky drawn in its colours: none under cloud. */
  photo: number;
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

/**
 * Where the sun stands in the sky's photograph (Poly Haven's kloofendal_48d_partly_cloudy_puresky):
 * its bearing, degrees from +x toward +z, and its height over the horizon.
 */
export const PHOTO_SUN = { bearing: 34.1, height: 48.2 };

/** A clear day, before the weather greys it; the horizon as in the sky's photograph. */
const DAY = {
  sunColor: 0xfff1dc, sunIntensity: 3.3, horizon: 0x9a9ead, zenith: 0x4f7fae,
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

/** The way to the sun at `bearing` degrees (from +x toward +z), as high as in the sky's photograph. */
export function sunToward(bearing: number): THREE.Vector3 {
  const b = THREE.MathUtils.degToRad(bearing);
  const h = THREE.MathUtils.degToRad(PHOTO_SUN.height);
  return new THREE.Vector3(Math.cos(h) * Math.cos(b), Math.sin(h), Math.cos(h) * Math.sin(b));
}

/** The island's sun, as it was before the sky's photograph, at its height. */
const ISLAND_SUN = (Math.atan2(0.35, 0.45) * 180) / Math.PI;
/**
 * A map's town is lit by the sky's light with its sun taken out (see
 * loadAssets), as the sun alone lights it, so its sky is this much of the
 * island's, which keeps the sun the island had in its sky's light; and under
 * cloud the sun's light spreads over the sky, whose flat light then gives
 * this much more for all of the sun the clouds hide (not its picture, which
 * puddles and wet stone would mirror bright blue).
 */
const TOWN_SKY = 1;
const TOWN_OVERCAST = 1;

/** The light under `clouds`, seen through `air`: on the island, or in `map`'s town, its sun at the map's bearing. */
export function lightingOf(clouds: Mix, air: Mix = clouds, map: GameMap | null = null): Lighting {
  const w = skyOf(clouds, air);
  const sky = map ? TOWN_SKY : 1;
  const t = { ...DAY, environment: DAY.environment * sky, hemi: DAY.hemi * sky };
  const cloudy = map ? TOWN_OVERCAST * (1 - w.light) : 0;
  const bearing = map?.sun ?? ISLAND_SUN;
  const overcast = new THREE.Color(t.overcast);
  const horizon = new THREE.Color(t.horizon).lerp(overcast, w.grey);
  // In fog the whole sky is fog; under rain clouds the top is barely darker.
  const zenith = new THREE.Color(t.zenith).lerp(overcast.clone().multiplyScalar(0.85), w.grey);
  return {
    sunDir: sunToward(bearing),
    skyTurn: THREE.MathUtils.degToRad(PHOTO_SUN.bearing - bearing),
    // Gone well before the sky is grey.
    photo: Math.max(0, 1 - 2 * w.grey),
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
    hemiTextured: 0.3 * t.hemi * (0.5 + 0.5 * w.light) + cloudy,
    hemiSky: new THREE.Color(t.hemiSky),
    hemiGround: new THREE.Color(t.hemiGround),
    ambient: t.hemi * (0.5 + 0.5 * w.light),
    exposure: t.exposure,
  };
}
