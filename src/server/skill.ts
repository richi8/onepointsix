// How well a bot sees, reacts, aims and fights. Every number that separates
// an easy bot from a hard one lives here.

export type Difficulty = 'easy' | 'normal' | 'hard';

export interface Skill {
  name: Difficulty;
  /** Farthest a standing target can be seen, in metres. */
  sight: number;
  /** Field of view, full angle in radians. */
  fov: number;
  /** Seconds to notice a target in plain view up close, and extra seconds per 100 m. */
  spotTime: number;
  spotPerDistance: number;
  /** Seconds between noticing a target and the first shot. */
  reaction: number;
  /** Fastest turn in radians per second. */
  turnRate: number;
  /** Aim error on a fresh target, in radians, and how fast it settles (per second). */
  aimError: number;
  settle: number;
  /** Steady aim wobble, in radians. */
  wobble: number;
  /** Seconds the aim trails a moving target. */
  trackLag: number;
  /** Fraction of the weapon's climb pulled back down. */
  recoilControl: number;
  /** Fires once the aim is within this many target widths of the target. */
  looseness: number;
  /** Rounds per automatic burst, and seconds between bursts. */
  burst: [number, number];
  burstPause: [number, number];
  /** Seconds between pistol and bolt-action shots beyond the weapon's own limit. */
  tapDelay: number;
  /** Chance per decision to aim for the head. */
  headChance: number;
  /** Chance to take cover when hurt, and to flank a target that went out of sight. */
  coverChance: number;
  flankChance: number;
  /** Seconds a lost target is remembered. */
  memory: number;
}

export const SKILLS: Record<Difficulty, Skill> = {
  easy: {
    name: 'easy',
    sight: 80,
    fov: (100 * Math.PI) / 180,
    spotTime: 0.6,
    spotPerDistance: 2.2,
    reaction: 0.75,
    turnRate: 3,
    aimError: 0.09,
    settle: 1.6,
    wobble: 0.006,
    trackLag: 0.25,
    recoilControl: 0.25,
    looseness: 2.5,
    burst: [3, 5],
    burstPause: [0.45, 0.9],
    tapDelay: 0.35,
    headChance: 0,
    coverChance: 0.3,
    flankChance: 0.15,
    memory: 12,
  },
  normal: {
    name: 'normal',
    sight: 120,
    fov: (120 * Math.PI) / 180,
    spotTime: 0.4,
    spotPerDistance: 1.6,
    reaction: 0.45,
    turnRate: 5,
    aimError: 0.06,
    settle: 2.6,
    wobble: 0.004,
    trackLag: 0.14,
    recoilControl: 0.55,
    looseness: 1.8,
    burst: [4, 7],
    burstPause: [0.3, 0.6],
    tapDelay: 0.22,
    headChance: 0.1,
    coverChance: 0.6,
    flankChance: 0.4,
    memory: 20,
  },
  hard: {
    name: 'hard',
    sight: 170,
    fov: (140 * Math.PI) / 180,
    spotTime: 0.25,
    spotPerDistance: 1.1,
    reaction: 0.28,
    turnRate: 8,
    aimError: 0.035,
    settle: 4,
    wobble: 0.0025,
    trackLag: 0.06,
    recoilControl: 0.8,
    looseness: 1.3,
    burst: [5, 10],
    burstPause: [0.2, 0.4],
    tapDelay: 0.12,
    headChance: 0.25,
    coverChance: 0.8,
    flankChance: 0.6,
    memory: 30,
  },
};
