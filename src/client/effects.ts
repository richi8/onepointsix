import * as THREE from 'three';
import { wetMaterial } from './rain.ts';
import { GRAVITY } from '../shared/constants.ts';
import type { Box } from '../shared/world.ts';
import { REFLECTED } from './water.ts';

// Effects in the world: tracers, impact marks, puffs, the flash of light a
// shot throws on its surroundings, explosions and the debris of broken cover.
// Everything is pooled.

/** Visual speed of a tracer streak, slower than a real round so the eye can follow it. */
const TRACER_SPEED = 450;
const TRACER_LENGTH = 3.5;
const MAX_TRACERS = 48;
const MAX_MARKS = 128;
const MAX_PUFFS = 32;
const PUFF_LIFE = 0.5;
const MARK_LIFE = 20;
const FLASH_TIME = 0.06;
const MAX_DEBRIS = 240;
const DEBRIS_LIFE = 4;
/** Chunks a panel breaks into, per cubic metre, within limits. */
const DEBRIS_DENSITY = 6;
const BOOM_TIME = 0.35;
const MAX_SMOKE = 24;
const SMOKE_LIFE = 2.2;
const HIDDEN = new THREE.Matrix4().makeScale(0, 0, 0);

interface Chunk {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  rot: THREE.Euler;
  spin: THREE.Vector3;
  size: THREE.Vector3;
  age: number;
}

interface Tracer {
  mesh: THREE.Mesh;
  from: THREE.Vector3;
  dir: THREE.Vector3;
  dist: number;
  age: number;
}

interface Puff {
  sprite: THREE.Sprite;
  age: number;
  size: number;
}

export type Struck = 'body' | 'world' | 'none';

export class Effects {
  private readonly scene: THREE.Scene;
  private readonly tracers: Tracer[] = [];
  private readonly tracerGeo = new THREE.BoxGeometry(0.018, 0.018, 1).translate(0, 0, -0.5);
  private readonly tracerMat = new THREE.MeshBasicMaterial({
    color: 0xffd9a0, transparent: true, opacity: 0.85, fog: false, toneMapped: false, depthWrite: false,
  });
  private readonly marks: THREE.InstancedMesh;
  private readonly markBorn: number[] = [];
  private nextMark = 0;
  private readonly puffs: Puff[] = [];
  private readonly light = new THREE.PointLight(0xffc27a, 0, 12, 2);
  private flash = 0;
  private time = 0;
  private readonly dummy = new THREE.Object3D();
  private readonly ground: (x: number, z: number) => number;
  private readonly debris: THREE.InstancedMesh;
  /** Each chunk's texture layer, once the debris is textured. */
  private readonly debrisLayer = new THREE.InstancedBufferAttribute(new Float32Array(MAX_DEBRIS), 1);
  private readonly chunks: Chunk[] = [];
  private nextChunk = 0;
  private readonly smoke: Puff[] = [];
  private readonly fireball: THREE.Sprite;
  private readonly boomLight = new THREE.PointLight(0xffa550, 0, 30, 2);
  private boom = BOOM_TIME;

