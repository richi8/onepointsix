import { BAG_TIME, CRATE_RESTOCK, INTERACT_REACH } from '../shared/constants.ts';
import { angleDiff, clamp, yawToward } from '../shared/geom.ts';
import { lootCrates, lootValue, rollItems, sortForTaking } from '../shared/loot.ts';
import type { Personality } from '../shared/personality.ts';
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
  /** A crate's panel in the world, or -1 for a bag. */
  panel: number;
  /** A crate that's been smashed, until it's rebuilt. */
  broken: boolean;
  /** A bag left by the body of an operator bot of this kind. */
  personality?: Personality;
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
  private readonly byPanel = new Map<number, Container>();
  private readonly world: World;
  private readonly rand: () => number;
  private nextId = 0;

  /** Crates hold only ammo and medkits, as in Deathmatch. */
  private readonly supplies: boolean;

  constructor(world: World, rand: () => number, supplies = false) {
    this.world = world;
    this.rand = rand;
    this.supplies = supplies;
    for (const { box, rich } of lootCrates(world)) {
      const { minX, minY, minZ, maxX, maxY, maxZ } = box;
      const id = this.nextId++;
      const c: Container = {
        id, kind: 'crate', minX, minY, minZ, maxX, maxY, maxZ, rich, items: rollItems(rand, rich, this.supplies), searched: false, until: 0,
        panel: box.panel ?? -1, broken: false,
      };
      this.all.set(id, c);
      if (c.panel >= 0) this.byPanel.set(c.panel, c);
    }
  }

  /** A panel broke: if it was a crate, whatever was in it spills out into a bag. */
  broke(panel: number, now: number): void {
    const c = this.byPanel.get(panel);
    if (!c || c.broken) return;
    c.broken = true;
    c.searched = true;
    c.until = Infinity;
    const x = (c.minX + c.maxX) / 2;
    const z = (c.minZ + c.maxZ) / 2;
    // On the floor it stood on, or whatever is left under it if that went too.
    this.drop(x, this.world.groundHeight(x, z, Math.max(this.world.floorHeight(x, z), c.minY)), z, c.items, now);
    c.items = [];
  }

  /** A crate's panel was rebuilt: it's a fresh crate. */
  repaired(panel: number): void {
    const c = this.byPanel.get(panel);
    if (!c || !c.broken) return;
    c.broken = false;
    c.searched = false;
    c.until = 0;
    c.items = rollItems(this.rand, c.rich, this.supplies);
  }

  /** Whether a bag lies inside the box. */
  bagIn(minX: number, minZ: number, maxX: number, maxZ: number): boolean {
    for (const c of this.all.values()) {
      if (c.kind === 'bag' && c.maxX > minX && c.minX < maxX && c.maxZ > minZ && c.minZ < maxZ) return true;
    }
    return false;
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
      if (c.broken || c.maxY < y - REACH_DOWN || c.minY > y + REACH_UP) continue;
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

  /**
   * Leave items on the ground at (x, y, z), in a bag already there or a new
   * one. `personality` is the operator bot whose body left them, if one did.
   */
  drop(x: number, y: number, z: number, items: number[], now: number, personality?: Personality): void {
    if (!items.length) return;
    for (const c of this.all.values()) {
      if (c.kind !== 'bag' || Math.hypot((c.minX + c.maxX) / 2 - x, (c.minZ + c.maxZ) / 2 - z) > BAG_MERGE || Math.abs(c.minY - y) > 1) continue;
      c.items = sortForTaking([...c.items, ...items]);
      c.until = now + BAG_TIME;
      c.personality ??= personality;
      return;
    }
    const h = BAG_SIZE / 2;
    const id = this.nextId++;
    this.all.set(id, {
      id, kind: 'bag', minX: x - h, minY: y, minZ: z - h, maxX: x + h, maxY: y + BAG_HEIGHT, maxZ: z + h,
      rich: false, items: sortForTaking([...items]), searched: true, until: now + BAG_TIME, panel: -1, broken: false,
      ...(personality ? { personality } : {}),
    });
  }

  /** Restock crates and clear away old bags. */
  step(now: number): void {
    for (const c of this.all.values()) {
      if (!c.searched || now < c.until) continue;
      if (c.kind === 'bag') this.all.delete(c.id);
      else {
        c.items = rollItems(this.rand, c.rich, this.supplies);
        c.searched = false;
      }
    }
  }

  bags(): BagSnap[] {
    const out: BagSnap[] = [];
    for (const c of this.all.values()) {
      if (c.kind !== 'bag') continue;
      const b: BagSnap = { id: c.id, x: (c.minX + c.maxX) / 2, y: c.minY, z: (c.minZ + c.maxZ) / 2, value: lootValue(c.items) };
      if (c.personality) b.kind = c.personality;
      out.push(b);
    }
    return out;
  }
}
