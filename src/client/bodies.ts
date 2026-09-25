import * as THREE from 'three';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { PLAYER_HEIGHT } from '../shared/constants.ts';
import { angleDiff, clamp, smoothstep } from '../shared/geom.ts';
import { HEAD_RADIUS, hitboxes, LEGS_RADIUS, TORSO_RADIUS } from '../shared/hitbox.ts';
import type { PlayerSnap, Team } from '../shared/protocol.ts';
import { PISTOL } from '../shared/weapons.ts';
import { fitGun } from './guns.ts';

// Everyone else. Once the soldier model has loaded, each body is an animated
// soldier: it walks and runs at the pace it moves, crouches, leans and aims
// where the player looks, with its hands on the gun. Until then, bodies are
// drawn from the hit volumes themselves. Either way they are posed to match
// the hitboxes, so what you see is what you hit. Colour tells the sides apart:
// operators in grey-blue, guards in olive and target dummies in orange.

const FALL_TIME = 0.45;
const FLASH_TIME = 0.1;
const MUZZLE_TIME = 0.05;
const HEAD = 0xd8c3a0;
const TORSO: Record<Team, number> = { operator: 0x3f556e, guard: 0x5a6638, dummy: 0xc4652b };
const LEGS: Record<Team, number> = { operator: 0x2e3238, guard: 0x4a4636, dummy: 0x4a4636 };
/** The soldier's uniform, per side; its gear, skin and visor keep the model's own colours. */
const UNIFORM: Record<Team, number> = { operator: 0x44566a, guard: 0x5c6a3a, dummy: 0xc4652b };
const UNIFORM_MATERIAL = 'Swat';
/** Beyond this, soldiers animate at a lower rate and skip fine posing. */
const NEAR = 90;
const FAR_UPDATE = 1 / 12;
/** Bodies this close are drawn even off screen, for their shadows. */
const SHADOW_REACH = 60;
/** Where the fog hides everything. */
const FOG_END = 750;
/** Speeds, in m/s, that the walk and run clips were recorded at. */
const WALK_CLIP_SPEED = 1.3;
const RUN_CLIP_SPEED = 3.2;
/** How far the upper body rolls with a full lean, so the head ends up over its hitbox. */
const LEAN_ROLL = 0.55;

const sphere = new THREE.SphereGeometry(1, 16, 12);
const cylinder = new THREE.CylinderGeometry(1, 1, 1, 14).translate(0, 0.5, 0);
const GUN_MAT = new THREE.MeshStandardMaterial({ color: 0x2a2c2e, roughness: 0.5, metalness: 0.4 });
const FLASH_MAT = new THREE.SpriteMaterial({
  map: flashTexture(), color: 0xffc070, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
});

/** A carried gun, barrel along -z with the grip at z = 0, as fitGun makes them. */
interface GunShape {
  make(): THREE.Object3D;
  muzzle: THREE.Vector3;
  /** Where the right hand holds it, and the left. */
  grip: THREE.Vector3;
  support: THREE.Vector3;
}

/** A stand-in gun of boxes until the models load. */
function gunShape(length: number, stock: boolean): GunShape {
  const parts = [
    new THREE.BoxGeometry(0.05, 0.07, length * 0.55).translate(0, 0.05, -length * 0.2),
    new THREE.CylinderGeometry(0.012, 0.012, length * 0.45, 8).rotateX(Math.PI / 2).translate(0, 0.06, -length * 0.65),
    new THREE.BoxGeometry(0.035, 0.1, 0.04).translate(0, -0.02, 0),
  ];
  if (stock) parts.push(new THREE.BoxGeometry(0.04, 0.08, 0.25).translate(0, 0.02, 0.18));
  const geometry = mergeGeometries(parts);
  return {
    make: () => new THREE.Mesh(geometry, GUN_MAT),
    muzzle: new THREE.Vector3(0, 0.06, -length * 0.88),
    grip: new THREE.Vector3(0, -0.02, 0.02),
    support: new THREE.Vector3(0, 0.02, -length * 0.42),
  };
}

