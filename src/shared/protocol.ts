// Messages that cross the client/server boundary. Today that boundary is a Web
// Worker; later it is a WebSocket. Everything here must survive structured
// cloning and JSON, so only plain data.

import type { PlayerState } from './sim.ts';
import type { WorldConfig } from './worldconfig.ts';

/** One fixed CMD_DT step of player intent. Bots produce these too. */
export interface InputCmd {
  seq: number;
  buttons: number;
  yaw: number;
  pitch: number;
}

export interface PlayerSnap {
  id: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  /** 0 standing to 1 crouched. */
  duck: number;
}

export type ClientMsg =
  // `world` is the island the client wants to join; the server may ignore it.
  | { t: 'hello'; name: string; world: WorldConfig }
  // Carries the last few unacknowledged commands so a lost packet costs nothing.
  | { t: 'input'; cmds: InputCmd[] }
  | { t: 'ping'; time: number };

export type ServerMsg =
  | { t: 'welcome'; id: number; seed: number; tick: number; tickRate: number }
  // `ack` is the highest command seq the server has simulated for the recipient,
  // and `you` its full movement state right after that command, which the
  // client replays its unacknowledged commands on top of.
  | { t: 'snapshot'; tick: number; ack: number; you: PlayerState; players: PlayerSnap[] }
  | { t: 'pong'; time: number };

/**
 * Unreliable messages may be dropped or reordered in transit, like UDP. The
 * protocol is built so that losing them is harmless: inputs are sent
 * redundantly and snapshots are superseded by the next one.
 */
export function isReliable(msg: ClientMsg | ServerMsg): boolean {
  return msg.t !== 'input' && msg.t !== 'snapshot';
}
