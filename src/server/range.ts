import { Btn, CARRY_MAX, CMD_DT, CMDS_PER_TICK, PLAYER_HEIGHT, SERVER_DT, THROW_LOFT, THROW_SPEED } from '../shared/constants.ts';
import { yawToward } from '../shared/geom.ts';
import { launchGrenade, stepGrenade } from '../shared/grenade.ts';
import { hitboxes } from '../shared/hitbox.ts';
import type { InputCmd, Team } from '../shared/protocol.ts';
import { eyePosition, type PlayerState } from '../shared/sim.ts';
import { BOLT, PISTOL, RIFLE, shotDirection } from '../shared/weapons.ts';
import { inBuilding, watchtower, type World } from '../shared/world.ts';
import type { Post } from './bot.ts';
import type { NavGrid } from './nav.ts';

// The range: a place to watch every way a body moves, for trying things out
// by hand. Round the island's first outpost, with no guards and no operator
// bots, stand actors: bots that don't think, each playing one routine over
// and over from its spot. Some walk, run, sprint and sneak in circles; some
// crouch, lean, jump, aim, shoot, reload, switch guns or throw grenades;
// one climbs a watchtower's stairs, one climbs onto a crate,
// one goes in and out of a door; and some are shot, now and then, by others
// beside them, or blown up by a grenade, so their bodies fall. The player
// can't be hurt there, and the run's clock stands still.

/** What an actor does, over and over. */
export type Act =
  | 'idle' | 'look' | 'turn'
  | 'walk' | 'sprint' | 'crouchWalk' | 'crouchSprint' | 'leanWalk' | 'heavyWalk' | 'runJump'
  | 'strafe' | 'backpedal' | 'duck' | 'lean' | 'leanCrouched' | 'leanAim' | 'jump'
  | 'aim' | 'aimCrouched' | 'rifle' | 'pistol' | 'bolt' | 'reload' | 'switch' | 'grenade'
  | 'stairs' | 'mantle' | 'door' | 'shooter' | 'victim' | 'crouchVictim';

export interface ActorSpec {
  act: Act;
  name: string;
  team: Team;
  weapon: number;
  /** Where it starts each loop, facing the way it starts. */
  post: Post;
  /** Seconds a loop takes; it's put back on its post at the start of each. 0 never puts it back. */
  loop: number;
  /** Walkers go round a circle this wide about this middle. */
  center?: { x: number; z: number };
  radius?: number;
  /** A shooter's target, as an index into the specs. */
  target?: number;
  /** Aims this far up or down, for a throw. */
  pitch?: number;
  /** A door's leaves, shut again at the start of each loop. */
  door?: number[];
  /** Carries this much, kg. */
  carry?: number;
  commander?: boolean;
}

/** Seconds a dead actor lies there before it's back on its post. */
export const ACTOR_RESPAWN = 3.5;
/** When in its loop a shooter fires, and a shot that missed is made good. */
const FIRE_AT = 2;
const MADE_GOOD = 0.5;
/** Those shooting into the open aim this far up, so their rounds pass over the heads of others out there. */
const OVERHEAD = 0.15;
/** Room between actors' spots, and the rings they stand on round the outpost. */
const SPACING = 7;
const RINGS = [19, 27, 35];
const CIRCLE = 2.5;
/** How far in from its victim a shooter stands: between two rings. */
const SHOOTER_IN = 4;

