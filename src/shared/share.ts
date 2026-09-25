import type { Mode } from './protocol.ts';
import { parseWorldParam, worldParams, type WorldConfig } from './worldconfig.ts';

/** Longest player name kept, in characters. */
export const NAME_MAX = 16;
/** Scores in links above this are taken as made up. */
const SCORE_MAX = 10_000_000;

/** A score to beat, carried by a share link. */
export interface Challenge {
  name: string;
  score: number;
}

/**
 * What a share link says: the island and its conditions, the mode to play it in, and who shared
 * it with what score. With no backend, the link is the only way a score
 * travels, so anyone could edit it; it's a friendly challenge, not a record.
 */
export interface ShareLink {
  world: WorldConfig;
  mode: Mode | null;
  challenge: Challenge | null;
}

export function parseShareLink(search: string): ShareLink {
  const q = new URLSearchParams(search);
  const m = q.get('mode');
  const mode = m === 'mixed' || m === 'pve' || m === 'range' ? m : null;
  const name = cleanName(q.get('by') ?? '');
  const s = q.get('score') ?? '';
  const score = /^\d{1,8}$/.test(s) ? Number(s) : NaN;
  const challenge = name && score > 0 && score <= SCORE_MAX && mode !== 'range' ? { name, score } : null;
  return { world: parseWorldParam(q.get('world'), q.get('time'), q.get('weather')), mode, challenge };
}

/** The query string of a link to an island in its conditions, optionally in a mode and with a score to beat. */
export function shareQuery(world: WorldConfig, mode?: Mode, challenge?: Challenge): string {
  const q = new URLSearchParams(worldParams(world));
  if (mode) q.set('mode', mode);
  if (challenge && challenge.score > 0) {
    q.set('by', cleanName(challenge.name) || 'someone');
    q.set('score', String(Math.min(Math.round(challenge.score), SCORE_MAX)));
  }
  return `?${q}`;
}

/** A name as shown to others: printable, single-spaced and short. */
export function cleanName(name: string): string {
  return [...name.replace(/[\p{C}]/gu, '').replace(/\s+/g, ' ').trim()].slice(0, NAME_MAX).join('').trim();
}
