import { CALL_TIME, EXTRACT_CLOSED, EXTRACT_OPEN, EXTRACT_RADIUS } from '../shared/constants.ts';
import { extractKind } from '../shared/loot.ts';
import type { ExtractView } from '../shared/protocol.ts';
import type { Point, World } from '../shared/world.ts';

/** An extraction point and its schedule. Times are server seconds. */
export interface ExtractPoint extends Point {
  kind: 'walk' | 'call';
  open: boolean;
  /** When it next opens or closes. */
  next: number;
  /** When a called pickup lands, or -1 while none is called. */
  pickup: number;
}

/** Height difference within which someone standing near a point counts as being at it. */
const ZONE_HEIGHT = 4;

/**
 * Opens and closes the island's extraction points at random, always keeping
 * at least one open, and runs the pickups called at landing zones.
 */
export class Extracts {
  readonly points: ExtractPoint[];
  private readonly rand: () => number;

  constructor(world: World, rand: () => number) {
    this.rand = rand;
    this.points = world.extracts.map((e, i) => ({ ...e, kind: extractKind(i), open: rand() < 0.5, next: 0, pickup: -1 }));
    if (this.points.length && !this.points.some((p) => p.open)) this.points[0].open = true;
    // Staggered, so they don't all change together.
    for (const p of this.points) p.next = this.between(p.open ? EXTRACT_OPEN : EXTRACT_CLOSED) * (0.3 + this.rand() * 0.7);
  }

  /** Advance to `now`. Returns the points whose called pickup landed. */
  step(now: number): number[] {
    const landed: number[] = [];
    this.points.forEach((p, i) => {
      if (p.pickup >= 0 && now >= p.pickup) {
        p.pickup = -1;
        landed.push(i);
      }
      if (now < p.next) return;
      if (p.open) {
        // A called landing zone stays open for its pickup, and the last open point stays open.
        const others = this.points.some((q) => q !== p && q.open);
        if (p.pickup >= 0 || !others) {
          p.next = now + this.between(EXTRACT_OPEN) * 0.5;
          return;
        }
        p.open = false;
        p.next = now + this.between(EXTRACT_CLOSED);
      } else {
        p.open = true;
        p.next = now + this.between(EXTRACT_OPEN);
      }
    });
    return landed;
  }

  /** Call in a pickup at a landing zone. Returns false if it can't be called now. */
  call(index: number, now: number): boolean {
    const p = this.points[index];
    if (!p || p.kind !== 'call' || !p.open || p.pickup >= 0) return false;
    p.pickup = now + CALL_TIME;
    p.next = Math.max(p.next, p.pickup);
    return true;
  }

  /** The point someone standing at `at` is in, or -1. */
  at(at: Point): number {
    return this.points.findIndex((p) => Math.hypot(p.x - at.x, p.z - at.z) <= EXTRACT_RADIUS && Math.abs(p.y - at.y) < ZONE_HEIGHT);
  }

  views(now: number): ExtractView[] {
    return this.points.map((p) => ({ open: p.open, next: Math.max(p.next - now, 0), call: p.pickup >= 0 ? p.pickup - now : -1 }));
  }

  private between([lo, hi]: [number, number]): number {
    return lo + this.rand() * (hi - lo);
  }
}
