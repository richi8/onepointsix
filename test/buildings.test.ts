import { describe, expect, it } from 'vitest';
import { NavGrid } from '../src/server/nav.ts';
import { Btn, CMD_DT } from '../src/shared/constants.ts';
import { lootCrates } from '../src/shared/loot.ts';
import { applyCmd, spawnState } from '../src/shared/sim.ts';
import { watchtower, World, type Box, type Building } from '../src/shared/world.ts';

const SEEDS = [1, 2, 3, 42, 1234];

/** Whether a box lies within a building's footprint, roof overhang included. */
function inside(b: Building, box: Box, pad = 0.35): boolean {
  return box.minX >= b.minX - pad && box.maxX <= b.maxX + pad && box.minZ >= b.minZ - pad && box.maxZ <= b.maxZ + pad;
}

function overlaps(b: Building, box: Box, pad: number): boolean {
  return box.maxX > b.minX - pad && box.minX < b.maxX + pad && box.maxZ > b.minZ - pad && box.minZ < b.maxZ + pad;
}

/** The building's two crates, one in the back corner of each room. */
function crates(w: World, b: Building) {
  return w.props.filter((p) => p.style === 'crate' && inside(b, p.box, 0));
}

describe('buildings', () => {
  it('stand one to an outpost, inside its walls and clear of everything else', () => {
    for (const seed of SEEDS) {
      const w = new World(seed);
      expect(w.buildings).toHaveLength(w.outposts.length);
      w.buildings.forEach((b, i) => {
        const o = w.outposts[i];
        expect(Math.max(Math.abs(b.minX - o.x), Math.abs(b.maxX - o.x), Math.abs(b.minZ - o.z), Math.abs(b.maxZ - o.z))).toBeLessThan(13);
        const t = watchtower(o);
        expect(b.maxX < t.x - 3 || b.minX > t.x + 10.5 || b.maxZ < t.z - 3 || b.minZ > t.z + 3).toBe(true);
        for (const p of w.props) {
          if (inside(b, p.box)) continue;
          if (overlaps(b, p.box, 1)) throw new Error(`seed ${seed}: a ${p.style} crowds building ${i}`);
        }
        expect(new World(seed).buildings[i]).toEqual(b);
      });
    }
  });

  it('can be walked into, room by room, by bots from outside the outpost', () => {
    for (const seed of SEEDS) {
      const w = new World(seed);
      const nav = new NavGrid(w);
      w.buildings.forEach((b, i) => {
        const o = w.outposts[i];
        const room = crates(w, b);
        expect(room).toHaveLength(2);
        for (const c of room) {
          // A step out from the crate toward the building's middle.
          const cx = (c.box.minX + c.box.maxX) / 2;
          const cz = (c.box.minZ + c.box.maxZ) / 2;
          const mx = (b.minX + b.maxX) / 2;
          const mz = (b.minZ + b.maxZ) / 2;
          const d = Math.hypot(mx - cx, mz - cz);
          const g = nav.nearestWalkable(cx + ((mx - cx) / d) * 1.6, cz + ((mz - cz) / d) * 1.6, 1)!;
          expect(g.x > b.minX && g.x < b.maxX && g.z > b.minZ && g.z < b.maxZ).toBe(true);
          const { x: gx, z: gz } = g;
          const path = nav.findPath(o.x, o.z - 30, gx, gz)!;
          expect(path, `seed ${seed} outpost ${i}`).not.toBeNull();
          const end = path.at(-1)!;
          expect(Math.hypot(end.x - gx, end.z - gz), `seed ${seed} outpost ${i}`).toBeLessThan(0.5);
        }
      });
    }
  });

  it('let a player walk in through a doorway and not through a wall', () => {
    const w = new World(1);
    const b = w.buildings[0];
    // Every doorway's lintel starts DOOR_HEIGHT up: walk through each from 2 m out.
    const lintels = w.props.filter((p) => p.style === 'wall' && inside(b, p.box, 0) && Math.abs(p.box.minY - b.floor - 2.2) < 1e-6);
    expect(lintels.length).toBe(3);
    let entered = 0;
    for (const { box } of lintels) {
      const alongX = box.maxX - box.minX > box.maxZ - box.minZ;
      const cx = (box.minX + box.maxX) / 2;
      const cz = (box.minZ + box.maxZ) / 2;
      for (const side of [-1, 1]) {
        const x = alongX ? cx : cx + side * 2;
        const z = alongX ? cz + side * 2 : cz;
        if (x > b.minX && x < b.maxX && z > b.minZ && z < b.maxZ) continue;
        const p = spawnState(x, w.groundHeight(x, z, b.floor), z);
        // Yaw 0 faces -z, and yaw π/2 faces -x.
        const yaw = alongX ? (side > 0 ? 0 : Math.PI) : side > 0 ? Math.PI / 2 : -Math.PI / 2;
        for (let i = 0; i < 90; i++) applyCmd(w, p, { seq: i, buttons: Btn.Forward, yaw, pitch: 0 }, CMD_DT);
        expect(p.x > b.minX && p.x < b.maxX && p.z > b.minZ && p.z < b.maxZ).toBe(true);
        entered++;
      }
    }
    expect(entered).toBeGreaterThanOrEqual(2);

    // Beside the doorway, the wall holds.
    const wall = w.props.find((p) => p.style === 'wall' && p.panel >= 0 && inside(b, p.box, 0) && p.box.minY < b.floor && p.box.maxY > b.floor + 1.2
      && p.box.maxX - p.box.minX > 1 && Math.abs(p.box.minZ - b.minZ) < 1e-6)!.box;
    const x = (wall.minX + wall.maxX) / 2;
    const p = spawnState(x, w.groundHeight(x, wall.minZ - 2, b.floor), wall.minZ - 2);
    for (let i = 0; i < 90; i++) applyCmd(w, p, { seq: i, buttons: Btn.Forward, yaw: Math.PI, pitch: 0 }, CMD_DT);
    expect(p.z).toBeLessThan(wall.minZ);
  });

  it('bring a lintel down with the wall it rests on, and keep the roof up', () => {
    const w = new World(1);
    const b = w.buildings[0];
    const lintel = w.panels.findIndex((p) => inside(b, p.box, 0) && p.restsOn.length === 2);
    expect(lintel).toBeGreaterThanOrEqual(0);
    const column = w.panels[lintel].restsOn[0];
    const under = w.panels[column].restsOn[0];
    const broke = w.breakPanel(under);
    expect(broke).toContain(column);
    expect(broke).toContain(lintel);
    expect(w.supported(lintel)).toBe(false);
    const roof = w.props.find((p) => p.style === 'roof' && inside(b, p.box))!;
    expect(roof.panel).toBe(-1);
    expect(roof.box.gone).toBeFalsy();
  });

  it('hold guarded loot crates, and a roof overhead', () => {
    const w = new World(2);
    const rich = lootCrates(w).filter((c) => c.rich);
    for (const b of w.buildings) {
      for (const c of crates(w, b)) {
        expect(rich.some((r) => r.box === c.box)).toBe(true);
        const x = (c.box.minX + c.box.maxX) / 2;
        const z = (c.box.minZ + c.box.maxZ) / 2;
        expect(w.ceilingHeight(x, z, b.floor + 1.8)).toBeCloseTo(b.roof, 6);
      }
    }
  });
});
