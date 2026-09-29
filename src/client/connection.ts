import { INTERP_DELAY, SERVER_DT } from '../shared/constants.ts';
import { angleDiff, clamp, lerp } from '../shared/geom.ts';
import type {
  BagSnap, BountyView, ClientMsg, CoverState, ExtractView, GameEvent, GrenadeSnap, InputCmd, Mode, PlayerSnap, RunView, ServerMsg,
} from '../shared/protocol.ts';
import type { PlayerState } from '../shared/sim.ts';
import { TAPE_TIME } from '../shared/tape.ts';
import type { WeaponFx } from '../shared/weapons.ts';
import type { LagTransport, Transport } from '../shared/transport.ts';
import type { World } from '../shared/world.ts';
import type { WorldConfig } from '../shared/worldconfig.ts';
import { Predictor } from './prediction.ts';

/** How many unacknowledged commands ride along with each input packet. */
const REDUNDANT_CMDS = 8;
const SNAPSHOT_BUFFER = 32;
const MAX_UNACKED = 256;
const PING_INTERVAL = 1;

/** The local game host, running in a Web Worker. */
export class WorkerTransport implements Transport<ClientMsg, ServerMsg> {
  onMessage: ((msg: ServerMsg) => void) | null = null;
  private readonly worker: Worker;

