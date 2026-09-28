import * as THREE from 'three';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { LEAN_OFFSET, PLAYER_HEIGHT } from '../shared/constants.ts';
import { angleDiff, clamp, lerp, smoothstep } from '../shared/geom.ts';
import { HEAD_RADIUS, hitboxes, LEGS_RADIUS, TORSO_RADIUS } from '../shared/hitbox.ts';
import type { GameEvent, PlayerSnap, Team } from '../shared/protocol.ts';
import { BOLT, GRENADE, PISTOL } from '../shared/weapons.ts';
import { clip, gaitSpeed, Reaction } from './clips.ts';
import { grenadeModel } from './grenade.ts';
import { fitGun } from './guns.ts';
import { dimIndoors } from './indoorlight.ts';
import { lensOf, lightTorch, makeTorch, mountTorch, torchMaterial, torchMount, type Torch } from './torch.ts';
import { inBuilding, type Building } from '../shared/world.ts';
import { BOLT_START, BOLT_TIME, boltHand, type GunPoints, path, reloadHands } from './handwork.ts';
import { JOINT, RAGDOLL_STEP, Ragdoll, type Solid, Tumbler, type Verlet } from './ragdoll.ts';
import { RagRig, type Slump, slump } from './ragrig.ts';
import {
  type Bones, curl, findBones, findHand, type Hand, moveWorld, orientHand, placeWorld, reach, rotateWorld, span, turnWorld, wristFor,
} from './rig.ts';

// Everyone else. Once the soldier model has loaded, each body is an animated
// soldier: it walks, runs and crouch-walks at the pace it moves with its feet
// planted, jumps, falls and lands, climbs, leans and aims where the player
// looks, with its hands closed on the gun. It flinches when hit, takes each
// shot's recoil, and reloads each gun its own way, switches weapons and
// throws grenades where others can see. Killed, it plays the start of its
// death clip and then goes limp as a ragdoll (see ragdoll.ts), and its gun
// falls from its hands. Until then, bodies are drawn from the
// hit volumes themselves. Either way the head is kept on its hitbox, so what
// you see is what you hit.
// Sides are told apart by colour and kit: operators in grey-blue with a pack,
// guards in olive with brown webbing, commanders with a red band on the helmet
// and a radio mast.

const FALL_TIME = 0.45;
const FLASH_TIME = 0.12;
/** How far round the point a round landed the flash reaches, in metres. */
const FLASH_REACH = 0.3;
const MUZZLE_TIME = 0.05;
const HEAD = 0xd8c3a0;
const TORSO: Record<Team, number> = { operator: 0x3f556e, guard: 0x5a6638 };
const LEGS: Record<Team, number> = { operator: 0x2e3238, guard: 0x4a4636 };
/** The soldier's uniform and webbing, per side; its skin and visor keep the model's own colours. */
const UNIFORM: Record<Team, number> = { operator: 0x44566a, guard: 0x5c6a3a };
const GEAR: Record<Team, number> = { operator: 0x26282b, guard: 0x4a3f2c };
const COMMANDER_UNIFORM = 0x4f5a34;
const COMMANDER_GEAR = 0x6b5a3a;
const UNIFORM_MATERIAL = 'Swat';
const GEAR_MATERIAL = 'Swat_Black';
/** Beyond this, soldiers animate at a lower rate and skip fine posing. */
const NEAR = 90;
const FAR_UPDATE = 1 / 20;
/** Bodies this close are drawn even off screen, for their shadows. */
const SHADOW_REACH = 60;
/** Where the fog hides everything. */
const FOG_END = 750;
/** How far into the jump clip the feet leave the ground, in seconds. */
const TAKEOFF = 0.12;
/** How long a landing plays over the rest, and the shortest time in the air that ends in one. */
const LAND_TIME = 0.8;
const LAND_AFTER = 0.2;
/** How much longer than the clip's a crouched stride can get at speed, so the legs don't scurry. */
const CROUCH_STRIDE = 1.8;
/** How long a shot's kick lasts. */
const KICK_TIME = 0.25;
/** How far the head may be moved to meet its hitbox, up or down. */
const HEAD_FIX = 0.3;
/** How far the hips move to bring the head over the feet, and how far off the hitbox's middle the head may be left. */
const HIPS_SHIFT = 0.12;
const HEAD_SLACK = 0.04;
/** How far the hips move out with a full lean; the upper body rolls the rest of the way. */
const LEAN_HIPS = 0.14;
/** Length of a suppressor on the barrel, as in first person. */
const CAN_LENGTH = 0.15;
/** How fast poses such as a jump or a climb blend in and out, per second. */
const BLEND_RATE = 12;
/** Room a body needs to lie down in, from its feet. */
const LIE_LENGTH = 1.9;
/** Room a body's arms need either side of it. */
const ARM_SPAN = 0.8;
/** Seconds into the death clip that the ragdoll takes over: the knees have gone and it's falling back. */
const HANDOFF = 0.35;
/**
 * How long a body seen dead waits for the kill event that says how it fell,
 * which can come a moment after the snapshot, before falling without it.
 */
const DEATH_WAIT = 0.25;
/** How long a dropped gun takes to leave the hands' last place for where it really falls. */
const GUN_BLEND = 0.3;
/** How far a dropped gun is rolled as it leaves the hands. */
const GUN_ROLL = -0.5;
/** How hard the killing round shoves the joint it struck, in m/s, in WEAPONS order; the rest of the body gets a share. */
const SHOVE = [1.2, 0.8, 2];
const SHOVE_SHARE = 0.2;
/** A grenade throws the whole body, and up. */
const BLAST = 3;
const BLAST_LIFT = 1.5;

