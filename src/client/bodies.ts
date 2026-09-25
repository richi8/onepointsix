import * as THREE from 'three';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { LEAN_OFFSET, PLAYER_HEIGHT } from '../shared/constants.ts';
import { angleDiff, clamp, lerp, smoothstep } from '../shared/geom.ts';
import { HEAD_RADIUS, hitboxes, LEGS_RADIUS, TORSO_RADIUS } from '../shared/hitbox.ts';
import type { PlayerSnap, Team } from '../shared/protocol.ts';
import { PISTOL } from '../shared/weapons.ts';
import { fitGun } from './guns.ts';
import {
  type Bones, curl, findBones, findHand, type Hand, moveWorld, orientHand, placeWorld, reach, rotateWorld, span, wristFor,
} from './rig.ts';

// Everyone else. Once the soldier model has loaded, each body is an animated
// soldier: it walks and runs at the pace it moves, crouches, slides, jumps,
// climbs, leans and aims where the player looks, with its hands closed on the
// gun, and it reloads, switches weapons and throws grenades where others can
// see. Until then, bodies are drawn from the hit volumes themselves. Either
// way they are posed to match the hitboxes, so what you see is what you hit.
// Sides are told apart by colour and kit: operators in grey-blue with a pack,
// guards in olive with brown webbing, commanders with a red band on the helmet
// and a radio mast, and target dummies in orange.

const FALL_TIME = 0.45;
const FLASH_TIME = 0.12;
/** How far round the point a round landed the flash reaches, in metres. */
const FLASH_REACH = 0.3;
const MUZZLE_TIME = 0.05;
const HEAD = 0xd8c3a0;
const TORSO: Record<Team, number> = { operator: 0x3f556e, guard: 0x5a6638, dummy: 0xc4652b };
const LEGS: Record<Team, number> = { operator: 0x2e3238, guard: 0x4a4636, dummy: 0x4a4636 };
/** The soldier's uniform and webbing, per side; its skin and visor keep the model's own colours. */
const UNIFORM: Record<Team, number> = { operator: 0x44566a, guard: 0x5c6a3a, dummy: 0xc4652b };
const GEAR: Record<Team, number> = { operator: 0x26282b, guard: 0x4a3f2c, dummy: 0x3a3a3a };
const COMMANDER_UNIFORM = 0x4f5a34;
const COMMANDER_GEAR = 0x6b5a3a;
const UNIFORM_MATERIAL = 'Swat';
const GEAR_MATERIAL = 'Swat_Black';
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
/** How far the hips move out with a full lean; the upper body rolls the rest of the way. */
const LEAN_HIPS = 0.14;
/** Length of a suppressor on the barrel, as in first person. */
const CAN_LENGTH = 0.15;
/** How fast poses such as a slide or a jump blend in and out, per second. */
const BLEND_RATE = 12;
/** Room a body needs to lie down in, from its feet. */
const LIE_LENGTH = 1.9;
/** Room a body's arms need either side of it. */
const ARM_SPAN = 0.8;
/** How long a dropped gun takes to reach the ground, at most. */
const GUN_DROP = 0.5;

const sphere = new THREE.SphereGeometry(1, 16, 12);
const cylinder = new THREE.CylinderGeometry(1, 1, 1, 14).translate(0, 0.5, 0);
const GUN_MAT = new THREE.MeshStandardMaterial({ color: 0x2a2c2e, roughness: 0.5, metalness: 0.4 });
const CAN_MAT = new THREE.MeshStandardMaterial({ color: 0x1e2022, roughness: 0.6, metalness: 0.3 });
const NADE_MAT = new THREE.MeshStandardMaterial({ color: 0x3b4a2a, roughness: 0.7 });
const PACK_MAT = new THREE.MeshStandardMaterial({ color: 0x3a3d33, roughness: 0.9 });
const RED_MAT = new THREE.MeshStandardMaterial({ color: 0xa3201b, roughness: 0.8 });
const MAST_MAT = new THREE.MeshStandardMaterial({ color: 0x1c1c1c, roughness: 0.6 });
const FLASH_MAT = new THREE.SpriteMaterial({
  map: flashTexture(), color: 0xffc070, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
});
const CAN_GEO = new THREE.CylinderGeometry(0.02, 0.02, CAN_LENGTH, 10).rotateX(Math.PI / 2);
const NADE_GEO = new THREE.SphereGeometry(0.045, 10, 8).scale(1, 1.25, 1);