/** In WEAPONS order. */
let GUNS: GunShape[] = [gunShape(0.85, true), gunShape(0.2, false), gunShape(1.1, true)];

interface Figure {
  group: THREE.Group;
  materials: THREE.MeshStandardMaterial[];
  /** Holds the gun in hand, which is swapped on a weapon change, and its flash. */
  gun: THREE.Group;
  held: THREE.Object3D;
  flashMesh: THREE.Sprite;
  weapon: number;
  /** Seconds since it died, or -1 while alive. */
  deadFor: number;
  flash: number;
  muzzle: number;
  /** Last position, for how fast it's going and footsteps. */
  lastX: number;
  lastY: number;
  lastZ: number;
  speed: number;
  /** Direction of travel relative to facing, radians. */
  heading: number;
  stride: number;
  /** Seconds to the next animation update, when far away. */
  wait: number;
  soldier: Soldier | null;
  /** Placeholder parts, until the soldier arrives. */
  head?: THREE.Mesh;
  torso?: THREE.Mesh;
  legs?: THREE.Mesh;
}

interface Soldier {
  mixer: THREE.AnimationMixer;
  idle: THREE.AnimationAction;
  walk: THREE.AnimationAction;
  run: THREE.AnimationAction;
  bones: Record<BoneName, THREE.Object3D>;
  /**
   * The pose the animation last wrote to the bones we adjust. The mixer only
   * writes a bone when its animated value changes, so our adjustments are
   * undone by hand before each update, or they would pile up.
   */
  animated: { bone: THREE.Object3D; position: THREE.Vector3; quaternion: THREE.Quaternion }[];
  /** Upper arm, forearm, thigh and shin lengths, measured at rest. */
  arm: number;
  forearm: number;
  thigh: number;
  shin: number;
}

/**
 * The bones we pose by hand, as named in Quaternius's rig. Its feet hang off
 * the root, not the shins: the clips place them, and the legs reach for them.
 * The body carries the pelvis, the legs and the upper body.
 */
const BONES = {
  root: 'Root', body: 'Body', spine: 'Abdomen', spine2: 'Chest', neck: 'Neck', head: 'Head',
  lArm: 'UpperArm.L', lForeArm: 'LowerArm.L', lHand: 'Wrist.L',
  rArm: 'UpperArm.R', rForeArm: 'LowerArm.R', rHand: 'Wrist.R',
  lUpLeg: 'UpperLeg.L', lLeg: 'LowerLeg.L', lAnkle: 'LowerLeg.L_end', lFoot: 'Foot.L',
  rUpLeg: 'UpperLeg.R', rLeg: 'LowerLeg.R', rAnkle: 'LowerLeg.R_end', rFoot: 'Foot.R',
} as const;
type BoneName = keyof typeof BONES;

/** Called for each footfall of a body, with how fast it was moving. */
export type StepListener = (x: number, y: number, z: number, speed: number, crouched: boolean) => void;

export class Bodies {
  onStep: StepListener | null = null;
  private readonly scene: THREE.Scene;
  private readonly figures = new Map<number, Figure>();
  private model: GLTF | null = null;
  /** Scale that makes the model PLAYER_HEIGHT tall. */
  private modelScale = 1;
  private readonly camera = new THREE.Vector3();
  private readonly frustum = new THREE.Frustum();
  private readonly bounds = new THREE.Sphere(new THREE.Vector3(), 1.4);
  private readonly viewProjection = new THREE.Matrix4();

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  /** Swap the placeholder figures for animated soldiers carrying `guns`, in WEAPONS order. */
  setModel(gltf: GLTF, guns: GLTF[]): void {
    this.model = gltf;
    GUNS = guns.map((g, i) => {
      const fitted = fitGun(g, i);
      return { make: () => fitted.object.clone(), muzzle: fitted.muzzle, grip: fitted.grip, support: fitted.support };
    });
    const box = new THREE.Box3().setFromObject(gltf.scene);
    this.modelScale = PLAYER_HEIGHT / (box.max.y - box.min.y);
    for (const id of [...this.figures.keys()]) this.remove(id);
  }

