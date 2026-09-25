import { GUARD_PATROLS, GUARDS_PER_OUTPOST, PLAYER_HEIGHT } from '../shared/constants.ts';
import { yawToward } from '../shared/geom.ts';
import { lootCrates } from '../shared/loot.ts';
import { BOLT, RIFLE } from '../shared/weapons.ts';
import { watchtower, type Outpost, type Point, type World } from '../shared/world.ts';
import type { LootSpot, Post, Role } from './bot.ts';
import type { NavGrid } from './nav.ts';
import type { Difficulty } from './skill.ts';

// Who is on the island besides the players, and what each of them is for:
// a sentry in every watchtower, guards walking each outpost, pairs of guards
// patrolling between outposts, and operator bots each playing their own run.

/** Everything needed to (re)create a bot. */
export interface BotPlan {
  name: string;
  role: Role;
  skill: Difficulty;
  primary: number;
  spawn: Post;
  /** For a patrol follower: the index of its leader's plan. */
  follows?: number;
  /** Sent for one job, such as answering a called extraction: not replaced when it dies. */
  temporary?: boolean;
  /** A commander, the target of a contract; drawn with its own markings. */
  commander?: boolean;
}

/** Guards walk points this far from their outpost's centre: inside the walls and just outside. */
const ROUTE_RADIUS: [number, number] = [5, 20];
const ROUTE_POINTS = 4;
const OUTPOST_LEASH = 45;
const PATROL_LEASH = 70;
/** Patrols pass outposts at this distance, outside the walls. */
const PATROL_STANDOFF = 26;
/** Operators drop in at least this far from outposts and from other players. */
const INSERT_FROM_OUTPOSTS = 130;
const INSERT_FROM_PLAYERS = 100;
/** Operator bots willing to carry this many kg or more also go for the guarded crates in outposts. */
const RAIDER_GREED = 26;
/** Crates searched per run. */
const LOOT_STOPS: [number, number] = [1, 3];
/** A response squad sets off from this far from the extraction point it answers. */
const RESPONSE_DISTANCE: [number, number] = [150, 190];
const RESPONSE_LEASH = 40;
const CALLSIGNS = [
  'Viper', 'Nomad', 'Rook', 'Ghost', 'Havoc', 'Mako', 'Jackal', 'Raven', 'Onyx', 'Talon', 'Sable', 'Kestrel',
  'Wolf', 'Brick', 'Dune', 'Echo', 'Fox', 'Hex', 'Lynx', 'Moth', 'Pike', 'Quill', 'Rust', 'Tusk',
];

export function planGuards(world: World, nav: NavGrid, rand: () => number): BotPlan[] {
  const plans: BotPlan[] = [];
  for (const o of world.outposts) {
    const { x: tx, y: ty, z: tz } = watchtower(o);
    if (world.fits(tx, ty, tz, PLAYER_HEIGHT)) {
      const post = { x: tx, y: ty, z: tz, yaw: yawToward(o.x, o.z, tx, tz) };
      plans.push({ name: `${o.name} sentry`, role: { kind: 'sentry', post }, skill: 'normal', primary: RIFLE, spawn: post });
    }
    const route = outpostRoute(world, nav, o, rand);
    if (route.length < 2) continue;
    for (let g = 0; g < GUARDS_PER_OUTPOST; g++) {
      // Each guard walks the loop from a different point, some the other way round.
      const start = Math.floor((g * route.length) / GUARDS_PER_OUTPOST);
      const mine = [...route.slice(start), ...route.slice(0, start)];
      if (g % 2 === 1) mine.reverse();
      plans.push({
        name: `${o.name} guard`,
        role: { kind: 'guard', route: mine, leash: OUTPOST_LEASH, home: o },
        skill: rand() < 0.5 ? 'easy' : 'normal',
        primary: RIFLE,
        spawn: { ...mine[0], yaw: rand() * Math.PI * 2 },
      });
    }
  }

  const n = world.outposts.length;
  for (let k = 0; k < GUARD_PATROLS && n >= 2; k++) {
    // Loops through three outposts, walking past each just outside its walls.
    const stops = [0, 1, 3].map((i) => world.outposts[(k * 2 + i) % n]);
    const route: Point[] = [];
    stops.forEach((o, i) => {
      const next = stops[(i + 1) % stops.length];
      const d = Math.hypot(next.x - o.x, next.z - o.z) || 1;
      const p = nav.nearestWalkable(o.x + ((next.x - o.x) / d) * PATROL_STANDOFF, o.z + ((next.z - o.z) / d) * PATROL_STANDOFF, 10);
      if (p) route.push(ground(world, p.x, p.z));
    });
    if (route.length < 2) continue;
    const leader = plans.length;
    const yaw = yawToward(route[0].x, route[0].z, route[1].x, route[1].z);
    const skill: Difficulty = 'normal';
    plans.push({ name: 'Patrol', role: { kind: 'guard', route, leash: PATROL_LEASH }, skill, primary: RIFLE, spawn: { ...route[0], yaw } });
    const behind = nav.nearestWalkable(route[0].x + Math.sin(yaw) * 3, route[0].z + Math.cos(yaw) * 3) ?? route[0];
    plans.push({
      name: 'Patrol',
      role: { kind: 'guard', route, leash: PATROL_LEASH },
      skill,
      primary: RIFLE,
      spawn: { ...ground(world, behind.x, behind.z), yaw },
      follows: leader,
    });
  }
  return plans;
}

