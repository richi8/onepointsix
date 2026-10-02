// Which of Microsoft's Rocketbox avatars each side wears, the one list both
// the game and scripts/fetch-assets.mjs read: the script packs each into
// public/assets/soldiers/<name>.glb, and the game loads them in this order.
// The first carries the clips every avatar plays (see clips.ts), and the
// arms seen in first person. No imports but rng.ts, so plain Node can load it.

import { hash2 } from './rng.ts';

export type Side = 'operator' | 'guard' | 'commander';

/** SWAT officers, soldiers in helmets, and soldiers in caps. */
export const AVATARS: Record<Side, readonly string[]> = {
  operator: ['Police_Male_02', 'Police_Female_01'],
  guard: ['Military_Male_01', 'Military_Male_03', 'Military_Male_04', 'Military_Female_01', 'Military_Female_02'],
  commander: ['Military_Male_02', 'Military_Male_05', 'Military_Male_06'],
};

/** Every avatar, in the order they're loaded. */
export const AVATAR_NAMES: readonly string[] = Object.values(AVATARS).flat();

const SIDES: readonly Side[] = ['operator', 'guard', 'commander'];

/**
 * The avatar a body wears, as an index into AVATAR_NAMES: its side's, taken in
 * turn by id from a start the island's seed picks, so bodies that join one
 * after another (an outpost's guards) differ, and the same island looks the
 * same each time.
 */
export function avatarOf(seed: number, id: number, side: Side): number {
  const names = AVATARS[side];
  const start = Math.floor(hash2(SIDES.indexOf(side), 0, seed) * names.length);
  return AVATAR_NAMES.indexOf(names[(((start + id) % names.length) + names.length) % names.length]);
}
