// Everything the humans in a game did, by the tick the server heard it. The
// server is deterministic given its seed and options, so this log is enough
// to run the whole game again, bots and all, exactly as it went: that's how a
// replay shows everyone exactly (see src/server/rerun.ts).

import type { ByteReader, ByteWriter } from './bytes.ts';
import type { Conditions } from './conditions.ts';
import type { ClientMsg, InputCmd, Mode } from './protocol.ts';

/** How the game was set up; plain data, the same as the server's options. */
export interface LogOptions {
  mode?: Mode;
  guards?: boolean;
  conditions?: Conditions;
  operators?: number;
  personality?: 'rat' | 'hunter' | 'camper' | 'looter';
}

/** Something a human did: joined, sent a message (never a ping or pause), or dropped out. */
export type Logged = { t: 'join' } | { t: 'drop' } | Exclude<ClientMsg, { t: 'ping' } | { t: 'pause' }>;

/** What happened before server tick `tick + 1` was simulated, from the human with id `id`. */
export interface LogEntry {
  tick: number;
  id: number;
  msg: Logged;
}

export interface GameLog {
  seed: number;
  options: LogOptions;
  entries: LogEntry[];
}

/** Look angles sent are whole steps of this many radians; see quantizeLook. */
export const LOOK_STEP = 1e-5;
/** The tick a command was sampled at is sent in whole thousandths. */
export const VIEW_STEP = 1e-3;

/** A look angle rounded to LOOK_STEP, as the client sends it. */
export function quantizeLook(a: number): number {
  return Math.round(a / LOOK_STEP) * LOOK_STEP;
}

/** A command's view tick rounded to VIEW_STEP, as the client sends it. */
export function quantizeView(v: number): number {
  return Math.round(v / VIEW_STEP) * VIEW_STEP;
}

const KINDS = ['join', 'drop', 'hello', 'leave', 'input', 'dev'] as const;

/** Whether a value is a whole number of `step`s, so it can be stored as that whole number and come back the same. */
function whole(v: number, step: number): boolean {
  return Math.round(v / step) * step === v;
}

/** A human's commands stored elsewhere, such as a replay's player's on their tape, so the log needn't repeat them. */
export interface KnownCmds {
  id: number;
  cmds: readonly InputCmd[];
}

/** The same command, but for the view tick, which the tape doesn't keep. */
function same(a: InputCmd, b: InputCmd): boolean {
  return a.seq === b.seq && a.buttons === b.buttons && a.yaw === b.yaw && a.pitch === b.pitch && a.weapon === b.weapon;
}

/**
 * The log into bytes. Commands are stored as changes from the same human's
 * last: seq, look in whole LOOK_STEPs and the view tick in whole thousandths
 * from the entry's tick. If any doesn't fit, look and view are kept as floats.
 * Those in `known` are only pointed at, with their view tick.
 */
