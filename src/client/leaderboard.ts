import { WEATHERS, type Weather } from '../shared/conditions.ts';
import type { Mode } from '../shared/protocol.ts';

/** Scores kept per island and mode. */
export const BOARD_SIZE = 10;

export interface BoardEntry {
  name: string;
  score: number;
  /** When it was set, as YYYY-MM-DD. */
  date: string;
  /**
   * The weather it was set in; scores from before it was kept have none.
   * Scores set before the game was day only also keep a time of day, which
   * isn't read: they count as set by day.
   */
  weather?: Weather;
}

/** Just the part of localStorage the board uses, so tests can hand it a fake. */
export interface KeyValue {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/**
 * The best runs on each island, per mode, kept in this browser only. With no
 * backend there's nothing to compare against but your own runs and the score
 * a share link brought. One board takes every weather, and each score
 * keeps the weather it was set in.
 */
export class Leaderboard {
  private readonly store: KeyValue | null;

  constructor(store: KeyValue | null) {
    this.store = store;
  }

  /** Best first. */
  entries(seed: number, mode: Mode): BoardEntry[] {
    try {
      // Online plays as Mixed did, so it starts from Mixed's scores.
      const saved = this.store?.getItem(key(seed, mode)) ?? (mode === 'online' ? this.store?.getItem(`board:${seed >>> 0}:mixed`) : null);
      const raw = JSON.parse(saved ?? '[]') as unknown;
      if (!Array.isArray(raw)) return [];
      return raw.filter((e): e is BoardEntry =>
        !!e && typeof e.name === 'string' && typeof e.score === 'number' && typeof e.date === 'string')
        .map(({ name, score, date, weather }) => ({ name, score, date, ...(WEATHERS.includes(weather!) ? { weather } : {}) }));
    } catch {
      return [];
    }
  }

  /** Post a run's score; returns its place, 1 for the best, or 0 if it didn't make the board. */
  add(seed: number, mode: Mode, entry: BoardEntry): number {
    if (entry.score <= 0) return 0;
    const list = this.entries(seed, mode);
    // Ties go to whoever set the score first.
    let place = list.findIndex((e) => e.score < entry.score);
    if (place < 0) place = list.length;
    if (place >= BOARD_SIZE) return 0;
    list.splice(place, 0, entry);
    try {
      this.store?.setItem(key(seed, mode), JSON.stringify(list.slice(0, BOARD_SIZE)));
    } catch {
      // Storage full or blocked: the score just isn't kept.
      return 0;
    }
    return place + 1;
  }

  best(seed: number, mode: Mode): BoardEntry | null {
    return this.entries(seed, mode)[0] ?? null;
  }
}

function key(seed: number, mode: Mode): string {
  return `board:${seed >>> 0}:${mode}`;
}

/**
 * Clear out the boards of modes no longer played: PvE's, left in storage
 * since it became Offline, whose scores don't compare. Returns how many went.
 */
export function dropOldBoards(store: Pick<Storage, 'length' | 'key' | 'removeItem'> | null): number {
  if (!store) return 0;
  try {
    const old: string[] = [];
    for (let i = 0; i < store.length; i++) {
      const k = store.key(i);
      if (k && /^board:\d+:pve$/.test(k)) old.push(k);
    }
    for (const k of old) store.removeItem(k);
    return old.length;
  } catch {
    return 0;
  }
}

/** localStorage, or null where the browser blocks it. */
export function localStore(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}
