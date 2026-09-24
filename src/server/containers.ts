import { BAG_TIME, CRATE_RESTOCK, INTERACT_REACH } from '../shared/constants.ts';
import { angleDiff, clamp, yawToward } from '../shared/geom.ts';
import { lootCrates, rollItems, sortForTaking } from '../shared/loot.ts';
import type { BagSnap } from '../shared/protocol.ts';
import type { World } from '../shared/world.ts';

/** Something that holds loot: a crate in the world or a bag on the ground. Times are server seconds. */
export interface Container {
  id: number;
  kind: 'crate' | 'bag';
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
  /** Guarded crates hold more and better loot. */
  rich: boolean;
  /** Contents in the order they'll be taken. Hidden until searched. */
  items: number[];
  searched: boolean;
  /** When a searched crate is stocked again, or a bag disappears. */
  until: number;
}

const BAG_SIZE = 0.6;
const BAG_HEIGHT = 0.35;
/** Dropped items go into a bag already on the ground this close. */
const BAG_MERGE = 1.5;
/** Largest angle between where someone faces and a container for it to be the one they use. */
const FACING = 1;
/** How far below the feet and above them a container can be reached. */
const REACH_DOWN = 0.6;
const REACH_UP = 2.2;

/**
 * Every container on the island. Crates come from the world and are stocked
 * at random; bags are left by bodies and dropped items.
 */
export class Containers {
  private readonly all = new Map<number, Container>();
  private readonly rand: () => number;
  private nextId = 0;

  constructor(world: World, rand: () => number) {
    this.rand = rand;
    for (const { box, rich } of lootCrates(world)) {
      const { minX, minY, minZ, maxX, maxY, maxZ } = box;
      const id = this.nextId++;
      this.all.set(id, { id, kind: 'crate', minX, minY, minZ, maxX, maxY, maxZ, rich, items: rollItems(rand, rich), searched: false, until: 0 });
    }
  }

  get(id: number): Container | undefined {
    return this.all.get(id);
  }

  crates(): Container[] {
    return [...this.all.values()].filter((c) => c.kind === 'crate');
  }

  /** The container someone at (x, y, z) facing `yaw` would use: in reach and most nearly ahead. */
  facing(x: number, y: number, z: number, yaw: number): Container | null {
    let best: Container | null = null;
    let bestOff = FACING;
    for (const c of this.all.values()) {
      if (c.maxY < y - REACH_DOWN || c.minY > y + REACH_UP) continue;
      const dx = x - clamp(x, c.minX, c.maxX);
      const dz = z - clamp(z, c.minZ, c.maxZ);
      const d = Math.hypot(dx, dz);
      if (d > INTERACT_REACH) continue;
      const off = d < 1e-3 ? 0 : Math.abs(angleDiff(yawToward(x, z, (c.minX + c.maxX) / 2, (c.minZ + c.maxZ) / 2), yaw));
      if (off <= bestOff) (best = c), (bestOff = off);
    }
    return best;
  }

  /** A searched crate stays searched until restocked. */
  searched(c: Container, now: number): void {
    c.searched = true;
    c.until = now + CRATE_RESTOCK;
  }

  /** Take the next item out, or undefined if it's empty or unsearched. Empty bags disappear. */
  take(c: Container): number | undefined {
    if (!c.searched) return undefined;
    const item = c.items.shift();
    if (c.kind === 'bag' && c.items.length === 0) this.all.delete(c.id);
    return item;
  }

  /** Leave items on the ground at (x, y, z), in a bag already there or a new one. */
  drop(x: number, y: number, z: number, items: number[], now: number): void {
    if (!items.length) return;
    for (const c of this.all.values()) {
      if (c.kind !== 'bag' || Math.hypot((c.minX + c.maxX) / 2 - x, (c.minZ + c.maxZ) / 2 - z) > BAG_MERGE || Math.abs(c.minY - y) > 1) continue;
      c.items = sortForTaking([...c.items, ...items]);
      c.until = now + BAG_TIME;
      return;
    }
    const h = BAG_SIZE / 2;
    const id = this.nextId++;
    this.all.set(id, {
      id, kind: 'bag', minX: x - h, minY: y, minZ: z - h, maxX: x + h, maxY: y + BAG_HEIGHT, maxZ: z + h,
      rich: false, items: sortForTaking([...items]), searched: true, until: now + BAG_TIME,
    });
  }

  /** Restock crates and clear away old bags. */
  step(now: number): void {
    for (const c of this.all.values()) {
      if (!c.searched || now < c.until) continue;
      if (c.kind === 'bag') this.all.delete(c.id);
      else {
        c.items = rollItems(this.rand, c.rich);
        c.searched = false;
      }
    }
  }

  bags(): BagSnap[] {
    const out: BagSnap[] = [];
    for (const c of this.all.values()) {
      if (c.kind === 'bag') out.push({ id: c.id, x: (c.minX + c.maxX) / 2, y: c.minY, z: (c.minZ + c.maxZ) / 2 });
    }
    return out;
  }
}