const sphere = new THREE.SphereGeometry(1, 16, 12);
const cylinder = new THREE.CylinderGeometry(1, 1, 1, 14).translate(0, 0.5, 0);
const GUN_MAT = new THREE.MeshStandardMaterial({ color: 0x2a2c2e, roughness: 0.5, metalness: 0.4 });
const CAN_MAT = new THREE.MeshStandardMaterial({ color: 0x1e2022, roughness: 0.6, metalness: 0.3 });
const MAG_MAT = new THREE.MeshStandardMaterial({ color: 0x2c2d2f, roughness: 0.6, metalness: 0.3 });
const ROUND_MAT = new THREE.MeshStandardMaterial({ color: 0xb08a3e, roughness: 0.35, metalness: 0.8 });
const PACK_MAT = new THREE.MeshStandardMaterial({ color: 0x3a3d33, roughness: 0.9 });
const RED_MAT = new THREE.MeshStandardMaterial({ color: 0xa3201b, roughness: 0.8 });
const MAST_MAT = new THREE.MeshStandardMaterial({ color: 0x1c1c1c, roughness: 0.6 });
const TORCH_MAT = torchMaterial();
for (const m of [GUN_MAT, CAN_MAT, MAG_MAT, ROUND_MAT, PACK_MAT, RED_MAT, MAST_MAT, TORCH_MAT]) dimIndoors(m);
const FLASH_MAT = new THREE.SpriteMaterial({
  map: flashTexture(), color: 0xffc070, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
});
const CAN_GEO = new THREE.CylinderGeometry(0.02, 0.02, CAN_LENGTH, 10).rotateX(Math.PI / 2);
/** What the left hand brings from the belt: a magazine for each gun (none for the bolt-action), or a round. */
const MAG_GEO = [
  new THREE.BoxGeometry(0.025, 0.14, 0.06).translate(0, -0.05, 0),
  new THREE.BoxGeometry(0.02, 0.09, 0.028).translate(0, -0.03, 0),
  null,
];
const ROUND_GEO = new THREE.CylinderGeometry(0.005, 0.005, 0.07, 6).rotateX(Math.PI / 2);

/** What a body stands on and falls against, and the buildings it may be inside. */
export interface Ground extends Solid {
  groundHeight(x: number, z: number, feetY: number): number;
  raycast(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxT: number): number;
  readonly buildings: readonly Building[];
}

/** A carried gun, barrel along -z with the grip at z = 0, as fitGun makes them, and its marked points. */
interface GunShape extends GunPoints {
  make(): THREE.Object3D;
  muzzle: THREE.Vector3;
  /** Where its flashlight sits. */
  torch: THREE.Vector3;
}

/** A stand-in gun of boxes until the models load. */
function gunShape(weapon: number, length: number, stock: boolean): GunShape {
  const parts = [
    new THREE.BoxGeometry(0.05, 0.07, length * 0.55).translate(0, 0.05, -length * 0.2),
    new THREE.CylinderGeometry(0.012, 0.012, length * 0.45, 8).rotateX(Math.PI / 2).translate(0, 0.06, -length * 0.65),
    new THREE.BoxGeometry(0.035, 0.1, 0.04).translate(0, -0.02, 0),
  ];
  if (stock) parts.push(new THREE.BoxGeometry(0.04, 0.08, 0.25).translate(0, 0.02, 0.18));
  const geometry = mergeGeometries(parts);
  const muzzle = new THREE.Vector3(0, 0.06, -length * 0.88);
  const support = new THREE.Vector3(0, 0.02, -length * 0.42);
  return {
    make: () => new THREE.Mesh(geometry, GUN_MAT),
    muzzle,
    torch: torchMount(weapon, muzzle, support),
    grip: new THREE.Vector3(0, -0.02, 0.02),
    support,
    magazine: new THREE.Vector3(0, -0.05, -length * 0.15),
    bolt: new THREE.Vector3(0.03, 0.06, -length * 0.05),
  };
}

/** In WEAPONS order. */
let GUNS: GunShape[] = [gunShape(0, 0.85, true), gunShape(1, 0.2, false), gunShape(2, 1.1, true)];

