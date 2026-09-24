import { Btn, CMD_DT, CMDS_PER_TICK, EYE_HEIGHT, PLAYER_HEIGHT, SERVER_DT } from '../shared/constants.ts';
import type { InputCmd } from '../shared/protocol.ts';
import type { World } from '../shared/world.ts';

// A shooting range of target dummies until chunk 5 brings real bots. Dummies
// are players without a keyboard: they move only through input commands.

export type DummyKind = 'still' | 'strafe' | 'crouch' | 'lean';

export interface Post {
  x: number;
  y: number;
  z: number;
  yaw: number;
}

export interface RangeLayout {
  /** Where shooters stand, facing down range and looking at the middle of it. */
  origin: Post & { pitch: number };
  dummies: (Post & { kind: DummyKind })[];
}

/** Distance down range and behaviour of each dummy. */
const LANE: [number, DummyKind][] = [
  [8, 'still'],
  [15, 'strafe'],
  [22, 'crouch'],
  [30, 'still'],
  [45, 'strafe'],
  [60, 'lean'],
  [80, 'still'],
  [110, 'strafe'],
  [150, 'still'],
  [220, 'still'],
];
/** Dummies step sideways off the lane line so near ones don't hide far ones. */
const LANE_OFFSETS = [0, -3, 3];
const CANDIDATES = 24;
const DIRECTIONS = 8;
const CHEST = 1.2;

/** Yaw that faces from (x, z) toward (tx, tz); yaw 0 faces -z. */
export function yawToward(x: number, z: number, tx: number, tz: number): number {
  return Math.atan2(-(tx - x), -(tz - z));
}

/**
 * Pick a spot with a long clear view and lay dummies out down range from it,
 * trying several spots and directions and keeping the one where the most
 * dummies are on dry land, have room to stand and are visible from the origin.
 */
export function layoutRange(world: World, rand: () => number): RangeLayout {
  let best: RangeLayout | null = null;
  for (let c = 0; c < CANDIDATES; c++) {
    const o = world.randomLandPoint(rand);
    const start = rand() * Math.PI * 2;
    for (let d = 0; d < DIRECTIONS; d++) {
      const yaw = start + (d / DIRECTIONS) * Math.PI * 2;
      const fx = -Math.sin(yaw);
      const fz = -Math.cos(yaw);
      const dummies: RangeLayout['dummies'] = [];
      LANE.forEach(([dist, kind], i) => {
        const side = LANE_OFFSETS[i % LANE_OFFSETS.length];
        const x = o.x + fx * dist + fz * side;
        const z = o.z + fz * dist - fx * side;
        const ground = world.terrainHeight(x, z);
        if (ground < 1) return;
        const y = world.groundHeight(x, z, ground);
        if (!world.fits(x, y, z, PLAYER_HEIGHT)) return;
        if (!world.hasLineOfSight(o.x, o.y + EYE_HEIGHT, o.z, x, y + CHEST, z)) return;
        dummies.push({ x, y, z, yaw: yawToward(x, z, o.x, o.z), kind });
      });
      if (best && dummies.length <= best.dummies.length) continue;
      // Look at the middle of the lane, which may be up or down a slope.
      const mid = dummies[Math.floor(dummies.length / 2)] ?? { ...o, x: o.x + fx, z: o.z + fz };
      const pitch = Math.atan2(mid.y + CHEST - (o.y + EYE_HEIGHT), Math.hypot(mid.x - o.x, mid.z - o.z));
      best = { origin: { ...o, yaw, pitch }, dummies };
      if (dummies.length === LANE.length) return best;
    }
  }
  return best!;
}

/** Seconds per half of a dummy's back-and-forth routine. */
const PERIOD: Record<DummyKind, number> = { still: 1, strafe: 1.3, crouch: 1.6, lean: 1.1 };

/** The commands a dummy sends during one server tick. */
export function dummyCmds(post: Post & { kind: DummyKind }, index: number, tick: number, seq: number): InputCmd[] {
  const cmds: InputCmd[] = [];
  for (let i = 0; i < CMDS_PER_TICK; i++) {
    const time = tick * SERVER_DT + i * CMD_DT + index * 0.37;
    const phase = Math.floor(time / PERIOD[post.kind]) % 2 === 0;
    let buttons = 0;
    if (post.kind === 'strafe') buttons = phase ? Btn.Left : Btn.Right;
    else if (post.kind === 'crouch') buttons = phase ? Btn.Crouch : 0;
    else if (post.kind === 'lean') buttons = phase ? Btn.LeanLeft : Btn.LeanRight;
    cmds.push({ seq: seq + i + 1, buttons, yaw: post.yaw, pitch: 0 });
  }
  return cmds;
}
