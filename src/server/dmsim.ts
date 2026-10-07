// Plays Deathmatch games of 12 bots in Node, with no browser, and sums up how
// they went: how often people die and how long they live, how kills spread,
// how safe respawns are, whether anyone runs out of ammo and what the bots
// spend their time on, and where: on the ground, upstairs or on the roofs;
// and any bot stuck, trying to go somewhere and not getting 2 m in 30 s.
// On a map, where the fights happen: the places killers stood that killed the
// most (a room's storey, a roof, or a few metres of street), those that
// killed most from afar, and the spawn points whose operators died soonest;
// and a heat map of every game, written to test-results/deathmatch-<seed>.png
// (see heatmap.ts). For tuning Deathmatch before and between playtests: on the
// old town, or with `team` Team Deathmatch on the map after Dust 2.
// Usage: npm run sim:deathmatch [seconds] [seeds, comma-separated] [deathmatch|team]

import { DEATHMATCH_CAPACITY, EYE_HEIGHT, SERVER_TICK_RATE } from '../shared/constants.ts';
import { DEFAULT_WORLD } from '../shared/worldconfig.ts';
import type { Side } from '../shared/protocol.ts';
import { inBuilding, type World } from '../shared/world.ts';
import { heatPicture, LONG, type KillAt, type Where } from './heatmap.ts';
import { MODES } from './directory.ts';
import { ARENA_SIGHT, arenaPicks } from './population.ts';
import { tally as botTally } from './bot.ts';
import { GameServer } from './server.ts';

declare const process: { argv: string[] };

const fs = (await import('node:fs' as string)) as { mkdirSync(path: string, o: { recursive: boolean }): void; writeFileSync(path: string, data: Uint8Array): void };

/** A death this soon after spawning counts as a spawn kill. */
const SPAWN_KILL = 15;
/** One this soon was killed coming in. */
const SPAWN_KILLED = 5;
/** A bot going somewhere that stays this near one spot this long is stuck. */
const STUCK_SPAN = 30;
const STUCK_REACH = 2;
const MOVING = new Set(['hunt', 'loot', 'investigate', 'stalk', 'flank']);
/** The opening seconds, when every bot plans its first paths at once. */
const OPENING = 10;

/** Kills from a ground spot are summed over squares this many metres a side. */
const GROUND_SPOT = 6;
/** Kills from this far or more count as from afar. */
const AFAR = 30;
/** Spots listed of each kind. */
const LISTED = 6;

/** Whether (x, y, z) is on the ground (a ground floor included), upstairs or on a roof. */
function whereIs(world: World, x: number, y: number, z: number): Where {
  const house = world.buildings.find((h) => inBuilding(h, x, z));
  if (!house || y < house.floor + 1) return 'ground';
  return y > house.roof ? 'roofs' : 'upstairs';
}

/**
 * The place a killer stood, as the tuning cares about it: a building's
 * storey or roof, by the map's name for it; or a square of the ground, by
 * its middle and the nearest lane's name.
 */
function placeOf(world: World, x: number, y: number, z: number): string {
  const map = world.map;
  const where = whereIs(world, x, y, z);
  if (map && where !== 'ground') {
    for (const b of map.buildings) {
      if (!b.blocks.some((k) => x > k.minX && x < k.maxX && z > k.minZ && z < k.maxZ)) continue;
      const storey = Math.max(1, Math.round((y - b.floor) / (b.storey ?? 3)));
      const name = `${b.name ?? 'building'} at ${Math.round((b.blocks[0].minX + b.blocks[0].maxX) / 2)}, ${Math.round((b.blocks[0].minZ + b.blocks[0].maxZ) / 2)}`;
      return where === 'roofs' ? `${name}, roof` : `${name}, storey ${storey + 1}`;
    }
  }
  const cx = (Math.floor(x / GROUND_SPOT) + 0.5) * GROUND_SPOT;
  const cz = (Math.floor(z / GROUND_SPOT) + 0.5) * GROUND_SPOT;
  // A map planned as named places: the square's middle's.
  const last = (px: number, pz: number) => [...(map?.areas ?? [])].reverse().find((a) => px >= a.minX && px < a.maxX && pz >= a.minZ && pz < a.maxZ);
  const area = last(cx, cz) ?? last(x, z);
  if (area) return `${where} at ${cx}, ${cz} (${area.name})`;
  let lane = '';
  let laneD = 8;
  for (const l of map?.lanes ?? []) {
    for (let i = 1; i < l.points.length; i++) {
      const [ax, az] = l.points[i - 1];
      const [bx, bz] = l.points[i];
      const len2 = (bx - ax) ** 2 + (bz - az) ** 2 || 1;
      const t = Math.max(0, Math.min(1, ((cx - ax) * (bx - ax) + (cz - az) * (bz - az)) / len2));
      const d = Math.hypot(ax + (bx - ax) * t - cx, az + (bz - az) * t - cz);
      if (d < laneD) (laneD = d), (lane = l.name);
    }
  }
  return `${where === 'ground' ? 'ground' : where} at ${cx}, ${cz}${lane ? ` (${lane})` : ''}`;
}

