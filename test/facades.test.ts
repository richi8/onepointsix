import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { KIT_WALL, placeBlocks, SLAB } from '../src/shared/kit.ts';
import { CALABIANCA } from '../src/shared/maps/calabianca.ts';
import { World } from '../src/shared/world.ts';
import { railProps, balconies } from '../src/client/balconies.ts';
import { dressFacades } from '../src/client/dressing.ts';
import { Life } from '../src/client/life.ts';
import { roofs } from '../src/client/roofs.ts';
import { edgeBit, openEdges } from '../src/client/rounding.ts';
import { signWalls } from '../src/client/signs.ts';
import { Boxes, Shapes } from '../src/client/townparts.ts';

// Calabianca's façades (chunk 62): edges rounded where they stand in the
// open, windows set deep in their walls, iron railings drawn over the
// balconies' railings, and what people have put up, all drawn only and
// kept out of the rooms. Coordinates are the town's as moved onto its
// island, 240 m south.

const town = new World(1, CALABIANCA);

/** A unit box's matrix for a prop where it stands. */
const matrixOf = (i: number) => {
  const b = town.props[i].box;
  return new THREE.Matrix4().makeScale(b.maxX - b.minX, b.maxY - b.minY, b.maxZ - b.minZ).setPosition((b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2, (b.minZ + b.maxZ) / 2);
};

describe('rounded edges', () => {
  it('gives each of a box\'s twelve edges a bit of its own, the same from either face', () => {
    const bits = new Set<number>();
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) {
        if (i === j) continue;
        for (const si of [-1, 1]) {
          for (const sj of [-1, 1]) {
            expect(edgeBit(i, si, j, sj)).toBe(edgeBit(j, sj, i, si));
            bits.add(edgeBit(i, si, j, sj));
          }
        }
      }
    }
    expect(bits.size).toBe(12);
    expect([...bits].reduce((a, b) => a | b, 0)).toBe(4095);
  });

  it('rounds buildings\' outer corners and terraces\' tops, but not where one storey of wall stands on the next nor in the ground', () => {
    const walls = town.props.map((_, i) => i).filter((i) => town.props[i].box.part === 'wall');
    const edges = new Map(walls.map((i) => [i, openEdges(town, matrixOf(i))]));
    const top = [edgeBit(1, 1, 0, -1), edgeBit(1, 1, 0, 1), edgeBit(1, 1, 2, -1), edgeBit(1, 1, 2, 1)].reduce((a, b) => a | b);
    const bottom = [edgeBit(1, -1, 0, -1), edgeBit(1, -1, 0, 1), edgeBit(1, -1, 2, -1), edgeBit(1, -1, 2, 1)].reduce((a, b) => a | b);
    const upright = [edgeBit(0, -1, 2, -1), edgeBit(0, -1, 2, 1), edgeBit(0, 1, 2, -1), edgeBit(0, 1, 2, 1)].reduce((a, b) => a | b);
    const near = (a: number, b: number) => Math.abs(a - b) < 1e-6;
    let stacked = 0;
    for (const i of walls) {
      const b = town.props[i].box;
      const above = walls.find((j) => {
        const c = town.props[j].box;
        return near(c.minY, b.maxY) && near(c.minX, b.minX) && near(c.maxX, b.maxX) && near(c.minZ, b.minZ) && near(c.maxZ, b.maxZ);
      });
      if (above !== undefined) {
        stacked++;
        expect(edges.get(i)! & top).toBe(0);
      }
      if (b.minY < town.terrainHeight((b.minX + b.maxX) / 2, (b.minZ + b.maxZ) / 2) - 0.1) expect(edges.get(i)! & bottom).toBe(0);
    }
    expect(stacked).toBeGreaterThan(100);
    expect(walls.filter((i) => edges.get(i)! & upright).length).toBeGreaterThan(100);
    expect(walls.filter((i) => town.props[i].box.walk && edges.get(i)! & top).length).toBeGreaterThan(5);
  });
});