/** The actors round outpost 0, and where the player drops in among them. */
export function planRange(world: World, nav: NavGrid): { actors: ActorSpec[]; spawn: Post } {
  const o = world.outposts[0];
  const ground = (x: number, z: number) => world.groundHeight(x, z, world.floorHeight(x, z));
  const stands = (x: number, z: number, pad: number) => nav.dry(x, z) && world.clear(x, ground(x, z), z, PLAYER_HEIGHT, pad);
  // Spots round the rings, each clear for a circle to be walked round it.
  const spots: { x: number; z: number; out: number }[] = [];
  for (const r of RINGS) {
    const n = Math.floor((2 * Math.PI * r) / SPACING);
    for (let i = 0; i < n; i++) {
      const a = ((i + (r % 2) * 0.5) / n) * Math.PI * 2;
      const x = o.x + Math.sin(a) * r;
      const z = o.z + Math.cos(a) * r;
      const round = [0, 1, 2, 3, 4, 5, 6, 7].every((k) => stands(x + Math.sin(k * 0.785) * CIRCLE, z + Math.cos(k * 0.785) * CIRCLE, 0.45));
      if (!stands(x, z, 1) || !round) continue;
      // Facing out, away from the outpost, so rounds and grenades go into the open.
      spots.push({ x, z, out: yawToward(o.x, o.z, x, z) });
    }
  }
  const actors: ActorSpec[] = [];
  const add = (spec: Omit<ActorSpec, 'name'> & { name?: string }): number => {
    actors.push({ name: spec.name ?? label(spec.act), ...spec });
    return actors.length - 1;
  };
  const take = () => spots.shift();
  const at = (s: { x: number; z: number }, yaw: number): Post => ({ x: s.x, y: ground(s.x, s.z), z: s.z, yaw });

  // Shot, from the front, from behind and from the side, and running.
  const pairs: [Act, number, number, string][] = [
    ['victim', 0, BOLT, 'shot from the front'], ['victim', Math.PI, RIFLE, 'shot from behind'],
    ['crouchVictim', Math.PI / 2, RIFLE, 'shot from the side'], ['sprint', 0, RIFLE, 'shot running'],
  ];
  for (const [act, turn, weapon, how] of pairs) {
    // On the outer ring, the shooter a few metres in from it firing out, so a round that goes through goes into the open.
    let i = spots.length - 1;
    while (i >= 0 && !stands(spots[i].x - Math.sin(spots[i].out) * SHOOTER_IN, spots[i].z - Math.cos(spots[i].out) * SHOOTER_IN, 0.6)) i--;
    if (i < 0) break;
    const [v] = spots.splice(i, 1);
    const s = { x: v.x - Math.sin(v.out) * SHOOTER_IN, z: v.z - Math.cos(v.out) * SHOOTER_IN };
    const toShooter = yawToward(v.x, v.z, s.x, s.z);
    const victim = act === 'sprint'
      ? add({ act, name: `Victim, ${how}`, team: 'guard', weapon: RIFLE, post: at({ x: v.x + CIRCLE, z: v.z }, 0), loop: 0, center: { x: v.x, z: v.z }, radius: CIRCLE })
      : add({ act, name: `Victim, ${how}`, team: 'guard', weapon: RIFLE, post: at(v, toShooter + turn), loop: 0 });
    add({ act: 'shooter', name: `Shooter (${how})`, team: 'operator', weapon, post: at(s, yawToward(s.x, s.z, v.x, v.z)), loop: 6, target: victim });
  }

  // Going round in circles, at every pace.
  const circles: [Act, Team, number, Partial<ActorSpec>?][] = [
    ['walk', 'operator', RIFLE], ['sprint', 'operator', RIFLE], ['crouchWalk', 'guard', RIFLE],
    ['crouchSprint', 'operator', RIFLE], ['leanWalk', 'guard', RIFLE], ['heavyWalk', 'operator', RIFLE, { carry: CARRY_MAX }],
    ['runJump', 'operator', RIFLE], ['walk', 'guard', PISTOL, { name: 'Walk (pistol)' }],
    ['walk', 'operator', BOLT, { name: 'Walk (bolt-action)' }],
  ];
  for (const [act, team, weapon, extra] of circles) {
    const s = take();
    if (!s) break;
    add({ act, team, weapon, post: at({ x: s.x + CIRCLE, z: s.z }, 0), loop: 0, center: { x: s.x, z: s.z }, radius: CIRCLE, ...extra });
  }

  // On the spot.
  const still: [Act, Team, number, Partial<ActorSpec>?][] = [
    ['idle', 'operator', RIFLE], ['idle', 'guard', RIFLE], ['idle', 'guard', RIFLE, { commander: true, name: 'Commander' }],
    ['idle', 'operator', PISTOL, { name: 'Idle (pistol)' }], ['idle', 'operator', BOLT, { name: 'Idle (bolt-action)' }],
    ['look', 'guard', RIFLE], ['turn', 'operator', RIFLE], ['strafe', 'operator', RIFLE], ['backpedal', 'guard', RIFLE],
    ['duck', 'operator', RIFLE], ['lean', 'guard', RIFLE], ['leanCrouched', 'operator', RIFLE], ['leanAim', 'operator', RIFLE],
    ['jump', 'guard', RIFLE], ['aim', 'operator', RIFLE], ['aimCrouched', 'guard', RIFLE], ['aim', 'operator', PISTOL, { name: 'Aim (pistol)' }],
    ['rifle', 'guard', RIFLE], ['pistol', 'operator', PISTOL], ['bolt', 'operator', BOLT], ['reload', 'guard', RIFLE],
    ['switch', 'operator', RIFLE],
  ];
  for (const [act, team, weapon, extra] of still) {
    const s = take();
    if (!s) break;
    const loop = { strafe: 3, backpedal: 3, duck: 2.4, lean: 3.6, leanCrouched: 3.6, leanAim: 3.6, jump: 1.4, rifle: 3, pistol: 3, bolt: 3.2, reload: 5, switch: 4.8 }[act as string] ?? 0;
    add({ act, team, weapon, post: at(s, s.out), loop, ...extra });
  }

  // A grenade thrown into a knot of three, worked out beforehand to land among them.
  for (let i = 0; i < spots.length; i++) {
    const s = spots[i];
    const found = [0.1, 0.25, 0.4].map((pitch) => {
      const rest = grenadeRest(world, at(s, s.out), pitch);
      const d = Math.hypot(rest.x - s.x, rest.z - s.z);
      const knot = [0, 2.1, 4.2].map((a) => ({ x: rest.x + Math.sin(a + s.out) * 1.4, z: rest.z + Math.cos(a + s.out) * 1.4 }));
      const ok = d > 10 && d < 30 && knot.every((k) => stands(k.x, k.z, 0.5)) && actors.every((a) => Math.hypot(a.post.x - rest.x, a.post.z - rest.z) > 10);
      return ok ? { pitch, knot } : null;
    }).find((f) => f);
    if (!found) continue;
    spots.splice(i, 1);
    add({ act: 'grenade', team: 'operator', weapon: RIFLE, post: at(s, s.out), loop: 7, pitch: found.pitch });
    for (const k of found.knot) add({ act: 'victim', name: 'Victim, blown up', team: 'guard', weapon: RIFLE, post: at(k, s.out + Math.PI), loop: 0 });
    break;
  }

  // Up the watchtower's stairs and down again.
  const t = watchtower(o);
  add({ act: 'stairs', team: 'guard', weapon: RIFLE, post: { x: t.x + 10.2, y: ground(t.x + 10.2, t.z), z: t.z, yaw: Math.PI / 2 }, loop: 7 });

  // Onto a crate in the outpost.
  const crate = mantleSpot(world, stands, o);
  if (crate) add({ act: 'mantle', team: 'operator', weapon: RIFLE, post: at(crate, crate.yaw), loop: 4 });

  // In through the outpost building's door and out again.
  const b = world.buildings.find((h) => h.outpost === 0);
  for (let i = 0; b && i < world.doors.length; i++) {
    const d = world.doors[i];
    if (d.pair < i || !inBuilding(b, d.x, d.z, 0.01)) continue;
    const mx = (d.x + world.doors[d.pair].x) / 2;
    const mz = (d.z + world.doors[d.pair].z) / 2;
    if (inBuilding(b, mx - d.openX * 2, mz - d.openZ * 2)) continue;
    const x = mx - d.openX * 2.5;
    const z = mz - d.openZ * 2.5;
    add({ act: 'door', team: 'guard', weapon: RIFLE, post: { x, y: ground(x, z), z, yaw: Math.atan2(-d.openX, -d.openZ) }, loop: 8, door: [i, d.pair] });
    break;
  }

  // The player, between the inner rings, facing the outpost.
  let spawn: Post = at({ x: o.x, z: o.z - 23 }, 0);
  for (let k = 0; k < 16; k++) {
    const a = (k / 16) * Math.PI * 2;
    const x = o.x + Math.sin(a) * 23;
    const z = o.z + Math.cos(a) * 23;
    if (!stands(x, z, 0.8)) continue;
    spawn = at({ x, z }, yawToward(x, z, o.x, o.z));
    break;
  }
  return { actors, spawn };
}

