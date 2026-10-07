import { mapFor } from '../shared/maps/index.ts';
import { isDeathmatch, type Mode } from '../shared/protocol.ts';

/** Scores kept per island and mode. */
export const BOARD_SIZE = 10;

export interface BoardEntry {
  name: string;
  /** A run's score; for a Deathmatch game, its kills. */
  score: number;
  /** For a Deathmatch game, its deaths: fewer rank higher on the same kills. */
  deaths?: number;
  /** When it was set, as YYYY-MM-DD. */
  date: string;
}

/** Just the part of localStorage the board uses, so tests can hand it a fake. */
export interface KeyValue {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/**
 * The best runs on each island, per mode, kept in this browser only. With no
 * backend there's nothing to compare against but your own runs and the score
 * a share link brought. Scores set before the weather changed during a game
 * also keep the weather they were set in, and older ones a time of day, which
 * are dropped as they're read.
 */
export class Leaderboard {
  private readonly store: KeyValue | null;

  constructor(store: KeyValue | null) {
    this.store = store;
  }

  /** Best first. */
  entries(seed: number, mode: Mode): BoardEntry[] {
    // Extraction plays as Online did, and Online as Mixed, so it starts from their scores.
    return this.entriesAt(boardKey(seed, mode), ...(mode === 'extraction' ? [`board:${seed >>> 0}:online`, `board:${seed >>> 0}:mixed`] : []));
  }

  /** The board kept under `at`, or else under the first of `fallbacks` there is. */
  entriesAt(at: string, ...fallbacks: string[]): BoardEntry[] {
    try {
      let saved = this.store?.getItem(at) ?? null;
      for (const k of fallbacks) saved ??= this.store?.getItem(k) ?? null;
      const raw = JSON.parse(saved ?? '[]') as unknown;
      if (!Array.isArray(raw)) return [];
      return raw.filter((e): e is BoardEntry =>
        !!e && typeof e.name === 'string' && typeof e.score === 'number' && typeof e.date === 'string')
        .map(({ name, score, date, deaths }) => ({ name, score, date, ...(typeof deaths === 'number' ? { deaths } : {}) }));
    } catch {
      return [];
    }
  }

  /** Post a run's score; returns its place, 1 for the best, or 0 if it didn't make the board. */
  add(seed: number, mode: Mode, entry: BoardEntry): number {
    if (entry.score <= 0) return 0;
    const list = this.entries(seed, mode);
    // Ties go to fewer deaths, then to whoever set the score first.
    let place = list.findIndex((e) => e.score < entry.score || (e.score === entry.score && (e.deaths ?? 0) > (entry.deaths ?? 0)));
    if (place < 0) place = list.length;
    if (place >= BOARD_SIZE) return 0;
    list.splice(place, 0, entry);
    try {
      this.store?.setItem(boardKey(seed, mode), JSON.stringify(list.slice(0, BOARD_SIZE)));
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

/**
 * Where a board is kept: by the island's seed, or for a mode played on a
 * fixed map, by the map, whatever the seed. Deathmatch moved to one on
 * 2026-10-03, so its board started afresh there: the games played on the
 * islands stay under their seeds, not read and not mixed in.
 */
export function boardKey(seed: number, mode: Mode): string {
  const map = mapFor(mode);
  // Both Deathmatches keep their boards as Deathmatch's, under their maps: the old town's is the one it had.
  return map ? `board:${map.id}:${isDeathmatch(mode) ? 'deathmatch' : mode}` : `board:${seed >>> 0}:${mode}`;
}

/**
 * Tidy the boards of modes no longer played. PvE's, left in storage since it became Offline,
 * don't compare and are dropped. Online is now Extraction, and Offline played as Online did, so
 * their scores join Extraction's board, best first. Returns how many old boards went.
 */
export function dropOldBoards(store: Pick<Storage, 'length' | 'key' | 'getItem' | 'setItem' | 'removeItem'> | null): number {
  if (!store) return 0;
  try {
    const old: string[] = [];
    for (let i = 0; i < store.length; i++) {
      const k = store.key(i);
      if (k && /^board:\d+:(pve|offline|online)$/.test(k)) old.push(k);
    }
    const board = new Leaderboard(store);
    for (const k of old) {
      const [, seed, mode] = k.split(':');
      if (mode !== 'pve') {
        // Extraction's board may still be read from Online's, so the same run can come twice.
        const seen = new Set<string>();
        const merged = [...board.entries(Number(seed), 'extraction'), ...board.entriesAt(k)]
          .filter((e) => {
            const id = `${e.name}|${e.score}|${e.date}`;
            return !seen.has(id) && !!seen.add(id);
          })
          .sort((a, b) => b.score - a.score || a.date.localeCompare(b.date));
        store.setItem(boardKey(Number(seed), 'extraction'), JSON.stringify(merged.slice(0, BOARD_SIZE)));
      }
      store.removeItem(k);
    }
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
