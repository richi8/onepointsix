// Runs the game server in Node with its full population of bots and no
// browser, to prove the server has no browser dependencies and to see how the
// bots play and what they cost. Usage: npm run sim [seconds] [seed]

import { OPERATOR_CAPACITY, SERVER_TICK_RATE } from '../shared/constants.ts';
import { DEFAULT_WORLD } from '../shared/worldconfig.ts';
import { GameServer } from './server.ts';

declare const process: { argv: string[] };

const seconds = Number(process.argv[2] ?? 60);
const seed = Number(process.argv[3] ?? DEFAULT_WORLD.seed);
const server = new GameServer(seed, { guards: true, operators: OPERATOR_CAPACITY });
const counts = { kills: 0, headshots: 0, extracts: 0 };
const killers = new Map<string, number>();
server.onEvent = (e) => {
  if (e.k === 'kill') {
    counts.kills++;
    if (e.head) counts.headshots++;
    const team = server.bots().find((b) => b.id === e.killer)?.team ?? 'player';
    const victim = server.bots().find((b) => b.id === e.victim)?.team ?? 'player';
    const key = `${team} killed ${victim}`;
    killers.set(key, (killers.get(key) ?? 0) + 1);
  }
  if (e.k === 'extract') {
    counts.extracts++;
    console.log(`${(server.tick / SERVER_TICK_RATE).toFixed(0).padStart(4)}s  ${e.name} extracted with ${e.carry} kg`);
  }
};

const ticks = seconds * SERVER_TICK_RATE;
let worst = 0;
const start = performance.now();
for (let tick = 0; tick < ticks; tick++) {
  const t = performance.now();
  server.step();
  worst = Math.max(worst, performance.now() - t);
}
const total = performance.now() - start;

const states = new Map<string, number>();
for (const b of server.bots()) states.set(b.bot.state, (states.get(b.bot.state) ?? 0) + 1);
console.log(`simulated ${seconds} s (${ticks} ticks) of seed ${seed} in ${(total / 1000).toFixed(1)} s`);
console.log(`tick: ${(total / ticks).toFixed(2)} ms average, ${worst.toFixed(1)} ms worst, budget ${(1000 / SERVER_TICK_RATE).toFixed(1)} ms`);
console.log(`bots: ${server.bots().length}; path searches: ${server.nav.searches}`);
console.log(`kills: ${counts.kills} (${counts.headshots} headshots); extractions: ${counts.extracts}`);
for (const [k, n] of killers) console.log(`  ${k}: ${n}`);
console.log(`states now: ${[...states].map(([s, n]) => `${s} ${n}`).join(', ')}`);