/** Where a grenade thrown from `post` at `pitch` comes to rest. */
function grenadeRest(world: World, post: Post, pitch: number): { x: number; y: number; z: number } {
  const o = eyePosition(world, post.x, post.y, post.z, post.yaw, 0, 0);
  const [dx, dy, dz] = shotDirection(post.yaw, pitch + THROW_LOFT, 0, 0);
  const g = launchGrenade(0, 0, { seq: 0, x: o.x + dx * 0.3, y: o.y + dy * 0.3, z: o.z + dz * 0.3, vx: dx * THROW_SPEED, vy: dy * THROW_SPEED, vz: dz * THROW_SPEED }, 10);
  for (let i = 0; i < 10 / SERVER_DT && !g.rest; i++) stepGrenade(world, g, SERVER_DT);
  return g;
}

/** A spot 1.6 m from a crate in the outpost that a body can climb onto, facing it. */
function mantleSpot(world: World, stands: (x: number, z: number, pad: number) => boolean, o: { x: number; y: number; z: number }): Post | null {
  for (const p of world.props) {
    const b = p.box;
    if (p.style !== 'crate' || b.gone || Math.hypot((b.minX + b.maxX) / 2 - o.x, (b.minZ + b.maxZ) / 2 - o.z) > 14) continue;
    const top = b.maxY - o.y;
    if (top < 0.9 || top > 1.9) continue;
    const cx = (b.minX + b.maxX) / 2;
    const cz = (b.minZ + b.maxZ) / 2;
    for (const [nx, nz, half] of [[1, 0, (b.maxX - b.minX) / 2], [-1, 0, (b.maxX - b.minX) / 2], [0, 1, (b.maxZ - b.minZ) / 2], [0, -1, (b.maxZ - b.minZ) / 2]]) {
      const x = cx + nx * (half + 1.6);
      const z = cz + nz * (half + 1.6);
      if (!stands(x, z, 0.5) || !stands(cx + nx * (half + 0.6), cz + nz * (half + 0.6), 0.3)) continue;
      return { x, y: world.groundHeight(x, z, world.floorHeight(x, z)), z, yaw: yawToward(x, z, cx, cz) };
    }
  }
  return null;
}

