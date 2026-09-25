import * as THREE from 'three';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { clamp, lerp } from '../shared/geom.ts';
import { fitGun } from './guns.ts';

// The weapon in your hands. It is drawn in its own scene after the world, over
// a cleared depth buffer, so it never clips into walls. Simple shapes stand in
// until the gun models have loaded.

const FOV = 60;
/** Length of a suppressor on the barrel. */
const CAN_LENGTH = 0.15;
const FLASH_TIME = 0.045;

interface Model {
  group: THREE.Group;
  /** The gun itself, swapped for the loaded model. */
  body: THREE.Object3D[];
  /** Gloved hands, on the grip and the fore-end. */
  hands: [THREE.Object3D, THREE.Object3D];
  /** Where the grip sits in the model's space. */
  grip: THREE.Vector3;
  flash: THREE.Mesh;
  /** The suppressor on the barrel, shown when fitted. */
  can: THREE.Mesh;
  /** Muzzle position in the model's space, bare and with the suppressor on. */
  muzzle: THREE.Vector3;
  canMuzzle: THREE.Vector3;
  /** Resting position from the hip, and aimed (sight on the screen centre). */
  hip: THREE.Vector3;
  ads: THREE.Vector3;
  /** Backward shove and upward flip per shot. */
  shove: number;
  flip: number;
}

/** What the viewmodel animates from, per frame. */
export interface HeldState {
  weapon: number;
  aim: number;
  /** 0 to 1 through a reload, or 0 when not reloading. */
  reload: number;
  /** 1 just switched to 0 fully up. */
  draw: number;
  speed: number;
  onGround: boolean;
  sprinting: boolean;
  /** A suppressor is fitted: longer barrel, no flash. */
  suppressed: boolean;
}

export class ViewModel {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(FOV, 1, 0.01, 10);
  private readonly root = new THREE.Group();
  private readonly models: Model[];
  private current = 0;
  private bob = 0;
  private sway = new THREE.Vector2();
  private kick = 0;
  private flip = 0;
  private flashLeft = 0;
  private sprintBlend = 0;
  private suppressed = false;
  private readonly tmp = new THREE.Vector3();

  constructor() {
    this.scene.add(new THREE.HemisphereLight(0xcfdcea, 0x5a5440, 1.4));
    const sun = new THREE.DirectionalLight(0xfff1dc, 2);
    sun.position.set(0.4, 1, 0.3);
    this.scene.add(sun);
    this.scene.add(this.camera);
    this.camera.add(this.root);
    // In WEAPONS order.
    this.models = [rifle(), pistol(), boltAction()];
    for (const m of this.models) {
      m.group.visible = false;
      this.root.add(m.group);
    }
  }

  /** Swap the stand-in shapes for real guns, in WEAPONS order, lit by the sky. */
  setGuns(guns: GLTF[], environment: THREE.Texture): void {
    this.scene.environment = environment;
    this.scene.environmentIntensity = 0.8;
    this.models.forEach((m, i) => {
      const gun = fitGun(guns[i], i);
      for (const part of m.body) m.group.remove(part);
      gun.object.position.copy(m.grip);
      m.group.add(gun.object);
      m.body = [gun.object];
      m.muzzle.copy(gun.muzzle).add(m.grip);
      m.canMuzzle.copy(m.muzzle).z -= CAN_LENGTH;
      m.flash.position.copy(m.muzzle);
      m.can.position.copy(m.muzzle).z -= CAN_LENGTH / 2;
      m.hands[0].position.copy(gun.grip).add(m.grip).y -= 0.03;
      m.hands[1].position.copy(gun.support).add(m.grip).y -= 0.03;
    });
  }