const seconds = Number(process.argv[2] ?? 600);
const seeds = (process.argv[3] ?? String(DEFAULT_WORLD.seed)).split(',').map(Number);
const mode = process.argv[4] === 'team' ? 'team' : 'deathmatch';

function median(values: readonly number[]): number {
  const s = [...values].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : NaN;
}

for (const seed of seeds) {
  const server = new GameServer(seed, MODES[mode].options);
  const kills: { killer: number; victim: number; head: boolean }[] = [];
  /** Where each kill by someone else happened, and from where, by the place the killer stood. */
  const killsAt: (KillAt & { place: string; range: number })[] = [];
  /** At each map spawn point: operators spawned there, and of those how many died within SPAWN_KILL. */
  const atSpawn = new Map<number, { spawned: number; died: number }>();
  /** The spawn point each bot last spawned at, by bot. */
  const spawnedOn = new Map<number, number>();
  /** Seconds each death came after its victim spawned. */
  const lives: number[] = [];
  /** When each bot last spawned, and its life count as last seen. */
  const spawnedAt = new Map<number, number>();
  const lastLife = new Map<number, number>();
  /** At each respawn: the nearest living operator, and whether anyone in reach saw the spot; in Team Deathmatch, its side, whether in its own half, and the same of the other side alone. */
  const spawns: { nearest: number; seen: boolean; side?: Side; own?: boolean; foe?: number; foeSeen?: boolean }[] = [];
  /** In Team Deathmatch, kills by each side, and kills made in each side's half. */
  const sideKills: Record<Side, number> = { red: 0, blue: 0 };
  const halfKills: Record<Side, number> = { red: 0, blue: 0 };
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
    const life = server.time - (spawnedAt.get(e.victim) ?? 0);
    lives.push(life);
    const on = spawnedOn.get(e.victim);
    if (on !== undefined && life < SPAWN_KILL) atSpawn.get(on)!.died++;
    const k = server.bots().find((b) => b.id === e.killer)?.state;
    const v = server.bots().find((b) => b.id === e.victim)?.state;
    if (!k || !v || e.killer === e.victim) return;
    const w = server.world;
    const side = server.bots().find((b) => b.id === e.killer)?.side;
    if (side) {
      sideKills[side]++;
      halfKills[halfOf(k.x, k.z)!]++;
    }
    killsAt.push({
      kx: k.x, ky: k.y, kz: k.z, vx: v.x, vz: v.z, where: whereIs(w, k.x, k.y, k.z),
      place: placeOf(w, k.x, k.y, k.z), range: Math.hypot(v.x - k.x, v.z - k.z),
    });
  };
  /** Which of the map's spawn points (x, z) is, if any. */
  const spawnPoint = (x: number, z: number): number => server.world.spawns.findIndex((p) => Math.hypot(p.x - x, p.z - z) < 1);
  /** Whose base (x, z) is nearer, on a map with bases. */
  const bases = server.world.map?.bases;
  const halfOf = (x: number, z: number): Side | undefined =>
    bases && (Math.hypot(bases.red.x - x, bases.red.z - z) < Math.hypot(bases.blue.x - x, bases.blue.z - z) ? 'red' : 'blue');
  const picks = { ...arenaPicks };
  const told = { ...botTally };

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
      if (!s.dead) where[whereIs(server.world, s.x, s.y, s.z)]++;
      const life = lastLife.get(b.id);
      if (life === undefined || s.life !== life) {
        const on = spawnPoint(s.x, s.z);
        if (on >= 0) {
          const n = atSpawn.get(on) ?? { spawned: 0, died: 0 };
          n.spawned++;
          atSpawn.set(on, n);
          spawnedOn.set(b.id, on);
        } else spawnedOn.delete(b.id);
      }
      if (life === undefined) spawnedAt.set(b.id, server.time);
      else if (s.life !== life) {
        let nearest = Infinity;
        let seen = false;
        let foe = Infinity;
        let foeSeen = false;
        for (const o of bots) {
          if (o === b || o.state.dead) continue;
          const d = Math.hypot(o.state.x - s.x, o.state.z - s.z);
          const enemy = !b.side || o.side !== b.side;
          nearest = Math.min(nearest, d);
          if (enemy) foe = Math.min(foe, d);
          if (d < ARENA_SIGHT && server.world.hasLineOfSight(o.state.x, o.state.y + EYE_HEIGHT, o.state.z, s.x, s.y + EYE_HEIGHT, s.z)) {
            seen = true;
            if (enemy) foeSeen = true;
          }
        }
        spawns.push(b.side ? { nearest, seen, side: b.side, own: halfOf(s.x, s.z) === b.side, foe, foeSeen } : { nearest, seen });
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
  console.log(`  life before dying: median ${median(lives).toFixed(0)} s; ${lives.filter((l) => l < SPAWN_KILL).length} died within ${SPAWN_KILL} s of spawning, ${lives.filter((l) => l < SPAWN_KILLED).length} within ${SPAWN_KILLED} s`);
  console.log(`  respawns ${spawns.length}: nearest living operator median ${median(spawns.map((s) => s.nearest)).toFixed(0)} m, least ${Math.min(...spawns.map((s) => s.nearest)).toFixed(0)} m; ${spawns.filter((s) => s.seen).length} in sight; ${unclear} of ${picked} spawns found no clear spot, ${seenPicks} none out of sight`);
  if (mode === 'team') {
    const sided = spawns.filter((s) => s.side);
    const away = (side: Side) => sided.filter((s) => s.side === side && !s.own).length;
    console.log(`  sides: red ${sideKills.red} kills, blue ${sideKills.blue}; kills made in red's half ${halfKills.red}, in blue's ${halfKills.blue}`);
    console.log(`  respawns in the other side's half: red ${away('red')} of ${sided.filter((s) => s.side === 'red').length}, blue ${away('blue')} of ${sided.filter((s) => s.side === 'blue').length}; nearest enemy median ${median(sided.map((s) => s.foe!)).toFixed(0)} m, under 15 m ${sided.filter((s) => s.foe! < 15).length}; ${sided.filter((s) => s.foeSeen).length} in an enemy's sight`);
  }
  console.log(`  ran out of ammo ${ranDry} times; time spent: ${states.join(', ')}`);
  const alive = where.ground + where.upstairs + where.roofs;
  console.log(`  stuck ${stuck.length} times${stuck.length ? `: ${stuck.slice(0, 12).join('; ')}` : ''}`);
  console.log(`  where: ${Object.entries(where).map(([k, n]) => `${k} ${Math.round((n / alive) * 100)}%`).join(', ')}`);
  if (!server.world.map) continue;
  console.log(`  watched from ${botTally.posts - told.posts} windows and roofs (${botTally.postsHeld - told.postsHeld} got to), ${botTally.streetSpots - told.streetSpots} street spots beside cover; ${botTally.joins - told.joins} fights joined`);

  // Where the kills came from.
  const n = killsAt.length;
  const pct = (k: number, of = n) => `${Math.round((k / (of || 1)) * 100)}%`;
  const from = { ground: 0, upstairs: 0, roofs: 0 };
  for (const k of killsAt) from[k.where]++;
  console.log(`  kills from: ${Object.entries(from).map(([w, k]) => `${w} ${pct(k)}`).join(', ')}; ${pct(killsAt.filter((k) => k.range >= AFAR).length)} from ${AFAR} m or more, ${pct(killsAt.filter((k) => k.range >= LONG).length)} from ${LONG} m, median ${median(killsAt.map((k) => k.range)).toFixed(0)} m`);
  const places = new Map<string, { all: number; afar: number; ranges: number[]; up: boolean }>();
  for (const k of killsAt) {
    const p = places.get(k.place) ?? { all: 0, afar: 0, ranges: [], up: k.where !== 'ground' };
    p.all++;
    if (k.range >= AFAR) p.afar++;
    p.ranges.push(k.range);
    places.set(k.place, p);
  }
  const ranked = [...places].sort((a, b) => b[1].all - a[1].all);
  const line = ([name, p]: [string, { all: number; afar: number; ranges: number[] }]) =>
    `${name}: ${p.all} (${pct(p.all)}), ${p.afar} from afar, median ${median(p.ranges).toFixed(0)} m`;
  console.log(`  killing most:\n${ranked.slice(0, LISTED).map((e) => `    ${line(e)}`).join('\n')}`);
  const afar = [...places].filter(([, p]) => p.afar > 0).sort((a, b) => b[1].afar - a[1].afar);
  console.log(`  killing most from afar:\n${afar.slice(0, LISTED).map((e) => `    ${line(e)}`).join('\n')}`);
  const up = ranked.find(([, p]) => p.up);
  console.log(`  the most from one window or roof: ${up ? line(up) : 'none'}`);
  const spawnsRanked = [...atSpawn].filter(([, s]) => s.spawned >= 4).sort((a, b) => b[1].died / b[1].spawned - a[1].died / a[1].spawned);
  console.log(`  spawn points dying soonest: ${spawnsRanked.slice(0, LISTED).map(([i, s]) => `#${i} at ${server.world.spawns[i].x.toFixed(0)}, ${server.world.spawns[i].z.toFixed(0)}: ${s.died} of ${s.spawned}`).join('; ')}`);

  fs.mkdirSync('test-results', { recursive: true });
  const file = `test-results/deathmatch-${seed}.png`;
  fs.writeFileSync(file, await heatPicture(server.world, killsAt));
  console.log(`  heat map: ${file}`);
}
