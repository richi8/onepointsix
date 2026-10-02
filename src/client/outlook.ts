import { clamp, smoothstep } from '../shared/geom.ts';
import { WEATHERS, type Forecast, type Weather } from '../shared/weather.ts';

// What the weather looks and sounds like at a moment of the game's clock,
// worked out from the island's forecast so every client and a death cam see
// the same: each change blended in over its half a minute to a minute, and
// signs of it in the minute before (clouds thickening, the wind rising and
// far thunder before rain, mist gathering in the hollows before fog). How wet
// the island is follows the rain that's fallen, soaking in fast and drying
// slowly after.

/** How much of each weather is in something, adding up to 1. */
export type Mix = Record<Weather, number>;

export interface Outlook {
  /** The clouds: how grey the sky is and how much sun gets through. Turns first, ahead of a change. */
  clouds: Mix;
  /** The air: how far you see through haze and fog. */
  air: Mix;
  /** How hard it's raining, 0 to 1. */
  rainfall: number;
  /** How stormy it is, 0 to 1: far thunder ahead of rain, near and often in it. */
  storm: number;
  /** How hard the wind blows, as a multiple of a clear day's. */
  wind: number;
  /** Mist lying in the hollows ahead of a fog, 0 to 1, besides the fog's own. */
  mist: number;
}

/** Seconds before a change that its signs begin to show. */
export const WARNING = 75;
/** How far the clouds have turned toward the coming weather by the time it starts coming in. */
const PRE_CLOUDS: Record<Weather, number> = { clear: 0.15, rain: 0.6, fog: 0.15 };
/** How hard the wind blows in each weather, and how much it rises ahead of rain. */
const WIND: Record<Weather, number> = { clear: 1, rain: 1.3, fog: 0.55 };
const GUST = 0.7;
/** How much mist lies in the hollows by the time a fog starts coming in. */
const PRE_MIST = 0.75;

/** One weather alone, settled, with no change coming. */
export function settledOutlook(weather: Weather): Outlook {
  const only = mix(weather, weather, 1);
  const rain = weather === 'rain' ? 1 : 0;
  return { clouds: only, air: { ...only }, rainfall: rain, storm: rain, wind: WIND[weather], mist: 0 };
}

/** Whether two outlooks look different enough to light the island again. */
export function outlookMoved(a: Outlook, b: Outlook): boolean {
  const far = (x: number, y: number) => Math.abs(x - y) > 1e-4;
  return WEATHERS.some((w) => far(a.clouds[w], b.clouds[w]) || far(a.air[w], b.air[w]))
    || far(a.rainfall, b.rainfall) || far(a.storm, b.storm) || far(a.mist, b.mist);
}

function mix(a: Weather, b: Weather, t: number): Mix {
  const m: Mix = { clear: 0, rain: 0, fog: 0 };
  m[a] += 1 - t;
  m[b] += t;
  return m;
}

/** The weather in `forecast` at `time` as it's seen and heard. */
export function outlookAt(forecast: Forecast, time: number): Outlook {
  const now = forecast.at(time);
  const next = forecast.next(time);
  const ahead = 1 - smoothstep(0, WARNING, next.in);
  if (now.from === now.to) return turning(now.to, next.weather, 0, ahead);
  // A short spell's next change may be on its way before this one is done:
  // its signs grow in as this one ends.
  const o = turning(now.from, now.to, now.blend, 1);
  if (ahead <= 0) return o;
  const k = smoothstep(0, 1, now.blend);
  const signs = turning(now.to, next.weather, 0, ahead);
  const settled = settledOutlook(now.to);
  const add = (x: number, y: number, z: number) => x + k * (y - z);
  for (const w of WEATHERS) {
    o.clouds[w] = add(o.clouds[w], signs.clouds[w], settled.clouds[w]);
    o.air[w] = add(o.air[w], signs.air[w], settled.air[w]);
  }
  o.rainfall = add(o.rainfall, signs.rainfall, settled.rainfall);
  o.storm = add(o.storm, signs.storm, settled.storm);
  o.wind = add(o.wind, signs.wind, settled.wind);
  o.mist = add(o.mist, signs.mist, settled.mist);
  return o;
}

/**
 * Turning from `a` to `b`, `s` of the way through the change, its signs
 * showing by `w`, 0 to 1, from a minute before it until it starts.
 */
function turning(a: Weather, b: Weather, s: number, w: number): Outlook {
  const eased = smoothstep(0, 1, s);
  const pre = PRE_CLOUDS[b] * w;
  const clouds = mix(a, b, pre + (1 - pre) * eased);
  const rain = (x: Weather) => (x === 'rain' ? 1 : 0);
  return {
    clouds,
    air: mix(a, b, eased),
    rainfall: rain(a) * (1 - s) + rain(b) * s,
    storm: rain(a) * (1 - s) + rain(b) * Math.max(w, s),
    wind: WIND[a] + (WIND[b] - WIND[a]) * (pre + (1 - pre) * eased) + (b === 'rain' ? GUST * w * (1 - eased) : 0),
    // Giving way to the fog's own mist as it comes in.
    mist: b === 'fog' && a !== 'fog' ? PRE_MIST * w * (1 - eased) : 0,
  };
}

/** Seconds for open ground to soak through under full rain, and to dry in each weather. */
const SOAK = 30;
const DRY: Mix = { clear: 180, rain: 600, fog: 480 };
/** Seconds for puddles to fill under full rain, and to drain in each weather. */
const FILL = 90;
const DRAIN: Mix = { clear: 360, rain: 900, fog: 720 };
/** Seconds of the game run through when the clock jumps, as into a death cam, and in what steps. */
const HISTORY = 900;
const STEP = 2;

/**
 * How wet the island is, from the rain that's fallen on it: followed along
 * the game's clock as it runs, and worked out afresh from the forecast when
 * the clock jumps or the forecast changes.
 */
export class Wetting {
  /** Open ground: 0 dry to 1 soaked. */
  wet = 0;
  /** How full the puddles are, 0 to 1. */
  puddles = 0;
  private forecast: Forecast | null = null;
  private time = 0;

  /** Follow `forecast` to `time`. */
  update(forecast: Forecast, time: number): void {
    if (forecast !== this.forecast || time < this.time || time - this.time > STEP) {
      this.forecast = forecast;
      this.wet = this.puddles = 0;
      for (let t = time - HISTORY; t < time; t += STEP) this.step(outlookAt(forecast, t), STEP);
    } else this.step(outlookAt(forecast, time), time - this.time);
    this.time = time;
  }

  private step(o: Outlook, dt: number): void {
    const r = o.rainfall;
    let dry = 0;
    let drain = 0;
    for (const w of WEATHERS) {
      dry += o.air[w] / DRY[w];
      drain += o.air[w] / DRAIN[w];
    }
    this.wet = clamp(this.wet + dt * (r / SOAK - (1 - r) * dry), 0, 1);
    this.puddles = clamp(this.puddles + dt * (r / FILL - (1 - r) * drain), 0, 1);
  }
}