/**
 * Where an operator drops in: dry land away from outposts and from `avoid`,
 * the players to keep clear of.
 */
export function insertionPoint(world: World, nav: NavGrid, rand: () => number, avoid: Point[]): Point {
  for (let i = 0; i < 60; i++) {
    const p = world.randomLandPoint(rand);
    const far = (q: Point, r: number) => Math.hypot(q.x - p.x, q.z - p.z) >= r;
    if (!nav.dry(p.x, p.z) || p.y > 40) continue;
    if (!world.outposts.every((o) => far(o, INSERT_FROM_OUTPOSTS)) || !avoid.every((a) => far(a, INSERT_FROM_PLAYERS))) continue;
    return p;
  }
  return world.randomLandPoint(rand);
}

/**
 * A fresh operator bot: where it drops in and the crates it will search on
 * the way. It picks an open extraction point when it's done. `avoid` are
 * players to keep clear of; `taken` are callsigns already in use.
 */
export function planOperator(world: World, nav: NavGrid, rand: () => number, avoid: Point[], taken: Set<string>): BotPlan {
  const spawn = insertionPoint(world, nav, rand, avoid);

  // How much it's willing to carry, kg. Greedy ones also raid the outposts' crates.
  const greed = 12 + rand() * 22;
  const crates = lootCrates(world).filter((c) => !c.rich || greed >= RAIDER_GREED).map((c) => c.box);
  const loot: LootSpot[] = [];
  const stops = LOOT_STOPS[0] + Math.floor(rand() * (LOOT_STOPS[1] - LOOT_STOPS[0] + 1));
  let from: Point = spawn;
  const used = new Set<number>();
  for (let s = 0; s < stops; s++) {
    // One of the few nearest unsearched crates.
    const near = crates
      .map((c, i) => ({ i, d: Math.hypot((c.minX + c.maxX) / 2 - from.x, (c.minZ + c.maxZ) / 2 - from.z) }))
      .filter((c) => !used.has(c.i) && c.d > 8)
      .sort((a, b) => a.d - b.d)
      .slice(0, s === 0 ? 6 : 4);
    if (!near.length) break;
    const pick = near[Math.floor(rand() * near.length)].i;
    used.add(pick);
    const spot = searchSpot(world, nav, crates[pick]);
    if (!spot) continue;
    loot.push(spot);
    from = spot;
  }

  const free = CALLSIGNS.filter((c) => !taken.has(c));
  const name = free.length ? free[Math.floor(rand() * free.length)] : `Op ${Math.floor(rand() * 100)}`;
  const r = rand();
  const skill: Difficulty = r < 0.2 ? 'easy' : r < 0.75 ? 'normal' : 'hard';
  const primary = skill !== 'easy' && rand() < 0.2 ? BOLT : RIFLE;
  const yaw = loot[0] ? yawToward(spawn.x, spawn.z, loot[0].x, loot[0].z) : rand() * Math.PI * 2;
  return { name, role: { kind: 'operator', loot, greed }, skill, primary, spawn: { ...spawn, yaw } };
}