  resize(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  /** A round just left the barrel. */
  fire(weapon: number): void {
    const m = this.models[weapon];
    this.kick += m.shove;
    this.flip += m.flip;
    this.flashLeft = FLASH_TIME;
    m.flash.rotation.z = Math.random() * Math.PI;
  }

  update(dt: number, s: HeldState, lookDx: number, lookDy: number): void {
    if (s.weapon !== this.current) {
      this.models[this.current].group.visible = false;
      this.current = s.weapon;
    }
    const m = this.models[this.current];
    m.group.visible = true;
    m.can.visible = this.suppressed = s.suppressed;

    // Springs back from recoil, sway toward the mouse, bob with the stride.
    this.kick *= Math.exp(-14 * dt);
    this.flip *= Math.exp(-12 * dt);
    this.sway.x = lerp(this.sway.x, clamp(-lookDx * 0.0006, -0.04, 0.04), 1 - Math.exp(-10 * dt));
    this.sway.y = lerp(this.sway.y, clamp(lookDy * 0.0006, -0.04, 0.04), 1 - Math.exp(-10 * dt));
    const stride = s.onGround ? clamp(s.speed / 6, 0, 1.6) : 0;
    this.bob += dt * (4 + s.speed * 0.9) * (stride > 0.05 ? 1 : 0);
    this.sprintBlend = lerp(this.sprintBlend, s.sprinting ? 1 : 0, 1 - Math.exp(-10 * dt));

    const aim = s.aim * s.aim * (3 - 2 * s.aim);
    const loose = 1 - aim * 0.85;
    const reloadDip = Math.sin(Math.PI * s.reload);
    const g = m.group;
    g.position.lerpVectors(m.hip, m.ads, aim);
    g.position.x += (Math.sin(this.bob) * 0.012 * stride + this.sway.x) * loose;
    g.position.y += (-Math.abs(Math.cos(this.bob)) * 0.01 * stride + this.sway.y) * loose;
    g.position.y -= reloadDip * 0.08 + s.draw * 0.3 + this.sprintBlend * 0.05;
    g.position.z += this.kick;
    g.rotation.set(
      this.flip + reloadDip * -0.35 - s.draw * 0.9 - this.sprintBlend * 0.25,
      this.sway.x * 2 * loose + this.sprintBlend * 0.7,
      reloadDip * 0.5 + this.sprintBlend * 0.2,
    );

    this.flashLeft = Math.max(this.flashLeft - dt, 0);
    m.flash.visible = this.flashLeft > 0 && !this.suppressed;
  }

  /** Hide the gun, as when looking through a scope. */
  set hidden(v: boolean) {
    this.root.visible = !v;
  }

  /** The muzzle's position relative to the camera, to start tracers from in the world. */
  muzzleOffset(): THREE.Vector3 {
    const m = this.models[this.current];
    this.root.updateMatrixWorld(true);
    this.tmp.copy(this.suppressed ? m.canMuzzle : m.muzzle);
    m.group.localToWorld(this.tmp);
    return this.camera.worldToLocal(this.tmp);
  }
}

// ---------------------------------------------------------------- models

const DARK = new THREE.MeshStandardMaterial({ color: 0x3b3e43, roughness: 0.5, metalness: 0.2 });
const POLYMER = new THREE.MeshStandardMaterial({ color: 0x4a4b45, roughness: 0.85 });
const WOOD = new THREE.MeshStandardMaterial({ color: 0x6b4526, roughness: 0.7 });
const TAN = new THREE.MeshStandardMaterial({ color: 0x8a7a5a, roughness: 0.8 });
const GLOVE = new THREE.MeshStandardMaterial({ color: 0x4b5240, roughness: 0.95 });
const LENS = new THREE.MeshStandardMaterial({ color: 0x1c3a48, roughness: 0.1, metalness: 0.3 });
const RED_DOT = new THREE.MeshBasicMaterial({ color: 0xff2a1a, toneMapped: false });
const FLASH = new THREE.MeshBasicMaterial({
  color: 0xffc070, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
});

function box(w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number, rx = 0): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  mesh.position.set(x, y, z);
  mesh.rotation.x = rx;
  return mesh;
}

function ring(radius: number, thickness: number, mat: THREE.Material, x: number, y: number, z: number): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.TorusGeometry(radius, thickness, 8, 24), mat);
  mesh.position.set(x, y, z);
  return mesh;
}

function tube(r: number, len: number, mat: THREE.Material, x: number, y: number, z: number): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 12).rotateX(Math.PI / 2), mat);
  mesh.position.set(x, y, z);
  return mesh;
}

function flashAt(z: number, size: number): THREE.Mesh {
  const shape = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    const r = i % 2 ? size * 0.35 : size;
    if (i === 0) shape.moveTo(Math.cos(a) * r, Math.sin(a) * r);
    else shape.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  const flash = new THREE.Mesh(new THREE.ShapeGeometry(shape), FLASH);
  flash.position.z = z;
  flash.visible = false;
  return flash;
}

/**
 * A gun model with its sight line on y = 0, the barrel along -z: the gun's
 * parts, the extras kept on the real model (optics), and the two hands.
 */
