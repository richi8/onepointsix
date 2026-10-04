// Plays Deathmatch games of 16 bots in Node, with no browser, and sums up how
// they went: how often people die and how long they live, how kills spread,
// how safe respawns are, whether anyone runs out of ammo and what the bots
// spend their time on, and where: on the ground, upstairs or on the roofs;
// and any bot stuck, trying to go somewhere and not getting 2 m in 30 s.
// For tuning Deathmatch before and between playtests.
// Usage: npm run sim:deathmatch [seconds] [seeds, comma-separated]

import { DEATHMATCH_CAPACITY, EYE_HEIGHT, SERVER_TICK_RATE } from '../shared/constants.ts';
import { DEFAULT_WORLD } from '../shared/worldconfig.ts';
import { inBuilding } from '../shared/world.ts';
import { MODES } from './directory.ts';
import { ARENA_SIGHT, arenaPicks } from './population.ts';
import { GameServer } from './server.ts';

declare const process: { argv: string[] };

/** A death this soon after spawning counts as a spawn kill. */
const SPAWN_KILL = 15;
/** A bot going somewhere that stays this near one spot this long is stuck. */
const STUCK_SPAN = 30;
const STUCK_REACH = 2;
const MOVING = new Set(['hunt', 'loot', 'investigate', 'stalk', 'flank']);
/** The opening seconds, when every bot plans its first paths at once. */
const OPENING = 10;

const seconds = Number(process.argv[2] ?? 600);
const seeds = (process.argv[3] ?? String(DEFAULT_WORLD.seed)).split(',').map(Number);

function median(values: readonly number[]): number {
  const s = [...values].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : NaN;
}