  /** `ground` gives the floor height debris lands on. */
  constructor(scene: THREE.Scene, ground: (x: number, z: number) => number) {
    this.scene = scene;
    this.ground = ground;
    this.marks = new THREE.InstancedMesh(
      new THREE.CircleGeometry(0.035, 8),
      new THREE.MeshBasicMaterial({ color: 0x1a1714, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2 }),
      MAX_MARKS,
    );
    this.marks.count = 0;
    this.marks.frustumCulled = false;
    scene.add(this.marks);
    // Always in the scene, so adding light doesn't recompile every material.
    scene.add(this.light);

    const puffTex = radialTexture();
    for (let i = 0; i < MAX_PUFFS; i++) {
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: puffTex, transparent: true, depthWrite: false }));
      sprite.visible = false;
      scene.add(sprite);
      this.puffs.push({ sprite, age: PUFF_LIFE, size: 0 });
    }
    for (let i = 0; i < MAX_SMOKE; i++) {
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: puffTex, transparent: true, depthWrite: false, color: 0x6b665e }));
      sprite.visible = false;
      scene.add(sprite);
      this.smoke.push({ sprite, age: SMOKE_LIFE, size: 0 });
    }
    this.fireball = new THREE.Sprite(new THREE.SpriteMaterial({
      map: puffTex, color: 0xffb35c, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
    }));
    this.fireball.visible = false;
    scene.add(this.fireball, this.boomLight);

    const chunkGeo = new THREE.BoxGeometry(1, 1, 1);
    chunkGeo.setAttribute('layer', this.debrisLayer);
    this.debris = new THREE.InstancedMesh(chunkGeo, wetMaterial(new THREE.MeshStandardMaterial({ roughness: 0.9 }), 0.5), MAX_DEBRIS);
    this.debris.count = 0;
    this.debris.frustumCulled = false;
    this.debris.castShadow = this.debris.receiveShadow = true;
    this.debris.layers.enable(REFLECTED);
    scene.add(this.debris);
  }

  /** Texture the debris like the panels it comes from, each chunk in its own frame. */
  setDebrisMaterial(material: THREE.Material): void {
    const old = this.debris.material as THREE.Material;
    this.debris.material = material;
    old.dispose();
  }

  /**
   * A panel coming apart: chunks of it in its colour and texture `layer` fly
   * away from (fx, fy, fz), where the force came from, harder the closer it was.
   */
  shatter(box: Box, color: THREE.Color, layer: number, fx: number, fy: number, fz: number): void {
    const sx = box.maxX - box.minX;
    const sy = box.maxY - box.minY;
    const sz = box.maxZ - box.minZ;
    const n = Math.round(THREE.MathUtils.clamp(sx * sy * sz * DEBRIS_DENSITY, 6, 28));
    const cx = (box.minX + box.maxX) / 2;
    const cy = (box.minY + box.maxY) / 2;
    const cz = (box.minZ + box.maxZ) / 2;
    const push = THREE.MathUtils.clamp(14 / (1 + Math.hypot(cx - fx, cy - fy, cz - fz)), 1.5, 9);
    const piece = Math.max(Math.cbrt((sx * sy * sz) / n), 0.12);
    for (let i = 0; i < n; i++) {
      const x = box.minX + Math.random() * sx;
      const y = box.minY + Math.random() * sy;
      const z = box.minZ + Math.random() * sz;
      const dx = x - fx;
      const dy = y - fy;
      const dz = z - fz;
      const d = Math.hypot(dx, dy, dz) || 1;
      const k = push * (0.5 + Math.random());
      const idx = this.nextChunk;
      this.nextChunk = (idx + 1) % MAX_DEBRIS;
      const chunk: Chunk = {
        x, y, z,
        vx: (dx / d) * k + (Math.random() - 0.5) * 2,
        vy: (dy / d) * k + 1 + Math.random() * 3,
        vz: (dz / d) * k + (Math.random() - 0.5) * 2,
        rot: new THREE.Euler(Math.random() * 3, Math.random() * 3, Math.random() * 3),
        spin: new THREE.Vector3().randomDirection().multiplyScalar(4 + Math.random() * 8),
        // Never thicker than the panel, so fences splinter into slats.
        size: new THREE.Vector3(
          Math.min(piece * (0.5 + Math.random()), sx),
          Math.min(piece * (0.4 + Math.random() * 0.8), sy),
          Math.min(piece * (0.5 + Math.random()), sz),
        ),
        age: 0,
      };
      this.chunks[idx] = chunk;
      this.debris.setMatrixAt(idx, HIDDEN);
      this.debris.setColorAt(idx, color);
      this.debrisLayer.setX(idx, layer);
      this.debris.count = Math.max(this.debris.count, idx + 1);
    }
    if (this.debris.instanceColor) this.debris.instanceColor.needsUpdate = true;
    this.debrisLayer.needsUpdate = true;
    this.dust(cx, cy, cz, Math.max(sx, sy, sz));
  }

  /** A grenade going off at `at`. */
  explosion(at: THREE.Vector3): void {
    this.boom = 0;
    this.fireball.position.copy(at).y += 0.5;
    this.fireball.visible = true;
    this.boomLight.position.copy(at).y += 1;
    this.dust(at.x, at.y + 0.6, at.z, 3);
    for (let i = 0; i < 5; i++) {
      this.dust(at.x + (Math.random() - 0.5) * 2, at.y + 0.5 + Math.random() * 1.5, at.z + (Math.random() - 0.5) * 2, 2 + Math.random() * 2);
    }
  }

  /** A slow cloud of smoke or dust `size` across. */
  private dust(x: number, y: number, z: number, size: number): void {
    const p = this.smoke.reduce((a, b) => (b.age > a.age ? b : a));
    p.age = 0;
    p.size = size;
    p.sprite.position.set(x, y, z);
    p.sprite.visible = true;
  }

  /** A streak running from a muzzle to where the round stopped. */
  tracer(from: THREE.Vector3, to: THREE.Vector3): void {
    const dir = to.clone().sub(from);
    const dist = dir.length();
    if (dist < 0.5) return;
    dir.divideScalar(dist);
    let t = this.tracers.find((tr) => tr.age * TRACER_SPEED - TRACER_LENGTH >= tr.dist);
    if (!t) {
      if (this.tracers.length >= MAX_TRACERS) return;
      t = { mesh: new THREE.Mesh(this.tracerGeo, this.tracerMat), from: new THREE.Vector3(), dir: new THREE.Vector3(), dist: 0, age: 0 };
      t.mesh.frustumCulled = false;
      this.scene.add(t.mesh);
      this.tracers.push(t);
    }
    t.from.copy(from);
    t.dir.copy(dir);
    t.dist = dist;
    t.age = 0;
    t.mesh.visible = false;
  }

  /**
   * What a round did where it stopped: a mark and a dust puff on the world, a
   * red puff on a body, nothing when it flew out of range. `normal` is the
   * surface's outward normal, or for a body the way back toward the shooter.
   */
  impact(at: THREE.Vector3, struck: Struck, normal: THREE.Vector3): void {
    if (struck === 'none') return;
    if (struck === 'world') {
      const i = this.nextMark;
      this.nextMark = (i + 1) % MAX_MARKS;
      this.dummy.position.copy(at).addScaledVector(normal, 0.005);
      this.dummy.lookAt(at.x + normal.x, at.y + normal.y, at.z + normal.z);
      this.dummy.rotateZ(Math.random() * Math.PI);
      this.dummy.updateMatrix();
      this.marks.setMatrixAt(i, this.dummy.matrix);
      this.markBorn[i] = this.time;
      this.marks.count = Math.max(this.marks.count, i + 1);
      this.marks.instanceMatrix.needsUpdate = true;
    }
    const p = this.puffs.reduce((a, b) => (b.age > a.age ? b : a));
    p.age = 0;
    p.size = struck === 'body' ? 0.35 : 0.5;
    p.sprite.position.copy(at).addScaledVector(normal, 0.08);
    (p.sprite.material as THREE.SpriteMaterial).color.setHex(struck === 'body' ? 0x9a1f1a : 0xb3a58a);
    p.sprite.visible = true;
  }

  /** Clear away every mark, puff, tracer and piece of debris, as another island opens. */
  clear(): void {
    this.marks.count = 0;
    this.nextMark = 0;
    this.debris.count = 0;
    this.chunks.length = 0;
    this.nextChunk = 0;
    for (const t of this.tracers) (t.dist = 0), (t.mesh.visible = false);
    for (const p of this.puffs) (p.age = PUFF_LIFE), (p.sprite.visible = false);
    for (const p of this.smoke) (p.age = SMOKE_LIFE), (p.sprite.visible = false);
    this.flash = 0;
    this.boom = BOOM_TIME;
  }

  /** Light up the surroundings of a muzzle for a moment. */
  muzzleLight(at: THREE.Vector3): void {
    this.light.position.copy(at);
    this.flash = FLASH_TIME;
  }

  update(dt: number): void {
    this.time += dt;
    for (const t of this.tracers) {
      if (t.age * TRACER_SPEED - TRACER_LENGTH >= t.dist) {
        t.mesh.visible = false;
        continue;
      }
      t.age += dt;
      const head = Math.min(t.age * TRACER_SPEED, t.dist);
      const tail = Math.max(head - TRACER_LENGTH, 0);
      if (head - tail < 1e-3) {
        t.mesh.visible = false;
        continue;
      }
      t.mesh.visible = true;
      t.mesh.position.copy(t.from).addScaledVector(t.dir, head);
      t.mesh.lookAt(t.mesh.position.x + t.dir.x, t.mesh.position.y + t.dir.y, t.mesh.position.z + t.dir.z);
      t.mesh.scale.set(1, 1, head - tail);
    }

    for (const p of this.puffs) {
      if (p.age >= PUFF_LIFE) continue;
      p.age += dt;
      const f = Math.min(p.age / PUFF_LIFE, 1);
      p.sprite.visible = f < 1;
      p.sprite.scale.setScalar(p.size * (0.4 + f));
      (p.sprite.material as THREE.SpriteMaterial).opacity = 0.7 * (1 - f);
    }

    // Old marks shrink away so the pool never visibly pops.
    for (let i = 0; i < this.marks.count; i++) {
      if (this.time - this.markBorn[i] < MARK_LIFE) continue;
      this.marks.getMatrixAt(i, this.dummy.matrix);
      this.dummy.matrix.decompose(this.dummy.position, this.dummy.quaternion, this.dummy.scale);
      if (this.dummy.scale.x < 0.01) continue;
      this.dummy.scale.multiplyScalar(0.95);
      this.dummy.updateMatrix();
      this.marks.setMatrixAt(i, this.dummy.matrix);
      this.marks.instanceMatrix.needsUpdate = true;
    }

    this.flash = Math.max(this.flash - dt, 0);
    this.light.intensity = (this.flash / FLASH_TIME) * 30;

    this.updateDebris(dt);
    for (const p of this.smoke) {
      if (p.age >= SMOKE_LIFE) continue;
      p.age += dt;
      const f = Math.min(p.age / SMOKE_LIFE, 1);
      p.sprite.visible = f < 1;
      p.sprite.position.y += dt * 0.6;
      p.sprite.scale.setScalar(p.size * (0.6 + f * 1.2));
      (p.sprite.material as THREE.SpriteMaterial).opacity = 0.55 * (1 - f) * Math.min(p.age * 8, 1);
    }
    if (this.boom < BOOM_TIME) {
      this.boom += dt;
      const f = Math.min(this.boom / BOOM_TIME, 1);
      this.fireball.visible = f < 1;
      this.fireball.scale.setScalar(1.5 + f * 4.5);
      (this.fireball.material as THREE.SpriteMaterial).opacity = 1 - f * f;
      this.boomLight.intensity = (1 - f) * 400;
    } else this.boomLight.intensity = 0;
  }

  /** Chunks fall, bounce once or twice off the ground, settle, then shrink away. */
  private updateDebris(dt: number): void {
    const m = this.dummy;
    let moved = false;
    for (let i = 0; i < this.debris.count; i++) {
      const c = this.chunks[i];
      if (!c || c.age >= DEBRIS_LIFE) continue;
      c.age += dt;
      c.vy -= GRAVITY * dt;
      c.x += c.vx * dt;
      c.y += c.vy * dt;
      c.z += c.vz * dt;
      const floor = this.ground(c.x, c.z) + c.size.y / 2;
      if (c.y < floor) {
        c.y = floor;
        c.vy = Math.abs(c.vy) > 2 ? -c.vy * 0.3 : 0;
        c.vx *= 0.6;
        c.vz *= 0.6;
        c.spin.multiplyScalar(0.6);
      }
      c.rot.x += c.spin.x * dt;
      c.rot.y += c.spin.y * dt;
      c.rot.z += c.spin.z * dt;
      const fade = Math.min((DEBRIS_LIFE - c.age) / 0.8, 1);
      m.position.set(c.x, c.y, c.z);
      m.rotation.copy(c.rot);
      m.scale.copy(c.size).multiplyScalar(Math.max(fade, 0));
      m.updateMatrix();
      this.debris.setMatrixAt(i, m.matrix);
      moved = true;
    }
    if (moved) this.debris.instanceMatrix.needsUpdate = true;
  }
}

function radialTexture(): THREE.Texture {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const g = canvas.getContext('2d')!;
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.5, 'rgba(255,255,255,0.5)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
