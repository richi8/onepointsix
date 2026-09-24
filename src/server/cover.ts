import { GRENADE_PANEL_DAMAGE, GRENADE_PANEL_RADIUS, PANEL_HP, PANEL_REPAIR } from '../shared/constants.ts';
import { clamp } from '../shared/geom.ts';
import type { Box, World } from '../shared/world.ts';

/** Seconds between looks for panels due to be rebuilt. */
const REPAIR_CHECK = 1;

/**
 * The health of every breakable panel. Damage that runs a panel out breaks
 * it in the world, along with whatever rests on it; after a while, broken
 * panels are rebuilt from the ground up. Times are server seconds.
 */
export class Cover {
  private readonly world: World;
  private readonly hp: Float32Array;
  /** Broken panels and when they broke. */
  private readonly broken = new Map<number, number>();
  private nextCheck = 0;

  constructor(world: World) {
    this.world = world;
    this.hp = Float32Array.from(world.panels, (p) => PANEL_HP[p.kind]);
  }

  health(id: number): number {
    return this.world.panels[id].box.gone ? 0 : this.hp[id];
  }

  /** Take `amount` off a panel. Returns the panels that broke. */
  damage(id: number, amount: number, now: number): number[] {
    if (this.world.panels[id].box.gone) return [];
    this.hp[id] -= amount;
    if (this.hp[id] > 0) return [];
    const broke = this.world.breakPanel(id);
    for (const i of broke) {
      this.hp[i] = 0;
      this.broken.set(i, now);
    }
    return broke;
  }

  /** A blast at (x, y, z): every panel near it takes damage by how close it came. Returns the panels that broke. */
  blast(x: number, y: number, z: number, now: number): number[] {
    const out: number[] = [];
    this.world.panels.forEach((p, i) => {
      if (p.box.gone) return;
      const d = distanceToBox(p.box, x, y, z);
      if (d >= GRENADE_PANEL_RADIUS) return;
      const f = 1 - d / GRENADE_PANEL_RADIUS;
      out.push(...this.damage(i, GRENADE_PANEL_DAMAGE * f * f, now));
    });
    return out;
  }

  /**
   * Rebuild panels that have been down long enough, bottom rows first, where
   * `blocked` says nothing is in the way. Returns the panels rebuilt.
   */
  repair(now: number, blocked: (box: Box) => boolean): number[] {
    if (now < this.nextCheck) return [];
    this.nextCheck = now + REPAIR_CHECK;
    const out: number[] = [];
    for (const [i, at] of this.broken) {
      if (now - at < PANEL_REPAIR || !this.world.supported(i)) continue;
      const box = this.world.panels[i].box;
      if (blocked(box)) continue;
      this.world.setPanel(i, true);
      this.hp[i] = PANEL_HP[this.world.panels[i].kind];
      this.broken.delete(i);
      out.push(i);
    }
    return out;
  }
}

export function distanceToBox(b: Box, x: number, y: number, z: number): number {
  return Math.hypot(x - clamp(x, b.minX, b.maxX), y - clamp(y, b.minY, b.maxY), z - clamp(z, b.minZ, b.maxZ));
}