/** What a body stands on and falls against. */
export interface Ground {
  groundHeight(x: number, z: number, feetY: number): number;
  raycast(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxT: number): number;
}

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
  /** Where the last round landed, in the figure's own space, and how bright its flash is. */
  hit: { value: THREE.Vector4 };
  hitAt: THREE.Vector3;
  /** Holds the gun in hand, which is swapped on a weapon change, its suppressor and its flash. */
  gun: THREE.Group;
  held: THREE.Object3D;
  can: THREE.Mesh;
  flashMesh: THREE.Sprite;
  weapon: number;
  quiet: boolean;
  /** Seconds since it died, or -1 while alive. */
  deadFor: number;
  /** Where it lies: the way it faces, how far it was pushed off walls, and the tilt of the ground. */
  fallYaw: number;
  fallX: number;
  fallZ: number;
  tilt: THREE.Quaternion;
  lift: number;
  /** Where whoever killed it stood, if known. */
  killer: { x: number; z: number } | null;
  /** The gun falling from its hands. */
  drop: { t: number; from: THREE.Vector3; to: THREE.Vector3; turn: THREE.Quaternion; flat: THREE.Quaternion } | null;
  flash: number;
  muzzle: number;
  /** Last position, for how fast it's going and footsteps. */
  lastX: number;
  lastY: number;
  lastZ: number;
  speed: number;
  /** Vertical speed, smoothed. */
  vy: number;
  /** Direction of travel relative to facing, radians. */
  heading: number;
  stride: number;
  /** Poses blended in and out: sliding, in the air and climbing. */
  slide: number;
  air: number;
  mantle: number;
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
  death: THREE.AnimationAction;
  bones: Bones;
  hands: [left: Hand, right: Hand];
  /** A grenade, shown in the throwing hand. */
  nade: THREE.Mesh;
  /** An operator's pack, kept out of the ground when it lies on it. */
  pack: THREE.Object3D | null;
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

/** Called for each footfall of a body, with how fast it was moving. */
export type StepListener = (x: number, y: number, z: number, speed: number, crouched: boolean) => void;

export class Bodies {
  onStep: StepListener | null = null;
  private readonly scene: THREE.Scene;
  private readonly ground: Ground;
  private readonly figures = new Map<number, Figure>();
  private model: GLTF | null = null;
  /** Scale that makes the model PLAYER_HEIGHT tall. */
  private modelScale = 1;
  /** Which way the death clip falls, as a yaw from facing, and how far the head ends up. */
  private deathYaw = Math.PI;
  private readonly camera = new THREE.Vector3();
  private readonly frustum = new THREE.Frustum();
  private readonly bounds = new THREE.Sphere(new THREE.Vector3(), 1.4);
  private readonly viewProjection = new THREE.Matrix4();

