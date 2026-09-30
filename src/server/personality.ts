// How each kind of operator bot plays its run. Every operator bot has one of
// four personalities, so meeting another operator plays out differently
// depending on who they are. They carry over unchanged as fill bots once
// other players can join.

import type { Personality } from '../shared/personality.ts';

export { PERSONALITIES, type Personality } from '../shared/personality.ts';

export interface Temper {
  /** Crates it means to search, fewest and most, and the kg it's willing to carry. */
  stops: [number, number];
  greed: [number, number];
  /** Also goes for the guarded crates in the outposts. */
  raids: boolean;
  /** Starts fights with other operators out to this multiple of its gun's range; everyone fights back when shot at. */
  fightRange: number;
  /** Would rather get away from other operators than fight them, as every operator bot does from guards. */
  shy: boolean;
  /** Goes this far to check on a noise. */
  curiosity: number;
  /** Goes this far to join a fight between others, heard as gunfire from two sides. */
  thirdParty: number;
  /** Any gunfire counts as a fight, even from one side. */
  anyGunfire: boolean;
  /** Goes after the bounty when it's called this close. */
  bountyRange: number;
  /** Picks up bags worth at least this much that it comes across. */
  bagValue: number;
  /** Seconds into the run it keeps hunting or camping once done looting, before heading out. */
  linger: number;
  /** Never sprints or lights its way, sneaks around outposts from farther out, and keeps to bushes and tall grass. */
  sneaky: boolean;
  /** Hides for a while on hearing a fight nearby. */
  hides: boolean;
}

export const TEMPERS: Record<Personality, Temper> = {
  // Sneaks, loots and avoids fights: it only shoots back, or at someone right on top of it, and hides when one breaks out nearby.
  rat: {
    stops: [1, 2], greed: [10, 18], raids: false, fightRange: 0.2, shy: true, curiosity: 0, thirdParty: 0, anyGunfire: false,
    bountyRange: 0, bagValue: 500, linger: 0, sneaky: true, hides: true,
  },
  // Loots a little, then follows gunfire to finish off whoever is left, and goes after the bounty.
  hunter: {
    stops: [1, 1], greed: [12, 20], raids: false, fightRange: 0.9, shy: false, curiosity: 25, thirdParty: 260, anyGunfire: true,
    bountyRange: 400, bagValue: 600, linger: 240, sneaky: false, hides: false,
  },
  // Loots a little, then waits near an extraction point for whoever comes to leave.
  camper: {
    stops: [1, 2], greed: [12, 22], raids: false, fightRange: 1.2, shy: false, curiosity: 12, thirdParty: 0, anyGunfire: false,
    bountyRange: 0, bagValue: Infinity, linger: 300, sneaky: false, hides: false,
  },
  // Goes for the high-value crates, the outposts' too, and picks over the bags fights leave behind.
  looter: {
    stops: [2, 3], greed: [24, 34], raids: true, fightRange: 0.8, shy: false, curiosity: 25, thirdParty: 120, anyGunfire: false,
    bountyRange: 150, bagValue: 800, linger: 0, sneaky: false, hides: false,
  },
};
