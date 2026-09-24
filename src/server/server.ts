import {
  CARRY_MAX,
  CMD_DT,
  MAX_CMDS_PER_TICK,
  MAX_REWIND,
  PLAYER_HEIGHT,
  RESPAWN_TIME,
  SERVER_DT,
  SERVER_TICK_RATE,
  SPAWN_PROTECTION,
} from '../shared/constants.ts';
import { angleDiff, clamp, lerp } from '../shared/geom.ts';
import { rayBody, type Pose, type Zone } from '../shared/hitbox.ts';
import type { ClientMsg, GameEvent, InputCmd, PlayerSnap, ServerMsg } from '../shared/protocol.ts';
import { mulberry32 } from '../shared/rng.ts';
import { applyCmd, copyState, spawnState, type PlayerState } from '../shared/sim.ts';
import { damageAt, WEAPONS, type Shot } from '../shared/weapons.ts';
import { World } from '../shared/world.ts';
import { dummyCmds, layoutRange, type DummyKind, type Post, type RangeLayout } from './range.ts';

/** Commands buffered beyond this are dropped; the client is too far ahead. */
const MAX_QUEUED_CMDS = MAX_CMDS_PER_TICK * 4;
const HISTORY_TICKS = Math.ceil(MAX_REWIND * SERVER_TICK_RATE) + 2;
/** Humans spawn spread sideways across the range origin by up to this much. */
const SPAWN_SPREAD = 3;

interface Player extends PlayerState {
  id: number;
  name: string;
  send: (msg: ServerMsg) => void;
  /** Set once the client says hello; until then it gets no snapshots. */
  joined: boolean;
  queue: InputCmd[];
  /** Highest seq received, to discard redundant resends. */
  lastRecv: number;
  /** Highest seq simulated, echoed back as the snapshot ack. */
  lastSim: number;
  /** Seconds until respawning, while dead. */
  respawn: number;
  /** Seconds of spawn protection left. */
  protection: number;
  /** Events to send this tick. */
  events: GameEvent[];
  /** Set for target dummies: where they stand and how they move. */
  dummy: (Post & { kind: DummyKind; index: number }) | null;
}

interface PoseRecord extends Pose {
  id: number;
  dead: boolean;
  life: number;
}

export interface ServerOptions {
  /** Populate the shooting range with target dummies (default true). */
  dummies?: boolean;
}

/**
 * The authoritative game. It knows nothing about Workers or sockets: a host
 * calls connect/receive/disconnect and drives tick() at SERVER_TICK_RATE.
 */
export class GameServer {
  readonly seed: number;
  readonly world: World;
  readonly range: RangeLayout;
  tick = 0;
  private readonly players = new Map<number, Player>();
  private readonly spawnRng: () => number;
  /** Where everyone stood at the end of each recent tick, oldest first, for rewinding shots. */
  private readonly history: { tick: number; poses: PoseRecord[] }[] = [];
  private nextId = 1;

  constructor(seed: number, options: ServerOptions = {}) {
    this.seed = seed >>> 0;
    this.world = new World(this.seed);
    this.spawnRng = mulberry32(this.seed ^ 0x5bd1e995);
    this.range = layoutRange(this.world, mulberry32(this.seed ^ 0x2545f491));
    if (options.dummies ?? true) {
      this.range.dummies.forEach((post, index) => {
        const p = this.add(`Dummy ${index + 1}`, () => {});
        p.joined = true;
        p.dummy = { ...post, index };
        this.spawn(p);
      });
    }
  }

  connect(send: (msg: ServerMsg) => void): number {
    const p = this.add('player', send);
    this.spawn(p);
    return p.id;
  }

  disconnect(id: number): void {
    this.players.delete(id);
  }

