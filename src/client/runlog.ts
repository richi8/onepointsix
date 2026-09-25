import type { RunRecord } from '../shared/runstats.ts';
import type { KeyValue } from './leaderboard.ts';

/** Runs kept, newest first; older ones drop off. */
export const LOG_SIZE = 200;
const KEY = 'runlog';

/**
 * Every run played in this browser, for tuning the game from playtests:
 * how long it lasted, how it ended, what it carried and got done.
 */
export class RunLog {
  private readonly store: KeyValue | null;

  constructor(store: KeyValue | null) {
    this.store = store;
  }

  /** Newest first. */
  records(): RunRecord[] {
    try {
      const raw = JSON.parse(this.store?.getItem(KEY) ?? '[]') as unknown;
      if (!Array.isArray(raw)) return [];
      return raw.filter((r): r is RunRecord =>
        !!r && typeof r.outcome === 'string' && typeof r.time === 'number' && typeof r.score === 'number');
    } catch {
      return [];
    }
  }

  add(record: RunRecord): void {
    this.save([record, ...this.records()].slice(0, LOG_SIZE));
  }

  clear(): void {
    this.save([]);
  }

  private save(records: RunRecord[]): void {
    try {
      this.store?.setItem(KEY, JSON.stringify(records));
    } catch {
      // Storage full or blocked: the run just isn't logged.
    }
  }
}