/** An actor's name from what it does. */
function label(act: Act): string {
  const s = act.replace(/[A-Z]/g, (c) => ` ${c.toLowerCase()}`);
  return s[0].toUpperCase() + s.slice(1);
}

/** A bot that doesn't think: it plays its routine from the start of each loop. */
export class Actor {
  readonly spec: ActorSpec;
  /** Server time its current loop started. */
  start = 0;
  private readonly world: World;
  /** A shooter's shot this loop was made good already. */
  private settled = false;

  constructor(spec: ActorSpec, world: World) {
    this.spec = spec;
    this.world = world;
  }

  /** Whether a new loop is due at `now`: the server puts it back on its post, and calls restart. */
  due(now: number): boolean {
    return this.spec.loop > 0 && now - this.start >= this.spec.loop - 1e-9;
  }

  restart(now: number): void {
    this.start = now;
    this.settled = false;
  }

  /** For a shooter: whether its shot should have killed by now, once a loop. */
  madeGood(now: number): boolean {
    if (this.spec.act !== 'shooter' || this.settled || now - this.start < FIRE_AT + MADE_GOOD) return false;
    this.settled = true;
    return true;
  }

  /** This tick's commands, numbered on from `seq`. */
  commands(self: PlayerState, target: PlayerState | undefined, now: number, seq: number): InputCmd[] {
    const cmds: InputCmd[] = [];
    for (let i = 0; i < CMDS_PER_TICK; i++) cmds.push(this.command(self, target, now + i * CMD_DT - this.start, seq + i + 1));
    return cmds;
  }