function model(
  body: THREE.Object3D[], extras: THREE.Object3D[], hands: [THREE.Mesh, THREE.Mesh],
  muzzleY: number, muzzleZ: number, flashSize: number, canRadius: number,
  hip: THREE.Vector3, adsZ: number, shove: number, flip: number,
): Model {
  const group = new THREE.Group();
  group.add(...body, ...extras, ...hands);
  const flash = flashAt(muzzleZ, flashSize);
  flash.position.y = muzzleY;
  const can = tube(canRadius, CAN_LENGTH, DARK, 0, muzzleY, muzzleZ - CAN_LENGTH / 2);
  can.visible = false;
  group.add(flash, can);
  return {
    group, body, hands, grip: hands[0].position.clone().setY(0),
    flash, can, muzzle: new THREE.Vector3(0, muzzleY, muzzleZ), canMuzzle: new THREE.Vector3(0, muzzleY, muzzleZ - CAN_LENGTH),
    hip, ads: new THREE.Vector3(0, 0, adsZ), shove, flip,
  };
}

function rifle(): Model {
  return model(
    [
      box(0.05, 0.07, 0.42, DARK, 0, -0.06, -0.05),
      box(0.045, 0.05, 0.22, POLYMER, 0, -0.055, -0.33),
      tube(0.011, 0.2, DARK, 0, -0.04, -0.52),
      box(0.035, 0.14, 0.07, DARK, 0, -0.15, -0.1, 0.25),
      box(0.035, 0.1, 0.045, POLYMER, 0, -0.13, 0.08, -0.35),
      box(0.045, 0.07, 0.2, POLYMER, 0, -0.07, 0.25),
    ],
    [
      // Reflex sight: a ring around the dot on the sight line, on a mount.
      ring(0.017, 0.0035, DARK, 0, 0, -0.03),
      box(0.03, 0.014, 0.04, DARK, 0, -0.024, -0.03),
      box(0.004, 0.004, 0.002, RED_DOT, 0, 0, -0.045),
    ],
    [box(0.05, 0.06, 0.09, GLOVE, 0.0, -0.15, 0.08), box(0.05, 0.05, 0.1, GLOVE, -0.01, -0.1, -0.3)],
    -0.04, -0.62, 0.06, 0.02, new THREE.Vector3(0.2, -0.17, -0.62), -0.5, 0.045, 0.06,
  );
}

function pistol(): Model {
  return model(
    [
      box(0.032, 0.035, 0.19, DARK, 0, -0.02, -0.05),
      box(0.03, 0.03, 0.16, POLYMER, 0, -0.05, -0.04),
      box(0.03, 0.11, 0.05, POLYMER, 0, -0.11, 0.03, -0.25),
      box(0.004, 0.008, 0.004, DARK, 0, 0.002, -0.14),
      box(0.012, 0.008, 0.006, DARK, 0, 0.002, 0.04),
    ],
    [],
    // Both hands wrap the grip.
    [box(0.05, 0.08, 0.07, GLOVE, 0, -0.12, 0.05), box(0.045, 0.07, 0.06, GLOVE, -0.02, -0.12, 0.04)],
    -0.02, -0.145, 0.04, 0.014, new THREE.Vector3(0.17, -0.15, -0.5), -0.42, 0.05, 0.14,
  );
}

function boltAction(): Model {
  return model(
    [
      box(0.05, 0.06, 0.5, TAN, 0, -0.08, -0.08),
      box(0.045, 0.1, 0.25, TAN, 0, -0.1, 0.27),
      tube(0.012, 0.42, DARK, 0, -0.06, -0.5),
      box(0.04, 0.05, 0.28, DARK, 0, -0.05, -0.02),
      // Scope on its rings.
      tube(0.022, 0.3, DARK, 0, 0, -0.03),
      tube(0.026, 0.06, DARK, 0, 0, -0.19),
      tube(0.023, 0.002, LENS, 0, 0, 0.121),
      box(0.01, 0.03, 0.01, DARK, 0, -0.025, -0.1),
      box(0.01, 0.03, 0.01, DARK, 0, -0.025, 0.05),
      tube(0.006, 0.05, DARK, 0.035, -0.05, 0.06).rotateY(Math.PI / 2),
      box(0.02, 0.02, 0.02, WOOD, 0, -0.14, 0.18),
    ],
    [],
    [box(0.05, 0.06, 0.09, GLOVE, 0, -0.16, 0.12), box(0.05, 0.05, 0.1, GLOVE, -0.01, -0.12, -0.3)],
    -0.06, -0.71, 0.08, 0.02, new THREE.Vector3(0.2, -0.17, -0.66), -0.5, 0.1, 0.2,
  );
}
