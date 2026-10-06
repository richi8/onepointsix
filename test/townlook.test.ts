import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { KIT_WALL, placeBlocks, SLAB } from '../src/shared/kit.ts';
import { Layer } from '../src/shared/layers.ts';
import { CALABIANCA } from '../src/shared/maps/calabianca.ts';
import { pavingAt } from '../src/shared/maps/index.ts';
import { World } from '../src/shared/world.ts';
import { Dressing, dressFacades } from '../src/client/dressing.ts';
import { features, replacedProps } from '../src/client/features.ts';
import { gableGeometry } from '../src/client/structures.ts';
import { Surfaces } from '../src/client/surface.ts';
import { faces } from '../src/client/surfaces.ts';
import { townLayer } from '../src/client/townlook.ts';
import { Boxes, fineAfter, isFine, Shapes, STONE, TILE } from '../src/client/townparts.ts';

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
    const looks = new Set(['truck', 'stall', 'cart', 'fountain', 'plane', 'olive', 'memorial', 'kiosk', 'boat', 'tank', 'tomb', 'sandbags', 'rubble']);
    const replaced = replacedProps(town);
    // Each feature's box, or the boxes it collides as in its place.
    expect(replaced.size).toBe(CALABIANCA.walls.filter((w) => w.look && looks.has(w.look)).reduce((n, w) => n + (w.collides?.length ?? 1), 0));
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

// Chunk 64: the dressing split into tiles, each culled on its own, its fine
// detail drawn into the near shadows alone and left out of the sea's reflection.
describe('Calabianca\'s dressing, for speed', () => {
  it('counts as fine only what is thin but along its length', () => {
    expect(isFine(5, 0.02, 0.02)).toBe(true);
    expect(isFine(1.2, 0.1, 0.2)).toBe(true);
    expect(isFine(0.6, 1.4, 0.05)).toBe(false);
    expect(isFine(0.55, 0.12, 0.35)).toBe(false);
  });

  it('merges shapes by tile, each tile\'s coarse ones before its fine', () => {
    const shapes = new Shapes();
    const at = (x: number, z: number) => new THREE.Matrix4().makeTranslation(x, 0, z);
    shapes.add(new THREE.BoxGeometry(0.05, 0.05, 2), at(1, 1), STONE);
    shapes.add(new THREE.BoxGeometry(1, 1, 1), at(2, 2), STONE);
    shapes.add(new THREE.BoxGeometry(1, 1, 1), at(TILE + 2, 2), STONE);
    const tiles = shapes.tiles();
    expect(tiles.length).toBe(2);
    const first = tiles.find((t) => t.geometry.getAttribute('position').count === 72)!;
    expect(first.coarse).toBe(36);
    // The coarse box comes first: its vertices all lie round (2, 2).
    const pos = first.geometry.getAttribute('position');
    for (let i = 0; i < first.coarse; i++) expect(Math.abs(pos.getX(i) - 2)).toBeLessThanOrEqual(0.5);
    expect(tiles.find((t) => t !== first)!.coarse).toBe(36);
  });

  it('draws only the coarse part into the other shadow maps and the reflection, all of it elsewhere', () => {
    const near = new THREE.OrthographicCamera();
    const far = new THREE.OrthographicCamera();
    const mesh = new THREE.Mesh(new THREE.BoxGeometry());
    fineAfter(mesh, 12, () => near);
    const instanced = new THREE.InstancedMesh(new THREE.BoxGeometry(), undefined, 10);
    fineAfter(instanced, 4, () => near);
    const r = null as unknown as THREE.WebGLRenderer;
    const shadow = (m: THREE.Mesh, cam: THREE.Camera) => m.onBeforeShadow(r, new THREE.Scene(), near, cam, m.geometry, m.material as THREE.Material, null as unknown as THREE.Group);
    const unshadow = (m: THREE.Mesh, cam: THREE.Camera) => m.onAfterShadow(r, new THREE.Scene(), near, cam, m.geometry, m.material as THREE.Material, null as unknown as THREE.Group);
    shadow(mesh, far);
    shadow(instanced, far);
    expect(mesh.geometry.drawRange.count).toBe(12);
    expect(instanced.count).toBe(4);
    unshadow(mesh, far);
    unshadow(instanced, far);
    expect(mesh.geometry.drawRange.count).toBe(Infinity);
    expect(instanced.count).toBe(10);
    shadow(mesh, near);
    shadow(instanced, near);
    expect(mesh.geometry.drawRange.count).toBe(Infinity);
    expect(instanced.count).toBe(10);
    const mirror = new THREE.PerspectiveCamera();
    mirror.layers.set(5);
    mesh.onBeforeRender(r, new THREE.Scene(), mirror, mesh.geometry, mesh.material as THREE.Material, null as unknown as THREE.Group);
    expect(mesh.geometry.drawRange.count).toBe(12);
    mesh.onAfterRender(r, new THREE.Scene(), mirror, mesh.geometry, mesh.material as THREE.Material, null as unknown as THREE.Group);
    mesh.onBeforeRender(r, new THREE.Scene(), new THREE.PerspectiveCamera(), mesh.geometry, mesh.material as THREE.Material, null as unknown as THREE.Group);
    expect(mesh.geometry.drawRange.count).toBe(Infinity);
  });

  it('splits the town\'s dressing into tiles, all but a few no bigger than about one', () => {
    const dressing = Dressing.build(town)!;
    const meshes = dressing.group.children.filter((o): o is THREE.Mesh => (o as THREE.Mesh).isMesh && o.castShadow);
    expect(meshes.length).toBeGreaterThan(20);
    // A few hold something long, as the quay's edge along the whole town.
    let big = 0;
    for (const m of meshes) {
      if ((m as THREE.InstancedMesh).isInstancedMesh) (m as THREE.InstancedMesh).computeBoundingSphere();
      else m.geometry.computeBoundingSphere();
      const sphere = (m as THREE.InstancedMesh).isInstancedMesh ? (m as THREE.InstancedMesh).boundingSphere! : m.geometry.boundingSphere!;
      if (sphere.radius > TILE * 1.5) big++;
    }
    expect(big).toBeLessThanOrEqual(4);
  });
});