interface Figure {
  group: THREE.Group;
  /** While too far to cast a visible shadow: the parts that cast one up close. */
  casters: THREE.Object3D[] | null;
  /** Its meshes take the world's shadows, as they do in and round buildings. */
  shaded: boolean;
  materials: THREE.MeshStandardMaterial[];
  /** Where the last round landed, in the figure's own space, and how bright its flash is. */
  hit: { value: THREE.Vector4 };
  hitAt: THREE.Vector3;
  /** Holds the gun in hand, which is swapped on a weapon change, its suppressor and its flash. */
  gun: THREE.Group;
  held: THREE.Object3D;
  can: THREE.Mesh;
  torch: Torch;
  flashMesh: THREE.Sprite;
  weapon: number;
  quiet: boolean;
  /** Seconds since it died, or -1 while alive. */
  deadFor: number;
  /** How it was killed, from the kill event, until it's seen dead or alive again. */
  death: Death | null;
  /** Where it falls from: its feet, pushed off walls, and the way the death clip faces. */
  fallAt: THREE.Vector3;
  fallYaw: number;
  /** Not yet posed: a body first seen dead lies still at once. */
  fresh: boolean;
  /** Seconds it has been seen dead without word of how it was killed. */
  unexplained: number;
  /** Its ragdoll once it takes over from the death clip, the bones on it, and the steps it has had. */
  rag: Ragdoll | null;
  rig: RagRig | null;
  ragSteps: number;
  /** The ragdoll's step the bones were last laid on, so a body at rest isn't laid again. */
  rigSteps: number;
  /** The gun falling from its hands, and the steps it has had. */
  drop: Drop | null;
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
  /** Poses blended in and out: in the air and climbing. */
  air: number;
  mantle: number;
  /** How far crouched it was last seen, 0 to 1. */
  duck: number;
  /** Seconds in the air, and since it last landed. */
  airFor: number;
  landedFor: number;
  /** How much longer its crouched strides are than the clip's. */
  crouchStride: number;
  /** How far its body is moved up or down to put the head on its hitbox, smoothed. */
  headFix: number;
  /** Seconds since it last fired, and since it was last hit, and whether that was in the head. */
  firedFor: number;
  hitFor: number;
  hitHead: boolean;
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
  crouchIdle: THREE.AnimationAction;
  crouchWalk: THREE.AnimationAction;
  /** Leaving the ground, in the air and landing. */
  jump: THREE.AnimationAction;
  airborne: THREE.AnimationAction;
  land: THREE.AnimationAction;
  death: THREE.AnimationAction;
  bones: Bones;
  hands: [left: Hand, right: Hand];
  /** The bones each reaction turns, in Reactions order. */
  reacting: THREE.Object3D[][];
  /** Each foot's hold on the ground, left then right. */
  feet: [Foothold, Foothold];
  /** A grenade, shown in the throwing hand, and what the left hand brings to a reload. */
  nade: THREE.Object3D;
  mag: THREE.Mesh;
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

/**
 * A foot planted where it landed, so it doesn't slide while the body moves
 * over it: the clip's foot is shifted by `offset` to stay on `at`. Lifted,
 * the offset eases away.
 */
interface Foothold {
  at: THREE.Vector3 | null;
  offset: THREE.Vector3;
  /** Where the clip had the foot last time, to tell a planted foot from a swinging one. */
  last: THREE.Vector3;
}

/** The short movements played over the upper body, and the clips they come from. */
interface Reactions {
  shot: Reaction;
  hit: Reaction;
  hitHead: Reaction;
}

/** What a kill event says about how a body falls. */
type Death = Pick<Extract<GameEvent, { k: 'kill' }>, 'pose' | 'at' | 'dir' | 'weapon' | 'head'>;

/**
 * A dropped gun: three balls held rigid (grip, muzzle and magazine), the
 * gun's turn when they started and their frame's then, and how far the gun
 * was drawn from where it starts, which fades in the first moments.
 */
interface Drop {
  tumbler: Tumbler;
  steps: number;
  turn: THREE.Quaternion;
  frame: THREE.Quaternion;
  offset: THREE.Vector3;
  offsetTurn: THREE.Quaternion;
}

/** Called for each footfall of a body, with how fast it was moving. */
export type StepListener = (x: number, y: number, z: number, speed: number, crouched: boolean) => void;

export class Bodies {
  onStep: StepListener | null = null;
  private readonly scene: THREE.Scene;
  /** What bodies stand and fall on; another island's when that opens. */
  ground: Ground;
  private readonly figures = new Map<number, Figure>();
  private model: GLTF | null = null;
  /** Scale that makes the model PLAYER_HEIGHT tall. */
  private modelScale = 1;
  /** Which way the death clip falls, as a yaw from facing, and how far the head ends up. */
  private deathYaw = Math.PI;
  /** How fast the walk, run and crouch-walk clips carry the body, in m/s, measured from their feet. */
  private gait = { walk: 1.3, run: 3.2, crouch: 0.5 };
  private reactions: Reactions | null = null;
  /** The death clip's pose where the ragdoll takes over. */
  private slump: Slump | null = null;
  /** The bodies lying, or falling, that others land on. */
  private rags: Verlet[] = [];
  /**
   * How each body was last killed, kept until it's seen alive again, so one
   * first drawn dead (after leaving a death cam) lies
   * where it fell.
   */
  private readonly deaths = new Map<number, Death>();
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
      const { object, ...points } = fitGun(g, i);
      // Their own materials, dimmed indoors: the first-person gun shares the model's.
      object.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        mesh.material = (mesh.material as THREE.Material).clone();
        dimIndoors(mesh.material);
      });
      return { make: () => object.clone(), ...points, torch: torchMount(i, points.muzzle, points.support) };
    });
    const box = new THREE.Box3().setFromObject(gltf.scene);
    this.modelScale = PLAYER_HEIGHT / (box.max.y - box.min.y);
    this.deathYaw = deathDirection(gltf);
    this.slump = slump(gltf, this.modelScale, HANDOFF);
    const speed = (name: string): number => gaitSpeed(gltf.scene, clip(gltf.animations, name)) * this.modelScale;
    this.gait = { walk: speed('Walk'), run: speed('Run'), crouch: speed('CrouchWalk') };
    this.reactions = {
      shot: new Reaction(clip(gltf.animations, 'Gun_Shoot')),
      hit: new Reaction(clip(gltf.animations, 'HitRecieve')),
      hitHead: new Reaction(clip(gltf.animations, 'HitRecieve_2')),
    };
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
    this.rags = [];
    for (const f of this.figures.values()) if (f.rag) this.rags.push(f.rag);
    for (const p of players) {
      seen.add(p.id);
      let f = this.figures.get(p.id);
      if (!f) {
        f = this.create(p.team, p.commander);
        this.figures.set(p.id, f);
        f.lastX = p.x;
        f.lastY = p.y;
        f.lastZ = p.z;
        if (p.dead) f.death = this.deaths.get(p.id) ?? null;
      }
      this.pose(f, p, dt);
    }

    for (const id of [...this.figures.keys()]) if (!seen.has(id)) this.remove(id);
  }

  /** Flash a body where a round landed, at (x, y, z) in the world, and make it flinch. */
  flash(id: number, x: number, y: number, z: number): void {
    const f = this.figures.get(id);
    if (!f) return;
    f.flash = FLASH_TIME;
    f.group.updateMatrixWorld(true);
    f.group.worldToLocal(f.hitAt.set(x, y, z));
    f.hitFor = 0;
    f.hitHead = y > f.lastY + PLAYER_HEIGHT * 0.5 && y > hitboxes({ x: 0, y: f.lastY, z: 0, yaw: 0, duck: f.duck, lean: 0 }).neckY;
  }

  /** A body fired: flash at its muzzle unless suppressed, and take the recoil. */
  fire(id: number, quiet: boolean): void {
    const f = this.figures.get(id);
    if (!f) return;
    f.firedFor = 0;
    if (!quiet) {
      f.muzzle = MUZZLE_TIME;
      f.flashMesh.material.rotation = Math.random() * Math.PI;
    }
  }

  /** Someone was killed: they fall from where the event says, pushed the way the round went. */
  killed(e: Death & { victim: number }): void {
    const death = { pose: e.pose, at: e.at, dir: e.dir, weapon: e.weapon, head: e.head };
    this.deaths.set(e.victim, death);
    const f = this.figures.get(e.victim);
    if (f) f.death = death;
  }

  /** A new game: nobody's deaths carry over. */
  forget(): void {
    this.deaths.clear();
  }

  /** Something broke near (x, y, z): the dead lying against it may fall further. */
  shake(x: number, y: number, z: number, reach: number): void {
    for (const f of this.figures.values()) {
      for (const v of [f.rag, f.drop?.tumbler]) {
        if (v && Math.hypot(v.bounds.x - x, v.bounds.y - y, v.bounds.z - z) < reach + v.bounds.r) v.wake();
      }
    }
  }

  /** Where a body's muzzle is in the world, or null if it isn't drawn. */
  muzzle(id: number, out: THREE.Vector3): THREE.Vector3 | null {
    const f = this.figures.get(id);
    if (!f || !f.group.visible) return null;
    f.gun.updateWorldMatrix(true, false);
    return f.gun.localToWorld(out.copy(muzzleOf(f)));
  }

  /** Where a body's flashlight shines from in the world, and the way the gun points, or null if it isn't drawn. */
  torch(id: number, out: THREE.Vector3, dir: THREE.Vector3): THREE.Vector3 | null {
    const f = this.figures.get(id);
    if (!f || !f.group.visible) return null;
    f.gun.updateWorldMatrix(true, false);
    dir.set(0, 0, -1).transformDirection(f.gun.matrixWorld);
    return f.gun.localToWorld(lensOf(GUNS[f.weapon].torch, out));
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
    const torch = makeTorch(TORCH_MAT);
    mountTorch(torch, GUNS[0].torch);
    gun.add(torch.object);
    const flashMesh = new THREE.Sprite(FLASH_MAT);
    flashMesh.scale.setScalar(0.45);
    flashMesh.visible = false;
    gun.add(flashMesh);
    group.add(gun);
    this.scene.add(group);
    const f: Figure = {
      group, materials: [], hit: { value: new THREE.Vector4() }, hitAt: new THREE.Vector3(),
      gun, held, can, torch, flashMesh, weapon: 0, quiet: false,
      deadFor: -1, death: null, fallAt: new THREE.Vector3(), fallYaw: 0, fresh: true, unexplained: 0, rag: null, rig: null, ragSteps: 0, rigSteps: -1, drop: null,
      flash: 0, muzzle: 0, lastX: 0, lastY: 0, lastZ: 0, speed: 0, vy: 0, heading: 0, stride: 0,
      air: 0, mantle: 0, airFor: 0, landedFor: LAND_TIME, crouchStride: 1, headFix: 0, duck: 0,
      firedFor: 1e3, hitFor: 1e3, hitHead: false, soldier: null, casters: null, shaded: false,
      // Far off, bodies take turns to be posed rather than all in one frame.
      wait: Math.random() * FAR_UPDATE,
    };
    placeCan(f);
    if (this.model) f.soldier = this.soldier(f, team, commander);
    else this.placeholder(f, team);
    for (const m of f.materials) {
      flashWhereHit(m, f.hit);
      dimIndoors(m);
    }
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
    const action = (name: string, once = false): THREE.AnimationAction => {
      const a = mixer.clipAction(clip(gltf.animations, name));
      if (once) {
        a.setLoop(THREE.LoopOnce, 1);
        a.clampWhenFinished = true;
      }
      a.weight = 0;
      a.play();
      return a;
    };
    const idle = action('Idle');
    const walk = action('Walk');
    const run = action('Run');
    const crouchIdle = action('CrouchIdle');
    const crouchWalk = action('CrouchWalk');
    const jump = action('JumpStart', true);
    const airborne = action('JumpLoop');
    const land = action('JumpLand', true);
    const death = action('Death', true);
    idle.weight = 1;
    // Start everyone at a different point in their stride.
    const phase = Math.random();
    for (const a of [walk, run, crouchWalk, idle, crouchIdle]) a.time = phase * a.getClip().duration;

    f.group.updateMatrixWorld(true);
    const hands: [Hand, Hand] = [findHand(model, 'L'), findHand(model, 'R')];
    const nade = grenadeModel();
    nade.visible = false;
    f.group.add(nade);
    const mag = new THREE.Mesh(ROUND_GEO, MAG_MAT);
    mag.visible = false;
    f.group.add(mag);
    const pack = this.kit(f, bones, team, commander);
    const animated = Object.values(bones).map((bone) => ({ bone, position: bone.position.clone(), quaternion: bone.quaternion.clone() }));
    const r = this.reactions!;
    const foothold = (): Foothold => ({ at: null, offset: new THREE.Vector3(), last: new THREE.Vector3() });
    return {
      mixer, idle, walk, run, crouchIdle, crouchWalk, jump, airborne, land, death, bones, hands, nade, mag, pack, animated,
      reacting: [r.shot, r.hit, r.hitHead].map((reaction) => reaction.bones(model)),
      feet: [foothold(), foothold()],
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
    // Seen dead before the kill event came: a moment on its feet, waiting for it.
    if (p.dead && f.deadFor < 0 && !f.death && !f.fresh && f.soldier && f.unexplained < DEATH_WAIT) {
      f.unexplained += dt;
      p = { ...p, dead: false };
    } else f.unexplained = 0;
    if (f.weapon !== p.weapon) {
      f.weapon = p.weapon;
      f.gun.remove(f.held);
      f.held = GUNS[p.weapon].make();
      f.held.castShadow = true;
      f.held.traverse((o) => (o as THREE.Mesh).isMesh && (o.receiveShadow = f.shaded));
      f.gun.add(f.held);
      placeCan(f);
      mountTorch(f.torch, GUNS[p.weapon].torch);
    }
    f.quiet = p.quiet;
    f.can.visible = p.quiet;
    lightTorch(f.torch, p.light && !p.dead);

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
      f.air += ((p.motion === 'air' ? 1 : 0) - f.air) * k;
      f.mantle += ((p.motion === 'mantle' ? 1 : 0) - f.mantle) * k;
      f.firedFor += dt;
      f.hitFor += dt;
      f.landedFor += dt;
    }
    // Leaving the ground plays the jump from where the feet leave it; coming down after a while, the landing.
    const inAir = p.motion === 'air' && !p.dead;
    if (inAir && f.airFor === 0 && f.soldier) {
      f.soldier.jump.reset();
      f.soldier.jump.time = f.vy > 0 ? TAKEOFF : f.soldier.jump.getClip().duration;
    }
    if (!inAir && f.airFor > LAND_AFTER && f.soldier) {
      f.landedFor = 0;
      f.soldier.land.reset();
    }
    f.airFor = inAir ? f.airFor + dt : 0;
    f.duck = p.duck;
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
    const revived = !p.dead && f.deadFor >= 0;
    f.deadFor = p.dead ? Math.max(f.deadFor, 0) + dt : -1;
    if (died && f.soldier) this.fall(f, p);
    if (revived) {
      f.death = null;
      this.deaths.delete(p.id);
      f.rag = f.rig = null;
      if (f.drop) {
        f.drop = null;
        f.group.add(f.gun);
      }
    }

    f.group.position.set(p.x, p.y, p.z);
    f.group.rotation.set(0, p.yaw, 0);
    if (p.dead && f.soldier) {
      f.group.position.copy(f.fallAt);
      f.group.quaternion.setFromAxisAngle(V_UP, f.fallYaw);
      if (f.deadFor >= HANDOFF && !f.rag) this.goLimp(f);
      if (died && f.fresh) this.settle(f);
      this.fallOn(f);
    }
    f.fresh = false;

    // Out of sight and too far to throw a shadow into view, or lost in the fog: not drawn.
    if (f.rag) this.bounds.center.set(f.rag.bounds.x, f.rag.bounds.y, f.rag.bounds.z);
    else this.bounds.center.set(p.x, p.y + 0.9, p.z);
    const distance = this.camera.distanceTo(this.bounds.center);
    f.group.visible = distance < SHADOW_REACH || (distance < FOG_END && this.frustum.intersectsSphere(this.bounds));
    // Beyond that, a body's shadow is too small to see but costs a draw in each shadow map.
    const shadow = distance < SHADOW_REACH;
    // In or beside a building, shadowed like the world, so a room keeps the sun
    // off them bar what comes in its windows. Out in the open that costs more
    // than it shows.
    const indoors = shadow && this.ground.buildings.some((b) => inBuilding(b, p.x, p.z, 1.5));
    if (indoors !== f.shaded) {
      f.shaded = indoors;
      f.group.traverse((o) => (o as THREE.Mesh).isMesh && (o.receiveShadow = indoors));
    }
    if (!shadow && !f.casters) {
      f.casters = [];
      f.group.traverse((o) => o.castShadow && f.casters!.push(o));
      for (const o of f.casters) o.castShadow = false;
    } else if (shadow && f.casters) {
      for (const o of f.casters) o.castShadow = true;
      f.casters = null;
    }
    if (f.drop) this.placeGun(f);
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
   * It just died: pick which way it falls. Away from the killing round if it
   * can, and otherwise the way with the most room, pushed back off a wall if
   * even that is too short. All from the kill event (or, without one, the
   * snapshot rounded to the centimetre), so a death cam picks the same. The
   * gun drops from its hands.
   */
  private fall(f: Figure, p: PlayerSnap): void {
    const d = f.death ?? {
      pose: [cm(p.x), cm(p.y), cm(p.z), cm(p.yaw), cm(p.duck)], at: [0, 0, 0], dir: [0, 0, 0], weapon: -1, head: false,
    } satisfies Death;
    f.death = d;
    const [x, y, z, yaw, duck] = d.pose;
    const away = d.weapon >= 0 && Math.hypot(d.dir[0], d.dir[2]) > 0.1 ? Math.atan2(-d.dir[0], -d.dir[2]) : yaw + this.deathYaw;
    let best = away;
    let room = 0;
    let score = -1;
    for (const turn of [0, 1, -1, 2, -2, 3, -3, 4]) {
      const toward = away + (turn * Math.PI) / 4;
      const free = this.room(x, y, z, toward, LIE_LENGTH);
      // Room for the arms, which fling out either side of the chest.
      const cx = x - Math.sin(toward) * Math.min(free, 1.3);
      const cz = z - Math.cos(toward) * Math.min(free, 1.3);
      const arms = Math.min(this.room(cx, y, cz, toward + Math.PI / 2, ARM_SPAN), this.room(cx, y, cz, toward - Math.PI / 2, ARM_SPAN));
      const k = free + arms * 0.5;
      if (k > score + 0.05) (best = toward), (room = free), (score = k);
      if (free >= LIE_LENGTH && arms >= ARM_SPAN) break;
    }
    const short = Math.max(LIE_LENGTH - room, 0);
    const back = short > 0 ? Math.min(short, this.room(x, y, z, best + Math.PI, short)) : 0;
    f.fallYaw = best - this.deathYaw;
    f.fallAt.set(x + Math.sin(best) * back, y, z + Math.cos(best) * back);
    f.rag = f.rig = null;
    f.ragSteps = 0;

    // The gun falls from about where the hands held it, facing ahead and rolling out of them (upright, it
    // could land balanced on its edge); it's drawn from where it really was, easing onto its fall.
    const gun = GUNS[f.weapon];
    const neck = hitboxes({ x: 0, y: 0, z: 0, yaw: 0, duck, lean: 0 }).neckY;
    const start = new THREE.Matrix4().compose(
      V_TMP.set(0.15, neck - 0.15, -0.3).applyAxisAngle(V_UP, yaw).add(V_TMP2.set(x, y, z)),
      Q_A.setFromEuler(E_A.set(0, yaw, GUN_ROLL, 'YXZ')), V_TMP2.set(1, 1, 1),
    );
    const points = [new THREE.Vector3(), gun.muzzle.clone(), new THREE.Vector3(0, -0.12, gun.muzzle.z * 0.4)].map((v) => v.applyMatrix4(start));
    const forward = V_TMP3.set(-Math.sin(yaw), 0, -Math.cos(yaw));
    const [sx, sy, sz] = d.weapon === GRENADE ? d.dir.map((v) => v * BLAST) : d.dir;
    const vx = forward.x * 0.6 + sx;
    const vy = 1 + sy * 0.3;
    const vz = forward.z * 0.6 + sz;
    const now = points.flatMap((v) => v.toArray());
    const before = points.flatMap((v) => [v.x - vx * RAGDOLL_STEP, v.y - vy * RAGDOLL_STEP, v.z - vz * RAGDOLL_STEP]);
    const tumbler = new Tumbler(now, before);
    const turn = Q_A.clone();
    const frame = gunFrame(tumbler, new THREE.Quaternion()).invert();
    const offset = new THREE.Vector3();
    const offsetTurn = new THREE.Quaternion();
    if (f.gun.parent === f.group && f.group.visible) {
      f.gun.updateMatrixWorld(true);
      offset.copy(f.gun.getWorldPosition(V_TMP)).sub(points[0]);
      offsetTurn.copy(f.gun.getWorldQuaternion(Q_B)).multiply(Q_A.copy(turn).invert());
    }
    this.scene.add(f.gun);
    f.drop = { tumbler, steps: 0, turn, frame, offset, offsetTurn };
  }

  /** Metres free along `yaw` from (x, z), up to `length`, at knee and waist height. */
  private room(x: number, y: number, z: number, yaw: number, length: number): number {
    const dx = -Math.sin(yaw);
    const dz = -Math.cos(yaw);
    let free = length;
    for (const h of [0.3, 0.7]) free = Math.min(free, this.ground.raycast(x, y + h, z, dx, 0, dz, length));
    return free;
  }

  /**
   * Partway through the death clip: the ragdoll takes over from the clip's
   * pose there, carrying on at the clip's speed, shoved by the killing round
   * where it struck, or thrown by a blast.
   */
  private goLimp(f: Figure): void {
    const s = this.slump!;
    const d = f.death!;
    f.group.updateMatrixWorld(true);
    const m = f.group.matrixWorld;
    const place = (from: Float64Array): number[] => {
      const out: number[] = [];
      for (let i = 0; i < from.length; i += 3) out.push(...V_TMP.fromArray(from, i).applyMatrix4(m).toArray());
      return out;
    };
    const rag = new Ragdoll(place(s.now), place(s.before), !!f.soldier?.pack);
    const [dx, dy, dz] = d.dir;
    if (d.weapon === GRENADE) {
      for (let i = 0; i < rag.n; i++) rag.push(i, dx * BLAST, Math.max(dy, 0) * BLAST + BLAST_LIFT, dz * BLAST);
    } else if (d.weapon >= 0) {
      // The head, or by the height it struck: the legs, the hips or the chest.
      const high = d.at[1] - d.pose[1];
      const side = (d.at[0] - d.pose[0]) * Math.cos(d.pose[3]) - (d.at[2] - d.pose[2]) * Math.sin(d.pose[3]);
      const struck = d.head ? JOINT.head : high < 0.55 ? (side < 0 ? JOINT.lKnee : JOINT.rKnee) : high < 1.05 ? JOINT.pelvis : JOINT.chest;
      const shove = SHOVE[d.weapon] ?? SHOVE[0];
      for (let i = 0; i < rag.n; i++) {
        const k = shove * (i === struck ? 1 : SHOVE_SHARE);
        rag.push(i, dx * k, dy * k, dz * k);
      }
    }
    f.rag = rag;
    f.ragSteps = 0;
    f.rig = new RagRig(f.soldier!.bones, rag, s, f.group);
    f.rigSteps = -1;
  }

  /** First seen dead, as after a death cam: already lying where it came to rest. */
  private settle(f: Figure): void {
    f.deadFor = HANDOFF;
    this.goLimp(f);
    const rag = f.rag!;
    const tumbler = f.drop?.tumbler;
    while (!rag.asleep) rag.step(this.ground, this.rags);
    while (tumbler && !tumbler.asleep) tumbler.step(this.ground, this.rags);
    f.ragSteps = rag.steps;
    f.deadFor = HANDOFF + rag.steps * RAGDOLL_STEP;
    if (f.drop) f.drop.steps = Math.floor(f.deadFor / RAGDOLL_STEP);
    this.rags.push(rag);
  }

  /** Step its ragdoll and gun up to now, on their fixed clock, onto the ground and the dead. */
  private fallOn(f: Figure): void {
    const drop = f.drop;
    if (drop) {
      const due = Math.floor(f.deadFor / RAGDOLL_STEP);
      // Its own body is left out: it falls away from it, and would only knock it about.
      if (drop.steps < due) {
        const on = this.rags.filter((r) => r !== f.rag);
        for (; drop.steps < due; drop.steps++) drop.tumbler.step(this.ground, on);
      }
    }
    if (f.rag) {
      const due = Math.floor((f.deadFor - HANDOFF) / RAGDOLL_STEP);
      for (; f.ragSteps < due; f.ragSteps++) f.rag.step(this.ground, this.rags);
    }
  }

  /** The dropped gun where its three balls are, drawn from where the hands last had it at first. */
  private placeGun(f: Figure): void {
    const d = f.drop!;
    const k = smoothstep(0, GUN_BLEND, f.deadFor);
    const t = d.tumbler.pos;
    f.gun.position.set(t[0], t[1], t[2]).addScaledVector(d.offset, 1 - k);
    const turn = gunFrame(d.tumbler, Q_A).multiply(d.frame).multiply(d.turn);
    f.gun.quaternion.slerpQuaternions(d.offsetTurn, Q_B.identity(), k).multiply(turn);
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
    // Near, a random wait: once it moves off, it takes its turn out of step with the others.
    f.wait = near ? Math.random() * FAR_UPDATE : FAR_UPDATE;
    if (f.rig) {
      if (f.rigSteps !== f.rag!.steps) {
        f.rigSteps = f.rag!.steps;
        f.group.updateMatrixWorld(true);
        f.rig.apply();
      }
      return;
    }

    // Walk into a run with speed, crouched or not; play the clips as fast as the body moves.
    const dead = f.deadFor >= 0;
    const speed = dead ? 0 : f.speed;
    const moving = smoothstep(0.3, 1.2, speed);
    const running = smoothstep(2.6, 4.6, speed);
    const alive = dead ? 1 - Math.min(f.deadFor / 0.15, 1) : 1;
    const air = f.air;
    const rising = smoothstep(-1, 1, f.vy);
    // A landing shows most when standing still, and fades as it finishes.
    const landing = (1 - smoothstep(0.35, LAND_TIME, f.landedFor)) * (1 - 0.6 * moving) * (1 - air);
    const ground = (1 - air) * (1 - landing);
    const duck = p.duck;
    s.idle.weight = alive * ground * (1 - duck) * (1 - moving);
    s.walk.weight = alive * ground * (1 - duck) * moving * (1 - running);
    s.run.weight = alive * ground * (1 - duck) * moving * running;
    s.crouchIdle.weight = alive * ground * duck * (1 - moving);
    s.crouchWalk.weight = alive * ground * duck * moving;
    s.jump.weight = alive * air * rising;
    s.airborne.weight = alive * air * (1 - rising);
    s.land.weight = alive * landing;
    if (dead && s.death.weight === 0) s.death.reset().play();
    s.death.weight = 1 - alive;
    if (!dead) s.death.stop();
    // Backpedalling plays the stride backward, with the legs facing the way back.
    const back = Math.abs(f.heading) > Math.PI * 0.6;
    const sign = back ? -1 : 1;
    s.walk.timeScale = sign * clamp(speed / this.gait.walk, 0.6, 2);
    s.run.timeScale = sign * clamp(speed / this.gait.run, 0.6, 1.8);
    // The crouch-walk clip is a slow sneak: faster, its strides lengthen before its pace quickens.
    f.crouchStride = clamp(speed / (this.gait.crouch * 2.5), 1, CROUCH_STRIDE);
    s.crouchWalk.timeScale = sign * clamp(speed / (this.gait.crouch * f.crouchStride), 0.6, 3);
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
    s.mag.visible = false;
    f.group.updateMatrixWorld(true);
    if (dead) return;

    const b = s.bones;
    const up = V_UP;
    const facing = f.group.quaternion;
    const right = V_RIGHT.set(1, 0, 0).applyQuaternion(facing);
    const forward = V_FORWARD.set(0, 0, -1).applyQuaternion(facing);

    // Legs and feet turn toward where it's going, within reason; the body keeps facing its aim.
    const legYaw = moving * clamp(back ? angleDiff(f.heading, Math.PI) : f.heading, -1.1, 1.1);
    rotateWorld(b.root, up, legYaw);
    rotateWorld(b.spine, up, -legYaw);

    // Leaning, the hips move out over the feet.
    if (Math.abs(p.lean) > 1e-3) moveWorld(b.body, V_TMP2.copy(right).multiplyScalar(p.lean * LEAN_HIPS));
    // Bent forward climbing; aiming, the chest and head follow the pitch.
    rotateWorld(b.spine, right, -0.45 * f.mantle);
    rotateWorld(b.spine2, right, p.pitch * 0.5);
    rotateWorld(b.neck, right, p.pitch * 0.35);
    this.headOnHitbox(f, s, p, step, right, forward, near);
    this.react(f, s);
    if (near) this.legs(f, s, legYaw, step);
    this.arms(f, s, p, near, running, right, forward);
  }

  /** The middle of the head, a little way up from where it sits on the neck, in the world. */
  private headAt(s: Soldier, out: THREE.Vector3): THREE.Vector3 {
    out.setFromMatrixPosition(s.bones.head.matrixWorld);
    return out.lerp(V_TMP4.setFromMatrixPosition(s.bones.headEnd.matrixWorld), 0.3);
  }

  /**
   * Put the head where its hitbox is, whatever the clips did: move the hips
   * and bend at the waist until it's over the feet front to back (within a
   * few centimetres), roll the upper body until it's as far out as a lean
   * puts the hitbox, and raise or lower the body (easing, so a stride's bob
   * stays) until it's at eye height. The bend and roll are one Newton step
   * each, from how far the head moves per radian turned at the waist, made
   * as a single turn.
   */
  private headOnHitbox(
    f: Figure, s: Soldier, p: PlayerSnap, step: number, right: THREE.Vector3, forward: THREE.Vector3, near: boolean,
  ): void {
    const spine = s.bones.spine;
    const origin = f.group.position;
    const head = this.headAt(s, V_TMP3);
    const arm = V_TMP5.copy(head).sub(V_TMP2.setFromMatrixPosition(spine.matrixWorld));
    // How far the head moves along `dir` for each radian turned about `axis` at the waist.
    const rate = (axis: THREE.Vector3, dir: THREE.Vector3): number => V_TMP2.crossVectors(axis, arm).dot(dir);
    const side = V_TMP2.copy(head).sub(origin).dot(right);
    const ahead = V_TMP2.copy(head).sub(origin).dot(forward);
    let roll = 0;
    let bend = 0;
    let shift = 0;
    const sideways = rate(forward, right);
    if (Math.abs(sideways) > 1e-3) roll = clamp((p.lean * LEAN_OFFSET - side) / sideways, -0.8, 0.8);
    // Far off, only a lean shows: a few centimetres either way can't be seen.
    if (near) {
      // Front to back, the hips carry it partway over the feet and the waist bends for the rest; climbing keeps its bend.
      shift = clamp(-ahead, -HIPS_SHIFT, HIPS_SHIFT) * (1 - f.mantle);
      const left = ahead + shift;
      const onward = rate(right, forward);
      if (Math.abs(left) > HEAD_SLACK && Math.abs(onward) > 1e-3) {
        bend = clamp((Math.sign(left) * HEAD_SLACK - left) / onward, -0.8, 0.8) * (1 - f.mantle);
      }
    }
    Q_A.setFromAxisAngle(forward, roll).multiply(Q_B.setFromAxisAngle(right, bend));
    if (roll !== 0 || bend !== 0) turnWorld(spine, Q_A);
    if (!near) return;
    // Where the turn left the head's height, then the body raised or lowered toward eye height, with the hips' shift.
    const eye = hitboxes({ x: 0, y: 0, z: 0, yaw: 0, duck: p.duck, lean: 0 }).headY;
    const headY = head.y + V_TMP2.copy(arm).applyQuaternion(Q_A).sub(arm).y - origin.y;
    f.headFix += (clamp(eye - headY, -HEAD_FIX, HEAD_FIX) - f.headFix) * (1 - Math.exp(-10 * step));
    moveWorld(s.bones.body, V_TMP2.copy(forward).multiplyScalar(shift).addScaledVector(V_UP, f.headFix));
  }

  /** A shot's recoil and a hit's flinch, over the upper body. */
  private react(f: Figure, s: Soldier): void {
    const r = this.reactions!;
    r.shot.apply(s.reacting[0], f.firedFor, 0.8);
    r[f.hitHead ? 'hitHead' : 'hit'].apply(s.reacting[f.hitHead ? 2 : 1], f.hitFor, 1);
    if (f.firedFor < r.shot.duration || f.hitFor < r.hit.duration) f.group.updateMatrixWorld(true);
  }

  /**
   * Where the feet go. The clips place them; crouched at speed, strides
   * lengthen, and a climb has its own stance. A foot on the ground stays
   * where it landed until the clip lifts it, so it doesn't slide. The legs
   * then bend to reach them.
   */
  private legs(f: Figure, s: Soldier, legYaw: number, step: number): void {
    const b = s.bones;
    const origin = f.group.position;
    const forward = V_TMP4.set(0, 0, -1).applyQuaternion(f.group.quaternion).applyAxisAngle(V_UP, legYaw);
    const right = V_TMP5.crossVectors(forward, V_UP);
    const stride = lerp(1, f.crouchStride, f.duck);
    const grounded = f.air < 0.1 && f.mantle < 0.1;
    const legs = [[b.lUpLeg, b.lLeg, b.lAnkle, b.lFoot], [b.rUpLeg, b.rLeg, b.rAnkle, b.rFoot]] as const;
    legs.forEach(([thigh, shin, ankle, foot], i) => {
      const left = i === 0;
      const at = foot.getWorldPosition(V_TMP3).sub(origin);
      // In the legs' frame: x right, y up, z forward.
      let x = at.dot(right);
      let y = at.dot(V_UP);
      let z = at.dot(forward) * stride;
      // Climbing, the right knee comes up onto the ledge.
      const climb = left ? [-0.12, 0.1, -0.12] : [0.12, 0.6, 0.3];
      x = lerp(x, climb[0], f.mantle);
      y = lerp(y, climb[1], f.mantle);
      z = lerp(z, climb[2], f.mantle);
      const target = V_TMP3.copy(origin).addScaledVector(right, x).addScaledVector(V_UP, y).addScaledVector(forward, z);

      // Planted: the clip's foot hardly moves over the ground, and it's low.
      const hold = s.feet[i];
      const drift = Math.hypot(target.x - hold.last.x, target.z - hold.last.z) / Math.max(step, 1e-3);
      const planted = grounded && y < 0.15 && drift < 0.5 * f.speed + 0.3;
      hold.last.copy(target);
      if (planted) {
        if (!hold.at) hold.at = target.clone();
        hold.offset.set(hold.at.x - target.x, 0, hold.at.z - target.z);
        // Stretched too far, as when turning on the spot: step again.
        if (hold.offset.lengthSq() > 0.3 * 0.3) {
          hold.at.copy(target);
          hold.offset.set(0, 0, 0);
        }
      } else {
        hold.at = null;
        hold.offset.multiplyScalar(Math.exp(-15 * step));
      }
      target.add(hold.offset);
      placeWorld(foot, target);
      // Knees out front.
      const pole = thigh.getWorldPosition(V_TMP2).addScaledVector(forward, 1);
      reach(thigh, shin, ankle, target, pole, s.thigh, s.shin);
    });
  }

  /**
   * The gun hangs off the right shoulder, pointing where the body aims, and
   * the hands close on it. It kicks with each shot, and the bolt-action's
   * bolt is worked after one. Reloading tips it over while the hands do what
   * that gun needs (see handwork.ts); switching brings it up from low; a
   * throw lowers it while the left hand throws. Running carries it low
   * across the chest.
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
    const kick = f.firedFor < KICK_TIME ? (1 - f.firedFor / KICK_TIME) ** 2 * [0.6, 1, 1.6][p.weapon] : 0;
    // The bolt-action and pistol tip toward the left hand to reload; the rifle rolls its magazine out.
    const tip = reload * (p.weapon === BOLT ? 0.4 : pistol ? 0.5 : 0.7);

    // The sight line runs just under the eye, the pistol held out at arm's length.
    f.gun.position.set(shoulder.x - 0.1, shoulder.y + 0.06 - low * 0.12, shoulder.z);
    f.gun.rotation.set(lerp(p.pitch, -0.9, low) - reload * 0.3 + kick * 0.12, low * 0.5 * (1 - draw), tip, 'YXZ');
    f.gun.translateZ((pistol ? -0.5 : -0.12) + kick * 0.04);
    f.gun.translateX(pistol ? -0.08 : 0);
    if (!near) return;

    f.gun.updateMatrixWorld(true);
    const gun = GUNS[f.weapon];
    const gunRight = V_TMP6.set(1, 0, 0).transformDirection(f.gun.matrixWorld);
    const gunForward = V_TMP7.set(0, 0, -1).transformDirection(f.gun.matrixWorld);
    const gunUp = V_TMP8.crossVectors(gunRight, gunForward);
    const gunBack = V_TMP10.copy(gunForward).negate();
    const toWorld = (v: THREE.Vector3): THREE.Vector3 => f.gun.localToWorld(v);
    const body = (x: number, y: number, z: number): THREE.Vector3 =>
      new THREE.Vector3().copy(f.group.position).addScaledVector(right, x).addScaledVector(up, y).addScaledVector(forward, z);

    // Where the hands hold the gun: the right round the grip, the left under the fore-end or round the right.
    const grip = toWorld(V_TMP.copy(gun.grip)).clone();
    let support = toWorld(V_TMP.copy(gun.support)).addScaledVector(gunUp, -0.025).clone();
    if (pistol) support = toWorld(V_TMP.copy(gun.grip)).addScaledVector(gunRight, -0.03).clone();
    let rightAt = grip;
    let leftAt = support;
    let rightAway = 0;
    let holding: 'magazine' | 'round' | null = null;
    if (p.act === 'reload') {
      const pouch = body(-0.14, 0.95 - p.duck * 0.45, 0.1);
      const work = reloadHands(f.weapon, t, gun, toWorld, { left: support, right: grip }, pouch, gunUp, gunBack);
      leftAt = work.left;
      rightAt = work.right;
      rightAway = work.rightAway;
      holding = work.holding;
    } else if (f.weapon === BOLT && p.act === 'none') {
      const c = (f.firedFor - BOLT_START) / BOLT_TIME;
      if (c > 0 && c < 1) {
        const work = boltHand(c, gun, toWorld, grip, gunUp, gunBack);
        rightAt = work.at;
        rightAway = work.away;
      }
    }

    // The right hand round the grip, fingers forward round its front, thumb up over it; on the bolt, fingers down over it.
    let along = V_TMP3.copy(gunForward).addScaledVector(gunUp, -0.3);
    let thumb = V_TMP4.copy(gunUp);
    if (rightAway > 0) {
      along.lerp(V_TMP11.copy(gunForward).multiplyScalar(0.4).sub(gunUp), rightAway);
      thumb.lerp(gunForward, rightAway);
    }
    const wrist = wristFor('R', rightAt, along, thumb, V_TMP9);
    const pole = V_TMP2.copy(right).multiplyScalar(0.6).addScaledVector(up, -0.8).add(wrist);
    reach(b.rArm, b.rForeArm, b.rHand, wrist, pole, s.arm, s.forearm);
    orientHand(s.hands[1], along, thumb);
    if (rightAway > 0) curl(s.hands[1], lerp(0.9, 0.6, rightAway));

    // The left hand: palm up under the fore-end, a little below its middle, fingers angled forward round its
    // far side and the thumb along the near side.
    let target = leftAt;
    let closed = 0.8;
    along = V_TMP3.copy(gunRight).addScaledVector(gunForward, 0.9);
    thumb = V_TMP4.copy(gunForward).addScaledVector(gunRight, -0.5).addScaledVector(gunUp, 0.4);
    if (pistol) {
      // Wrapped round the right hand's fingers from the left, the thumb forward along the frame.
      closed = 0.9;
      along = V_TMP3.copy(gunRight).addScaledVector(gunUp, -0.35).addScaledVector(gunForward, 0.2);
      thumb = V_TMP4.copy(gunForward).addScaledVector(gunUp, 0.3);
    }
    if (p.act === 'throw') {
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
    curl(s.hands[0], p.act === 'none' || p.act === 'draw' ? closed : 0.8);

    // Whatever the left hand carries sits in its fingers.
    const carried = s.nade.visible ? s.nade : holding ? s.mag : null;
    if (carried) {
      if (carried === s.mag) {
        const geometry = holding === 'round' ? ROUND_GEO : MAG_GEO[f.weapon];
        if (geometry) s.mag.geometry = geometry;
        s.mag.material = holding === 'round' ? ROUND_MAT : MAG_MAT;
        s.mag.visible = !!geometry;
        s.mag.quaternion.copy(f.gun.quaternion).premultiply(Q_A.copy(f.group.quaternion).invert());
      }
      const hand = s.hands[0];
      hand.wrist.updateMatrixWorld(true);
      carried.position.copy(hand.wrist.localToWorld(V_TMP.copy(hand.knuckles).multiplyScalar(0.8)));
      f.group.worldToLocal(carried.position);
    }
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

/** Rounded to the centimetre, as kill events give positions. */
function cm(v: number): number {
  return Math.round(v * 100) / 100 + 0;
}

/** A dropped gun's frame: along the barrel, and up from the magazine. */
function gunFrame(t: Tumbler, out: THREE.Quaternion): THREE.Quaternion {
  const p = t.pos;
  const x = V_TMP4.set(p[3] - p[0], p[4] - p[1], p[5] - p[2]).normalize();
  const up = V_TMP5.set(p[0] - p[6], p[1] - p[7], p[2] - p[8]);
  const z = V_TMP6.crossVectors(x, up).normalize();
  const y = up.crossVectors(z, x);
  return out.setFromRotationMatrix(M_A.makeBasis(x, y, z));
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
const V_TMP10 = new THREE.Vector3();
const V_TMP11 = new THREE.Vector3();
const Q_A = new THREE.Quaternion();
const Q_B = new THREE.Quaternion();
const M_A = new THREE.Matrix4();
const E_A = new THREE.Euler();

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
