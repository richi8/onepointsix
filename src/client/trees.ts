import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mulberry32 } from '../shared/rng.ts';
import type { World } from '../shared/world.ts';
import type { Assets } from './assets.ts';
import { Layer } from './layers.ts';
import { surfaceMaterial } from './surfaces.ts';

// Firs: a trunk, a dark core of cones and whorls of branch cards with needles
// drawn on them, which give the ragged outline. Trees are split into tiles so
// the ones off screen are skipped.

/** Metres across a tile of trees. */
const TILE = 200;
/** A unit tree is this tall, matching the collider height in World.placeTrees. */
const HEIGHT = 7;
const WHORLS = 13;

interface Tile {
  trunks: THREE.InstancedMesh;
  cores: THREE.InstancedMesh;
  cards: THREE.InstancedMesh;
}

export class Trees {
  readonly group = new THREE.Group();
  private readonly tiles: Tile[] = [];

  constructor(world: World) {
    const trunkGeo = new THREE.CylinderGeometry(0.14, 0.3, HEIGHT - 0.8, 7).translate(0, (HEIGHT - 0.8) / 2, 0);
    const coreGeo = core(mulberry32(world.seed + 19));
    const cardGeo = branches(mulberry32(world.seed + 21));
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x4a3526, roughness: 1 });
    const coreMat = new THREE.MeshStandardMaterial({ roughness: 0.95 });
    const cardMat = new THREE.MeshStandardMaterial({
      map: branchTexture(), alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.85,
    });

    const byTile = new Map<number, number[]>();
    const n = Math.ceil(world.size / TILE);
    world.trees.forEach((t, i) => {
      const tx = Math.min(Math.floor((t.x + world.half) / TILE), n - 1);
      const tz = Math.min(Math.floor((t.z + world.half) / TILE), n - 1);
      const key = tz * n + tx;
      const list = byTile.get(key) ?? [];
      list.push(i);
      byTile.set(key, list);
    });

    const rand = mulberry32(world.seed + 17);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const c = new THREE.Color();
    // Every tree's look is drawn in world order, so tiling doesn't change them.
    const looks = world.trees.map(() => ({ turn: rand() * Math.PI * 2, hue: rand(), light: rand() }));
    for (const ids of byTile.values()) {
      const tile: Tile = {
        trunks: new THREE.InstancedMesh(trunkGeo, trunkMat, ids.length),
        cores: new THREE.InstancedMesh(coreGeo, coreMat, ids.length),
        cards: new THREE.InstancedMesh(cardGeo, cardMat, ids.length),
      };
      ids.forEach((id, i) => {
        const t = world.trees[id];
        const look = looks[id];
        q.setFromAxisAngle(up, look.turn);
        m.compose(new THREE.Vector3(t.x, t.y - 0.2, t.z), q, new THREE.Vector3(t.s, t.s, t.s));
        tile.trunks.setMatrixAt(i, m);
        tile.cores.setMatrixAt(i, m);
        tile.cards.setMatrixAt(i, m);
        c.setHSL(0.22 + look.hue * 0.08, 0.35 + look.light * 0.2, 0.7 + look.light * 0.15, THREE.SRGBColorSpace);
        tile.cards.setColorAt(i, c);
        tile.cores.setColorAt(i, c.setHSL(0.27 + look.hue * 0.05, 0.45, 0.14 + look.light * 0.05, THREE.SRGBColorSpace));
      });
      for (const mesh of [tile.trunks, tile.cores, tile.cards]) {
        mesh.castShadow = mesh.receiveShadow = true;
        mesh.computeBoundingSphere();
        this.group.add(mesh);
      }
      this.tiles.push(tile);
    }
  }

  applyAssets(assets: Assets): void {
    const bark = surfaceMaterial(assets, { kind: 'fixed', layer: Layer.bark }, { roughness: 0.95 }, 1.5);
    for (const t of this.tiles) t.trunks.material = bark;
  }
}