  constructor(scene: THREE.Scene, ground: Ground) {
    this.scene = scene;
    this.ground = ground;
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
    this.deathYaw = deathDirection(gltf);
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
        f = this.create(p.team, p.commander);
        this.figures.set(p.id, f);
        f.lastX = p.x;
        f.lastY = p.y;
        f.lastZ = p.z;
      }
      this.pose(f, p, dt);
    }
    for (const id of [...this.figures.keys()]) if (!seen.has(id)) this.remove(id);
  }

  /** Flash a body where a round landed, at (x, y, z) in the world. */
  flash(id: number, x: number, y: number, z: number): void {
    const f = this.figures.get(id);
    if (!f) return;
    f.flash = FLASH_TIME;
    f.group.updateMatrixWorld(true);
    f.group.worldToLocal(f.hitAt.set(x, y, z));
  }

  /** A body fired: flash at its muzzle unless suppressed. */
  fire(id: number, quiet: boolean): void {
    const f = this.figures.get(id);
    if (f && !quiet) {
      f.muzzle = MUZZLE_TIME;
      f.flashMesh.material.rotation = Math.random() * Math.PI;
    }
  }

  /** Someone was killed by `killer`: they fall away from them. */
  killed(victim: number, killer: number): void {
    const f = this.figures.get(victim);
    const k = this.figures.get(killer);
    if (f && k && f !== k) f.killer = { x: k.lastX, z: k.lastZ };
  }

  /** Where a body's muzzle is in the world, or null if it isn't drawn. */
  muzzle(id: number, out: THREE.Vector3): THREE.Vector3 | null {
    const f = this.figures.get(id);
    if (!f || !f.group.visible) return null;
    f.gun.updateWorldMatrix(true, false);
    return f.gun.localToWorld(out.copy(muzzleOf(f)));
  }

  private remove(id: number): void {
    const f = this.figures.get(id);
    if (!f) return;
    this.scene.remove(f.group, f.gun);
    for (const m of f.materials) m.dispose();
    f.soldier?.mixer.stopAllAction();
    this.figures.delete(id);
  }

  private create(team: Team, commander: boolean): Figure {
    const group = new THREE.Group();
    const gun = new THREE.Group();
    const held = GUNS[0].make();
    held.castShadow = true;
    gun.add(held);
    const can = new THREE.Mesh(CAN_GEO, CAN_MAT);
    can.castShadow = true;
    can.visible = false;
    gun.add(can);
    const flashMesh = new THREE.Sprite(FLASH_MAT);
    flashMesh.scale.setScalar(0.45);
    flashMesh.visible = false;
    gun.add(flashMesh);
    group.add(gun);
    this.scene.add(group);
    const f: Figure = {
      group, materials: [], hit: { value: new THREE.Vector4() }, hitAt: new THREE.Vector3(),
      gun, held, can, flashMesh, weapon: 0, quiet: false,
      deadFor: -1, fallYaw: 0, fallX: 0, fallZ: 0, tilt: new THREE.Quaternion(), lift: 0, killer: null, drop: null,
      flash: 0, muzzle: 0, lastX: 0, lastY: 0, lastZ: 0, speed: 0, vy: 0, heading: 0, stride: 0,
      slide: 0, air: 0, mantle: 0, wait: 0, soldier: null,
    };
    placeCan(f);
    if (this.model) f.soldier = this.soldier(f, team, commander);
    else this.placeholder(f, team);
    for (const m of f.materials) flashWhereHit(m, f.hit);
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

  private soldier(f: Figure, team: Team, commander: boolean): Soldier {
    const gltf = this.model!;
    const model = SkeletonUtils.clone(gltf.scene);
    model.scale.setScalar(this.modelScale);
    model.traverse((o) => {
      const mesh = o as THREE.SkinnedMesh;
      if (!mesh.isMesh) return;
      // Each mesh gets its own materials, for the hit flash.
      const m = (mesh.material as THREE.MeshStandardMaterial).clone();
      if (m.name === UNIFORM_MATERIAL) m.color.setHex(commander ? COMMANDER_UNIFORM : UNIFORM[team]);
      if (m.name === GEAR_MATERIAL) m.color.setHex(commander ? COMMANDER_GEAR : GEAR[team]);
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

    const bones = findBones(model);
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
    const death = clip('Death');
    death.setLoop(THREE.LoopOnce, 1);
    death.clampWhenFinished = true;
    death.weight = 0;
    // Start everyone at a different point in their stride.
    const phase = Math.random();
    walk.time = phase * walk.getClip().duration;
    run.time = phase * run.getClip().duration;

    f.group.updateMatrixWorld(true);
    const hands: [Hand, Hand] = [findHand(model, 'L'), findHand(model, 'R')];
    const nade = new THREE.Mesh(NADE_GEO, NADE_MAT);
    nade.visible = false;
    f.group.add(nade);
    const pack = this.kit(f, bones, team, commander);
    const animated = Object.values(bones).map((bone) => ({ bone, position: bone.position.clone(), quaternion: bone.quaternion.clone() }));
    return {
      mixer, idle, walk, run, death, bones, hands, nade, pack, animated,
      arm: span(bones.rArm, bones.rForeArm), forearm: span(bones.rForeArm, bones.rHand),
      thigh: span(bones.rUpLeg, bones.rLeg), shin: span(bones.rLeg, bones.rAnkle),
    };
  }

  /** What sets the sides apart besides colour: a pack on operators, a helmet band and radio mast on commanders. */
  private kit(f: Figure, bones: Bones, team: Team, commander: boolean): THREE.Object3D | null {
    // Placed in the figure's space at rest, facing -z, then carried by a bone.
    const chest = bones.spine2.getWorldPosition(new THREE.Vector3());
    const head = bones.head.getWorldPosition(new THREE.Vector3());
    const wear = (mesh: THREE.Mesh, bone: THREE.Object3D): void => {
      mesh.castShadow = true;
      f.group.add(mesh);
      f.group.updateMatrixWorld(true);
      bone.attach(mesh);
    };
    let carried: THREE.Object3D | null = null;
    if (team === 'operator') {
      const pack = carried = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.4, 0.16), PACK_MAT);
      pack.position.set(chest.x, chest.y - 0.06, chest.z + 0.2);
      wear(pack, bones.spine2);
      const roll = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.3, 10).rotateZ(Math.PI / 2), PACK_MAT);
      roll.position.set(chest.x, chest.y + 0.17, chest.z + 0.22);
      wear(roll, bones.spine2);
    }
    if (commander) {
      const band = new THREE.Mesh(new THREE.TorusGeometry(0.155, 0.025, 6, 20).rotateX(Math.PI / 2), RED_MAT);
      band.position.set(head.x, head.y + 0.15, head.z - 0.01);
      wear(band, bones.head);
      const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.01, 0.7, 5), MAST_MAT);
      mast.position.set(chest.x - 0.1, chest.y + 0.3, chest.z + 0.2);
      mast.rotation.z = 0.12;
      wear(mast, bones.spine2);
      const radio = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.28, 0.12), MAST_MAT);
      radio.position.set(chest.x, chest.y - 0.05, chest.z + 0.18);
      wear(radio, bones.spine2);
    }
    return carried;
  }

  private pose(f: Figure, p: PlayerSnap, dt: number): void {
    if (f.weapon !== p.weapon) {
      f.weapon = p.weapon;
      f.gun.remove(f.held);
      f.held = GUNS[p.weapon].make();
      f.held.castShadow = true;
      f.gun.add(f.held);
      placeCan(f);
    }
    f.quiet = p.quiet;
    f.can.visible = p.quiet;

    // How fast and which way it's going, relative to where it faces.
    const dx = p.x - f.lastX;
    const dz = p.z - f.lastZ;
    const moved = Math.hypot(dx, dz);
    const teleported = moved > 3;
    if (dt > 0) {
      const speed = teleported ? 0 : moved / dt;
      f.speed += (speed - f.speed) * (1 - Math.exp(-10 * dt));
      const vy = teleported ? 0 : (p.y - f.lastY) / dt;
      f.vy += (vy - f.vy) * (1 - Math.exp(-15 * dt));
      if (moved > 1e-3) {
        const travel = Math.atan2(-dx, -dz);
        f.heading += angleDiff(angleDiff(travel, p.yaw), f.heading) * (1 - Math.exp(-8 * dt));
      }
      const k = 1 - Math.exp(-BLEND_RATE * dt);
      f.slide += ((p.motion === 'slide' ? 1 : 0) - f.slide) * k;
      f.air += ((p.motion === 'air' ? 1 : 0) - f.air) * k;
      f.mantle += ((p.motion === 'mantle' ? 1 : 0) - f.mantle) * k;
    }
    f.lastX = p.x;
    f.lastY = p.y;
    f.lastZ = p.z;

    // Footfalls, spaced by a stride that lengthens with speed.
    if (!p.dead && p.motion === 'ground' && !teleported) {
      f.stride += moved;
      const stride = strideLength(f.speed);
      if (f.stride >= stride) {
        f.stride -= stride;
        this.onStep?.(p.x, p.y, p.z, f.speed, p.duck > 0.5);
      }
    }

    const died = p.dead && f.deadFor < 0;
    f.deadFor = p.dead ? Math.max(f.deadFor, 0) + dt : -1;
    if (died) this.fall(f, p);
    if (!p.dead) {
      f.killer = null;
      if (f.drop) {
        f.drop = null;
        f.group.add(f.gun);
      }
    }

    f.group.position.set(p.x, p.y, p.z);
    f.group.rotation.set(0, p.yaw, 0);
    if (p.dead && f.soldier) {
      f.group.position.x += f.fallX;
      f.group.position.z += f.fallZ;
      f.group.position.y += f.lift;
      f.group.quaternion.setFromAxisAngle(V_UP, f.fallYaw).premultiply(f.tilt);
    }

    // Out of sight and too far to throw a shadow into view, or lost in the fog: not drawn.
    this.bounds.center.set(p.x, p.y + 0.9, p.z);
    const distance = this.camera.distanceTo(this.bounds.center);
    f.group.visible = distance < SHADOW_REACH || (distance < FOG_END && this.frustum.intersectsSphere(this.bounds));
    // A dead soldier's gun is on the ground, or not drawn at all if it died out of sight.
    f.gun.visible = !p.dead || !f.soldier || !!f.drop;
    if (f.drop) this.dropGun(f, dt);
    if (!f.group.visible) return;

    if (f.soldier) this.poseSoldier(f, f.soldier, p, dt);
    else this.posePlaceholder(f, p);

    f.flash = Math.max(f.flash - dt, 0);
    const where = V_TMP.copy(f.hitAt);
    f.group.localToWorld(where);
    f.hit.value.set(where.x, where.y, where.z, f.flash / FLASH_TIME);
    f.muzzle = Math.max(f.muzzle - dt, 0);
    f.flashMesh.visible = f.muzzle > 0 && !p.dead;
    f.flashMesh.position.copy(muzzleOf(f));
  }

  /**
   * It just died: pick which way it falls. Away from its killer if it can,
   * and otherwise the way with the most room, pushed back off a wall if even
   * that is too short. The gun drops from its hands.
   */
  private fall(f: Figure, p: PlayerSnap): void {
    const away = f.killer ? Math.atan2(-(p.x - f.killer.x), -(p.z - f.killer.z)) : p.yaw + this.deathYaw;
    let best = away;
    let room = 0;
    let score = -1;
    for (const turn of [0, 1, -1, 2, -2, 3, -3, 4]) {
      const yaw = away + (turn * Math.PI) / 4;
      const free = this.room(p.x, p.y, p.z, yaw, LIE_LENGTH);
      // Room for the arms, which fling out either side of the chest.
      const cx = p.x - Math.sin(yaw) * Math.min(free, 1.3);
      const cz = p.z - Math.cos(yaw) * Math.min(free, 1.3);
      const arms = Math.min(this.room(cx, p.y, cz, yaw + Math.PI / 2, ARM_SPAN), this.room(cx, p.y, cz, yaw - Math.PI / 2, ARM_SPAN));
      const k = free + arms * 0.5;
      if (k > score + 0.05) (best = yaw), (room = free), (score = k);
      if (free >= LIE_LENGTH && arms >= ARM_SPAN) break;
    }
    const short = Math.max(LIE_LENGTH - room, 0);
    const back = short > 0 ? Math.min(short, this.room(p.x, p.y, p.z, best + Math.PI, short)) : 0;
    f.fallYaw = best - this.deathYaw;
    f.fallX = Math.sin(best) * back;
    f.fallZ = Math.cos(best) * back;
    f.tilt.identity();
    f.lift = 0;

    if (!f.soldier || !f.group.visible) return;
    f.gun.updateMatrixWorld(true);
    const from = f.gun.getWorldPosition(new THREE.Vector3());
    const turn = f.gun.getWorldQuaternion(new THREE.Quaternion());
    this.scene.attach(f.gun);
    // It lands to the side, lying flat on its side, pointing roughly where it did.
    const yaw = new THREE.Euler().setFromQuaternion(turn, 'YXZ').y;
    const to = new THREE.Vector3(from.x + Math.cos(yaw) * 0.3, 0, from.z - Math.sin(yaw) * 0.3);
    to.y = this.ground.groundHeight(to.x, to.z, p.y + 0.5) + 0.04;
    const flat = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, Math.PI / 2, 'YXZ'));
    f.drop = { t: 0, from, to, turn, flat };
  }

  /** Metres free along `yaw` from (x, z), up to `length`, at knee and waist height. */
  private room(x: number, y: number, z: number, yaw: number, length: number): number {
    const dx = -Math.sin(yaw);
    const dz = -Math.cos(yaw);
    let free = length;
    for (const h of [0.3, 0.7]) free = Math.min(free, this.ground.raycast(x, y + h, z, dx, 0, dz, length));
    return free;
  }

  private dropGun(f: Figure, dt: number): void {
    const d = f.drop!;
    d.t = Math.min(d.t + dt, GUN_DROP);
    const k = (d.t / GUN_DROP) ** 2;
    f.gun.position.lerpVectors(d.from, d.to, k);
    f.gun.quaternion.slerpQuaternions(d.turn, d.flat, Math.min(d.t / GUN_DROP * 1.5, 1));
    f.flashMesh.visible = false;
  }

  private posePlaceholder(f: Figure, p: PlayerSnap): void {
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
    const fall = f.deadFor < 0 ? 0 : Math.min(f.deadFor / FALL_TIME, 1);
    f.group.rotation.x = (fall * fall * Math.PI) / 2;
  }

  private poseSoldier(f: Figure, s: Soldier, p: PlayerSnap, dt: number): void {
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
    const dying = dead ? Math.min(f.deadFor / 0.15, 1) : 0;
    s.idle.weight = (1 - moving) * (1 - dying);
    s.walk.weight = moving * (1 - running) * (1 - dying);
    s.run.weight = moving * running * (1 - dying);
    if (dead && s.death.weight === 0) s.death.reset().play();
    s.death.weight = dying;
    if (!dead) s.death.stop();
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
    for (const hand of s.hands) curl(hand, dead ? 0.3 : 0.9);
    s.nade.visible = false;
    f.group.updateMatrixWorld(true);
    if (dead) {
      this.lie(f, s, p, step);
      return;
    }

    const b = s.bones;
    const up = V_UP;
    const facing = f.group.quaternion;
    const right = V_RIGHT.set(1, 0, 0).applyQuaternion(facing);
    const forward = V_FORWARD.set(0, 0, -1).applyQuaternion(facing);

    // Legs and feet turn toward where it's going, within reason; the body keeps facing its aim.
    const legYaw = moving * (1 - f.slide) * clamp(back ? angleDiff(f.heading, Math.PI) : f.heading, -1.1, 1.1);
    rotateWorld(b.root, up, legYaw);
    rotateWorld(b.spine, up, -legYaw);

    // Crouch: sink the body to the hitbox's hip height. A slide sits lower still.
    const duck = p.duck;
    const drop = hitboxes({ x: 0, y: 0, z: 0, yaw: 0, duck: 0, lean: 0 }).hipY -
      hitboxes({ x: 0, y: 0, z: 0, yaw: 0, duck, lean: 0 }).hipY + duck * 0.06 + f.slide * 0.06;
    // Leaning, the hips move out over the feet too.
    const hips = V_TMP2.set(0, -drop, 0).addScaledVector(right, p.lean * LEAN_HIPS);
    if (hips.lengthSq() > 1e-5) moveWorld(b.body, hips);
    this.legs(f, s, duck, p.lean, legYaw);

    // Bent forward over the knees in a crouch, back in a slide, forward climbing.
    rotateWorld(b.spine, right, -0.25 * duck * (1 - f.slide) + 0.45 * f.slide - 0.45 * f.mantle - 0.12 * f.air);
    // Lean rolls the upper body sideways from the waist until the head is where its hitbox is.
    this.trueLean(f, s, p, right, forward);
    // Aim: the chest and head follow the pitch.
    rotateWorld(b.spine2, right, p.pitch * 0.5);
    rotateWorld(b.neck, right, p.pitch * 0.35);

    this.arms(f, s, p, near, running * (1 - f.slide), right, forward);
  }

  /**
   * Where the feet go. The clips place them for walking upright; a crouch
   * pulls them in under the lowered hips, and a slide, a jump, a fall and a
   * climb each have their own stance. The legs then bend to reach them.
   */
  private legs(f: Figure, s: Soldier, duck: number, lean: number, legYaw: number): void {
    const custom = Math.max(f.slide, f.air, f.mantle);
    if (duck < 0.01 && custom < 0.01 && Math.abs(lean) < 0.01) return;
    const b = s.bones;
    const origin = f.group.position;
    const forward = V_TMP4.set(0, 0, -1).applyQuaternion(f.group.quaternion).applyAxisAngle(V_UP, legYaw);
    const right = V_TMP5.crossVectors(forward, V_UP);
    const rising = smoothstep(-1, 2, f.vy);
    const legs = [[b.lUpLeg, b.lLeg, b.lAnkle, b.lFoot], [b.rUpLeg, b.rLeg, b.rAnkle, b.rFoot]] as const;
    legs.forEach(([thigh, shin, ankle, foot], i) => {
      const left = i === 0;
      const at = foot.getWorldPosition(V_TMP3).sub(origin);
      // In the legs' frame: x right, y up, z forward.
      let x = at.dot(right);
      let y = at.dot(V_UP);
      let z = at.dot(forward);
      // Crouched strides are shorter and flatter, and the feet a little wider.
      x *= 1 + 0.2 * duck;
      y *= 1 - 0.5 * duck;
      z *= 1 - 0.45 * duck;
      // A slide leads with the left leg out straight, the right folded under.
      const slide = left ? [-0.12, 0.12, 0.7] : [0.2, 0.05, 0.05];
      // Rising, one knee drives up; falling, both feet reach down.
      const jump = left ? [-0.12, 0.45, 0.25] : [0.12, 0.2, -0.2];
      const drop = left ? [-0.15, 0.22, 0.12] : [0.15, 0.15, -0.08];
      // Climbing, the right knee comes up onto the ledge.
      const climb = left ? [-0.12, 0.1, -0.12] : [0.12, 0.6, 0.3];
      for (const [pose, w] of [[jump, f.air * rising], [drop, f.air * (1 - rising)], [slide, f.slide], [climb, f.mantle]] as const) {
        x = lerp(x, pose[0], w);
        y = lerp(y, pose[1], w);
        z = lerp(z, pose[2], w);
      }
      const target = V_TMP3.copy(origin).addScaledVector(right, x).addScaledVector(V_UP, y).addScaledVector(forward, z);
      placeWorld(foot, target);
      // Knees out front, and the folded leg's knee out to the side in a slide.
      const pole = thigh.getWorldPosition(V_TMP2).addScaledVector(forward, 1);
      if (!left) pole.addScaledVector(right, f.slide * 1.2).addScaledVector(V_UP, -f.slide * 0.8);
      reach(thigh, shin, ankle, target, pole, s.thigh, s.shin);
      // A slide's lead foot points its toes up.
      if (left && f.slide > 0.01) rotateWorld(foot, right, 0.8 * f.slide);
    });
  }

  /** Roll the upper body until the head is right over its hitbox, side to side. */
  private trueLean(f: Figure, s: Soldier, p: PlayerSnap, right: THREE.Vector3, forward: THREE.Vector3): void {
    const want = p.lean * LEAN_OFFSET;
    // The middle of the head, a little way up from where it sits on the neck.
    const side = (): number => {
      const head = s.bones.head.getWorldPosition(V_TMP3);
      head.lerp(s.bones.headEnd.getWorldPosition(V_TMP4), 0.3);
      return head.sub(f.group.position).dot(right);
    };
    const a = side();
    rotateWorld(s.bones.spine, forward, 0.05);
    const b = side();
    const rate = (b - a) / 0.05;
    if (Math.abs(rate) > 1e-3) rotateWorld(s.bones.spine, forward, clamp((want - b) / rate, -0.8, 0.8));
  }

  /**
   * The gun hangs off the right shoulder, pointing where the body aims, and
   * the hands close on it. Reloading tips it over while the left hand fetches
   * a magazine; switching brings it up from low; a throw lowers it while the
   * left hand throws. Running carries it low across the chest.
   */
  private arms(
    f: Figure, s: Soldier, p: PlayerSnap, near: boolean, running: number,
    right: THREE.Vector3, forward: THREE.Vector3,
  ): void {
    const b = s.bones;
    const up = V_UP;
    const shoulder = b.rArm.getWorldPosition(V_TMP);
    f.group.worldToLocal(shoulder);
    const pistol = p.weapon === PISTOL;
    const t = p.actT;
    const reload = p.act === 'reload' ? hump(t, 0.12, 0.85) : 0;
    const draw = p.act === 'draw' ? 1 - smoothstep(0, 0.9, t) : 0;
    const tossing = p.act === 'throw' ? hump(t, 0.05, 0.8) : 0;
    const climbing = f.mantle;
    const low = Math.max(running * 0.7, draw, tossing, climbing * 0.8);

    // The sight line runs just under the eye, the pistol held out at arm's length.
    f.gun.position.set(shoulder.x - 0.1, shoulder.y + 0.06 - low * 0.12, shoulder.z);
    f.gun.rotation.set(lerp(p.pitch, -0.9, low) - reload * 0.3, low * 0.5 * (1 - draw), reload * 0.7, 'YXZ');
    f.gun.translateZ(pistol ? -0.5 : -0.12);
    f.gun.translateX(pistol ? -0.08 : 0);
    if (!near) return;

    f.gun.updateMatrixWorld(true);
    const gun = GUNS[f.weapon];
    const gunRight = V_TMP6.set(1, 0, 0).transformDirection(f.gun.matrixWorld);
    const gunForward = V_TMP7.set(0, 0, -1).transformDirection(f.gun.matrixWorld);
    const gunUp = V_TMP8.crossVectors(gunRight, gunForward);

    // The right hand round the grip, fingers forward round its front, thumb up over it.
    const grip = f.gun.localToWorld(V_TMP.copy(gun.grip));
    let along = V_TMP3.copy(gunForward).addScaledVector(gunUp, -0.3);
    let thumb = V_TMP4.copy(gunUp);
    const wrist = wristFor('R', grip, along, thumb, V_TMP9);
    const pole = V_TMP2.copy(right).multiplyScalar(0.6).addScaledVector(up, -0.8).add(wrist);
    reach(b.rArm, b.rForeArm, b.rHand, wrist, pole, s.arm, s.forearm);
    orientHand(s.hands[1], along, thumb);

    // The left hand: under the fore-end, or off doing something else.
    const body = (x: number, y: number, z: number): THREE.Vector3 =>
      new THREE.Vector3().copy(f.group.position).addScaledVector(right, x).addScaledVector(up, y).addScaledVector(forward, z);
    let target: THREE.Vector3 = f.gun.localToWorld(V_TMP.copy(gun.support));
    // Palm up under it, fingers round its far side, thumb along it.
    along = V_TMP3.copy(gunRight);
    thumb = V_TMP4.copy(gunForward);
    if (pistol) {
      // Wrapped round the right hand, from the other side.
      target = f.gun.localToWorld(V_TMP.copy(gun.grip)).addScaledVector(gunRight, -0.03);
      along = V_TMP3.copy(gunForward).addScaledVector(gunUp, -0.3);
      thumb = V_TMP4.copy(gunUp).addScaledVector(gunForward, 0.5);
    }
    if (p.act === 'reload') {
      // Under the magazine well, down to a pouch on the belt, and back.
      const well = f.gun.localToWorld(gun.grip.clone().lerp(gun.support, 0.45)).addScaledVector(gunUp, -0.1);
      const pouch = body(-0.15, 0.95 - p.duck * 0.45, -0.12);
      target = path(t, [[0, target], [0.15, well], [0.35, pouch], [0.5, pouch], [0.7, well], [0.8, well], [0.95, target]]);
    } else if (p.act === 'throw') {
      // Back over the shoulder, over the top and down in front, then back to the gun.
      const y = 1.55 - p.duck * 0.55;
      const cocked = body(-0.25, y + 0.15, 0.25);
      const release = body(-0.15, y + 0.1, -0.45);
      const follow = body(-0.05, y - 0.55, -0.35);
      target = path(t, [[0, target], [0.1, cocked], [0.2, cocked], [0.32, release], [0.45, follow], [0.8, follow], [1, target]]);
      if (t > 0.05 && t < 0.9) {
        along = V_TMP3.copy(forward).addScaledVector(up, 0.5);
        thumb = V_TMP4.copy(up);
      }
      s.nade.visible = t < 0.3;
    } else if (climbing > 0.01) {
      // Palm down on the ledge, pushing up.
      target = target.clone().lerp(body(-0.2, 1.05, -0.4), climbing);
      along = V_TMP3.copy(forward);
      thumb = V_TMP4.copy(right);
    }
    wristFor('L', target, along, thumb, wrist);
    pole.copy(right).multiplyScalar(-0.6).addScaledVector(up, -0.8).add(wrist);
    reach(b.lArm, b.lForeArm, b.lHand, wrist, pole, s.arm, s.forearm);
    orientHand(s.hands[0], along, thumb);
    if (s.nade.visible) {
      s.hands[0].wrist.updateMatrixWorld(true);
      s.nade.position.copy(s.hands[0].wrist.localToWorld(V_TMP.copy(s.hands[0].knuckles).multiplyScalar(0.8)));
      f.group.worldToLocal(s.nade.position);
    }
  }

  /**
   * Dead: the death clip plays out, and the body settles onto the ground
   * under it, tilted to the slope and lifted out of anything it would sink into.
   */
  private lie(f: Figure, s: Soldier, p: PlayerSnap, step: number): void {
    const b = s.bones;
    const g = this.ground;
    const feetY = p.y + 0.5;
    // Tilt to the slope along the body and across it, easing in as it falls.
    const at = V_TMP.set(0, 0, 0);
    const head = b.head.getWorldPosition(V_TMP2);
    const base = f.group.position;
    const along = V_TMP3.copy(head).sub(base).setY(0);
    const length = along.length();
    if (length > 0.3) {
      along.divideScalar(length);
      const across = V_TMP4.crossVectors(V_UP, along);
      const h0 = g.groundHeight(base.x, base.z, feetY);
      const h1 = g.groundHeight(base.x + along.x * length, base.z + along.z * length, feetY);
      const hl = g.groundHeight(base.x + across.x * 0.35, base.z + across.z * 0.35, feetY);
      const hr = g.groundHeight(base.x - across.x * 0.35, base.z - across.z * 0.35, feetY);
      const pitch = clamp(Math.atan2(h1 - h0, length), -0.6, 0.6);
      const roll = clamp(Math.atan2(hl - hr, 0.7), -0.5, 0.5);
      const settled = smoothstep(0.2, s.death.getClip().duration, f.deadFor);
      Q_A.setFromAxisAngle(across, -pitch * settled);
      Q_B.setFromAxisAngle(along, roll * settled);
      f.tilt.copy(Q_A).multiply(Q_B);
      f.group.quaternion.setFromAxisAngle(V_UP, f.fallYaw).premultiply(f.tilt);
      f.group.updateMatrixWorld(true);
    }
    // Nothing below the ground: lift the body until its lowest part clears.
    let under = 0;
    const points: [THREE.Object3D, number][] = [
      [b.head, 0.12], [b.spine2, 0.12], [b.body, 0.1], [b.lHand, 0.04], [b.rHand, 0.04],
      [b.lFoot, 0.04], [b.rFoot, 0.04], [b.lLeg, 0.07], [b.rLeg, 0.07],
    ];
    if (s.pack) points.push([s.pack, 0.08]);
    for (const [bone, clear] of points) {
      bone.getWorldPosition(at);
      under = Math.max(under, g.groundHeight(at.x, at.z, feetY) + clear - at.y);
    }
    // Only ever up, and eased, so it settles rather than pops.
    const want = Math.max(f.lift + under, 0);
    f.lift += (want - f.lift) * Math.min(step * 20, 1);
    f.group.position.y = p.y + f.lift;
  }
}

