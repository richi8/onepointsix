import type { Mode } from '../shared/protocol.ts';

/** Scores kept per island and mode. */
export const BOARD_SIZE = 10;

export interface BoardEntry {
  name: string;
  score: number;
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
 * a share link brought.
 */
export class Leaderboard {
  private readonly store: KeyValue | null;

  constructor(store: KeyValue | null) {
    this.store = store;
  }

  /** Best first. */
  entries(seed: number, mode: Mode): BoardEntry[] {
    try {
      const raw = JSON.parse(this.store?.getItem(key(seed, mode)) ?? '[]') as unknown;
      if (!Array.isArray(raw)) return [];
      return raw.filter((e): e is BoardEntry =>
        !!e && typeof e.name === 'string' && typeof e.score === 'number' && typeof e.date === 'string');
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

/** localStorage, or null where the browser blocks it. */
export function localStore(): KeyValue | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}
