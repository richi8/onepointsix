// A bot playtest: runs Mixed games on several islands in Node and sums up
// every operator bot's run the same way the browser sums up the player's, so
// the tuning numbers can be checked without anyone playing. It also splits the
// runs by how the bot played (skill, weapon, how much it was willing to
// carry), to see whether one way of playing wins out.
// Usage: npm run playtest [minutes per island] [islands] [first seed] [time] [weather]

import { SERVER_TICK_RATE } from '../shared/constants.ts';
import { parseWorldParam } from '../shared/worldconfig.ts';
import { extractName } from '../shared/loot.ts';
import { runRecord, summarize, summaryText, type RunRecord } from '../shared/runstats.ts';
import { WEAPONS } from '../shared/weapons.ts';
import { MODES } from './directory.ts';
import type { BotPlan } from './population.ts';
import { GameServer } from './server.ts';

declare const process: { argv: string[] };

const minutes = Number(process.argv[2] ?? 30);
const islands = Number(process.argv[3] ?? 6);
const firstSeed = Number(process.argv[4] ?? 1);
const { time, weather } = parseWorldParam(null, process.argv[5] ?? null, process.argv[6] ?? null);

interface Played {
  record: RunRecord;
  plan: BotPlan;
}

const played: Played[] = [];
const kills = new Map<string, number>();
const start = performance.now();
for (let seed = firstSeed; seed < firstSeed + islands; seed++) {
  const server = new GameServer(seed, { ...MODES.mixed.options, conditions: { time, weather } });
  const names = server.world.extracts.map((_, i) => extractName(server.world, i));
  server.onRunEnd = (e, plan) => {
    if (plan) played.push({ record: runRecord(e, { seed, time, weather }, 'mixed', (i) => names[i]), plan });
  };
  server.onEvent = (e) => {
    if (e.k !== 'kill') return;
    const team = (id: number) => server.bots().find((b) => b.id === id)?.team ?? '?';
    const key = `${team(e.killer)} killed ${team(e.victim)}`;
    kills.set(key, (kills.get(key) ?? 0) + 1);
  };
  const ticks = minutes * 60 * SERVER_TICK_RATE;
  for (let t = 0; t < ticks; t++) server.step();
}
const seconds = (performance.now() - start) / 1000;

console.log(`${islands} islands from seed ${firstSeed} (${time}, ${weather}), ${minutes} min each, simulated in ${seconds.toFixed(0)} s`);
console.log('Runs still going when the game stopped are left out, so long runs are slightly undercounted.\n');
console.log(summaryText(summarize(played.map((p) => p.record))));
console.log(`\nkills per hour of game: ${[...kills].map(([k, n]) => `${k} ${(n / ((islands * minutes) / 60)).toFixed(0)}`).join(', ')}`);

/** One line per group of runs, to compare ways of playing. */
function compare(title: string, key: (p: Played) => string): void {
  const groups = new Map<string, RunRecord[]>();
  for (const p of played) {
    const k = key(p);
    groups.set(k, [...(groups.get(k) ?? []), p.record]);
  }
  console.log(`\nby ${title}:`);
  for (const [k, records] of [...groups].sort()) {
    const s = summarize(records);
    const pct = (f: number) => `${Math.round(f * 100)}%`.padStart(4);
    // What a run is worth on average, dying counting as zero.
    const expected = records.reduce((sum, r) => sum + r.score, 0) / records.length;
    console.log(
      `  ${k.padEnd(18)} ${String(s.runs).padStart(4)} runs  out ${pct(s.extracted)}  killed ${pct(s.killed)}  mia ${pct(s.mia)}  ` +
      `mean ${fmt(s.meanTime)}  score if out ${String(Math.round(s.meanScore)).padStart(5)}  per run ${String(Math.round(expected)).padStart(5)}`,
    );
  }
}

function fmt(t: number): string {
  return `${Math.floor(t / 60)}:${String(Math.round(t % 60)).padStart(2, '0')}`;
}

compare('skill', (p) => p.plan.skill);
compare('weapon', (p) => WEAPONS[p.plan.primary].name);
compare('greed', (p) => {
  const g = p.plan.role.kind === 'operator' ? p.plan.role.greed : 0;
  return g < 20 ? 'light (< 20 kg)' : g < 28 ? 'medium' : 'heavy (28+ kg)';
});
compare('loot stops', (p) => (p.plan.role.kind === 'operator' ? `${p.plan.role.loot.length} crates` : '?'));