/** Metres between footfalls at a speed. */
export function strideLength(speed: number): number {
  return 1.1 + speed * 0.12;
}

/**
 * Which way the death clip lays the body down, as a yaw from where it faced:
 * where its head ends up, relative to its feet.
 */
function deathDirection(gltf: GLTF): number {
  const clip = THREE.AnimationClip.findByName(gltf.animations, 'Death');
  if (!clip) return Math.PI;
  const model = SkeletonUtils.clone(gltf.scene);
  const mixer = new THREE.AnimationMixer(model);
  const action = mixer.clipAction(clip).setLoop(THREE.LoopOnce, 1);
  action.clampWhenFinished = true;
  action.play();
  mixer.update(clip.duration);
  model.updateMatrixWorld(true);
  const head = model.getObjectByName('Head')!.getWorldPosition(new THREE.Vector3());
  // The model faces +z where bodies face -z: turn it round.
  return Math.atan2(head.x, head.z);
}

/** 0 before `a`, up to 1 by a fifth of the way and down again by `b`: for an action's middle. */
function hump(t: number, a: number, b: number): number {
  const w = (b - a) * 0.2;
  return smoothstep(a, a + w, t) * (1 - smoothstep(b - w, b, t));
}

/** A point moving through keyframes [time, where], eased between them. */
function path(t: number, keys: [number, THREE.Vector3][]): THREE.Vector3 {
  if (t <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    const [t1, p1] = keys[i];
    if (t > t1) continue;
    const [t0, p0] = keys[i - 1];
    return p0.clone().lerp(p1, smoothstep(t0, t1, t));
  }
  return keys[keys.length - 1][1];
}

