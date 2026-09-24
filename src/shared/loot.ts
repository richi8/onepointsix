import { KILL_SCORE_GUARD, KILL_SCORE_OPERATOR } from './constants.ts';
import type { Box, World } from './world.ts';

// What can be found in crates, what it is worth and what it weighs. Valuables
// go in the inventory and count toward carry weight and the run's score;
// supplies are used on the spot.

export interface ItemDef {
  name: string;
  /** Score when extracted with it. */
  value: number;
  /** Carried weight in kg. */
  mass: number;
  /** How often it turns up, relative to the others. */
  rarity: number;
  /** Supplies are used when taken instead of carried: ammo refills every weapon's reserve, a medkit heals. */
  use?: 'ammo' | 'heal';
}

export const ITEMS: readonly ItemDef[] = [
  { name: 'Ammo box', value: 0, mass: 0, rarity: 16, use: 'ammo' },
  { name: 'Medkit', value: 0, mass: 0, rarity: 9, use: 'heal' },
  { name: 'Cash roll', value: 250, mass: 0.2, rarity: 16 },
  { name: 'Wristwatch', value: 600, mass: 0.2, rarity: 10 },
  { name: 'Hard drive', value: 900, mass: 0.6, rarity: 8 },
  { name: 'Intel folder', value: 1200, mass: 0.5, rarity: 6 },
  { name: 'Field radio', value: 800, mass: 3, rarity: 8 },
  { name: 'Gun parts', value: 1400, mass: 5, rarity: 7 },
  { name: 'Fuel can', value: 1100, mass: 9, rarity: 6 },
  { name: 'Generator core', value: 3000, mass: 16, rarity: 3 },
  { name: 'Gold bar', value: 4000, mass: 12, rarity: 2 },
];

/** Health a medkit gives back. */
export const MEDKIT_HEAL = 50;
/** Crates this close to an outpost are guarded, and hold more and better loot. */
const RICH_RADIUS = 22;
/** Rarity multiple for items worth this much or more in a guarded crate. */
const RICH_VALUE = 1000;
const RICH_BOOST = 2.5;

/** A fresh crate's contents: one or two items out in the open, two to four in an outpost. */
export function rollItems(rand: () => number, rich: boolean): number[] {
  const count = rich ? 2 + Math.floor(rand() * 3) : 1 + Math.floor(rand() * 2);
  const weights = ITEMS.map((it) => it.rarity * (rich && it.value >= RICH_VALUE ? RICH_BOOST : 1));
  const total = weights.reduce((a, b) => a + b, 0);
  const items: number[] = [];
  for (let i = 0; i < count; i++) {
    let r = rand() * total;
    let k = 0;
    while (k < weights.length - 1 && r >= weights[k]) r -= weights[k++];
    items.push(k);
  }
  return sortForTaking(items);
}

/** The order items are taken in: supplies first, then the most valuable. */
export function sortForTaking(items: number[]): number[] {
  const rank = (i: number) => (ITEMS[i].use ? Infinity : ITEMS[i].value);
  return items.sort((a, b) => rank(b) - rank(a) || a - b);
}

export function lootValue(items: readonly number[]): number {
  return items.reduce((sum, i) => sum + ITEMS[i].value, 0);
}

export function lootMass(items: readonly number[]): number {
  return Math.round(items.reduce((sum, i) => sum + ITEMS[i].mass, 0) * 10) / 10;
}

export function runScore(value: number, kills: number, guardKills: number): number {
  return value + kills * KILL_SCORE_OPERATOR + guardKills * KILL_SCORE_GUARD;
}

/** Crates standing on the ground, in outposts and out in the open; stacked ones are just cover. */
export function lootCrates(world: World): { box: Box; rich: boolean }[] {
  return world.props
    .filter((p) => p.style === 'crate' && p.box.minY < world.terrainHeight((p.box.minX + p.box.maxX) / 2, (p.box.minZ + p.box.maxZ) / 2))
    .map(({ box }) => {
      const near = world.nearestOutpost((box.minX + box.maxX) / 2, (box.minZ + box.maxZ) / 2);
      return { box, rich: !!near && near.dist < RICH_RADIUS };
    });
}

/** Every other extraction point is a landing zone that must be called and held; the rest are walk-in. */
export function extractKind(index: number): 'walk' | 'call' {
  return index % 2 === 0 ? 'walk' : 'call';
}

const COMPASS = ['North', 'North-east', 'East', 'South-east', 'South', 'South-west', 'West', 'North-west'];

/** A name for an extraction point from where it lies on the island, e.g. "South-west beach". */
export function extractName(world: World, index: number): string {
  const e = world.extracts[index];
  // Yaw 0 faces -z, so north is -z.
  const a = Math.atan2(e.x, -e.z);
  const dir = COMPASS[((Math.round(a / (Math.PI / 4)) % 8) + 8) % 8];
  return `${dir} ${extractKind(index) === 'call' ? 'landing zone' : 'beach'}`;
}