  /** Pose everyone as seen from `camera`; bodies it can't see are skipped. */
  update(players: readonly PlayerSnap[], dt: number, camera?: THREE.Camera): void {
    if (camera) {
      this.camera.setFromMatrixPosition(camera.matrixWorld);
      this.viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      this.frustum.setFromProjectionMatrix(this.viewProjection);
    }
    const seen = new Set<number>();
    for (const p of players) {
      seen.add(p.id);
      let f = this.figures.get(p.id);
      if (!f) {
        f = this.create(p.team);
        this.figures.set(p.id, f);
        f.lastX = p.x;
        f.lastY = p.y;
        f.lastZ = p.z;
      }
      this.pose(f, p, dt);
    }
    for (const id of [...this.figures.keys()]) if (!seen.has(id)) this.remove(id);
  }

  /** Flash a body white where a round landed. */
  flash(id: number): void {
    const f = this.figures.get(id);
    if (f) f.flash = FLASH_TIME;
  }

  /** A body fired: flash at its muzzle unless suppressed. */
  fire(id: number, quiet: boolean): void {
    const f = this.figures.get(id);
    if (f && !quiet) {
      f.muzzle = MUZZLE_TIME;
      f.flashMesh.material.rotation = Math.random() * Math.PI;
    }
  }

  /** Where a body's muzzle is in the world, or null if it isn't drawn. */
  muzzle(id: number, out: THREE.Vector3): THREE.Vector3 | null {
    const f = this.figures.get(id);
    if (!f || !f.group.visible) return null;
    f.gun.updateWorldMatrix(true, false);
    return f.gun.localToWorld(out.copy(GUNS[f.weapon].muzzle));
  }

  private remove(id: number): void {
    const f = this.figures.get(id);
    if (!f) return;
    this.scene.remove(f.group);
    for (const m of f.materials) m.dispose();
    f.soldier?.mixer.stopAllAction();
    this.figures.delete(id);
  }

  private create(team: Team): Figure {
    const group = new THREE.Group();
    const gun = new THREE.Group();
    const held = GUNS[0].make();
    held.castShadow = true;
    gun.add(held);
    const flashMesh = new THREE.Sprite(FLASH_MAT);
    flashMesh.scale.setScalar(0.45);
    flashMesh.visible = false;
    gun.add(flashMesh);
    group.add(gun);
    this.scene.add(group);
    const f: Figure = {
      group, materials: [], gun, held, flashMesh, weapon: 0, deadFor: -1, flash: 0, muzzle: 0,
      lastX: 0, lastY: 0, lastZ: 0, speed: 0, heading: 0, stride: 0, wait: 0, soldier: null,
    };
    if (this.model) f.soldier = this.soldier(f, team);
    else this.placeholder(f, team);
    return f;
  }

  private placeholder(f: Figure, team: Team): void {
    f.materials = [HEAD, TORSO[team], LEGS[team]].map((color) => new THREE.MeshStandardMaterial({ color, roughness: 0.8 }));
    const [head, torso, legs] = [sphere, cylinder, cylinder].map((geo, i) => {
      const mesh = new THREE.Mesh(geo, f.materials[i]);
      mesh.castShadow = true;
      f.group.add(mesh);
      return mesh;
    });
    Object.assign(f, { head, torso, legs });
  }

