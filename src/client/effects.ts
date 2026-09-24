import * as THREE from 'three';

// Bullet effects in the world: tracers, impact marks, puffs and the flash of
// light a shot throws on its surroundings. Everything is pooled.

/** Visual speed of a tracer streak, slower than a real round so the eye can follow it. */
const TRACER_SPEED = 450;
const TRACER_LENGTH = 3.5;
const MAX_TRACERS = 48;
const MAX_MARKS = 128;
const MAX_PUFFS = 32;
const PUFF_LIFE = 0.5;
const MARK_LIFE = 20;
const FLASH_TIME = 0.06;

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

  constructor(scene: THREE.Scene) {
    this.scene = scene;
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
