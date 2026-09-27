import { SERVER_DT } from '../shared/constants.ts';
import type { GameLog } from '../shared/gamelog.ts';
import type { GrenadeSnap, PlayerSnap, ServerMsg } from '../shared/protocol.ts';
import { Rerun } from '../server/rerun.ts';
import type { Snapshot } from './connection.ts';
import { FIELDS, Frames, quantize } from './replayfile.ts';

// A replay's game run again from its log, off the main thread (see
// rerun.worker.ts), to show everyone exactly as they were rather than as the
// player's client saw them. Every tick is checked against the frames the file
// kept: the same bodies there, and each sampled body to the centimetre. Only
// ticks checked are handed on, and at the first that differs (the replay's
// from another build, or this browser works out the maths differently) it
// stops, and the replay goes on with its frames from there.

/** Numbers kept per body in a tick: its id and FIELDS values, as floats. */
const PER_BODY = 1 + FIELDS;

/** Ticks of the game run again, checked: for each, where its numbers start in `data`, and the numbers. */
export interface ExactBatch {
  ticks: number[];
  starts: number[];
  data: Float32Array<ArrayBuffer>;
}

export type ExactNews =
  | { k: 'batch'; batch: ExactBatch }
  /** The game went differently from the file at server time `at`; nothing from then on is exact. */
  | { k: 'diverged'; at: number }
  /** Run to the end, all of it checked. */
  | { k: 'done' };

export interface ExactJob {
  log: GameLog;
  /** The replay's player, and the file's frames of everyone else. */
  watch: number;
  frames: number[];
  from: number;
  to: number;
}

/** Ticks packed per batch sent on. */
const BATCH_TICKS = 150;

const MOTION_CODE = { ground: 0, air: 1, mantle: 2 } as const;
const ACT_CODE = { none: 0, reload: 1, draw: 2, throw: 3 } as const;
const MOTIONS = ['ground', 'air', 'mantle'] as const;
const ACTS = ['none', 'reload', 'draw', 'throw'] as const;

/** A body as numbers: its id, position and look, how crouched and leaning, and its flags. */
function packBody(p: PlayerSnap, out: number[]): void {
  out.push(p.id, p.x, p.y, p.z, p.yaw, p.pitch, p.duck, p.lean, p.actT,
    (p.team === 'guard' ? 1 : 0) | (+p.dead << 1) | (+p.quiet << 2) | (+p.commander << 3) | (+p.light << 4) |
    (MOTION_CODE[p.motion] << 5) | (ACT_CODE[p.act] << 7) | (p.weapon << 9));
}

function unpackBody(d: ArrayLike<number>, at: number): PlayerSnap {
  const f = d[at + 9];
  return {
    id: d[at], team: f & 1 ? 'guard' : 'operator', x: d[at + 1], y: d[at + 2], z: d[at + 3], yaw: d[at + 4], pitch: d[at + 5],
    duck: d[at + 6], lean: d[at + 7], actT: d[at + 8], dead: !!(f & 2), quiet: !!(f & 4), commander: !!(f & 8), light: !!(f & 16),
    motion: MOTIONS[(f >> 5) & 3] ?? 'ground', act: ACTS[(f >> 7) & 3], weapon: f >> 9,
  };
}

/** Runs a replay's game again and checks it against the file, a batch of ticks at a time. */
export class ExactRun {
  private readonly rerun: Rerun;
  private readonly frames: Frames;
  private readonly job: ExactJob;
  /** Frame index by tick. */
  private readonly frameAt = new Map<number, number>();
  /** Ticks run but not yet checked, and packed. */
  private pending: { tick: number; data: number[] }[] = [];
  private checked: { tick: number; data: number[] }[] = [];
  private diverged = -1;
  private finished = false;
  private readonly q: number[] = [];

  constructor(job: ExactJob) {
    this.job = job;
    this.frames = new Frames(job.frames);
    this.frames.times.forEach((t, i) => this.frameAt.set(Math.round(t / SERVER_DT), i));
    this.rerun = new Rerun(job.log, job.watch, (m) => this.heard(m));
  }