describe('Calabianca\'s façades', () => {
  it('sets its windows more than 20 cm into their walls, behind their stone surrounds, over a sill standing out', () => {
    const boxes = new Boxes();
    dressFacades(town, boxes);
    // The Albergo del Porto's front over the quay, its first floor.
    const w = town.facades.find((f) => f.axis === 'x' && Math.abs(f.line - 285) < 0.01 && f.a0 < -15 && f.a1 > -15 && f.y > 5 && f.openings.some((o) => o.kind === 'window'))!;
    const o = w.openings.find((x) => x.kind === 'window')!;
    const at = new THREE.Vector3();
    const scale = new THREE.Vector3();
    const q = new THREE.Quaternion();
    /** How far out of the wall's middle line, the glass's, the dressing reaches round the window, at `a` along and `y` up. */
    const reach = (a: number, y: number) => {
      let most = 0;
      boxes.matrices.forEach((m) => {
        m.decompose(at, q, scale);
        if (Math.abs(at.x - a) > scale.x / 2 || Math.abs(at.y - y) > scale.y / 2) return;
        const out = Math.abs(at.z - w.line) + scale.z / 2;
        if (out < 1) most = Math.max(most, out);
      });
      return most;
    };
    const jamb = reach(o.at - o.width / 2 - 0.06, w.y + 1.5);
    expect(jamb).toBeGreaterThan(0.2);
    expect(jamb).toBeLessThan(0.3);
    expect(reach(o.at, w.y + 0.97)).toBeGreaterThan(jamb);
  });

  it('draws every balcony\'s railings in iron, the railings it collides as still there to stop rounds', () => {
    const count = CALABIANCA.buildings.flatMap((b) => b.blocks.flatMap((k) => k.balconies ?? [])).length;
    expect(count).toBeGreaterThan(3);
    const rails = railProps(town);
    expect(rails.size).toBe(count * 3);
    for (const i of rails) {
      const b = town.props[i].box;
      expect(b.part).toBe('wall');
      expect(b.maxY - b.minY).toBeCloseTo(1, 5);
      // A round at its middle from beside it stops on it.
      const [x, y, z] = [(b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2, (b.minZ + b.maxZ) / 2];
      const alongX = b.maxX - b.minX > b.maxZ - b.minZ;
      const t = alongX ? town.raycast(x, y, z + 3, 0, 0, -1, 5) : town.raycast(x + 3, y, z, -1, 0, 0, 5);
      expect(t).toBeLessThan(3);
    }
    expect(railProps(new World(1)).size).toBe(0);
  });

  it('strings cables and washing lines across its lanes from wall to wall, high enough to walk under', () => {
    const life = new Life(town, new Boxes(), new Shapes());
    dressFacades(town, new Boxes(), new Shapes(), life);
    life.string();
    const cables = life.strung.filter((s) => s.kind === 'cable');
    const lines = life.strung.filter((s) => s.kind === 'line');
    expect(cables.length).toBeGreaterThan(10);
    expect(lines.length).toBeGreaterThan(5);
    for (const s of life.strung) {
      const mid = s.from.clone().lerp(s.to, 0.5);
      expect(mid.y - s.sag - town.groundHeight(mid.x, mid.z, mid.y - s.sag)).toBeGreaterThanOrEqual(2.4);
      expect(s.from.distanceTo(s.to)).toBeLessThan(15.5);
      // Level, from wall to wall.
      expect(Math.abs(s.from.y - s.to.y)).toBeLessThan(1e-6);
    }
  });

  it('keeps everything drawn over its walls and roofs out of its rooms', () => {
    const boxes = new Boxes();
    const shapes = new Shapes();
    const life = new Life(town, boxes, shapes);
    dressFacades(town, boxes, shapes, life);
    life.string();
    life.roofs();
    roofs(town, boxes, shapes);
    balconies(town, boxes, shapes);
    const rooms = placeBlocks(CALABIANCA.buildings).flatMap((p) => {
      const b = p.block;
      const inner = { minX: b.minX + KIT_WALL / 2 + 0.02, maxX: b.maxX - KIT_WALL / 2 - 0.02, minZ: b.minZ + KIT_WALL / 2 + 0.02, maxZ: b.maxZ - KIT_WALL / 2 - 0.02 };
      return Array.from({ length: b.storeys - (b.from ?? 0) }, (_, k) => {
        const y = p.floor + p.height * (k + (b.from ?? 0));
        return { ...inner, y0: y + 0.05, y1: y + p.height - SLAB - 0.05 };
      });
    });
    const inRoom = (x: number, y: number, z: number) => rooms.some((r) => x > r.minX && x < r.maxX && z > r.minZ && z < r.maxZ && y > r.y0 && y < r.y1);
    const at = new THREE.Vector3();
    expect(boxes.matrices.filter((m) => inRoom(...at.setFromMatrixPosition(m).toArray())).length).toBe(0);
    const pos = shapes.geometry()!.getAttribute('position');
    let inside = 0;
    for (let i = 0; i < pos.count; i++) if (inRoom(pos.getX(i), pos.getY(i), pos.getZ(i))) inside++;
    expect(inside).toBe(0);
  });

  it('finds the wall every sign is written on', () => {
    const walls = signWalls(town);
    expect(walls.length).toBeGreaterThan(10);
    expect(walls.every((w) => w !== null)).toBe(true);
  });
});
