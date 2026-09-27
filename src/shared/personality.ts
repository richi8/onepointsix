// The kinds of operator bot, as the players are told about them. How each
// plays is in src/server/personality.ts; this is what the results screen, the
// kill feed and bags say once one of them is dead or has killed you.

export type Personality = 'rat' | 'hunter' | 'camper' | 'looter';

export const PERSONALITIES: readonly Personality[] = ['rat', 'hunter', 'camper', 'looter'];

/** What each kind does, in a line for the player. */
export const PERSONALITY_NOTES: Record<Personality, string> = {
  rat: 'Rats sneak, loot and avoid fights, shooting only when cornered.',
  hunter: 'Hunters follow gunfire to finish off the wounded, and go after the bounty.',
  camper: 'Campers wait near an extraction point for whoever comes to leave.',
  looter: 'Looters go for the richest crates and pick over the bags fights leave.',
};
