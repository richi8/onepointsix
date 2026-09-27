// A bot playtest: runs Mixed games on several islands in Node and sums up
// every operator bot's run the same way the browser sums up the player's, so
// the tuning numbers can be checked without anyone playing. It also splits the
// runs by how the bot played (skill, weapon, how much it was willing to
// carry), to see whether one way of playing wins out. With --thorough, one
// operator bot at a time loots as many crates as a person tends to and can't
// be killed, so the length of a run that isn't cut short by death can be read.
// Usage: npm run playtest [minutes per island] [islands] [first seed] [time] [weather] [--thorough]

import { SERVER_TICK_RATE } from '../shared/constants.ts';
import { parseWorldParam } from '../shared/worldconfig.ts';
import { extractName } from '../shared/loot.ts';
import { runRecord, summarize, summaryText, type RunRecord } from '../shared/runstats.ts';
import { WEAPONS } from '../shared/weapons.ts';
import { MODES } from './directory.ts';
import { tally } from './bot.ts';
import { dropIns, type BotPlan } from './population.ts';
import { GameServer } from './server.ts';

declare const process: { argv: string[] };

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const thorough = process.argv.includes('--thorough');
const minutes = Number(args[0] ?? 30);
const islands = Number(args[1] ?? 6);
const firstSeed = Number(args[2] ?? 1);
const { time, weather } = parseWorldParam(null, args[3] ?? null, args[4] ?? null);

interface Played {
  record: RunRecord;
  plan: BotPlan;
}

const played: Played[] = [];
const kills = new Map<string, number>();
/** Operators who became the bounty, and how their runs ended. */
const bounty = { held: 0, killed: 0, extracted: 0 };
/** Runs still going when each game stopped. */
let unfinished = 0;
const start = performance.now();
for (let seed = firstSeed; seed < firstSeed + islands; seed++) {
  // Thorough bots can't be killed, so they play alone rather than fight each other forever.
  const server = new GameServer(seed, { ...MODES.offline.options, conditions: { time, weather }, ...(thorough ? { thorough, operators: 1 } : {}) });
  const names = server.world.extracts.map((_, i) => extractName(server.world, i));
  server.onRunEnd = (e, plan) => {
    if (plan) played.push({ record: runRecord(e, { seed, time, weather }, 'offline', (i) => names[i]), plan });
  };
  let holder = 0;
  server.onEvent = (e) => {
    if (e.k === 'bounty') {
      if (e.id && e.id !== holder) bounty.held++;
      holder = e.id;
    }
    if (e.k === 'extract' && e.id === holder) bounty.extracted++;
    if (e.k !== 'kill') return;
    if (e.bounty) bounty.killed++;
    const team = (id: number) => server.bots().find((b) => b.id === id)?.team ?? '?';
    const key = `${team(e.killer)} killed ${team(e.victim)}`;
    kills.set(key, (kills.get(key) ?? 0) + 1);
  };
  const ticks = minutes * 60 * SERVER_TICK_RATE;
  for (let t = 0; t < ticks; t++) server.step();
  unfinished += server.runsGoing();
}
const seconds = (performance.now() - start) / 1000;

console.log(
  `${islands} islands from seed ${firstSeed} (${time}, ${weather})${thorough ? ', thorough looting' : ''}, ${minutes} min each, ` +
  `simulated in ${seconds.toFixed(0)} s`,
);
console.log(
  `${unfinished} runs still going when the games stopped are left out (${Math.round((unfinished / (played.length + unfinished)) * 100)}% of runs), ` +
  'so long runs are slightly undercounted.\n',
);
console.log(summaryText(summarize(played.map((p) => p.record))));
console.log(`\nbounties: ${bounty.held} (${(bounty.held / ((islands * minutes) / 60)).toFixed(0)} per hour), ${bounty.killed} killed, ${bounty.extracted} got out`);
console.log(`kills per hour of game: ${[...kills].map(([k, n]) => `${k} ${(n / ((islands * minutes) / 60)).toFixed(0)}`).join(', ')}`);
const share = (n: number, of: number) => `${n} of ${of} (${of ? Math.round((n / of) * 100) : 0}%)`;
console.log(
  `stealth: hid from a threat in a bush ${share(tally.bushCovers, tally.covers)}, waited in a bush ${share(tally.bushWaits, tally.waits)}; ` +
  `fights joined ${tally.joins}, guessed ${tally.joins ? (tally.guessOff / tally.joins).toFixed(1) : '-'} m off the shooter on average; ` +
  `camps blind to their extraction point ${share(tally.blindCamps, tally.camps)}, ${tally.campFixes} later moved to one that could see`,
);
console.log(`drop-ins with no spot clear of outposts and other operators, so anywhere: ${share(dropIns.anywhere, dropIns.picked)}`);

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

compare('personality', (p) => (p.plan.role.kind === 'operator' ? (p.plan.role.personality ?? '?') : '?'));
compare('skill', (p) => p.plan.skill);
compare('weapon', (p) => WEAPONS[p.plan.primary].name);
compare('greed', (p) => {
  const g = p.plan.role.kind === 'operator' ? p.plan.role.greed : 0;
  return g < 20 ? 'light (< 20 kg)' : g < 28 ? 'medium' : 'heavy (28+ kg)';
});
compare('loot stops', (p) => (p.plan.role.kind === 'operator' ? `${p.plan.role.loot.length} crates` : '?'));