  receive(id: number, msg: ClientMsg): void {
    const p = this.players.get(id);
    if (!p) return;
    switch (msg.t) {
      case 'hello':
        p.joined = true;
        p.name = msg.name.slice(0, 24) || 'player';
        p.send({ t: 'welcome', id, seed: this.seed, tick: this.tick, tickRate: SERVER_TICK_RATE });
        break;
      case 'ping':
        p.send({ t: 'pong', time: msg.time });
        break;
      case 'input':
        if (!p.joined) break;
        for (const cmd of msg.cmds) {
          if (cmd.seq <= p.lastRecv) continue;
          p.lastRecv = cmd.seq;
          p.queue.push(cmd);
        }
        if (p.queue.length > MAX_QUEUED_CMDS) p.queue.splice(0, p.queue.length - MAX_QUEUED_CMDS);
        break;
      case 'debug':
        p.carry = clamp(msg.carry, 0, CARRY_MAX) || 0;
        break;
    }
  }

  step(): void {
    this.tick++;
    for (const p of this.players.values()) {
      if (p.dummy) p.queue.push(...dummyCmds(p.dummy, p.dummy.index, this.tick, p.lastSim));
      const n = Math.min(p.queue.length, MAX_CMDS_PER_TICK);
      for (let i = 0; i < n; i++) {
        const cmd = p.queue[i];
        applyCmd(this.world, p, cmd, CMD_DT, (fx) => {
          if (fx.k === 'shot') this.fire(p, fx.shot, cmd.view);
        });
        p.lastSim = cmd.seq;
      }
      p.queue.splice(0, n);
    }

    for (const p of this.players.values()) {
      p.protection = Math.max(p.protection - SERVER_DT, 0);
      if (!p.dead) continue;
      p.respawn -= SERVER_DT;
      if (p.respawn <= 0) this.spawn(p);
    }

    this.history.push({ tick: this.tick, poses: [...this.players.values()].map(poseOf) });
    if (this.history.length > HISTORY_TICKS) this.history.shift();

    const joined = [...this.players.values()].filter((p) => p.joined);
    const players: PlayerSnap[] = joined.map(({ id, x, y, z, yaw, duck, lean, dead, weapon }) => (
      { id, x, y, z, yaw, duck, lean, dead, weapon }
    ));
    for (const p of joined) {
      p.send({ t: 'snapshot', tick: this.tick, ack: p.lastSim, you: copyState(p), players });
      if (p.events.length) p.send({ t: 'events', tick: this.tick, events: p.events });
      p.events = [];
    }
  }

  private add(name: string, send: (msg: ServerMsg) => void): Player {
    const p: Player = {
      ...spawnState(0, 0, 0), id: this.nextId++, name, send, joined: false, queue: [], lastRecv: 0, lastSim: 0,
      respawn: 0, protection: 0, events: [], dummy: null,
    };
    this.players.set(p.id, p);
    return p;
  }

  /** (Re)spawn a player with full health and ammo: dummies at their post, humans at the range. */
  private spawn(p: Player): void {
    let post: Post & { pitch?: number };
    if (p.dummy) post = p.dummy;
    else {
      const o = this.range.origin;
      const side = (this.spawnRng() * 2 - 1) * SPAWN_SPREAD;
      const x = o.x + Math.cos(o.yaw) * side;
      const z = o.z - Math.sin(o.yaw) * side;
      const y = this.world.groundHeight(x, z, o.y + 1);
      post = this.world.fits(x, y, z, PLAYER_HEIGHT) ? { x, y, z, yaw: o.yaw, pitch: o.pitch } : o;
    }
    Object.assign(p, spawnState(post.x, post.y, post.z), { yaw: post.yaw, pitch: post.pitch ?? 0, carry: p.carry, life: p.life + 1 });
    p.respawn = 0;
    p.protection = p.dummy ? 0 : SPAWN_PROTECTION;
  }