  private soldier(f: Figure, team: Team): Soldier {
    const gltf = this.model!;
    const model = SkeletonUtils.clone(gltf.scene);
    model.scale.setScalar(this.modelScale);
    model.traverse((o) => {
      const mesh = o as THREE.SkinnedMesh;
      if (!mesh.isMesh) return;
      // Each mesh gets its own materials, for the hit flash.
      const m = (mesh.material as THREE.MeshStandardMaterial).clone();
      if (m.name === UNIFORM_MATERIAL) m.color.setHex(UNIFORM[team]);
      mesh.material = m;
      mesh.castShadow = true;
      // Culled as a whole body instead, in update.
      mesh.frustumCulled = false;
      f.materials.push(m);
    });
    // The model faces +z; bodies face -z.
    const turned = new THREE.Group();
    turned.rotation.y = Math.PI;
    turned.add(model);
    f.group.add(turned);

    const bones = {} as Record<BoneName, THREE.Object3D>;
    for (const [key, name] of Object.entries(BONES)) {
      // The loader drops the dots from node names.
      const bone = model.getObjectByName(THREE.PropertyBinding.sanitizeNodeName(name));
      if (!bone) throw new Error(`Soldier has no ${name} bone`);
      bones[key as BoneName] = bone;
    }
    const mixer = new THREE.AnimationMixer(model);
    const clip = (name: string): THREE.AnimationAction => {
      const c = THREE.AnimationClip.findByName(gltf.animations, name);
      if (!c) throw new Error(`Soldier has no ${name} animation`);
      const action = mixer.clipAction(c);
      action.play();
      return action;
    };
    const idle = clip('Idle');
    const walk = clip('Walk');
    const run = clip('Run');
    // Start everyone at a different point in their stride.
    const phase = Math.random();
    walk.time = phase * walk.getClip().duration;
    run.time = phase * run.getClip().duration;

    f.group.updateMatrixWorld(true);
    const at = (b: THREE.Object3D): THREE.Vector3 => b.getWorldPosition(new THREE.Vector3());
    const arm = at(bones.rArm).distanceTo(at(bones.rForeArm));
    const forearm = at(bones.rForeArm).distanceTo(at(bones.rHand));
    const thigh = at(bones.rUpLeg).distanceTo(at(bones.rLeg));
    const shin = at(bones.rLeg).distanceTo(at(bones.rAnkle));
    const animated = Object.values(bones).map((bone) => ({ bone, position: bone.position.clone(), quaternion: bone.quaternion.clone() }));
    return { mixer, idle, walk, run, bones, animated, arm, forearm, thigh, shin };
  }

  private pose(f: Figure, p: PlayerSnap, dt: number): void {
    f.group.position.set(p.x, p.y, p.z);
    f.group.rotation.set(0, p.yaw, 0);
    if (f.weapon !== p.weapon) {
      f.weapon = p.weapon;
      f.gun.remove(f.held);
      f.held = GUNS[p.weapon].make();
      f.held.castShadow = true;
      f.gun.add(f.held);
    }

    // How fast and which way it's going, relative to where it faces.
    const dx = p.x - f.lastX;
    const dz = p.z - f.lastZ;
    const moved = Math.hypot(dx, dz);
    const falling = dt > 0 && Math.abs(p.y - f.lastY) / dt > 3;
    if (dt > 0) {
      const speed = moved > 3 ? 0 : moved / dt;
      f.speed += (speed - f.speed) * (1 - Math.exp(-10 * dt));
      if (moved > 1e-3) {
        const travel = Math.atan2(-dx, -dz);
        f.heading += angleDiff(angleDiff(travel, p.yaw), f.heading) * (1 - Math.exp(-8 * dt));
      }
    }
    f.lastX = p.x;
    f.lastY = p.y;
    f.lastZ = p.z;

    // Footfalls, spaced by a stride that lengthens with speed.
    if (!p.dead && !falling && moved < 3) {
      f.stride += moved;
      const stride = strideLength(f.speed);
      if (f.stride >= stride) {
        f.stride -= stride;
        this.onStep?.(p.x, p.y, p.z, f.speed, p.duck > 0.5);
      }
    }

    f.deadFor = p.dead ? Math.max(f.deadFor, 0) + dt : -1;
    const fall = f.deadFor < 0 ? 0 : Math.min(f.deadFor / FALL_TIME, 1);

    // Out of sight and too far to throw a shadow into view, or lost in the fog: not drawn.
    this.bounds.center.set(p.x, p.y + 0.9, p.z);
    const distance = this.camera.distanceTo(this.bounds.center);
    f.group.visible = distance < SHADOW_REACH || (distance < FOG_END && this.frustum.intersectsSphere(this.bounds));
    if (!f.group.visible) return;

    if (f.soldier) this.poseSoldier(f, f.soldier, p, dt, fall);
    else this.posePlaceholder(f, p, fall);

    f.flash = Math.max(f.flash - dt, 0);
    const glow = f.flash / FLASH_TIME;
    for (const m of f.materials) m.emissive.setScalar(glow * 0.8);
    f.muzzle = Math.max(f.muzzle - dt, 0);
    f.flashMesh.visible = f.muzzle > 0 && !p.dead;
    f.flashMesh.position.copy(GUNS[f.weapon].muzzle);
  }