/** Where rounds leave the gun: the barrel's end, or the suppressor's. */
function muzzleOf(f: Figure): THREE.Vector3 {
  const m = V_MUZZLE.copy(GUNS[f.weapon].muzzle);
  if (f.quiet) m.z -= CAN_LENGTH;
  return m;
}

function placeCan(f: Figure): void {
  f.can.position.copy(GUNS[f.weapon].muzzle);
  f.can.position.z -= CAN_LENGTH / 2;
}

/**
 * Light a material up round the point a round landed, fading with distance,
 * rather than all over. `hit` holds the point in the world and the strength.
 */
function flashWhereHit(m: THREE.MeshStandardMaterial, hit: { value: THREE.Vector4 }): void {
  m.onBeforeCompile = (shader) => {
    shader.uniforms.hitGlow = hit;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vHitPos;')
      .replace('#include <skinning_vertex>', '#include <skinning_vertex>\nvHitPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vHitPos;\nuniform vec4 hitGlow;')
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>\ntotalEmissiveRadiance += vec3(1.0, 0.9, 0.8) * hitGlow.w * 1.5 * smoothstep(${FLASH_REACH.toFixed(2)}, 0.0, distance(vHitPos, hitGlow.xyz));`,
      );
  };
  m.customProgramCacheKey = () => 'hitflash';
}

const V_UP = new THREE.Vector3(0, 1, 0);
const V_RIGHT = new THREE.Vector3();
const V_FORWARD = new THREE.Vector3();
const V_MUZZLE = new THREE.Vector3();
const V_TMP = new THREE.Vector3();
const V_TMP2 = new THREE.Vector3();
const V_TMP3 = new THREE.Vector3();
const V_TMP4 = new THREE.Vector3();
const V_TMP5 = new THREE.Vector3();
const V_TMP6 = new THREE.Vector3();
const V_TMP7 = new THREE.Vector3();
const V_TMP8 = new THREE.Vector3();
const V_TMP9 = new THREE.Vector3();
const Q_A = new THREE.Quaternion();
const Q_B = new THREE.Quaternion();

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