/** Dark cones filling the middle of the crown, so it doesn't look hollow between the cards. */
function core(rand: () => number): THREE.BufferGeometry {
  const tiers: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 4; i++) {
    const f = i / 3;
    const r = 1.35 - f * 0.9;
    const h = 2.4 - f * 0.8;
    const tier = new THREE.ConeGeometry(r, h, 9, 1, true).translate(0, 2.2 + f * 3.4 + h / 2, 0);
    tier.rotateY(rand() * Math.PI);
    tiers.push(tier.toNonIndexed());
  }
  const geo = mergeGeometries(tiers);
  geo.computeVertexNormals();
  return geo;
}

/**
 * Whorls of branch cards, longest at the bottom, drooping and rolled at random.
 * Normals point out from the crown's middle, so it lights as one soft mass.
 */
function branches(rand: () => number): THREE.BufferGeometry {
  const pos: number[] = [];
  const nrm: number[] = [];
  const uv: number[] = [];
  const index: number[] = [];
  const dir = new THREE.Vector3();
  const side = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  const corner = new THREE.Vector3();
  const centre = new THREE.Vector3();
  for (let w = 0; w < WHORLS; w++) {
    const f = w / (WHORLS - 1);
    const y = 1.9 + f * (HEIGHT - 2.3);
    const length = 2.3 * (1 - f) + 0.55;
    const count = f > 0.8 ? 4 : 7 + Math.floor(rand() * 2);
    const turn = rand() * Math.PI * 2;
    for (let b = 0; b < count; b++) {
      const a = turn + (b / count) * Math.PI * 2 + (rand() - 0.5) * 0.5;
      const droop = 0.25 + rand() * 0.3 + (1 - f) * 0.15;
      dir.set(Math.cos(a), -droop, Math.sin(a)).normalize();
      side.crossVectors(dir, up).normalize().applyAxisAngle(dir, (rand() - 0.5) * 2);
      const width = length * 0.9;
      const base = pos.length / 3;
      centre.set(0, y - length * 0.2, 0);
      for (const [along, across] of [[0, -1], [0, 1], [1, -1], [1, 1]] as const) {
        corner.copy(dir).multiplyScalar(along * length).addScaledVector(side, (across * width) / 2);
        corner.y += y;
        pos.push(corner.x, corner.y, corner.z);
        const out = corner.clone().sub(centre).normalize();
        nrm.push(out.x, out.y, out.z);
        uv.push(along, (across + 1) / 2);
      }
      index.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(index);
  return geo;
}

/** A fir branch seen from above: a stem, side twigs and dense needles, on transparent. */
function branchTexture(): THREE.Texture {
  const w = 256;
  const h = 128;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const g = canvas.getContext('2d')!;
  const rand = mulberry32(7);
  const needle = (x: number, y: number, angle: number, len: number): void => {
    g.strokeStyle = `hsl(${95 + rand() * 25}, ${35 + rand() * 20}%, ${24 + rand() * 16}%)`;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + Math.cos(angle) * len, y + Math.sin(angle) * len);
    g.stroke();
  };
  const twig = (x0: number, y0: number, angle: number, len: number, width: number): void => {
    g.lineWidth = width;
    g.strokeStyle = '#3b2f22';
    g.beginPath();
    g.moveTo(x0, y0);
    g.lineTo(x0 + Math.cos(angle) * len, y0 + Math.sin(angle) * len);
    g.stroke();
    g.lineWidth = 1.6;
    for (let s = 0; s < len; s += 1.6) {
      const x = x0 + Math.cos(angle) * s;
      const y = y0 + Math.sin(angle) * s;
      // Needles shorten toward the tip.
      const n = 9 * (1 - (s / len) * 0.5);
      needle(x, y, angle - 1.0 - rand() * 0.4, n * (0.7 + rand() * 0.5));
      needle(x, y, angle + 1.0 + rand() * 0.4, n * (0.7 + rand() * 0.5));
    }
  };
  g.lineCap = 'round';
  // The stem runs along u from the trunk to the tip; twigs taper the outline.
  for (let s = 12; s < w - 30; s += 14 + rand() * 8) {
    const room = (h / 2) * (1 - s / w) * 0.85;
    twig(s, h / 2, -0.55 - rand() * 0.3, room * (0.8 + rand() * 0.4), 1.4);
    twig(s, h / 2, 0.55 + rand() * 0.3, room * (0.8 + rand() * 0.4), 1.4);
  }
  twig(0, h / 2, 0, w - 8, 3);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}
