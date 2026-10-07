import { CALABIANCA_2 } from '../src/shared/maps/calabianca2.ts';
import type { MapArea } from '../src/shared/maps/index.ts';
import type { World } from '../src/shared/world.ts';

// Finding places on the new Calabianca for its tests: a clear spot to stand
// in each named place, on whichever of its floors (it has one over another
// under the walk to A) there's room.

/** A spot a player stands in, clear of everything, on a floor. */
export interface Spot {
  name: string;
  x: number;
  y: number;
  z: number;
}

/** The place called `name` (the last of that name, as later places lie over earlier). */
export function area(name: string): MapArea {
  const a = [...CALABIANCA_2.areas!].reverse().find((p) => p.name === name);
  if (!a) throw new Error(`no place called ${name}`);
  return a;
}

/**
 * The clear spot in `a` nearest its middle on its ground: the floor most of
 * it stands at, not a box's top. With `lowest` (as by default), of its lower
 * floor where one runs over another, else its upper; null if there's none.
 */
export function standIn(world: World, a: MapArea, lowest = true): Spot | null {
  const [cx, cz] = [(a.minX + a.maxX) / 2, (a.minZ + a.maxZ) / 2];
  const spots: Spot[] = [];
  for (let x = a.minX + 0.5; x < a.maxX - 0.5; x += 0.5) {
    for (let z = a.minZ + 0.5; z < a.maxZ - 0.5; z += 0.5) {
      const tops = world.floorTops(x, z, 0.01).filter((y) => world.fits(x, y, z, 1.8) && world.clear(x, y, z, 1.8, 0.6));
      if (tops.length) spots.push({ name: a.name, x, y: lowest ? tops[0] : tops[tops.length - 1], z });
    }
  }
  if (!spots.length) return null;
  const count = new Map<number, number>();
  for (const s of spots) count.set(s.y, (count.get(s.y) ?? 0) + 1);
  const ground = [...count].reduce((m, e) => (e[1] > m[1] ? e : m))[0];
  return spots.filter((s) => s.y === ground).reduce((m, s) => (Math.hypot(s.x - cx, s.z - cz) < Math.hypot(m.x - cx, m.z - cz) ? s : m));
}