  private posePlaceholder(f: Figure, p: PlayerSnap, fall: number): void {
    // Hitboxes of the same pose at the origin, facing -z: offsets in the figure's own space.
    const h = hitboxes({ x: 0, y: 0, z: 0, yaw: 0, duck: p.duck, lean: p.lean });
    f.head!.position.set(h.headX, h.headY, h.headZ);
    f.head!.scale.setScalar(HEAD_RADIUS);
    f.torso!.position.set(h.torsoX, h.hipY, h.torsoZ);
    f.torso!.scale.set(TORSO_RADIUS, h.neckY - h.hipY, TORSO_RADIUS);
    f.legs!.scale.set(LEGS_RADIUS, h.hipY, LEGS_RADIUS);
    f.gun.position.set(h.torsoX + 0.12, h.neckY - 0.12, -0.15);
    f.gun.rotation.set(p.pitch, 0, 0);
    // Topple backward on death; stand straight back up on respawn.
    f.group.rotation.x = (fall * fall * Math.PI) / 2;
  }

  private poseSoldier(f: Figure, s: Soldier, p: PlayerSnap, dt: number, fall: number): void {
    const near = this.camera.distanceTo(f.group.position) < NEAR;
    f.wait -= dt;
    if (!near && f.wait > 0) return;
    const step = near ? dt : dt + Math.max(-f.wait, 0) + FAR_UPDATE;
    f.wait = near ? 0 : FAR_UPDATE;

    // Walk into a run with speed; play the clips as fast as the body moves.
    const dead = f.deadFor >= 0;
    const speed = dead ? 0 : f.speed;
    const moving = smoothstep(0.3, 1.2, speed);
    const running = smoothstep(2.6, 4.6, speed);
    s.idle.weight = 1 - moving;
    s.walk.weight = moving * (1 - running);
    s.run.weight = moving * running;
    // Backpedalling plays the stride backward, with the legs facing the way back.
    const back = Math.abs(f.heading) > Math.PI * 0.6;
    const sign = back ? -1 : 1;
    s.walk.timeScale = sign * clamp(speed / WALK_CLIP_SPEED, 0.6, 2);
    s.run.timeScale = sign * clamp(speed / RUN_CLIP_SPEED, 0.6, 1.8);
    for (const a of s.animated) {
      a.bone.position.copy(a.position);
      a.bone.quaternion.copy(a.quaternion);
    }
    s.mixer.update(step);
    for (const a of s.animated) {
      a.position.copy(a.bone.position);
      a.quaternion.copy(a.bone.quaternion);
    }

    const b = s.bones;
    f.group.updateMatrixWorld(true);
    const up = V_UP;
    const facing = f.group.quaternion;
    const right = V_RIGHT.set(1, 0, 0).applyQuaternion(facing);
    const forward = V_FORWARD.set(0, 0, -1).applyQuaternion(facing);

    // Legs and feet turn toward where it's going, within reason; the body keeps facing its aim.
    const legYaw = dead ? 0 : moving * clamp(back ? angleDiff(f.heading, Math.PI) : f.heading, -1.1, 1.1);
    rotateWorld(b.root, up, legYaw);
    rotateWorld(b.spine, up, -legYaw);

    // Crouch: sink the body to the hitbox's hip height, and the legs fold to keep the feet planted.
    const duck = p.duck;
    if (duck > 0.01) {
      const drop = hitboxes({ x: 0, y: 0, z: 0, yaw: 0, duck: 0, lean: 0 }).hipY -
        hitboxes({ x: 0, y: 0, z: 0, yaw: 0, duck, lean: 0 }).hipY;
      moveWorld(b.body, V_TMP2.set(0, -drop, 0));
      const legForward = V_TMP.copy(forward).applyAxisAngle(up, legYaw);
      for (const [thigh, shin, ankle, foot] of [[b.lUpLeg, b.lLeg, b.lAnkle, b.lFoot], [b.rUpLeg, b.rLeg, b.rAnkle, b.rFoot]] as const) {
        // Knees out front.
        const target = foot.getWorldPosition(V_TMP3);
        const pole = thigh.getWorldPosition(V_TMP2).addScaledVector(legForward, 1);
        reach(thigh, shin, ankle, target, pole, s.thigh, s.shin);
      }
      // Bent forward a little over the knees.
      rotateWorld(b.spine, right, -0.25 * duck);
    }
    // Lean rolls the whole upper body sideways from the waist.
    rotateWorld(b.spine, forward, p.lean * LEAN_ROLL);
    // Aim: the chest and head follow the pitch.
    rotateWorld(b.spine2, right, p.pitch * 0.5);
    rotateWorld(b.neck, right, p.pitch * 0.35);

    // The gun hangs off the right shoulder, pointing where the body aims.
    const shoulder = b.rArm.getWorldPosition(V_TMP);
    f.group.worldToLocal(shoulder);
    const pistol = p.weapon === PISTOL;
    // The sight line runs just under the eye, the pistol held out at arm's length.
    f.gun.position.set(shoulder.x - 0.1, shoulder.y + 0.06, shoulder.z);
    f.gun.rotation.set(p.pitch, 0, 0, 'YXZ');
    f.gun.translateZ(pistol ? -0.5 : -0.12);
    f.gun.translateX(pistol ? -0.08 : 0);

    if (near && !dead) {
      f.gun.updateMatrixWorld(true);
      const grip = f.gun.localToWorld(V_TMP.copy(GUNS[f.weapon].grip));
      const pole = V_TMP2.copy(right).multiplyScalar(0.6).addScaledVector(up, -0.8).add(grip);
      reach(b.rArm, b.rForeArm, b.rHand, grip, pole, s.arm, s.forearm);
      const support = f.gun.localToWorld(V_TMP.copy(GUNS[f.weapon].support));
      if (pistol) support.addScaledVector(right, -0.03);
      pole.copy(right).multiplyScalar(-0.6).addScaledVector(up, -0.8).add(support);
      reach(b.lArm, b.lForeArm, b.lHand, support, pole, s.arm, s.forearm);
    }

    // Topple backward on death; stand straight back up on respawn.
    f.group.rotation.x = (fall * fall * Math.PI) / 2;
  }
}