export function writeLog(w: ByteWriter, log: GameLog, known?: KnownCmds): void {
  const knownBySeq = new Map(known?.cmds.map((c) => [c.seq, c]));
  w.uint(log.seed >>> 0);
  w.text(JSON.stringify(log.options));
  const cmds = log.entries.flatMap((e) => (e.msg.t === 'input' ? e.msg.cmds : []));
  const exact = cmds.every((c) => whole(c.yaw, LOOK_STEP) && whole(c.pitch, LOOK_STEP) && (c.view === undefined || whole(c.view, VIEW_STEP)));
  w.uint(exact ? 1 : 0);
  w.uint(log.entries.length);
  const last = new Map<number, { seq: number; yaw: number; pitch: number; view: number }>();
  let tick = 0;
  for (const e of log.entries) {
    w.uint(e.tick - tick);
    tick = e.tick;
    w.uint(e.id);
    const kind = KINDS.indexOf(e.msg.t);
    w.uint(kind);
    const m = e.msg;
    if (m.t === 'hello') w.text(JSON.stringify({ name: m.name, world: m.world, mode: m.mode }));
    else if (m.t === 'dev') w.text(JSON.stringify(m.cmd));
    else if (m.t === 'input') {
      let l = last.get(e.id);
      if (!l) last.set(e.id, (l = { seq: 0, yaw: 0, pitch: 0, view: 0 }));
      w.uint(m.cmds.length);
      for (const c of m.cmds) {
        w.int(c.seq - l.seq);
        l.seq = c.seq;
        const k = e.id === known?.id ? knownBySeq.get(c.seq) : undefined;
        const found = !!k && same(k, c);
        // 0 or 1 for a known command, without or with a view; else buttons and weapon follow.
        w.uint(found ? (c.view === undefined ? 0 : 1) : 2 + (c.view === undefined ? 0 : 1));
        if (!found) {
          w.uint(c.buttons);
          w.uint(c.weapon === undefined ? 0 : c.weapon + 1);
        }
        if (exact) {
          const yaw = Math.round(c.yaw / LOOK_STEP);
          const pitch = Math.round(c.pitch / LOOK_STEP);
          if (!found) {
            w.int(yaw - l.yaw);
            w.int(pitch - l.pitch);
          }
          l.yaw = yaw;
          l.pitch = pitch;
          if (c.view !== undefined) {
            const view = Math.round(c.view / VIEW_STEP) - tick * 1000;
            w.int(view - l.view);
            l.view = view;
          }
        } else {
          if (!found) {
            w.float(c.yaw);
            w.float(c.pitch);
          }
          if (c.view !== undefined) w.float(c.view);
        }
      }
    }
  }
}

export function readLog(r: ByteReader, known?: KnownCmds): GameLog {
  const knownBySeq = new Map(known?.cmds.map((c) => [c.seq, c]));
  const seed = r.uint();
  const options = JSON.parse(r.text()) as LogOptions;
  const exact = r.uint() === 1;
  const n = r.uint();
  const entries: LogEntry[] = [];
  const last = new Map<number, { seq: number; yaw: number; pitch: number; view: number }>();
  let tick = 0;
  for (let i = 0; i < n; i++) {
    tick += r.uint();
    const id = r.uint();
    const kind = KINDS[r.uint()];
    let msg: Logged;
    switch (kind) {
      case 'hello': {
        const { name, world, mode } = JSON.parse(r.text());
        msg = { t: 'hello', name, world, mode };
        break;
      }
      case 'dev':
        msg = { t: 'dev', cmd: JSON.parse(r.text()) };
        break;
      case 'input': {
        let l = last.get(id);
        if (!l) last.set(id, (l = { seq: 0, yaw: 0, pitch: 0, view: 0 }));
        const cmds: InputCmd[] = [];
        for (let k = r.uint(); k > 0; k--) {
          l.seq += r.int();
          const how = r.uint();
          const hasView = how % 2 === 1;
          const k = how < 2 ? knownBySeq.get(l.seq) : undefined;
          if (how < 2 && (!k || id !== known?.id)) throw new RangeError('Not a game log');
          const cmd: InputCmd = { seq: l.seq, buttons: k ? k.buttons : r.uint(), yaw: 0, pitch: 0 };
          const weapon = k ? (k.weapon ?? -1) + 1 : r.uint();
          if (weapon) cmd.weapon = weapon - 1;
          if (exact) {
            if (k) {
              l.yaw = Math.round(k.yaw / LOOK_STEP);
              l.pitch = Math.round(k.pitch / LOOK_STEP);
            } else {
              l.yaw += r.int();
              l.pitch += r.int();
            }
            cmd.yaw = l.yaw * LOOK_STEP;
            cmd.pitch = l.pitch * LOOK_STEP;
            if (hasView) {
              l.view += r.int();
              cmd.view = (l.view + tick * 1000) * VIEW_STEP;
            }
          } else {
            cmd.yaw = k ? k.yaw : r.float();
            cmd.pitch = k ? k.pitch : r.float();
            if (hasView) cmd.view = r.float();
          }
          cmds.push(cmd);
        }
        msg = { t: 'input', cmds };
        break;
      }
      case 'join':
      case 'drop':
      case 'leave':
        msg = { t: kind };
        break;
      default:
        throw new RangeError('Not a game log');
    }
    entries.push({ tick, id, msg });
  }
  return { seed, options, entries };
}
