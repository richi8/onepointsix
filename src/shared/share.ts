import { parseMode, type Mode } from './protocol.ts';
import { DEFAULT_WORLD, parseWorldParam, worldParams, type WorldConfig } from './worldconfig.ts';

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
 * What a share link says: the island, the mode to play it in, whether its
 * games are private, and who shared it with what score. With no backend, the
 * link is the only way a score travels, so anyone could edit it; it's a
 * friendly challenge, not a record.
 */
export interface ShareLink {
  world: WorldConfig;
  mode: Mode | null;
  /** Only players with the link join its games; quick join never puts anyone else there. */
  private: boolean;
  challenge: Challenge | null;
}

export function parseShareLink(search: string): ShareLink {
  const q = new URLSearchParams(search);
  const mode = parseMode(q.get('mode'));
  const name = cleanName(q.get('by') ?? '');
  const s = q.get('score') ?? '';
  const score = /^\d{1,8}$/.test(s) ? Number(s) : NaN;
  const challenge = name && score > 0 && score <= SCORE_MAX ? { name, score } : null;
  return { world: parseWorldParam(q.get('world')), mode, private: q.get('private') === '1', challenge };
}

/** The query string of a link to an island, optionally in a mode, private, and with a score to beat. */
export function shareQuery(world: WorldConfig, mode?: Mode, challenge?: Challenge, isPrivate = false): string {
  const q = new URLSearchParams(worldParams(world));
  if (mode) q.set('mode', mode);
  if (isPrivate) q.set('private', '1');
  if (challenge && challenge.score > 0) {
    q.set('by', cleanName(challenge.name) || 'someone');
    q.set('score', String(Math.min(Math.round(challenge.score), SCORE_MAX)));
  }
  return `?${q}`;
}

/** A new island for a private link: a random seed, never the default one. */
export function freshWorld(): WorldConfig {
  const seed = crypto.getRandomValues(new Uint32Array(1))[0];
  return seed === DEFAULT_WORLD.seed ? freshWorld() : { seed };
}

/** A name as shown to others: printable, single-spaced and short. */
export function cleanName(name: string): string {
  return [...name.replace(/[\p{C}]/gu, '').replace(/\s+/g, ' ').trim()].slice(0, NAME_MAX).join('').trim();
}
