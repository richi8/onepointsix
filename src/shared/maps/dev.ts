import type { GameMap } from './index.ts';
import { KIT_YARD } from './kityard.ts';
import { TEST_STREET } from './teststreet.ts';

/**
 * The test maps, by the name `?map=` gives them in development: shown
 * behind the menu and played as Deathmatch, for looking at the building kit.
 * Only development builds import this.
 */
export const TEST_MAPS: Record<string, GameMap> = { 'kit-yard': KIT_YARD, 'test-street': TEST_STREET };
