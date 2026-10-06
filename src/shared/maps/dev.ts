import { CALABIANCA } from './calabianca.ts';
import type { GameMap } from './index.ts';
import { KIT_YARD } from './kityard.ts';
import { TEST_STREET } from './teststreet.ts';

/**
 * The test maps, by the name `?map=` gives them in development: shown
 * behind the menu and played as Deathmatch, for looking at the building kit,
 * and the old Calabianca, Deathmatch's map until chunk 67, kept for its
 * screenshots until it's removed (chunk 69). Only development builds import
 * this.
 */
export const TEST_MAPS: Record<string, GameMap> = { 'kit-yard': KIT_YARD, 'test-street': TEST_STREET, 'old-calabianca': CALABIANCA };