  private command(self: PlayerState, target: PlayerState | undefined, t: number, seq: number): InputCmd {
    const s = this.spec;
    let yaw = s.post.yaw;
    let pitch = 0;
    let weapon = s.weapon;
    let b = 0;
    /** On for `on` seconds in every `every`. */
    const pulse = (every: number, on: number, from = 0) => ((t - from) % every + every) % every < on && t >= from;
    const circle = () => {
      const c = s.center!;
      const r = s.radius!;
      const rx = self.x - c.x;
      const rz = self.z - c.z;
      const d = Math.hypot(rx, rz) || 1;
      // Round the way the tangent goes, pulled back onto the circle.
      const k = (d - r) / r;
      const dx = -rz / d - (rx / d) * k;
      const dz = rx / d - (rz / d) * k;
      yaw = Math.atan2(-dx, -dz);
      b |= Btn.Forward;
    };
    switch (s.act) {
      case 'look':
        yaw += Math.sin(t * 0.8) * 1.2;
        pitch = Math.sin(t * 0.5) * 0.6;
        break;
      case 'turn':
        yaw += t * 1.5;
        break;
      case 'walk':
        circle();
        break;
      case 'sprint':
        circle();
        b |= Btn.Sprint;
        break;
      case 'crouchWalk':
        circle();
        b |= Btn.Crouch;
        break;
      case 'crouchSprint':
        circle();
        b |= Btn.Crouch | Btn.Sprint;
        break;
      case 'leanWalk':
        circle();
        b |= pulse(4, 2) ? Btn.LeanLeft : Btn.LeanRight;
        break;
      case 'heavyWalk':
        circle();
        break;
      case 'runJump':
        circle();
        b |= Btn.Sprint;
        if (pulse(2, CMD_DT * 2)) b |= Btn.Jump;
        break;
      case 'strafe':
        b |= t < 1.5 ? Btn.Left : Btn.Right;
        break;
      case 'backpedal':
        b |= t < 1.5 ? Btn.Back : Btn.Forward;
        break;
      case 'duck':
        if (t < 1.2) b |= Btn.Crouch;
        break;
      case 'lean':
      case 'leanCrouched':
      case 'leanAim':
        if (t < 1.2) b |= Btn.LeanLeft;
        else if (t >= 1.8 && t < 3) b |= Btn.LeanRight;
        if (s.act === 'leanCrouched') b |= Btn.Crouch;
        if (s.act === 'leanAim') b |= Btn.Aim;
        break;
      case 'jump':
        if (t < CMD_DT * 2) b |= Btn.Jump;
        break;
      case 'aim':
      case 'aimCrouched':
        b |= Btn.Aim;
        if (s.act === 'aimCrouched') b |= Btn.Crouch;
        pitch = Math.sin(t * 0.7) * 0.5;
        yaw += Math.sin(t * 0.4) * 0.5;
        break;
      case 'rifle':
        pitch = OVERHEAD;
        b |= Btn.Aim;
        if (pulse(1.5, 0.35, 0.4)) b |= Btn.Fire;
        break;
      case 'pistol':
        pitch = OVERHEAD;
        if (t > 0.3 && t < 2.3 && pulse(0.3, 0.12)) b |= Btn.Fire;
        break;
      case 'bolt':
        pitch = OVERHEAD;
        b |= Btn.Aim;
        if (pulse(1.6, 0.1, 0.5)) b |= Btn.Fire;
        break;
      case 'reload': {
        // A gun at a time: a shot or two, then a reload.
        weapon = [RIFLE, PISTOL, BOLT][Math.floor(this.start / this.spec.loop + 0.5) % 3];
        pitch = OVERHEAD;
        if (t > 1 && t < 1.2) b |= Btn.Fire;
        if (t > 1.6 && t < 1.7) b |= Btn.Reload;
        break;
      }
      case 'switch':
        weapon = [RIFLE, PISTOL, BOLT][Math.floor(t / 1.6) % 3];
        break;
      case 'grenade':
        pitch = s.pitch ?? 0.2;
        if (t > 0.6 && t < 0.7) b |= Btn.Throw;
        break;
      case 'stairs':
        if (t < 2.4) b |= Btn.Forward;
        else if (t >= 3.2 && t < 5.6) {
          yaw += Math.PI;
          b |= Btn.Forward;
        } else if (t >= 2.4) yaw += Math.PI;
        break;
      case 'mantle':
        if (t > 0.2 && t < 1.2) b |= Btn.Forward | Btn.Jump;
        break;
      case 'door':
        if (t < 2) b |= Btn.Forward;
        else if (t >= 3 && t < 5.2) {
          yaw += Math.PI;
          b |= Btn.Forward;
        } else if (t >= 2) yaw += Math.PI;
        break;
      case 'crouchVictim':
        b |= Btn.Crouch;
        break;
      case 'shooter': {
        if (target && !target.dead) {
          const eye = eyePosition(this.world, self.x, self.y, self.z, self.yaw, self.duck, self.lean);
          const h = hitboxes(target);
          const ty = (h.hipY + h.neckY) / 2;
          yaw = yawToward(eye.x, eye.z, h.torsoX, h.torsoZ);
          pitch = Math.atan2(ty - eye.y, Math.hypot(h.torsoX - eye.x, h.torsoZ - eye.z));
        }
        b |= Btn.Aim;
        // Only at someone standing: past a body, the round would go on to whoever is beyond.
        if (target && !target.dead && t >= FIRE_AT && t < FIRE_AT + (weapon === BOLT ? 0.05 : 0.3)) b |= Btn.Fire;
        break;
      }
    }
    // Out of rounds: reload, whatever the routine.
    if (self.mag[self.weapon] === 0 && self.reserve[self.weapon] > 0) b |= Btn.Reload;
    return { seq, buttons: b, yaw, pitch, weapon };
  }
}
