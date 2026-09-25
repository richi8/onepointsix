import { clock, summarize, summaryText, type RunRecord } from '../shared/runstats.ts';
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

/** Runs shown one per line in the panel. */
const SHOWN = 12;

/**
 * Debug overlay (toggle with F4) that sums up the run log and lists the
 * latest runs, with buttons to copy it all for sending in and to clear it.
 */
export class RunLogPanel {
  private readonly log: RunLog;
  private readonly root = document.createElement('div');
  private readonly text = document.createElement('pre');

  constructor(log: RunLog, copy: (text: string) => void) {
    this.log = log;
    this.root.className = 'netpanel runlog';
    this.root.hidden = true;
    const copyButton = document.createElement('button');
    copyButton.textContent = 'Copy as JSON';
    copyButton.onclick = () => copy(JSON.stringify(this.log.records(), null, 1));
    const clearButton = document.createElement('button');
    clearButton.textContent = 'Clear';
    clearButton.onclick = () => {
      if (!window.confirm('Delete every logged run?')) return;
      this.log.clear();
      this.render();
    };
    this.root.append(this.text, copyButton, clearButton);
    document.body.append(this.root);
    window.addEventListener('keydown', (e) => {
      if (e.code !== 'F4') return;
      e.preventDefault();
      this.root.hidden = !this.root.hidden;
      this.render();
    });
  }

  /** Redraw, if showing, such as after a run is added. */
  render(): void {
    if (this.root.hidden) return;
    const records = this.log.records();
    const recent = records.slice(0, SHOWN).map((r) => {
      const how = r.outcome === 'extracted' ? `out at ${r.extract}` : r.outcome === 'killed' ? `killed by ${r.cause || '?'}` : 'MIA';
      return `${r.at.slice(5, 16).replace('T', ' ')}  ${r.mode.padEnd(5)} ${clock(r.time).padStart(5)}  ${String(r.score).padStart(6)}  ` +
        `${r.contractsDone}/${r.contracts}  ${how}${r.conditions ? ` (${r.conditions})` : ''}`;
    });
    this.text.textContent = records.length
      ? `Run log (F4)\n${summaryText(summarize(records))}\n\nlatest:  mode  time   score  contracts\n${recent.join('\n')}`
      : 'Run log (F4)\nNo runs yet. Every run you play is logged here.';
  }
}