  /**
   * Judge a round: rewind everyone else to where the shooter saw them, find
   * the nearest body the round meets before the world stops it, and apply
   * damage. Everyone else gets the shot as a tracer.
   */
  private fire(shooter: Player, shot: Shot, view: number | undefined): void {
    shooter.protection = 0;
    const w = WEAPONS[shot.weapon];
    const { ox, oy, oz, dx, dy, dz } = shot;
    const wall = this.world.raycast(ox, oy, oz, dx, dy, dz, w.range);
    let t = Math.min(wall, w.range);
    let victim: Player | null = null;
    let zone: Zone = 'torso';
    for (const pose of this.posesAt(view)) {
      if (pose.id === shooter.id || pose.dead) continue;
      const target = this.players.get(pose.id);
      // Skip bodies that have died or respawned since the moment being judged.
      if (!target || target.dead || target.life !== pose.life) continue;
      const hit = rayBody(pose, ox, oy, oz, dx, dy, dz, t);
      if (hit && hit.t < t) {
        t = hit.t;
        victim = target;
        zone = hit.zone;
      }
    }

    const ex = ox + dx * t;
    const ey = oy + dy * t;
    const ez = oz + dz * t;
    const struck = victim ? 'body' : wall <= w.range ? 'world' : 'none';
    for (const p of this.players.values()) {
      if (p !== shooter) p.events.push({ k: 'shot', id: shooter.id, weapon: shot.weapon, ox, oy, oz, ex, ey, ez, struck });
    }
    if (victim) this.damage(victim, shooter, damageAt(shot.weapon, t, zone), zone, shot.weapon, ex, ey, ez);
  }

  private damage(victim: Player, attacker: Player, amount: number, zone: Zone, weapon: number, x: number, y: number, z: number): void {
    if (victim.protection > 0) amount = 0;
    amount = Math.min(amount, victim.hp);
    victim.hp -= amount;
    const killed = victim.hp <= 0;
    attacker.events.push({ k: 'hit', target: victim.id, zone, damage: amount, killed, x, y, z });
    victim.events.push({ k: 'hurt', damage: amount, x: attacker.x, z: attacker.z });
    if (!killed) return;
    victim.dead = true;
    victim.respawn = RESPAWN_TIME;
    victim.vx = victim.vy = victim.vz = 0;
    for (const p of this.players.values()) {
      p.events.push({
        k: 'kill', killer: attacker.id, victim: victim.id, killerName: attacker.name, victimName: victim.name,
        weapon, head: zone === 'head',
      });
    }
  }

  /**
   * Everyone's pose at a past, possibly fractional, tick, blended between the
   * recorded ticks around it and clamped to the rewind window. Without a view
   * tick, the latest record.
   */
  private posesAt(view: number | undefined): PoseRecord[] {
    const h = this.history;
    if (h.length === 0) return [...this.players.values()].map(poseOf);
    const latest = h[h.length - 1];
    if (view === undefined) return latest.poses;
    const v = clamp(view, Math.max(h[0].tick, this.tick - MAX_REWIND * SERVER_TICK_RATE), latest.tick);
    let i = h.length - 1;
    while (i > 0 && h[i - 1].tick > v) i--;
    if (i === 0 || h[i].tick <= v) return h[i].poses;
    const a = h[i - 1];
    const b = h[i];
    const f = (v - a.tick) / (b.tick - a.tick);
    return b.poses.map((pb) => {
      const pa = a.poses.find((p) => p.id === pb.id);
      if (!pa || pa.life !== pb.life) return pb;
      const near = f < 0.5 ? pa : pb;
      return {
        id: pb.id,
        x: lerp(pa.x, pb.x, f),
        y: lerp(pa.y, pb.y, f),
        z: lerp(pa.z, pb.z, f),
        yaw: pa.yaw + angleDiff(pb.yaw, pa.yaw) * f,
        duck: lerp(pa.duck, pb.duck, f),
        lean: lerp(pa.lean, pb.lean, f),
        dead: near.dead,
        life: pb.life,
      };
    });
  }
}

function poseOf(p: Player): PoseRecord {
  return { id: p.id, x: p.x, y: p.y, z: p.z, yaw: p.yaw, duck: p.duck, lean: p.lean, dead: p.dead, life: p.life };
}