describe('Calabianca\'s pitched roofs', () => {
  it('reach no slope into a room of a building they stand against', () => {
    const { geometry, plaster } = gableGeometry(town);
    const pos = geometry.getAttribute('position');
    const inside: string[] = [];
    for (let i = 0; i < pos.count; i++) {
      if (plaster[i] >= 0) continue;
      const [x, y, z] = [pos.getX(i), pos.getY(i), pos.getZ(i)];
      // Well inside a room: past the inner face of its walls, under its roof.
      const b = town.buildings.find((b) => y > b.floor && y < b.roof && b.parts.some((r) => x > r.minX + 0.2 && x < r.maxX - 0.2 && z > r.minZ + 0.2 && z < r.maxZ - 0.2));
      if (b) inside.push(`${x.toFixed(2)}, ${y.toFixed(2)}, ${z.toFixed(2)}`);
    }
    expect(inside).toEqual([]);
  });
});

describe('Calabianca\'s rubble', () => {
  it('collides as a heap, low at its edges and highest in its middle, as drawn', () => {
    const heaps = CALABIANCA.walls.filter((w) => w.look === 'rubble');
    expect(heaps.length).toBe(2);
    for (const h of heaps) {
      const [cx, cz] = [(h.minX + h.maxX) / 2, (h.minZ + h.maxZ) / 2];
      const top = (x: number, z: number) => 40 - town.raycast(x, 40, z, 0, -1, 0, 60);
      expect(top(cx, cz)).toBeCloseTo(h.y1, 3);
      const edge = top(cx + (h.maxX - h.minX) * 0.45, cz);
      expect(edge).toBeLessThan(h.y1 - (h.y1 - h.y0 - 0.4) * 0.5);
      expect(edge).toBeGreaterThan(h.y0 + 0.4);
    }
  });
});
