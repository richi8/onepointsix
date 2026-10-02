import { clock, summarize, type RunRecord } from '../shared/runstats.ts';
import { DEFAULT_WORLD } from '../shared/worldconfig.ts';

/** What an exported run log says it is. */
export const RUNS_FORMAT = 'onepointsix-runs';
/** The newest runs listed one by one under the summary. */
const RECENT = 10;
/** The most common causes of death and extraction points listed. */
const TOP = 5;

/**
 * The menu's stats page: every run the run log holds, summed up the way the
 * bot playtest sums up the bots', then the newest one by one.
 */
export function renderStats(root: HTMLElement, records: readonly RunRecord[]): void {
  const s = summarize(records);
  const pct = (f: number) => `${Math.round(f * 100)}%`;
  (root.querySelector('.empty') as HTMLElement).hidden = records.length > 0;
  (root.querySelector('.summary') as HTMLElement).hidden = !records.length;
  (root.querySelector('.export') as HTMLButtonElement).disabled = !records.length;
  root.querySelector('.note')!.textContent = records.length
    ? `${records.length} run${records.length > 1 ? 's' : ''} played in this browser since ${shortDate(records.at(-1)!.at)}`
    : 'Runs you play are kept here, in this browser.';
  if (!records.length) return;

  const tiles: [string, string][] = [
    ['Runs', String(s.runs)],
    ['Extracted', pct(s.extracted)],
    ['Killed', pct(s.killed)],
    ['MIA', pct(s.mia)],
  ];
  root.querySelector('.tiles')!.replaceChildren(...tiles.map(([k, v]) => {
    const div = document.createElement('div');
    const b = document.createElement('b');
    b.textContent = v;
    const span = document.createElement('span');
    span.textContent = k;
    div.append(b, span);
    return div;
  }));

  const best = Math.max(...records.map((r) => r.score));
  const rows: [string, string][] = [
    ['Run length', `median ${clock(s.medianTime)} · mean ${clock(s.meanTime)}`],
    ['Extracted runs', s.extracted ? `mean ${clock(s.meanExtractTime)} · score ${Math.round(s.meanScore).toLocaleString('en-US')}` : '—'],
    ['Best score', best > 0 ? best.toLocaleString('en-US') : '—'],
    ['Loot carried at the end', `$${Math.round(s.meanValue).toLocaleString('en-US')} on average`],
    ['Contracts done', pct(s.contractsDone)],
  ];
  const dl = root.querySelector('dl')!;
  dl.replaceChildren(...rows.flatMap(([k, v]) => {
    const dt = document.createElement('dt');
    dt.textContent = k;
    const dd = document.createElement('dd');
    dd.textContent = v;
    return [dt, dd];
  }));

  list(root.querySelector('.causes')!, s.causes.slice(0, TOP).map(([k, n]) => `${n} × ${k}`), 'Nobody has killed you yet.');
  list(root.querySelector('.exits')!, s.extracts.slice(0, TOP).map(([k, n]) => `${n} × ${k}`), 'You haven’t got out yet.');
  list(root.querySelector('.recent')!, records.slice(0, RECENT).map(recentLine), '');
}

/** One run in a line: how it went, where, in what, how long and when. */
function recentLine(r: RunRecord): string {
  const how = r.outcome === 'extracted' ? `Extracted · ${r.score.toLocaleString('en-US')}`
    : r.outcome === 'killed' ? `Killed${r.cause ? ` · ${r.cause}` : ''}` : 'Missing in action';
  const island = r.seed === DEFAULT_WORLD.seed ? 'Default island' : `Island #${r.seed}`;
  const when = r.conditions ? r.conditions[0].toUpperCase() + r.conditions.slice(1) : 'Clear';
  return [how, island, when, clock(r.time), shortDate(r.at)].join(' · ');
}

function list(ul: Element, lines: string[], none: string): void {
  const items = (lines.length ? lines : none ? [none] : []).map((line) => {
    const li = document.createElement('li');
    li.textContent = line;
    return li;
  });
  ul.replaceChildren(...items);
}

function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

/** The run log as a file to send: every run, and the build it was played on. */
export function exportRuns(records: readonly RunRecord[], build: string): void {
  const file = { format: RUNS_FORMAT, version: 2, build, exported: new Date().toISOString(), runs: records };
  const url = URL.createObjectURL(new Blob([JSON.stringify(file, null, 1)], { type: 'application/json' }));
  const a = document.createElement('a');
  const d = new Date();
  a.href = url;
  a.download = `onepointsix-runs-${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
