// The time of day and the weather an island is played in. They're part of the
// world config, so a link carries them and every peer plays the same
// conditions. They change nothing about the island's shape, only how far
// everyone sees and hears, who guards it and what the crates hold.

export type TimeOfDay = 'day' | 'dusk' | 'night';
export type Weather = 'clear' | 'rain' | 'fog';

export const TIMES: readonly TimeOfDay[] = ['day', 'dusk', 'night'];
export const WEATHERS: readonly Weather[] = ['clear', 'rain', 'fog'];

export interface Conditions {
  time: TimeOfDay;
  weather: Weather;
}

export const DEFAULT_CONDITIONS: Conditions = { time: 'day', weather: 'clear' };

/** How the conditions change what bots can sense, as multiples of a clear day's. */
export interface Senses {
  /** Sight range for an unlit target in these conditions. */
  sight: number;
  /** Sight range limit from the weather alone, which a flashlight doesn't help with. */
  haze: number;
  /** Radius every noise carries. */
  hearing: number;
  /** Too dark to see far without a light: flashlights work and give their holders away. */
  dark: boolean;
  /** Dark enough that guards need their flashlights. */
  night: boolean;
}

const DARKNESS: Record<TimeOfDay, number> = { day: 1, dusk: 0.7, night: 0.35 };
const HAZE: Record<Weather, number> = { clear: 1, rain: 0.75, fog: 0.4 };
/** Rain drums over footsteps and far-off shots. */
const MUFFLE: Record<Weather, number> = { clear: 1, rain: 0.6, fog: 1 };

export function sensesOf(c: Conditions): Senses {
  const haze = HAZE[c.weather];
  return { sight: DARKNESS[c.time] * haze, haze, hearing: MUFFLE[c.weather], dark: c.time !== 'day', night: c.time === 'night' };
}

/** Night brings more and tougher guards, and better loot to make it worth it. */
export function isNight(c: Conditions): boolean {
  return c.time === 'night';
}

export const TIME_NAMES: Record<TimeOfDay, string> = { day: 'Day', dusk: 'Dusk', night: 'Night' };
export const WEATHER_NAMES: Record<Weather, string> = { clear: 'Clear', rain: 'Rain', fog: 'Fog' };

/** "Night, fog", or "" for a clear day. */
export function conditionsLabel(c: Conditions): string {
  const parts: string[] = [];
  if (c.time !== 'day') parts.push(TIME_NAMES[c.time]);
  if (c.weather !== 'clear') parts.push(WEATHER_NAMES[c.weather]);
  return parts.join(', ');
}