  /** Run on until there's news: a batch of ticks checked, the game going differently, or the end. */
  next(): ExactNews {
    for (;;) {
      if (this.checked.length >= BATCH_TICKS || ((this.finished || this.diverged >= 0) && this.checked.length)) return { k: 'batch', batch: this.batch() };
      if (this.diverged >= 0) return { k: 'diverged', at: this.diverged };
      if (this.finished) return { k: 'done' };
      if (!this.rerun.ok) this.diverged = this.rerun.time;
      else if (this.rerun.time > this.job.to + SERVER_DT) this.finished = true;
      else this.rerun.step();
    }
  }

  private heard(m: ServerMsg): void {
    if (m.t !== 'snapshot' || this.diverged >= 0) return;
    const time = m.tick * SERVER_DT;
    if (time < this.job.from - SERVER_DT) return;
    const data: number[] = [m.players.length - (m.players.some((p) => p.id === this.job.watch) ? 1 : 0)];
    for (const p of m.players) if (p.id !== this.job.watch) packBody(p, data);
    data.push(m.grenades.length);
    for (const g of m.grenades) data.push(g.id, g.x, g.y, g.z);
    this.pending.push({ tick: m.tick, data });
    const frame = this.frameAt.get(m.tick);
    if (frame === undefined) return;
    if (!this.matches(frame, m.players)) {
      this.diverged = time;
      this.pending = [];
      return;
    }
    this.checked.push(...this.pending);
    this.pending = [];
  }

  /** Whether the bodies in the file's frame are those run again: the same ones, and every one it sampled to the centimetre. */
  private matches(frame: number, players: readonly PlayerSnap[]): boolean {
    const kept = this.frames.quantized(frame);
    const watch = this.job.watch;
    const ids = new Set(players.filter((p) => p.id !== watch).map((p) => p.id));
    const keptIds = kept.ids.filter((id) => id !== watch);
    if (ids.size !== keptIds.length || keptIds.some((id) => !ids.has(id))) return false;
    for (const id of kept.sampled) {
      if (id === watch) continue;
      quantize(players.find((p) => p.id === id)!, this.q);
      const want = kept.q.get(id)!;
      for (let f = 0; f < FIELDS; f++) if (this.q[f] !== want[f]) return false;
    }
    return true;
  }

  private batch(): ExactBatch {
    const ticks: number[] = [];
    const starts: number[] = [];
    let size = 0;
    for (const t of this.checked) size += t.data.length;
    const data = new Float32Array(size);
    let at = 0;
    for (const t of this.checked) {
      ticks.push(t.tick);
      starts.push(at);
      data.set(t.data, at);
      at += t.data.length;
    }
    this.checked = [];
    return { ticks, starts, data };
  }
}

/** The ticks run again and checked so far, as snapshots of everyone but the replay's player. */
export class ExactTrack {
  /** Server time from which nothing is exact, once the game went differently. */
  divergedAt = Infinity;
  done = false;
  private readonly ticks = new Map<number, Float32Array>();
  private readonly cache = new Map<number, Snapshot>();

  add(b: ExactBatch): void {
    b.ticks.forEach((tick, i) => this.ticks.set(tick, b.data.subarray(b.starts[i], b.starts[i + 1] ?? b.data.length)));
  }

  /** How many ticks are in. */
  get size(): number {
    return this.ticks.size;
  }

  /** The two ticks either side of server time `t`, if both are in and before any divergence. */
  around(t: number): Snapshot[] | null {
    if (t >= this.divergedAt - SERVER_DT) return null;
    const a = Math.floor(t / SERVER_DT + 1e-6);
    const sa = this.at(a);
    const sb = this.at(a + 1);
    return sa && sb ? [sa, sb] : null;
  }

  private at(tick: number): Snapshot | null {
    let s = this.cache.get(tick);
    if (s) return s;
    const d = this.ticks.get(tick);
    if (!d) return null;
    const players: PlayerSnap[] = [];
    let at = 1;
    for (let n = d[0]; n > 0; n--, at += PER_BODY) players.push(unpackBody(d, at));
    const grenades: GrenadeSnap[] = [];
    for (let n = d[at++]; n > 0; n--, at += 4) grenades.push({ id: d[at], x: d[at + 1], y: d[at + 2], z: d[at + 3] });
    s = { time: tick * SERVER_DT, players, grenades };
    if (this.cache.size > 6) this.cache.delete(this.cache.keys().next().value!);
    this.cache.set(tick, s);
    return s;
  }
}
