import { CMD_DT } from '../shared/constants.ts';
import { lerp } from '../shared/geom.ts';
import type { InputCmd } from '../shared/protocol.ts';
import { applyCmd, copyState, type PlayerState } from '../shared/sim.ts';
import type { WeaponFx } from '../shared/weapons.ts';
import type { World } from '../shared/world.ts';

/** Corrections bigger than this snap instead of blending (teleports, respawns). */
const SNAP_DISTANCE = 2;
/** How fast a visual correction fades out, per second. */
const ERROR_DECAY = 15;

export interface Rendered {
  x: number;
  y: number;
  z: number;
  duck: number;
  lean: number;
  aim: number;
  recoilPitch: number;
  recoilYaw: number;
}

/**
 * Client-side prediction for the local player. Commands are simulated
 * immediately with the shared applyCmd; when the server's authoritative state
 * arrives, it is taken as the new base and every command the server hasn't
 * simulated yet is replayed on top. Any resulting jump in position is hidden
 * by a render offset that fades out.
 */
export class Predictor {
  /** Predicted state after the newest command, or null before the first snapshot. */
  state: PlayerState | null = null;
  /** Visual offset still to be smoothed away. */
  readonly error = { x: 0, y: 0, z: 0 };
  /** Mispredictions seen so far, and the size of the last one in metres. */
  corrections = 0;
  lastError = 0;
  private readonly world: World;
  /** State before the newest command, for rendering between command steps. */
  private prev: PlayerState | null = null;

  constructor(world: World) {
    this.world = world;
  }

  /** Simulate a new command; its shots and other effects go to `onFx`. Replays stay silent. */
  predict(cmd: InputCmd, onFx?: (fx: WeaponFx) => void): void {
    if (!this.state) return;
    this.prev = copyState(this.state);
    applyCmd(this.world, this.state, cmd, CMD_DT, onFx);
  }

  /** Rebase on the server's state after `ack`; `pending` are the commands after it. */
  reconcile(auth: PlayerState, pending: readonly InputCmd[]): void {
    const s = copyState(auth);
    let prev = s;
    for (const cmd of pending) {
      prev = copyState(s);
      applyCmd(this.world, s, cmd, CMD_DT);
    }

    const old = this.state;
    if (old) {
      const dx = old.x - s.x;
      const dy = old.y - s.y;
      const dz = old.z - s.z;
      const d = Math.hypot(dx, dy, dz);
      if (d > 1e-6) {
        this.corrections++;
        this.lastError = d;
      }
      if (d > SNAP_DISTANCE) this.error.x = this.error.y = this.error.z = 0;
      else {
        this.error.x += dx;
        this.error.y += dy;
        this.error.z += dz;
      }
    }
    this.state = s;
    this.prev = prev === s ? copyState(s) : prev;
  }

  /** Fade out the visual correction; call once per rendered frame. */
  update(dt: number): void {
    const k = Math.exp(-ERROR_DECAY * dt);
    this.error.x *= k;
    this.error.y *= k;
    this.error.z *= k;
  }

  /**
   * Where to draw the player: between the last two command steps by `alpha`
   * (the input loop's leftover fraction), plus the fading correction.
   */
  render(alpha: number): Rendered | null {
    const s = this.state;
    if (!s) return null;
    const p = this.prev ?? s;
    return {
      x: lerp(p.x, s.x, alpha) + this.error.x,
      y: lerp(p.y, s.y, alpha) + this.error.y,
      z: lerp(p.z, s.z, alpha) + this.error.z,
      duck: lerp(p.duck, s.duck, alpha),
      lean: lerp(p.lean, s.lean, alpha),
      aim: lerp(p.aim, s.aim, alpha),
      recoilPitch: lerp(p.recoilPitch, s.recoilPitch, alpha),
      recoilYaw: lerp(p.recoilYaw, s.recoilYaw, alpha),
    };
  }
}