/** Metres between footfalls at a speed. */
export function strideLength(speed: number): number {
  return 1.1 + speed * 0.12;
}

const V_UP = new THREE.Vector3(0, 1, 0);
const V_RIGHT = new THREE.Vector3();
const V_FORWARD = new THREE.Vector3();
const V_TMP = new THREE.Vector3();
const V_TMP2 = new THREE.Vector3();
const V_TMP3 = new THREE.Vector3();
const Q_A = new THREE.Quaternion();
const Q_B = new THREE.Quaternion();
const Q_C = new THREE.Quaternion();

/** Turn a bone by `angle` about a world-space axis, then bring its children along. */
function rotateWorld(bone: THREE.Object3D, axis: THREE.Vector3, angle: number): void {
  if (Math.abs(angle) < 1e-5) return;
  const parent = bone.parent!;
  parent.getWorldQuaternion(Q_A);
  // local' = parent^-1 * R * parent * local
  Q_B.setFromAxisAngle(axis, angle);
  Q_C.copy(Q_A).invert().multiply(Q_B).multiply(Q_A);
  bone.quaternion.premultiply(Q_C);
  bone.updateMatrixWorld(true);
}

/** Shift a bone by a world-space offset. */
function moveWorld(bone: THREE.Object3D, offset: THREE.Vector3): void {
  const parent = bone.parent!;
  const world = bone.getWorldPosition(new THREE.Vector3()).add(offset);
  bone.position.copy(parent.worldToLocal(world));
  bone.updateMatrixWorld(true);
}

