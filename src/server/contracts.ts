import { CONTRACT_REWARD, CONTRACTS, INTEL_TIME, INTERACT_REACH } from '../shared/constants.ts';
import { angleDiff, yawToward } from '../shared/geom.ts';
import type { ContractKind, ContractView } from '../shared/protocol.ts';
import { watchtower, type World } from '../shared/world.ts';

// Contracts give each run a purpose besides loot: grab the intel from an
// outpost's watchtower, destroy an outpost's supply cache, or eliminate a
// commander. Each run gets its own, at different outposts, and they pay out
// only if the operator gets off the island.

/** A contract as the server keeps it. */
export interface Contract extends ContractView {
  /** Intel: seconds Interact has been held on it. */
  held: number;
  /** Commander: its player id once it's on the island, or 0. */
  bot: number;
}

/** Where on a watchtower's platform the intel lies, from its middle: in a corner away from the stairs. */
const INTEL_OFFSET = { x: -1.1, z: 1.1 };
/** How far below or above the intel someone can be and still grab it. */
const INTEL_HEIGHT = 1;
/** Largest angle between where someone faces and the intel for them to grab it. */
const FACING = 1;
/** Crates on the ground this close to an outpost's centre can be its supply cache. */
const CACHE_RADIUS = 16;
const KINDS: readonly ContractKind[] = ['intel', 'cache', 'commander'];

/**
 * A run's contracts: one or two of different kinds, each at a different
 * outpost. A commander's name and bot are filled in when it's put on the island.
 */
export function planContracts(world: World, rand: () => number): Contract[] {
  const count = CONTRACTS[0] + Math.floor(rand() * (CONTRACTS[1] - CONTRACTS[0] + 1));
  const kinds = shuffle([...KINDS], rand);
  const outposts = shuffle(world.outposts.map((_, i) => i), rand);
  const out: Contract[] = [];
  for (const kind of kinds) {
    if (out.length >= count) break;
    for (const [k, outpost] of outposts.entries()) {
      const c = place(world, kind, outpost, rand);
      if (!c) continue;
      out.push(c);
      outposts.splice(k, 1);
      break;
    }
  }
  return out;
}

function place(world: World, kind: ContractKind, outpost: number, rand: () => number): Contract | null {
  const o = world.outposts[outpost];
  const c: Contract = {
    kind, outpost, x: o.x, y: o.y, z: o.z, reward: CONTRACT_REWARD[kind], state: 'open', progress: 0, panel: -1, name: '', held: 0, bot: 0,
  };
  if (kind === 'intel') {
    const t = watchtower(o);
    return { ...c, x: t.x + INTEL_OFFSET.x, y: t.y, z: t.z + INTEL_OFFSET.z };
  }
  if (kind === 'cache') {
    const crates: number[] = [];
    world.panels.forEach((p, i) => {
      const b = p.box;
      if (p.kind !== 'crate' || p.restsOn.length || b.gone) return;
      if (Math.hypot((b.minX + b.maxX) / 2 - o.x, (b.minZ + b.maxZ) / 2 - o.z) < CACHE_RADIUS) crates.push(i);
    });
    if (!crates.length) return null;
    const panel = crates[Math.floor(rand() * crates.length)];
    const b = world.panels[panel].box;
    return { ...c, x: (b.minX + b.maxX) / 2, y: b.maxY, z: (b.minZ + b.maxZ) / 2, panel };
  }
  return c;
}

/** Whether someone at (x, y, z) facing `yaw` can grab this contract's intel. */
export function reachesIntel(c: Contract, x: number, y: number, z: number, yaw: number): boolean {
  if (c.kind !== 'intel' || c.state !== 'open' || Math.abs(y - c.y) > INTEL_HEIGHT) return false;
  const d = Math.hypot(c.x - x, c.z - z);
  return d <= INTERACT_REACH && (d < 0.5 || Math.abs(angleDiff(yawToward(x, z, c.x, c.z), yaw)) <= FACING);
}

export function contractView(c: Contract): ContractView {
  const { kind, outpost, x, y, z, reward, state, panel, name } = c;
  return { kind, outpost, x, y, z, reward, state, progress: Math.min(c.held / INTEL_TIME, 1), panel, name };
}

/** What the done contracts pay. */
export function contractReward(contracts: readonly ContractView[]): number {
  return contracts.reduce((sum, c) => sum + (c.state === 'done' ? c.reward : 0), 0);
}

function shuffle<T>(items: T[], rand: () => number): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}
