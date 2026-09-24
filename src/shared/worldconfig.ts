import { DEFAULT_SEED } from './constants.ts';

/**
 * Everything needed to generate a world. Every peer builds the same island
 * from it, so this is all that travels in a share link or over the network.
 * Settings beyond the seed arrive in later chunks.
 */
export interface WorldConfig {
  seed: number;
}

export const DEFAULT_WORLD: WorldConfig = { seed: DEFAULT_SEED };

/**
 * Reads a `?world=` value. A plain number is used as the seed; any other text
 * is hashed, so `?world=banana` is a valid, stable island. Missing or blank
 * values give the default world.
 */
export function parseWorldParam(value: string | null): WorldConfig {
  const s = value?.trim() ?? '';
  if (s === '') return DEFAULT_WORLD;
  if (/^\d{1,10}$/.test(s) && Number(s) <= 0xffffffff) return { seed: Number(s) };
  return { seed: hashString(s) };
}

export function worldParam(cfg: WorldConfig): string {
  return String(cfg.seed);
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