  constructor() {
    this.worker = new Worker(new URL('../server/worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (e: MessageEvent<ServerMsg>) => this.onMessage?.(e.data);
  }

  send(msg: ClientMsg): void {
    this.worker.postMessage(msg);
  }
}

/** What a snapshot showed, at server time `time` in seconds. */
export interface Snapshot {
  time: number;
  players: PlayerSnap[];
  grenades: GrenadeSnap[];
}

/** Events worth showing again in a death cam: rounds, explosions, and panels breaking and being rebuilt. */
export type RecordedEvent = Extract<GameEvent, { k: 'shot' } | { k: 'boom' } | { k: 'break' } | { k: 'repair' }>;

function isRecordedEvent(e: GameEvent): e is RecordedEvent {
  return e.k === 'shot' || e.k === 'boom' || e.k === 'break' || e.k === 'repair' || e.k === 'door';
}

/** The last few seconds as this client saw them, everyone included, for the death cam. */
export interface Recording {
  snapshots: Snapshot[];
  events: { time: number; e: RecordedEvent }[];
}

/**
 * The client's view of the server for one run: sends commands and predicts
 * their effect on the local player, and buffers and interpolates snapshots of
 * everyone else.
 */
export class Connection {
  readonly transport: LagTransport<ClientMsg, ServerMsg>;
  readonly predictor: Predictor;
  id = 0;
  seed = 0;
  mode: Mode = 'offline';
  /** The local player's run, the extraction points and the bags on the ground, as of the latest snapshot. */
  run: RunView | null = null;
  extracts: ExtractView[] = [];
  bags: BagSnap[] = [];
  bounty: BountyView | null = null;
  /** Set once the run has ended: no more commands are sent. */
  over = false;
  /** Panels down right now, as the server says; what the world shows can differ while a death cam plays. */
  readonly broken = new Set<number>();
  /** Door leaves open right now. */
  readonly open = new Set<number>();

  /** The cover as it stands now. */
  get cover(): CoverState {
    return { broken: [...this.broken], open: [...this.open] };
  }
  /** Round-trip time in ms, smoothed. */
  rtt = 0;
  lastTick = 0;
  /** Predicted effects of the local player's own commands: shots, reloads, switches. */
  onFx: ((fx: WeaponFx) => void) | null = null;
  /** Events from the server: hits, damage taken, kills and other players' shots. */
  onEvents: ((events: GameEvent[], time: number) => void) | null = null;
  /** The server (re)spawned the local player; `state` is where and facing which way. */
  onSpawn: ((state: PlayerState) => void) | null = null;
  /** Joined: this is how the cover stands right now. */
  onWelcome: ((cover: CoverState) => void) | null = null;
  private life = 0;
  private seq = 0;
  private ack = 0;
  private readonly unacked: InputCmd[] = [];
  private readonly snapshots: Snapshot[] = [];
  private readonly recording: Recording = { snapshots: [], events: [] };
  /** Estimate of the server's current time in seconds. */
  private clock = -1;
  private sincePing = PING_INTERVAL;

  /** Quick-joins a game of `mode` on the island as `name`; the transport is shared by every run. */
  constructor(config: WorldConfig, world: World, mode: Mode, name: string, transport: LagTransport<ClientMsg, ServerMsg>) {
    this.predictor = new Predictor(world);
    this.transport = transport;
    this.transport.onMessage = (msg) => this.handle(msg);
    this.transport.send({ t: 'hello', name, world: config, mode });
  }

  /** A copy of the last TAPE_TIME seconds as this client saw them. */
  recorded(): Recording {
    return { snapshots: [...this.recording.snapshots], events: [...this.recording.events] };
  }

  /** Back to the menu. */
  leave(): void {
    this.over = true;
    this.transport.onMessage = null;
    this.transport.send({ t: 'leave' });
  }

  get connected(): boolean {
    return this.id !== 0;
  }

  /** Queue one CMD_DT step of input and send it with its unacked predecessors. */
  sendCmd(buttons: number, yaw: number, pitch: number, weapon: number): void {
    if (!this.connected || this.over) return;
    const cmd = { seq: ++this.seq, buttons, yaw, pitch, weapon, view: this.renderTime() / SERVER_DT };
    this.unacked.push(cmd);
    this.predictor.predict(cmd, (fx) => this.onFx?.(fx));
    if (this.unacked.length > MAX_UNACKED) this.unacked.shift();
    this.transport.send({ t: 'input', cmds: this.unacked.slice(-REDUNDANT_CMDS) });
  }

  /** Advance local clocks; call once per rendered frame. */
  update(dt: number): void {
    if (this.clock >= 0) this.clock += dt;
    this.predictor.update(dt);
    this.sincePing += dt;
    if (this.connected && this.sincePing >= PING_INTERVAL) {
      this.sincePing = 0;
      this.transport.send({ t: 'ping', time: performance.now() });
    }
  }

  /**
   * The server time, in seconds, that other players are drawn at: INTERP_DELAY
   * behind the server, within the snapshots buffered. Commands carry it so the
   * server can judge shots against what the player saw.
   */
  renderTime(): number {
    const snaps = this.snapshots;
    if (snaps.length === 0) return this.lastTick * SERVER_DT;
    return clamp(this.clock - INTERP_DELAY, snaps[0].time, snaps[snaps.length - 1].time);
  }

  /** Other players as they were at renderTime, blended between buffered snapshots. */
  interpolated(): PlayerSnap[] {
    return playersAt(this.snapshots, this.renderTime());
  }

  /**
   * Everyone, this player too, as the server had them at `time`: the same
   * whether now or replayed in a death cam, for bodies falling against them.
   */
  everyoneAt(time: number): PlayerSnap[] {
    return playersAt(this.recording.snapshots, time);
  }

  /** Live grenades as they were at renderTime. */
  grenades(): GrenadeSnap[] {
    return grenadesAt(this.snapshots, this.renderTime());
  }

  /** Commands sent but not yet simulated by the server. */
  get pendingCmds(): number {
    return this.unacked.length;
  }

  private handle(msg: ServerMsg): void {
    switch (msg.t) {
      case 'welcome':
        this.id = msg.id;
        this.seed = msg.seed;
        this.mode = msg.mode;
        this.clock = msg.tick * SERVER_DT;
        for (const i of msg.broken) this.broken.add(i);
        for (const i of msg.open) this.open.add(i);
        this.onWelcome?.(this.cover);
        break;
      case 'pong': {
        const sample = performance.now() - msg.time;
        this.rtt = this.rtt === 0 ? sample : lerp(this.rtt, sample, 0.2);
        break;
      }
      case 'snapshot':
        if (this.receiveSnapshot(msg.tick, msg.ack, msg.you, msg.players, msg.grenades)) {
          this.run = msg.run;
          this.extracts = msg.extracts;
          this.bags = msg.bags;
          this.bounty = msg.bounty;
        }
        break;
      case 'events':
        for (const e of msg.events) {
          if (isRecordedEvent(e)) this.recording.events.push({ time: msg.tick * SERVER_DT, e });
          if (e.k === 'break') for (const i of e.panels) this.broken.add(i);
          if (e.k === 'repair') for (const i of e.panels) this.broken.delete(i);
          if (e.k === 'door') for (const i of e.doors) (e.open ? this.open.add(i) : this.open.delete(i));
        }
        this.trimRecording(msg.tick * SERVER_DT);
        this.onEvents?.(msg.events, msg.tick * SERVER_DT);
        break;
    }
  }

  /** Returns false for a snapshot that was ignored. */
  private receiveSnapshot(tick: number, ack: number, you: PlayerState, players: PlayerSnap[], grenades: GrenadeSnap[]): boolean {
    if (!this.connected || tick <= this.lastTick) return false; // not welcomed yet, or stale/reordered
    this.lastTick = tick;
    if (ack > this.ack) {
      this.ack = ack;
      while (this.unacked.length && this.unacked[0].seq <= ack) this.unacked.shift();
    }
    this.predictor.reconcile(you, this.unacked);
    if (you.life !== this.life) {
      this.life = you.life;
      this.onSpawn?.(you);
    }

    const time = tick * SERVER_DT;
    this.snapshots.push({ time, players: players.filter((p) => p.id !== this.id), grenades });
    if (this.snapshots.length > SNAPSHOT_BUFFER) this.snapshots.shift();
    this.recording.snapshots.push({ time, players, grenades });
    this.trimRecording(time);

    // Keep the local clock locked to the server's, jumping only on big drift.
    const drift = time - this.clock;
    if (Math.abs(drift) > 0.25) this.clock = time;
    else this.clock += drift * 0.1;
    return true;
  }

  private trimRecording(now: number): void {
    const { snapshots, events } = this.recording;
    while (snapshots.length && snapshots[0].time < now - TAPE_TIME) snapshots.shift();
    while (events.length && events[0].time < now - TAPE_TIME) events.shift();
  }
}

/** Where everyone in `snaps` (oldest first) was at server time `t`, blended between the snapshots around it. */
export function playersAt(snaps: readonly Snapshot[], t: number): PlayerSnap[] {
  if (snaps.length === 0) return [];
  let i = snaps.length - 1;
  while (i > 0 && snaps[i - 1].time > t) i--;
  if (i === 0) return snaps[0].players;
  const a = snaps[i - 1];
  const b = snaps[i];
  if (t >= b.time) return b.players;
  const f = (t - a.time) / (b.time - a.time);
  // Those in the earlier snapshot, as they are until the next: someone gone by it is there until then.
  return a.players.map((pa) => {
    const pb = b.players.find((p) => p.id === pa.id);
    // Don't slide a body across the map when it dies or respawns.
    if (!pb || pa.dead !== pb.dead) return pa;
    return {
      id: pa.id,
      team: pa.team,
      x: lerp(pa.x, pb.x, f),
      y: lerp(pa.y, pb.y, f),
      z: lerp(pa.z, pb.z, f),
      yaw: pa.yaw + angleDiff(pb.yaw, pa.yaw) * f,
      pitch: lerp(pa.pitch, pb.pitch, f),
      duck: lerp(pa.duck, pb.duck, f),
      lean: lerp(pa.lean, pb.lean, f),
      // What they're doing holds until the next snapshot says otherwise.
      dead: pa.dead,
      weapon: pa.weapon,
      quiet: pa.quiet,
      motion: pa.motion,
      act: pa.act,
      actT: pa.act === pb.act && pb.actT >= pa.actT ? lerp(pa.actT, pb.actT, f) : pa.actT,
      ...(pa.rounds !== undefined && { rounds: pa.rounds }),
      commander: pa.commander,
      light: pa.light,
    };
  });
}

/** Live grenades in `snaps` at server time `t`. */
export function grenadesAt(snaps: readonly Snapshot[], t: number): GrenadeSnap[] {
  if (snaps.length === 0) return [];
  let i = snaps.length - 1;
  while (i > 0 && snaps[i - 1].time > t) i--;
  const b = snaps[i];
  const a = snaps[i - 1];
  if (!a || t >= b.time) return b.grenades;
  const f = (t - a.time) / (b.time - a.time);
  return b.grenades.map((gb) => {
    const ga = a.grenades.find((g) => g.id === gb.id);
    return ga ? { id: gb.id, x: lerp(ga.x, gb.x, f), y: lerp(ga.y, gb.y, f), z: lerp(ga.z, gb.z, f) } : gb;
  });
}
