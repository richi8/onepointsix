import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { KIT_WALL, placeBlocks, SLAB } from '../src/shared/kit.ts';
import { Layer } from '../src/shared/layers.ts';
import { CALABIANCA } from '../src/shared/maps/calabianca.ts';
import { pavingAt } from '../src/shared/maps/index.ts';
import { World } from '../src/shared/world.ts';
import { dressFacades } from '../src/client/dressing.ts';
import { features, replacedProps } from '../src/client/features.ts';
import { Surfaces } from '../src/client/surface.ts';
import { faces } from '../src/client/surfaces.ts';
import { townLayer } from '../src/client/townlook.ts';
import { Boxes, Shapes } from '../src/client/townparts.ts';

// Calabianca's look (chunk 59): what its ground is paved with and how it
// sounds, how its props are textured, and the dressing drawn over its walls
// and features, which must keep out of its rooms and draw each feature in
// place of its box. Coordinates are the town's as moved onto its island, 240 m south.

const town = new World(1, CALABIANCA);
const island = new World(1);
const Z = 240;

describe('Calabianca\'s ground', () => {
  it('paves the lanes and the quay in flagstones, the squares and the road in cobbles, the gardens in grass, the boat yard bare, and nothing beyond the town', () => {
    expect(pavingAt(CALABIANCA, -37.5, 5 + Z)).toBe('flagstones');
    expect(pavingAt(CALABIANCA, 0, 50 + Z)).toBe('flagstones');
    expect(pavingAt(CALABIANCA, -20, 0 + Z)).toBe('cobbles');
    expect(pavingAt(CALABIANCA, 0, 25 + Z)).toBe('cobbles');
    expect(pavingAt(CALABIANCA, 45, 35 + Z)).toBe('cobbles');
    expect(pavingAt(CALABIANCA, 47, 6 + Z)).toBe('grass');
    expect(pavingAt(CALABIANCA, -50, -50 + Z)).toBe('grass');
    expect(pavingAt(CALABIANCA, -62, 50 + Z)).toBe('earth');
    expect(pavingAt(CALABIANCA, 0, 120 + Z)).toBeNull();
    expect(pavingAt(CALABIANCA, 100, 0 + Z)).toBeNull();
  });

  it('sounds like stone on its paving, stairs and roofs, grass in the garden, wood on a crate', () => {
    const surfaces = new Surfaces(town);
    const ground = (x: number, z: number) => surfaces.at(x, town.groundHeight(x, z, town.terrainHeight(x, z) + 0.4), z);
    expect(ground(-20, 0 + Z)).toBe('rock');
    expect(ground(-37.5, 5 + Z)).toBe('concrete');
    expect(ground(47, 6 + Z)).toBe('grass');
    const top = (part: string, walk = true) => {
      const p = town.props.find((q) => q.box.part === part && !!q.box.walk === walk)!;
      return surfaces.at((p.box.minX + p.box.maxX) / 2, p.box.maxY, (p.box.minZ + p.box.maxZ) / 2);
    };
    expect(top('step')).toBe('concrete');
    expect(top('roof')).toBe('concrete');
    expect(top('crate', false)).toBe('wood');
  });
});

describe('Calabianca\'s textures', () => {
  it('plasters its walls, tiles its floors and roofs over plastered ceilings, and builds its stairs and freestanding walls in stone, paved on top where walked', () => {
    const layerOf = (pred: (i: number) => boolean) => townLayer(town, town.props.findIndex((_, i) => pred(i)));
    const p = town.props;
    expect(layerOf((i) => p[i].box.part === 'wall' && p[i].colour !== undefined)).toBe(Layer.plaster);
    expect(layerOf((i) => p[i].box.part === 'floor' && p[i].colour !== undefined)).toBe(faces(Layer.cotto, Layer.plaster));
    expect(layerOf((i) => p[i].box.part === 'roof')).toBe(faces(Layer.cotto, Layer.plaster));
    expect(layerOf((i) => p[i].box.part === 'step')).toBe(faces(Layer.flagstones, Layer.ashlar));
    expect(layerOf((i) => p[i].box.part === 'wall' && p[i].colour === undefined && !p[i].box.walk)).toBe(Layer.ashlar);
    // A terrace on the piazza is cobbled, as the ground round it.
    const terrace = p.findIndex((q) => q.box.part === 'wall' && q.box.walk && pavingAt(CALABIANCA, (q.box.minX + q.box.maxX) / 2, (q.box.minZ + q.box.maxZ) / 2) === 'cobbles');
    expect(terrace).toBeGreaterThanOrEqual(0);
    expect(townLayer(town, terrace)).toBe(faces(Layer.cobbles, Layer.ashlar));
  });

  it('leaves the island\'s props as they were', () => {
    for (let i = 0; i < island.props.length; i++) expect(townLayer(island, i)).toBeNull();
  });
});

describe('Calabianca\'s dressing', () => {
  it('keeps out of its rooms: nothing drawn over its walls stands inside one', () => {
    const boxes = new Boxes();
    dressFacades(town, boxes);
    expect(boxes.matrices.length).toBeGreaterThan(3000);
    const rooms = placeBlocks(CALABIANCA.buildings).flatMap((p) => {
      const b = p.block;
      const inner = { minX: b.minX + KIT_WALL / 2 + 0.02, maxX: b.maxX - KIT_WALL / 2 - 0.02, minZ: b.minZ + KIT_WALL / 2 + 0.02, maxZ: b.maxZ - KIT_WALL / 2 - 0.02 };
      return Array.from({ length: b.storeys - (b.from ?? 0) }, (_, k) => {
        const y = p.floor + p.height * (k + (b.from ?? 0));
        return { ...inner, y0: y + 0.05, y1: y + p.height - SLAB - 0.05 };
      });
    });
    const at = new THREE.Vector3();
    const inside = boxes.matrices.filter((m) => {
      at.setFromMatrixPosition(m);
      return rooms.some((r) => at.x > r.minX && at.x < r.maxX && at.z > r.minZ && at.z < r.maxZ && at.y > r.y0 && at.y < r.y1);
    });
    expect(inside.length).toBe(0);
  });

  it('draws each feature in place of its box and keeps every other prop, and its shapes whole', () => {
    const looks = new Set(['truck', 'stall', 'cart', 'fountain', 'plane', 'olive', 'memorial', 'kiosk', 'boat', 'tank', 'tomb']);
    const replaced = replacedProps(town);
    expect(replaced.size).toBe(CALABIANCA.walls.filter((w) => w.look && looks.has(w.look)).length);
    for (const i of replaced) expect(town.props[i].box.part).toBe('wall');
    expect(replacedProps(island).size).toBe(0);
    const boxes = new Boxes();
    const shapes = new Shapes();
    features(town, boxes, shapes);
    const g = shapes.geometry()!;
    const pos = g.getAttribute('position');
    expect(pos.count).toBeGreaterThan(1000);
    for (let i = 0; i < pos.count * 3; i++) expect(Number.isFinite(pos.array[i])).toBe(true);
    for (const name of ['normal', 'color', 'tint', 'layer']) expect(g.getAttribute(name).count).toBe(pos.count);
  });
});