/**
 * Two-bone IK: bend an arm so its hand reaches `target`, with the elbow
 * toward `pole`. Lengths are the upper arm's and forearm's in world units.
 */
function reach(
  upper: THREE.Object3D, lower: THREE.Object3D, hand: THREE.Object3D,
  target: THREE.Vector3, pole: THREE.Vector3, a: number, b: number,
): void {
  const s = upper.getWorldPosition(new THREE.Vector3());
  const toTarget = target.clone().sub(s);
  const c = clamp(toTarget.length(), Math.abs(a - b) + 1e-3, a + b - 1e-3);
  const dir = toTarget.normalize();
  // Where the elbow must be: along the reach by x, out toward the pole by h.
  const x = (a * a - b * b + c * c) / (2 * c);
  const h = Math.sqrt(Math.max(a * a - x * x, 0));
  const bend = pole.clone().sub(s);
  bend.addScaledVector(dir, -bend.dot(dir));
  if (bend.lengthSq() < 1e-8) bend.set(0, -1, 0);
  bend.normalize();
  const elbow = s.clone().addScaledVector(dir, x).addScaledVector(bend, h);

  aimBone(upper, lower.getWorldPosition(new THREE.Vector3()), elbow);
  aimBone(lower, hand.getWorldPosition(new THREE.Vector3()), s.addScaledVector(dir, c));
}

/** Turn a bone so the child now at `from` swings to `to`. */
function aimBone(bone: THREE.Object3D, from: THREE.Vector3, to: THREE.Vector3): void {
  const origin = bone.getWorldPosition(new THREE.Vector3());
  const u = from.sub(origin).normalize();
  const v = to.sub(origin).normalize();
  const turn = new THREE.Quaternion().setFromUnitVectors(u, v);
  const axis = new THREE.Vector3(turn.x, turn.y, turn.z);
  const sin = axis.length();
  if (sin < 1e-6) return;
  rotateWorld(bone, axis.divideScalar(sin), 2 * Math.atan2(sin, turn.w));
}

/** A star of light with a hot middle, for muzzle flashes seen from any side. */
function flashTexture(): THREE.Texture {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const g = canvas.getContext('2d')!;
  const c = size / 2;
  const glow = g.createRadialGradient(c, c, 0, c, c, c);
  glow.addColorStop(0, 'rgba(255,255,255,1)');
  glow.addColorStop(0.25, 'rgba(255,255,255,0.6)');
  glow.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = glow;
  g.beginPath();
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const r = i % 2 ? c * 0.3 : c;
    g.lineTo(c + Math.cos(a) * r, c + Math.sin(a) * r);
  }
  g.fill();
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