/**
 * Guards sent to a called extraction point: they set off together from
 * inland and hold the landing zone until they die or are recalled.
 */
export function planResponse(world: World, nav: NavGrid, rand: () => number, at: Point, count: number): BotPlan[] {
  // From inland, where the outposts are.
  const inland = Math.atan2(-at.x, -at.z) + (rand() - 0.5) * 1.2;
  const d = RESPONSE_DISTANCE[0] + rand() * (RESPONSE_DISTANCE[1] - RESPONSE_DISTANCE[0]);
  const start = nav.nearestWalkable(at.x + Math.sin(inland) * d, at.z + Math.cos(inland) * d, 20);
  if (!start) return [];
  const route: Point[] = [];
  for (let i = 0; i < 3; i++) {
    const a = rand() * Math.PI * 2;
    const p = nav.nearestWalkable(at.x + Math.sin(a) * 4, at.z + Math.cos(a) * 4, 5);
    if (p && nav.dry(p.x, p.z)) route.push(ground(world, p.x, p.z));
  }
  if (!route.length) route.push(at);
  const yaw = yawToward(start.x, start.z, at.x, at.z);
  const plans: BotPlan[] = [];
  for (let i = 0; i < count; i++) {
    const p = nav.nearestWalkable(start.x + (i - 1) * 2, start.z + (i % 2) * 2, 5) ?? start;
    plans.push({
      name: 'Response',
      role: { kind: 'guard', route, leash: RESPONSE_LEASH, home: at },
      skill: rand() < 0.5 ? 'easy' : 'normal',
      primary: RIFLE,
      spawn: { ...ground(world, p.x, p.z), yaw },
      temporary: true,
    });
  }
  return plans;
}

/**
 * A commander, the target of a contract: a tough guard walking an outpost
 * with its guards, there for one run. `taken` are callsigns already in use.
 */
export function planCommander(world: World, nav: NavGrid, rand: () => number, o: Outpost, taken: Set<string>): BotPlan | null {
  const route = outpostRoute(world, nav, o, rand);
  if (route.length < 2) return null;
  const free = CALLSIGNS.filter((c) => !taken.has(`Commander ${c}`));
  const callsign = free.length ? free[Math.floor(rand() * free.length)] : String(Math.floor(rand() * 100));
  return {
    name: `Commander ${callsign}`,
    role: { kind: 'guard', route, leash: OUTPOST_LEASH, home: o },
    skill: 'hard',
    primary: RIFLE,
    spawn: { ...route[0], yaw: rand() * Math.PI * 2 },
    temporary: true,
    commander: true,
  };
}

/** Walkable points around an outpost for guards to walk between, in order around it. */
function outpostRoute(world: World, nav: NavGrid, o: Point, rand: () => number): Point[] {
  const route: Point[] = [];
  const turn = rand() * Math.PI * 2;
  for (let i = 0; i < ROUTE_POINTS; i++) {
    const a = turn + (i / ROUTE_POINTS) * Math.PI * 2;
    const r = ROUTE_RADIUS[0] + rand() * (ROUTE_RADIUS[1] - ROUTE_RADIUS[0]);
    const p = nav.nearestWalkable(o.x + Math.sin(a) * r, o.z + Math.cos(a) * r, 5);
    if (p && nav.dry(p.x, p.z)) route.push(ground(world, p.x, p.z));
  }
  return route;
}

/** A dry spot next to a crate to search it from, looking at its top. */
function searchSpot(world: World, nav: NavGrid, box: { minX: number; maxX: number; minZ: number; maxZ: number; maxY: number }): LootSpot | null {
  const cx = (box.minX + box.maxX) / 2;
  const cz = (box.minZ + box.maxZ) / 2;
  const reach = Math.max(box.maxX - box.minX, box.maxZ - box.minZ) / 2 + 0.9;
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const x = cx + Math.sin(a) * reach;
    const z = cz + Math.cos(a) * reach;
    if (!nav.dry(x, z)) continue;
    return { ...ground(world, x, z), look: { x: cx, y: box.maxY, z: cz } };
  }
  return null;
}

function ground(world: World, x: number, z: number): Point {
  return { x, y: world.groundHeight(x, z, world.floorHeight(x, z)), z };
}