for (const seed of seeds) {
  const server = new GameServer(seed, MODES.deathmatch.options);
  const kills: { killer: number; victim: number; head: boolean }[] = [];
  /** Seconds each death came after its victim spawned. */
  const lives: number[] = [];
  /** When each bot last spawned, and its life count as last seen. */
  const spawnedAt = new Map<number, number>();
  const lastLife = new Map<number, number>();
  /** At each respawn: the nearest living operator, and whether anyone in reach saw the spot. */
  const spawns: { nearest: number; seen: boolean }[] = [];
  const dry = new Set<number>();
  let ranDry = 0;
  const stateTicks = new Map<string, number>();
  /** Ticks bots spent alive on the ground (a ground floor included), upstairs and on the roofs. */
  const where = { ground: 0, upstairs: 0, roofs: 0 };
  /** Each bot's spot and time when it last moved STUCK_REACH, or started trying to; and where bots got stuck. */
  const still = new Map<number, { x: number; z: number; y: number; t: number; life: number }>();
  const stuck: string[] = [];
  server.onEvent = (e) => {
    if (e.k !== 'kill') return;
    kills.push({ killer: e.killer, victim: e.victim, head: e.head });
    lives.push(server.time - (spawnedAt.get(e.victim) ?? 0));
  };
  const picks = { ...arenaPicks };

  let worst = 0;
  let worstAt = 0;
  /** The worst tick once the opening's first searches are done, when every path is new. */
  let settled = 0;
  const start = performance.now();
  for (let tick = 0; tick < seconds * SERVER_TICK_RATE; tick++) {
    const t = performance.now();
    server.step();
    if (performance.now() - t > worst) (worst = performance.now() - t), (worstAt = server.time);
    if (server.time > OPENING) settled = Math.max(settled, performance.now() - t);
    const bots = server.bots();
    for (const b of bots) {
      const s = b.state;
      stateTicks.set(b.bot.state, (stateTicks.get(b.bot.state) ?? 0) + 1);
      if (!s.dead) {
        const house = server.world.buildings.find((h) => inBuilding(h, s.x, s.z));
        if (!house || s.y < house.floor + 1) where.ground++;
        else if (s.y > house.roof) where.roofs++;
        else where.upstairs++;
      }
      const life = lastLife.get(b.id);
      if (life === undefined) spawnedAt.set(b.id, server.time);
      else if (s.life !== life) {
        let nearest = Infinity;
        let seen = false;
        for (const o of bots) {
          if (o === b || o.state.dead) continue;
          const d = Math.hypot(o.state.x - s.x, o.state.z - s.z);
          nearest = Math.min(nearest, d);
          if (d < ARENA_SIGHT && server.world.hasLineOfSight(o.state.x, o.state.y + EYE_HEIGHT, o.state.z, s.x, s.y + EYE_HEIGHT, s.z)) seen = true;
        }
        spawns.push({ nearest, seen });
        spawnedAt.set(b.id, server.time);
      }
      lastLife.set(b.id, s.life);
      const at = still.get(b.id);
      if (s.dead || !MOVING.has(b.bot.state)) still.delete(b.id);
      else if (!at || at.life !== s.life || Math.hypot(s.x - at.x, s.z - at.z) > STUCK_REACH) still.set(b.id, { x: s.x, z: s.z, y: s.y, t: server.time, life: s.life });
      else if (server.time - at.t > STUCK_SPAN) {
        stuck.push(`${b.bot.state} at ${s.x.toFixed(1)}, ${s.y.toFixed(1)}, ${s.z.toFixed(1)}`);
        still.delete(b.id);
      }
      const empty = !s.dead && s.mag[b.bot.primary] + s.reserve[b.bot.primary] === 0;
      if (empty && !dry.has(b.id)) ranDry++;
      if (empty) dry.add(b.id);
      else dry.delete(b.id);
    }
  }
  const took = (performance.now() - start) / 1000;

  const tally = new Map<number, number>();
  for (const k of kills) if (k.killer !== k.victim) tally.set(k.killer, (tally.get(k.killer) ?? 0) + 1);
  const perBot = server.bots().map((b) => tally.get(b.id) ?? 0).sort((a, b) => b - a);
  const ticks = [...stateTicks.values()].reduce((a, b) => a + b, 0);
  const states = [...stateTicks].sort((a, b) => b[1] - a[1]).map(([s, n]) => `${s} ${Math.round((n / ticks) * 100)}%`);
  const unclear = arenaPicks.unclear - picks.unclear;
  const picked = arenaPicks.picked - picks.picked;
  const seenPicks = arenaPicks.seen - picks.seen;

  console.log(`seed ${seed}: ${seconds} s simulated in ${took.toFixed(1)} s, worst tick ${worst.toFixed(1)} ms at ${worstAt.toFixed(0)} s, ${settled.toFixed(1)} ms after the first ${OPENING} s`);
  console.log(`  kills ${kills.length} (${((kills.length / seconds) * 60).toFixed(1)} a minute), ${kills.filter((k) => k.head).length} headshots, ${kills.filter((k) => k.killer === k.victim).length} by their own grenade`);
  console.log(`  kills per bot: best ${perBot.slice(0, 3).join(', ')}, median ${median(perBot)}, ${perBot.filter((k) => k === 0).length} of ${DEATHMATCH_CAPACITY} with none`);
  console.log(`  life before dying: median ${median(lives).toFixed(0)} s; ${lives.filter((l) => l < SPAWN_KILL).length} died within ${SPAWN_KILL} s of spawning`);
  console.log(`  respawns ${spawns.length}: nearest living operator median ${median(spawns.map((s) => s.nearest)).toFixed(0)} m, least ${Math.min(...spawns.map((s) => s.nearest)).toFixed(0)} m; ${spawns.filter((s) => s.seen).length} in sight; ${unclear} of ${picked} spawns found no clear spot, ${seenPicks} none out of sight`);
  console.log(`  ran out of ammo ${ranDry} times; time spent: ${states.join(', ')}`);
  const alive = where.ground + where.upstairs + where.roofs;
  console.log(`  stuck ${stuck.length} times${stuck.length ? `: ${stuck.slice(0, 12).join('; ')}` : ''}`);
  console.log(`  where: ${Object.entries(where).map(([k, n]) => `${k} ${Math.round((n / alive) * 100)}%`).join(', ')}`);
}
