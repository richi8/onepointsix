// Messages that cross the client/server boundary. Today that boundary is a Web
// Worker; later it is a WebSocket. Everything here must survive structured
// cloning and JSON, so only plain data.

import type { Zone } from './hitbox.ts';
import type { PlayerState } from './sim.ts';
import type { WorldConfig } from './worldconfig.ts';

/** One fixed CMD_DT step of player intent. Bots produce these too. */
export interface InputCmd {
  seq: number;
  buttons: number;
  yaw: number;
  pitch: number;
  /** Weapon the player wants in hand, as an index into WEAPONS; omitted keeps the current one. */
  weapon?: number;
  /**
   * The server tick, fractional, that the client was showing other players at
   * when it sampled this command. The server rewinds them to it to judge shots.
   * Omitted means no rewind.
   */
  view?: number;
}

export interface PlayerSnap {
  id: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  /** 0 standing to 1 crouched. */
  duck: number;
  /** -1 leaning left to 1 leaning right. */
  lean: number;
  dead: boolean;
  /** Weapon in hand. */
  weapon: number;
}

/** Something that happened during a server tick, sent reliably to whoever should hear. */
export type GameEvent =
  // To the shooter: their round hit `target` for `damage` at (x, y, z).
  | { k: 'hit'; target: number; zone: Zone; damage: number; killed: boolean; x: number; y: number; z: number }
  // To the victim: they took `damage` from a shooter at (x, z).
  | { k: 'hurt'; damage: number; x: number; z: number }
  // To everyone.
  | { k: 'kill'; killer: number; victim: number; killerName: string; victimName: string; weapon: number; head: boolean }
  // To everyone but the shooter, who predicted it: a round from (ox, oy, oz) that stopped at (ex, ey, ez).
  | {
      k: 'shot'; id: number; weapon: number;
      ox: number; oy: number; oz: number; ex: number; ey: number; ez: number;
      /** What it stopped in: a body, the world, or nothing within range. */
      struck: 'body' | 'world' | 'none';
    };

export type ClientMsg =
  // `world` is the island the client wants to join; the server may ignore it.
  | { t: 'hello'; name: string; world: WorldConfig }
  // Carries the last few unacknowledged commands so a lost packet costs nothing.
  | { t: 'input'; cmds: InputCmd[] }
  | { t: 'ping'; time: number }
  // Debug only: sets the sender's carried weight in kg until there is an inventory.
  | { t: 'debug'; carry: number };

export type ServerMsg =
  | { t: 'welcome'; id: number; seed: number; tick: number; tickRate: number }
  // `ack` is the highest command seq the server has simulated for the recipient,
  // and `you` its full movement state right after that command, which the
  // client replays its unacknowledged commands on top of.
  | { t: 'snapshot'; tick: number; ack: number; you: PlayerState; players: PlayerSnap[] }
  | { t: 'events'; tick: number; events: GameEvent[] }
  | { t: 'pong'; time: number };

/**
 * Unreliable messages may be dropped or reordered in transit, like UDP. The
 * protocol is built so that losing them is harmless: inputs are sent
 * redundantly and snapshots are superseded by the next one.
 */
export function isReliable(msg: ClientMsg | ServerMsg): boolean {
  return msg.t !== 'input' && msg.t !== 'snapshot';
}
