import { mulberry32 } from './rng.ts';

// The weather over a game. Clear, rain and fog follow each other at random,
// never the same twice running, each for a random while, and every change
// blends over half a minute to a minute. It's worked out from the island's
// seed and the game's clock alone, so the server, its bots, every client and
// a death cam replaying a moment all agree on it without it being sent.

export type Weather = 'clear' | 'rain' | 'fog';

export const WEATHERS: readonly Weather[] = ['clear', 'rain', 'fog'];

export const WEATHER_NAMES: Record<Weather, string> = { clear: 'Clear', rain: 'Rain', fog: 'Fog' };

/** Seconds each weather lasts on average, its change in included: 10 minutes a cycle. */
export const MEAN_LENGTH: Record<Weather, number> = { clear: 300, rain: 180, fog: 120 };
/** How far a weather's length strays from its average either way, as a share of it. */
const LENGTH_SPREAD = 0.4;
/** Seconds a change takes, at least and at most. */
export const CHANGE_MIN = 30;
export const CHANGE_MAX = 60;

/** The weather at a moment: going from one to another, or settled, `from` and `to` the same. */
export interface WeatherNow {
  from: Weather;
  to: Weather;
  /** How far the change has gone, 0 (all `from`) to 1 (all `to`), linearly in time. */
  blend: number;
}

export function settled(w: Weather): WeatherNow {
  return { from: w, to: w, blend: 1 };
}

/** A weather's name as typed, or undefined for anything else. */
export function parseWeather(s: string | null | undefined): Weather | undefined {
  return WEATHERS.find((w) => w === s);
}

/** The weather that has the upper hand: the one coming in once it's halfway. */
export function mainWeather(w: WeatherNow): Weather {
  return w.blend < 0.5 ? w.from : w.to;
}

interface Phase {
  weather: Weather;
  /** Server seconds it starts coming in. */
  start: number;
  /** Server seconds the next one starts coming in. */
  end: number;
  /** Seconds it takes to come in. */
  change: number;
}

/**
 * An island's weather over a game, from its seed: ask it for any moment of the
 * game's clock. Its phases are drawn as far ahead as asked for, in order, so
 * the answer for a moment doesn't depend on what was asked before. `fixed`
 * holds one weather throughout, for tests and the playtest.
 */
export class Forecast {
  private readonly phases: Phase[] = [];
  private readonly rng: () => number;
  private readonly fixed: Weather | undefined;

  constructor(seed: number, fixed?: Weather) {
    this.fixed = fixed;
    this.rng = mulberry32((seed >>> 0) ^ 0x7f4a7c15);
    // A game opens on a clear day, so the island first shows itself in the
    // open, some way through it, so the first change doesn't come at a set time.
    const length = this.length('clear');
    const start = -this.rng() * 0.5 * length;
    this.phases.push({ weather: 'clear', start, end: start + length, change: 0 });
  }

  /** The weather at `time`, server seconds since the game began. */
  at(time: number): WeatherNow {
    if (this.fixed) return settled(this.fixed);
    const phases = this.phases;
    while (phases[phases.length - 1].start <= time) this.extend();
    // The last phase starting by `time`.
    let lo = 0;
    let hi = phases.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (phases[mid].start <= time) lo = mid;
      else hi = mid - 1;
    }
    const p = phases[lo];
    const into = time - p.start;
    if (lo === 0 || into >= p.change) return settled(p.weather);
    return { from: phases[lo - 1].weather, to: p.weather, blend: into / p.change };
  }

  /** The next phase, after the last drawn. */
  private extend(): void {
    const last = this.phases[this.phases.length - 1];
    const others = WEATHERS.filter((w) => w !== last.weather);
    const weather = others[Math.floor(this.rng() * others.length)];
    const start = last.end;
    const change = CHANGE_MIN + this.rng() * (CHANGE_MAX - CHANGE_MIN);
    this.phases.push({ weather, start, end: start + this.length(weather), change });
  }

  /** A random length for a phase of `w`, its change in included. */
  private length(w: Weather): number {
    return MEAN_LENGTH[w] * (1 - LENGTH_SPREAD + 2 * LENGTH_SPREAD * this.rng());
  }
}

/** How the weather changes what bots can sense, as multiples of a clear day's. */
export interface Senses {
  /** Sight range. */
  sight: number;
  /** Radius every noise carries. */
  hearing: number;
}

const HAZE: Record<Weather, number> = { clear: 1, rain: 0.75, fog: 0.4 };
/** Rain drums over footsteps and far-off shots. */
const MUFFLE: Record<Weather, number> = { clear: 1, rain: 0.6, fog: 1 };

/** The senses in `w`, part way between two weathers while one gives way to the next. */
export function sensesOf(w: WeatherNow): Senses {
  const mix = (k: Record<Weather, number>) => k[w.from] + (k[w.to] - k[w.from]) * w.blend;
  return { sight: mix(HAZE), hearing: mix(MUFFLE) };
}
