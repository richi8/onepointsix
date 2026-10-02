import { DEFAULT_CONDITIONS, WEATHERS, type Conditions, type Weather } from './conditions.ts';
import { DEFAULT_SEED } from './constants.ts';

/**
 * Everything needed to generate a world and set up a game on it. Every peer
 * builds the same island from it, so this is all that travels in a share
 * link or over the network. The seed shapes the island; the weather sets the
 * conditions it's played in.
 */
export interface WorldConfig extends Conditions {
  seed: number;
}

export const DEFAULT_WORLD: WorldConfig = { seed: DEFAULT_SEED, ...DEFAULT_CONDITIONS };

/**
 * Reads a `?world=` value. A plain number is used as the seed; any other text
 * is hashed, so `?world=banana` is a valid, stable island. Missing or blank
 * values give the default world. The conditions come from `weather`, falling
 * back to clear for anything missing or unknown. Links from before the game
 * was day only also carry a `time`, which is ignored: they open by day.
 */
export function parseWorldParam(value: string | null, weather: string | null = null): WorldConfig {
  const s = value?.trim() ?? '';
  const conditions: Conditions = {
    weather: WEATHERS.includes(weather as Weather) ? (weather as Weather) : DEFAULT_CONDITIONS.weather,
  };
  if (s === '') return { ...DEFAULT_WORLD, ...conditions };
  if (/^\d{1,10}$/.test(s) && Number(s) <= 0xffffffff) return { seed: Number(s), ...conditions };
  return { seed: hashString(s), ...conditions };
}

/** Query parameters for a world: the seed, plus the weather unless it's clear. */
export function worldParams(cfg: WorldConfig): Record<string, string> {
  const q: Record<string, string> = { world: String(cfg.seed) };
  if (cfg.weather !== DEFAULT_CONDITIONS.weather) q.weather = cfg.weather;
  return q;
}

/** Whether two configs describe the same game: island and conditions. */
export function sameWorld(a: WorldConfig, b: WorldConfig): boolean {
  return a.seed >>> 0 === b.seed >>> 0 && a.weather === b.weather;
}

/** FNV-1a, 32-bit. */
function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
