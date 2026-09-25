import type { GameEvent, Mode, Team } from './protocol.ts';
import { weaponName } from './weapons.ts';

// What a finished run is remembered by, for tuning: how long it lasted, how it
// ended, what it carried, what it got done and how it got out or died. The
// browser keeps the player's own runs; the headless playtest collects the
// bots'. Both are summed up the same way, so they can be compared.

export type RunEndEvent = Extract<GameEvent, { k: 'runEnd' }>;

export interface RunRecord {
  /** When it ended, as an ISO date and time. */
  at: string;
  seed: number;
  mode: Mode;
  outcome: 'extracted' | 'killed' | 'mia';
  /** Seconds it lasted. */
  time: number;
  score: number;
  /** What the loot carried at the end was worth, extracted or not. */
  value: number;
  kills: number;
  guardKills: number;
  contracts: number;
  contractsDone: number;
  /** Where they got out, by extraction point name, or ''. */
  extract: string;
  /** What killed them, such as "guard, Assault rifle, head", or ''. */
  cause: string;
}

/** A run's record, from how it ended. `extractName` names an extraction point by index. */
export function runRecord(
  e: RunEndEvent, seed: number, mode: Mode, extractName: (index: number) => string, at = new Date(),
): RunRecord {
  return {
    at: at.toISOString(),
    seed,
    mode,
    outcome: e.outcome,
    time: Math.round(e.time),
    score: e.score,
    value: e.value,
    kills: e.kills,
    guardKills: e.guardKills,
    contracts: e.contracts.length,
    contractsDone: e.contracts.filter((c) => c.state === 'done').length,
    extract: e.extract >= 0 ? extractName(e.extract) : '',
    cause: e.death ? causeOf(e.death) : '',
  };
}

function causeOf(d: { by: Team | 'self'; weapon: number; head: boolean }): string {
  return [d.by, weaponName(d.weapon), ...(d.head ? ['head'] : [])].join(', ');
}

export interface RunSummary {
  runs: number;
  /** Share of runs, 0 to 1. */
  extracted: number;
  killed: number;
  mia: number;
  /** Seconds, over all runs, and over extracted ones. */
  meanTime: number;
  medianTime: number;
  meanExtractTime: number;
  /** Over extracted runs. */
  meanScore: number;
  /** Loot carried at the end, over all runs. */
  meanValue: number;
  /** Share of contracts handed out that got done. */
  contractsDone: number;
  /** Counts, most common first. */
  causes: [string, number][];
  extracts: [string, number][];
}

export function summarize(records: readonly RunRecord[]): RunSummary {
  const n = records.length;
  const out = records.filter((r) => r.outcome === 'extracted');
  const share = (o: RunRecord['outcome']) => (n ? records.filter((r) => r.outcome === o).length / n : 0);
  const contracts = records.reduce((s, r) => s + r.contracts, 0);
  return {
    runs: n,
    extracted: share('extracted'),
    killed: share('killed'),
    mia: share('mia'),
    meanTime: mean(records.map((r) => r.time)),
    medianTime: median(records.map((r) => r.time)),
    meanExtractTime: mean(out.map((r) => r.time)),
    meanScore: mean(out.map((r) => r.score)),
    meanValue: mean(records.map((r) => r.value)),
    contractsDone: contracts ? records.reduce((s, r) => s + r.contractsDone, 0) / contracts : 0,
    causes: tally(records.map((r) => r.cause).filter(Boolean)),
    extracts: tally(out.map((r) => r.extract)),
  };
}

/** The summary as a few lines of text. */
export function summaryText(s: RunSummary): string {
  const pct = (f: number) => `${Math.round(f * 100)}%`;
  const list = (rows: [string, number][]) => rows.map(([k, v]) => `  ${v} × ${k}`).join('\n') || '  none';
  return [
    `${s.runs} runs: ${pct(s.extracted)} extracted, ${pct(s.killed)} killed, ${pct(s.mia)} MIA`,
    `length: mean ${clock(s.meanTime)}, median ${clock(s.medianTime)}, extracted runs ${clock(s.meanExtractTime)}`,
    `score when extracted: ${Math.round(s.meanScore)}; loot carried at the end: ${Math.round(s.meanValue)}`,
    `contracts done: ${pct(s.contractsDone)}`,
    `killed by:\n${list(s.causes)}`,
    `got out at:\n${list(s.extracts)}`,
  ].join('\n');
}

export function clock(seconds: number): string {
  const s = Math.max(Math.round(seconds), 0);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function tally(xs: string[]): [string, number][] {
  const m = new Map<string, number>();
  for (const x of xs) m.set(x, (m.get(x) ?? 0) + 1);
  return [...m].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}
