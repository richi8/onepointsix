// The weather an island is played in. It's part of the world config, so a
// link carries it and every peer plays the same conditions. It changes
// nothing about the island's shape, only how far everyone sees and hears.

export type Weather = 'clear' | 'rain' | 'fog';

export const WEATHERS: readonly Weather[] = ['clear', 'rain', 'fog'];

export interface Conditions {
  weather: Weather;
}

export const DEFAULT_CONDITIONS: Conditions = { weather: 'clear' };

/** How the conditions change what bots can sense, as multiples of a clear day's. */
export interface Senses {
  /** Sight range. */
  sight: number;
  /** Radius every noise carries. */
  hearing: number;
}

const HAZE: Record<Weather, number> = { clear: 1, rain: 0.75, fog: 0.4 };
/** Rain drums over footsteps and far-off shots. */
const MUFFLE: Record<Weather, number> = { clear: 1, rain: 0.6, fog: 1 };

export function sensesOf(c: Conditions): Senses {
  return { sight: HAZE[c.weather], hearing: MUFFLE[c.weather] };
}

export const WEATHER_NAMES: Record<Weather, string> = { clear: 'Clear', rain: 'Rain', fog: 'Fog' };

/** "Fog", or "" for a clear day. */
export function conditionsLabel(c: Conditions): string {
  return c.weather === 'clear' ? '' : WEATHER_NAMES[c.weather];
}
