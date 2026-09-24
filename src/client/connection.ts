import { INTERP_DELAY, SERVER_DT } from '../shared/constants.ts';
import { angleDiff, clamp, lerp } from '../shared/geom.ts';
import {
  isReliable, type ClientMsg, type GameEvent, type InputCmd, type PlayerSnap, type ServerMsg,
} from '../shared/protocol.ts';
import type { PlayerState } from '../shared/sim.ts';
import type { WeaponFx } from '../shared/weapons.ts';
import { LagTransport, type Transport } from '../shared/transport.ts';
import type { World } from '../shared/world.ts';
import type { WorldConfig } from '../shared/worldconfig.ts';
import { Predictor } from './prediction.ts';

/** How many unacknowledged commands ride along with each input packet. */
const REDUNDANT_CMDS = 8;
const SNAPSHOT_BUFFER = 32;
const MAX_UNACKED = 256;
const PING_INTERVAL = 1;

class WorkerTransport implements Transport<ClientMsg, ServerMsg> {
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

interface Snapshot {
  time: number;
  players: PlayerSnap[];
}

/**
 * The client's view of the server: sends commands and predicts their effect on
 * the local player, and buffers and interpolates snapshots of everyone else.
 */
export class Connection {
  readonly transport: LagTransport<ClientMsg, ServerMsg>;
  readonly predictor: Predictor;
  id = 0;
  seed = 0;
  /** Round-trip time in ms, smoothed. */
  rtt = 0;
  lastTick = 0;
  /** Predicted effects of the local player's own commands: shots, reloads, switches. */
  onFx: ((fx: WeaponFx) => void) | null = null;
  /** Events from the server: hits, damage taken, kills and other players' shots. */
  onEvents: ((events: GameEvent[]) => void) | null = null;
  /** The server (re)spawned the local player; `state` is where and facing which way. */
  onSpawn: ((state: PlayerState) => void) | null = null;
  private life = 0;
  private seq = 0;
  private ack = 0;
  private readonly unacked: InputCmd[] = [];
  private readonly snapshots: Snapshot[] = [];
  /** Estimate of the server's current time in seconds. */
  private clock = -1;
  private sincePing = PING_INTERVAL;

  constructor(config: WorldConfig, world: World) {
    this.predictor = new Predictor(world);
    this.transport = new LagTransport(new WorkerTransport(), isReliable);
    this.transport.onMessage = (msg) => this.handle(msg);
    this.transport.send({ t: 'hello', name: 'player', world: config });
  }

  get connected(): boolean {
    return this.id !== 0;
  }

  /** Queue one CMD_DT step of input and send it with its unacked predecessors. */
  sendCmd(buttons: number, yaw: number, pitch: number, weapon: number): void {
    if (!this.connected) return;
    const cmd = { seq: ++this.seq, buttons, yaw, pitch, weapon, view: this.renderTime() / SERVER_DT };
    this.unacked.push(cmd);
    this.predictor.predict(cmd, (fx) => this.onFx?.(fx));
    if (this.unacked.length > MAX_UNACKED) this.unacked.shift();
    this.transport.send({ t: 'input', cmds: this.unacked.slice(-REDUNDANT_CMDS) });
  }

  /** Debug: set the carried weight in kg on the server. */
  setCarry(kg: number): void {
    this.transport.send({ t: 'debug', carry: kg });
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
    const snaps = this.snapshots;
    if (snaps.length === 0) return [];
    const t = this.renderTime();
    let i = snaps.length - 1;
    while (i > 0 && snaps[i - 1].time > t) i--;
    if (i === 0) return snaps[0].players;
    const a = snaps[i - 1];
    const b = snaps[i];
    if (t >= b.time) return b.players;
    const f = (t - a.time) / (b.time - a.time);
    return b.players.map((pb) => {
      const pa = a.players.find((p) => p.id === pb.id);
      // Don't slide a body across the map when it respawns.
      if (!pa || pa.dead !== pb.dead) return pb;
      return {
        id: pb.id,
        team: pb.team,
        x: lerp(pa.x, pb.x, f),
        y: lerp(pa.y, pb.y, f),
        z: lerp(pa.z, pb.z, f),
        yaw: pa.yaw + angleDiff(pb.yaw, pa.yaw) * f,
        duck: lerp(pa.duck, pb.duck, f),
        lean: lerp(pa.lean, pb.lean, f),
        dead: pb.dead,
        weapon: pb.weapon,
      };
    });
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
        this.clock = msg.tick * SERVER_DT;
        break;
      case 'pong': {
        const sample = performance.now() - msg.time;
        this.rtt = this.rtt === 0 ? sample : lerp(this.rtt, sample, 0.2);
        break;
      }
      case 'snapshot':
        this.receiveSnapshot(msg.tick, msg.ack, msg.you, msg.players);
        break;
      case 'events':
        this.onEvents?.(msg.events);
        break;
    }
  }

  private receiveSnapshot(tick: number, ack: number, you: PlayerState, players: PlayerSnap[]): void {
    if (!this.connected || tick <= this.lastTick) return; // not welcomed yet, or stale/reordered
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
    this.snapshots.push({ time, players: players.filter((p) => p.id !== this.id) });
    if (this.snapshots.length > SNAPSHOT_BUFFER) this.snapshots.shift();

    // Keep the local clock locked to the server's, jumping only on big drift.
    const drift = time - this.clock;
    if (Math.abs(drift) > 0.25) this.clock = time;
    else this.clock += drift * 0.1;
  }
}
