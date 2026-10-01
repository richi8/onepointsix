import * as THREE from 'three';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { GRENADE_RADIUS, LEAN_OFFSET, MANTLE_REACH, PLAYER_HEIGHT, PLAYER_RADIUS } from '../shared/constants.ts';
import { angleDiff, clamp, lerp, smoothstep } from '../shared/geom.ts';
import { HEAD_RADIUS, hitboxes, LEGS_RADIUS, TORSO_RADIUS } from '../shared/hitbox.ts';
import type { GameEvent, PlayerSnap, Team } from '../shared/protocol.ts';
import { BOLT, GRENADE, PISTOL } from '../shared/weapons.ts';
import { mergeParts, part, type Part, partOf, vertexSurfaces } from './baked.ts';
import { clip, gaitSpeed, Reaction } from './clips.ts';
import { grenadeModel } from './grenade.ts';
import { fitGun } from './guns.ts';
import { FAR_SHADOWS } from './cascades.ts';
import { dimIndoors } from './indoorlight.ts';
import { Soak, wetMaterial, type Shelter } from './rain.ts';
import { lensOf, lightTorch, makeTorch, mountTorch, torchMount, torchPart, type Torch } from './torch.ts';
import type { Building } from '../shared/world.ts';
import {
  actionMatrix, AT_REST, BOLT_START, BOLT_TIME, boltHand, type GunPoints, magazineMatrix, type Parts, path, reloadHands, shotParts, SOME_ROUNDS,
} from './handwork.ts';
import { Litter } from './litter.ts';
import { JOINT, type Living, RAGDOLL_STEP, Ragdoll, type Solid, stepAll, stepOf, Tumbler, type Verlet } from './ragdoll.ts';
import { RagRig, type Slump, slump } from './ragrig.ts';
import {
  type Bones, curl, findBones, findHand, type Hand, moveWorld, orientHand, placeWorld, reach, rotateWorld, span, turnWorld, wristFor,
} from './rig.ts';
import { REFLECTED } from './water.ts';

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
// Each soldier is drawn in two draw calls a pass: its body with its kit as
// one skinned mesh, and its gun with its flashlight and suppressor (see
// baked.ts). They take the world's shadows everywhere and cast them as far as
// the sun's cascades reach, and they're mirrored in the sea.

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
const PACK = 0x3a3d33;
const RED = 0xa3201b;
const MAST = 0x1c1c1c;
const GUN = 0x2a2c2e;
const CAN = 0x1e2022;
/** Beyond this, soldiers animate at a lower rate and skip fine posing. */
const NEAR = 90;
const FAR_UPDATE = 1 / 20;
/** Bodies this close cast shadows, drawn off screen too if their shadow may fall in view: as far as the coarse cascade reaches. */
const SHADOW_REACH = FAR_SHADOWS;
/** The longest shadow a body is thought to throw, for a sun low in the sky. */
const SHADOW_LENGTH = 25;
/** Bodies this close with their flashlight on are posed off screen too, for their beam. */
const LIGHT_REACH = 60;
/** Room round a body standing, for culling. */
const BODY_RADIUS = 1.4;
/** Where the fog hides everything. */
const FOG_END = 750;
/** How far into the jump clip the feet leave the ground, in seconds. */
const TAKEOFF = 0.12;
/** How long a landing plays over the rest, and the shortest time in the air that ends in one. */
const LAND_TIME = 0.8;
const LAND_AFTER = 0.2;
/** How much longer than the clip's a crouched stride can get at speed, so the legs don't scurry. */
const CROUCH_STRIDE = 1.3;
/**
 * Crouched, the speeds over which the crouch-walk gives way to the run
 * played low: how much shorter its strides are, how far the hips drop and
 * the chest bends over.
 */
const CROUCH_FAST = [1, 1.7];
const CROUCH_RUN_STRIDE = 1;
const CROUCH_RUN_DROP = 0.28;
const CROUCH_RUN_BEND = 0.45;
const CROUCH_RUN_BACK = 0.22;
/** How much of the run's foot lift, over a planted foot's height, the low run keeps. */
const CROUCH_RUN_LIFT = 0.4;
const FOOT_REST = 0.12;
/** How far a foot reaches up or down to the ground under it, how far the hips drop to a low one, and how far an ankle turns. */
const FOOT_REACH = 0.35;
const FOOT_DROP = 0.25;
const ANKLE_TURN = 0.45;
/** How long a shot's kick lasts. */
const KICK_TIME = 0.25;
/** How far the head may be moved to meet its hitbox, up or down. */
const HEAD_FIX = 0.3;
/** How far the hips move to bring the head over the feet, and how far off the hitbox's middle the head may be left. */
const HIPS_SHIFT = 0.12;
const HEAD_SLACK = 0.04;
/** How far the whole body, feet and all, may move back or forward to bring the head over its middle first. */
const ROOT_SHIFT = 0.3;
/** How far behind the middle of the legs' hitbox a crouching foot may stand. */
const FOOT_TUCK = LEGS_RADIUS;
/** How far the hips move out with a full lean; the upper body rolls the rest of the way. */
const LEAN_HIPS = 0.14;
/** How far the chest turns, left shoulder forward, behind a long gun, so the left hand reaches the fore-end; the head turns back. */
const BLADE = 0.8;
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
/** How long kill events are kept, for death cams, and how far ahead of the time shown one may be. */
const DEATH_KEEP = 30;
const DEATH_AHEAD = 0.5;
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
/** A grenade throws bodies already down at this speed at its heart, less with distance, and up by this share of it. */
const BLAST_DOWN = 4;
const BLAST_DOWN_LIFT = 0.5;
/** How thick the living are to the dead falling against them. */
const LIVING_RADIUS = 0.25;
/**
 * A body left lying after its player is up again elsewhere stays at least
 * this long after dying, and then until it's out of view, but never more
 * than twice that; no more than CORPSES are kept, the oldest going first.
 */
const CORPSE_TIME = 30;
const CORPSES = 8;

const sphere = new THREE.SphereGeometry(1, 16, 12);
const cylinder = new THREE.CylinderGeometry(1, 1, 1, 14).translate(0, 0.5, 0);
/**
 * A carried gun's, whose look is in its vertices, and a loose round's: each
 * body's own, and each dropped magazine's, wet as `soak` says (see Soak).
 */
function gunMaterial(soak: { value: number }): THREE.MeshStandardMaterial {
  return metal(vertexSurfaces(new THREE.MeshStandardMaterial()), soak);
}
function roundMaterial(soak: { value: number }): THREE.MeshStandardMaterial {
  return metal(new THREE.MeshStandardMaterial({ color: 0xb08a3e, roughness: 0.35, metalness: 0.8 }), soak);
}
function metal(m: THREE.MeshStandardMaterial, soak: { value: number }): THREE.MeshStandardMaterial {
  dimIndoors(m);
  return wetMaterial(m, { gloss: 0.35, soak });
}
const FLASH_MAT = new THREE.SpriteMaterial({
  map: flashTexture(), color: 0xffc070, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
});
const CAN_GEO = new THREE.CylinderGeometry(0.02, 0.02, CAN_LENGTH, 10).rotateX(Math.PI / 2);
/** What the bolt-action's left hand brings from the belt, a round at a time. */
const ROUND_GEO = new THREE.CylinderGeometry(0.005, 0.005, 0.07, 6).rotateX(Math.PI / 2);

/** What a body stands on and falls against, and the buildings it may be inside. */
export interface Ground extends Solid {
  groundHeight(x: number, z: number, feetY: number): number;
  raycast(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxT: number): number;
  readonly buildings: readonly Building[];
}

/** A carried gun, barrel along -z with the grip at z = 0, as fitGun makes them, and its marked points. */
interface GunShape extends GunPoints {
  /** The gun with its flashlight's body, bare and with the suppressor on. */
  looks: [bare: THREE.BufferGeometry, quiet: THREE.BufferGeometry];
  /** The same without its moving parts, drawn on their own while they move. */
  frames: [bare: THREE.BufferGeometry, quiet: THREE.BufferGeometry];
  mag: THREE.BufferGeometry | null;
  action: THREE.BufferGeometry | null;
  muzzle: THREE.Vector3;
  /** Where its flashlight sits. */
  torch: THREE.Vector3;
  /** How far behind the grip its back end is, in metres: the butt of a stock. */
  butt: number;
}

/** How far behind the grip a gun's geometry reaches. */
function buttOf(geometry: THREE.BufferGeometry): number {
  if (!geometry.boundingBox) geometry.computeBoundingBox();
  return Math.max(geometry.boundingBox!.max.z, 0);
}

/**
 * A gun's frame merged with its flashlight, without and with a suppressor,
 * with its moving parts (its magazine, and its slide or bolt handle) and
 * without, and those parts on their own.
 */
function gunLooks(
  frame: Part[], mag: Part[], action: Part[], weapon: number, muzzle: THREE.Vector3, support: THREE.Vector3,
): Pick<GunShape, 'looks' | 'frames' | 'mag' | 'action' | 'torch' | 'butt'> {
  const torch = torchMount(weapon, muzzle, support);
  const bare = [...frame, torchPart(torch)];
  const can = part(CAN_GEO.clone().translate(muzzle.x, muzzle.y, muzzle.z - CAN_LENGTH / 2), CAN, 0.6, 0.3);
  const moving = [...mag, ...action];
  const looks: GunShape['looks'] = [mergeParts([...bare, ...moving]), mergeParts([...bare, ...moving, can])];
  return {
    torch, looks, butt: buttOf(looks[0]),
    frames: moving.length ? [mergeParts(bare), mergeParts([...bare, can])] : looks,
    mag: mag.length ? mergeParts(mag) : null,
    action: action.length ? mergeParts(action) : null,
  };
}

/** A stand-in gun of boxes until the models load. */
function gunShape(weapon: number, length: number, stock: boolean): GunShape {
  const parts = [
    new THREE.BoxGeometry(0.05, 0.07, length * 0.55).translate(0, 0.05, -length * 0.2),
    new THREE.CylinderGeometry(0.012, 0.012, length * 0.45, 8).rotateX(Math.PI / 2).translate(0, 0.06, -length * 0.65),
    new THREE.BoxGeometry(0.035, 0.1, 0.04).translate(0, -0.02, 0),
  ];
  if (stock) parts.push(new THREE.BoxGeometry(0.04, 0.08, 0.25).translate(0, 0.02, 0.18));
  const muzzle = new THREE.Vector3(0, 0.06, -length * 0.88);
  const support = new THREE.Vector3(0, 0.02, -length * 0.42);
  const bolt = new THREE.Vector3(0.03, 0.06, -length * 0.05);
  return {
    ...gunLooks(parts.map((g) => part(g, GUN, 0.5, 0.4)), [], [], weapon, muzzle, support),
    muzzle,
    grip: new THREE.Vector3(0, -0.02, 0.02),
    support,
    magazine: new THREE.Vector3(0, -0.05, -length * 0.15),
    bolt,
    pivot: bolt.clone().setX(0),
    well: new THREE.Vector3(0, -1, 0),
  };
}

/** In WEAPONS order. */
let GUNS: GunShape[] = [gunShape(0, 0.85, true), gunShape(1, 0.2, false), gunShape(2, 1.1, true)];

interface Figure {
  group: THREE.Group;
  /** While too far to cast a visible shadow: the parts that cast one up close. */
  casters: THREE.Object3D[] | null;
  materials: THREE.MeshStandardMaterial[];
  /** The soldier's skinned mesh, culled by a sphere round the body, and where it sits in the figure. */
  body: THREE.SkinnedMesh | null;
  bodyAt: THREE.Matrix4;
  /** Where the last round landed, in the figure's own space, and how bright its flash is. */
  hit: { value: THREE.Vector4 };
  hitAt: THREE.Vector3;
  /** How wet it still is from the rain. */
  soak: Soak;
  /** Its gun's material and a loose round's, wet as it is. */
  gunMats: [THREE.MeshStandardMaterial, THREE.MeshStandardMaterial];
  /** Holds the gun in hand, whose look is swapped on a weapon change or with the suppressor, and its flash. */
  gun: THREE.Group;
  held: THREE.Mesh;
  /** The gun's magazine and its slide or bolt handle, drawn on their own only while they move. */
  magMesh: THREE.Mesh;
  actionMesh: THREE.Mesh;
  /** Where the magazine was when last posed up close, to see it let go; null when it wasn't. */
  lastMag: Parts['mag'] | null;
  torch: Torch;
  flashMesh: THREE.Sprite;
  weapon: number;
  quiet: boolean;
  /** The player it draws. */
  id: number;
  /** Seconds since it died, or -1 while alive, and the game's time it died at. */
  deadFor: number;
  diedAt: number;
  /** How it was last seen: kept to draw its body after it's up again elsewhere. */
  snap: PlayerSnap | null;
  /** How it was killed, from the kill event, until it's seen dead or alive again. */
  death: Death | null;
  /** Where it falls from: its feet, pushed off walls, and the way the death clip faces. */
  fallAt: THREE.Vector3;
  fallYaw: number;
  /** Not yet posed: a body first seen dead lies still at once. */
  fresh: boolean;
  /** Seconds it has been seen dead without word of how it was killed. */
  unexplained: number;
  /** Its ragdoll once it takes over from the death clip, and the bones on it. */
  rag: Ragdoll | null;
  rig: RagRig | null;
  /** The ragdoll's step the bones were last laid on, so a body at rest isn't laid again. */
  rigSteps: number;
  /** The gun falling from its hands. */
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
  /** The climb under way or last made: where it started, the ledge's top and the hand's hold on it, and how far through. */
  climb: Climb | null;
  /** How far crouched it was last seen, 0 to 1. */
  duck: number;
  /** Seconds in the air, and since it last landed. */
  airFor: number;
  landedFor: number;
  /** How much longer its crouched strides are than the clip's, and how far it has gone from the crouch-walk to the low run. */
  crouchStride: number;
  crouchFast: number;
  /** How far it's turned side-on behind a long gun, 0 to 1, smoothed. */
  blade: number;
  /** How far its body is moved up or down to put the head on its hitbox, smoothed. */
  headFix: number;
  /** Seconds since it last fired, and since it was last hit, and whether that was in the head. */
  firedFor: number;
  hitFor: number;
  hitHead: boolean;
  /** Whether it struck below the hips, and the way the round went, in the figure's own space. */
  hitLow: boolean;
  hitDir: THREE.Vector3;
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
  /** The run, played low and bent over with shorter strides, for crouching fast. */
  crouchRun: THREE.AnimationAction;
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
  /** A grenade, shown in the throwing hand, and what the left hand brings to a reload: a magazine or a round. */
  nade: THREE.Object3D;
  fresh: THREE.Mesh;
  round: THREE.Mesh;
  /** Whether it wears an operator's pack, kept out of the ground when it lies on it. */
  pack: boolean;
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
  /** How far the ground under it is above the body's own height, smoothed. */
  rise: number;
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
type Death = Pick<Extract<GameEvent, { k: 'kill' }>, 'pose' | 'at' | 'dir' | 'weapon' | 'head'> & {
  /** The game's time it died at, in seconds, when told. */
  time?: number;
};

/**
 * The game's time that bodies are drawn at, in seconds, and where everyone
 * was at any time near it: all falls step on its clock (see stepAll).
 */
export interface Clock {
  time: number;
  at(time: number): readonly PlayerSnap[];
}

/** Something that shakes bodies lying near: a blast throws them (`force` > 0), a breaking panel lets them fall further. */
interface Knock {
  step: number;
  x: number;
  y: number;
  z: number;
  reach: number;
  force: number;
}

/**
 * A dropped gun: three balls held rigid (grip, muzzle and magazine), the
 * gun's turn when they started and their frame's then, and how far the gun
 * was drawn from where it starts, which fades in the first moments.
 */
interface Drop {
  tumbler: Tumbler;
  turn: THREE.Quaternion;
  frame: THREE.Quaternion;
  offset: THREE.Vector3;
  offsetTurn: THREE.Quaternion;
}

/**
 * A climb onto a ledge: the height it started from, the ledge's top, where
 * the left hand holds its edge, and how far it has got: `rise` 0 to 1 up to
 * the top, then `over` seconds on it, moving onto the ledge.
 */
interface Climb {
  from: number;
  top: number;
  hold: THREE.Vector3;
  rise: number;
  over: number;
}

/** Called for each footfall of a body, with how fast it was moving. */
export type StepListener = (x: number, y: number, z: number, speed: number, crouched: boolean) => void;

export class Bodies {
  onStep: StepListener | null = null;
  /** Whether it's raining and where a roof keeps it off, for how wet everyone is. */
  shelter: Shelter | null = null;
  /** Toward the sun or moon, for which bodies out of view throw a shadow into it. */
  readonly sun = new THREE.Vector3(0, 1, 0);
  private readonly scene: THREE.Scene;
  /** What bodies stand and fall on; another island's when that opens. */
  ground: Ground;
  private readonly figures = new Map<number, Figure>();
  /** Magazines dropped in reloads, lying where they fell. */
  readonly litter: Litter;
  private model: GLTF | null = null;
  /** The soldier's merged geometry for each look: operator, guard and commander. */
  private readonly looks = new Map<string, THREE.BufferGeometry>();
  /**
   * One gone body's material, never freed: three.js frees a shader once no
   * material uses it, and every body has its own, so the next one to come
   * would compile it again, a stall on a cold shader cache.
   */
  private kept: THREE.Material | null = null;
  /** The same for a gun's and a round's. */
  private keptGun: THREE.Material[] | null = null;
  /** How wet each body was as it went, so one drawn again, as a death cam starts or ends, is as wet. */
  private readonly soaked = new Map<number, number>();
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
  /** Bodies left lying after their player was up again elsewhere, or gone, oldest first. */
  private corpses: Figure[] = [];
  /** The time bodies are drawn at, and where everyone was at any time near it. */
  private time = 0;
  private clock: Clock | null = null;
  /** Blasts and breaks to shake bodies with, on the step they happened. */
  private knocks: Knock[] = [];
  /**
   * How each body was killed lately, with when, so one first drawn dead
   * (after leaving a death cam) lies where it fell, and one dying in a death
   * cam falls as it did.
   */
  private readonly deaths = new Map<number, Death[]>();
  private readonly camera = new THREE.Vector3();
  private readonly frustum = new THREE.Frustum();
  private readonly bounds = new THREE.Sphere(new THREE.Vector3(), 1.4);
  private readonly viewProjection = new THREE.Matrix4();

  constructor(scene: THREE.Scene, ground: Ground) {
    this.scene = scene;
    this.ground = ground;
    this.litter = new Litter(scene);
  }

  /** Swap the placeholder figures for animated soldiers carrying `guns`, in WEAPONS order. */
  setModel(gltf: GLTF, guns: GLTF[]): void {
    this.model = gltf;
    GUNS = guns.map((g, i) => {
      const { object, frame, magazinePart, actionPart, ...points } = fitGun(g, i);
      object.updateMatrixWorld(true);
      const parts = (from: THREE.Object3D | null): Part[] => {
        const out: Part[] = [];
        from?.traverse((o) => (o as THREE.Mesh).isMesh && out.push(partOf(o as THREE.Mesh, o.matrixWorld)));
        return out;
      };
      return { ...points, ...gunLooks(parts(frame), parts(magazinePart), parts(actionPart), i, points.muzzle, points.support) };
    });
    this.looks.clear();
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

  /**
   * Drop a magazine of `weapon`'s, placed by `matrix` in the world (from the
   * gun's space), at `velocity`, as wet as `soak`, 0 to 1: as your own
   * reload lets one fall.
   */
  dropMagazine(weapon: number, matrix: THREE.Matrix4, velocity: THREE.Vector3, soak: number): void {
    const gun = GUNS[weapon];
    if (!gun.mag) return;
    const base = gun.magazine;
    const points = [base.clone(), base.clone().addScaledVector(gun.well, -0.08), base.clone().setZ(base.z - 0.03)];
    this.litter.drop(gun.mag, gunMaterial, matrix, points, velocity, soak);
  }

  /**
   * Pose everyone as seen from `camera`; bodies it can't see are skipped.
   * `clock` says the game's time being shown; without one, time runs on by `dt`.
   */
  update(players: readonly PlayerSnap[], dt: number, camera?: THREE.Camera, clock?: Clock): void {
    this.litter.update(dt, this.ground, this.shelter);
    this.time = clock ? clock.time : this.time + dt;
    this.clock = clock ?? null;
    if (camera) {
      this.camera.setFromMatrixPosition(camera.matrixWorld);
      this.viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      this.frustum.setFromProjectionMatrix(this.viewProjection);
    }
    const seen = new Set<number>();
    this.rags = [];
    for (const f of [...this.figures.values(), ...this.corpses]) if (f.rag) this.rags.push(f.rag);
    const posed: [Figure, PlayerSnap][] = [];
    for (const p of players) {
      seen.add(p.id);
      let f = this.figures.get(p.id);
      // Up again elsewhere: the body stays behind a while.
      if (f && !p.dead && f.deadFor >= 0 && f.rag) {
        this.leave(f);
        f = undefined;
      }
      if (!f) {
        f = this.create(p.id, p.team, p.commander);
        this.figures.set(p.id, f);
        f.lastX = p.x;
        f.lastY = p.y;
        f.lastZ = p.z;
        if (p.dead) f.death = this.deathOf(p.id, true);
      }
      posed.push([f, this.pose(f, p, dt)]);
    }
    for (const [id, f] of [...this.figures]) {
      if (seen.has(id)) continue;
      if (f.deadFor >= 0 && f.rag) this.leave(f);
      else this.remove(id);
    }

    this.stepFalls(players);
    // Wet or drying about halfway up, standing or lying.
    for (const f of [...this.figures.values(), ...this.corpses]) f.soak.update(this.shelter, f.lastX, f.lastY + (f.deadFor >= 0 ? 0.3 : 1), f.lastZ, dt);
    for (const [f, p] of posed) this.draw(f, p, dt);
    this.corpses = this.corpses.filter((f, i) => {
      f.deadFor = Math.max(this.time - f.diedAt, 0);
      // Gone once it has lain long enough and nobody sees it go, and it isn't still falling.
      const old = f.deadFor > CORPSE_TIME * 2 || (f.deadFor > CORPSE_TIME && !f.group.visible) || i < this.corpses.length - CORPSES;
      if (old && !this.falling(f)) {
        this.dispose(f);
        return false;
      }
      this.draw(f, f.snap!, dt);
      return true;
    });
  }

  /** How wet the body nearest (x, y, z) is, within `reach` metres, 0 to 1; null if there's none so near. */
  soakNear(x: number, y: number, z: number, reach = 1.5): number | null {
    let best: number | null = null;
    let nearest = reach * reach;
    for (const f of [...this.figures.values(), ...this.corpses]) {
      const d = (f.lastX - x) ** 2 + (f.lastY - y) ** 2 + (f.lastZ - z) ** 2;
      if (d > nearest) continue;
      nearest = d;
      best = f.soak.level.value;
    }
    return best;
  }

  /** Every body goes, and whatever was to shake them: as a death cam starts or ends, or a game. */
  clear(): void {
    this.update([], 0);
    for (const f of this.corpses) this.dispose(f);
    this.corpses = [];
    this.knocks = [];
  }

  /** Whether its body or gun is still on the move. */
  private falling(f: Figure): boolean {
    return !!f.rag && (!f.rag.asleep || (!!f.drop && !f.drop.tumbler.asleep));
  }

  /** Its player is up again elsewhere, or gone: the body lies on its own for a while (see CORPSE_TIME). */
  private leave(f: Figure): void {
    this.figures.delete(f.id);
    this.corpses.push(f);
  }

  /**
   * Flash a body where a round landed, at (x, y, z) in the world, and make it
   * flinch away from `from`, where the round came from (or from in front).
   */
  flash(id: number, x: number, y: number, z: number, from?: THREE.Vector3): void {
    const f = this.figures.get(id);
    if (!f) return;
    f.flash = FLASH_TIME;
    f.group.updateMatrixWorld(true);
    f.group.worldToLocal(f.hitAt.set(x, y, z));
    f.hitFor = 0;
    const box = hitboxes({ x: 0, y: f.lastY, z: 0, yaw: 0, duck: f.duck, lean: 0 });
    f.hitHead = y > f.lastY + PLAYER_HEIGHT * 0.5 && y > box.neckY;
    f.hitLow = y < box.hipY;
    // The way the round went, in the body's own space.
    if (from) f.hitDir.set(x - from.x, y - from.y, z - from.z).transformDirection(M_A.copy(f.group.matrixWorld).invert());
    else f.hitDir.set(0, 0, 1);
    f.hitDir.normalize();
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

  /** Someone was killed at `time`, the game's: they fall from where the event says, pushed the way the round went. */
  killed(e: Death & { victim: number }, time = this.time): void {
    const death = { pose: e.pose, at: e.at, dir: e.dir, weapon: e.weapon, head: e.head, time };
    // Kept a while, even once they're up again: a death cam shows them dying again.
    const list = (this.deaths.get(e.victim) ?? []).filter((d) => d.time! > time - DEATH_KEEP);
    list.push(death);
    this.deaths.set(e.victim, list);
    const f = this.figures.get(e.victim);
    if (f) f.death = death;
  }

  /** A new game: nobody's deaths carry over, and the dropped magazines are cleared away. */
  forget(): void {
    this.deaths.clear();
    this.soaked.clear();
    this.litter.clear();
  }

  /** Something broke near (x, y, z) at `time`, the game's: the dead lying against it may fall further. */
  shake(x: number, y: number, z: number, reach: number, time = this.time): void {
    this.knocks.push({ step: stepOf(time), x, y, z, reach, force: 0 });
  }

  /** A grenade went off at (x, y, z) at `time`, the game's: it throws the dead lying near in the open. */
  blast(x: number, y: number, z: number, time = this.time): void {
    this.knocks.push({ step: stepOf(time), x, y, z, reach: GRENADE_RADIUS, force: BLAST_DOWN });
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
    this.dispose(f);
    this.figures.delete(id);
  }

  private dispose(f: Figure): void {
    this.scene.remove(f.group, f.gun);
    if (this.shelter?.raining) this.soaked.set(f.id, f.soak.level.value);
    for (const m of f.materials) {
      if (!this.kept && f.soldier) this.kept = m;
      else m.dispose();
    }
    if (!this.keptGun) this.keptGun = f.gunMats;
    else for (const m of f.gunMats) m.dispose();
    f.soldier?.mixer.stopAllAction();
  }

  private create(id: number, team: Team, commander: boolean): Figure {
    const group = new THREE.Group();
    const gun = new THREE.Group();
    const soak = new Soak();
    const was = this.soaked.get(id);
    if (was !== undefined) soak.begin(was);
    const gunMats: Figure['gunMats'] = [gunMaterial(soak.level), roundMaterial(soak.level)];
    const held = new THREE.Mesh(GUNS[0].looks[0], gunMats[0]);
    gun.add(held);
    const [magMesh, actionMesh] = [0, 1].map(() => {
      const m = new THREE.Mesh(undefined, gunMats[0]);
      m.matrixAutoUpdate = false;
      m.visible = false;
      gun.add(m);
      return m;
    });
    const torch = makeTorch(null);
    mountTorch(torch, GUNS[0].torch);
    gun.add(torch.object);
    const flashMesh = new THREE.Sprite(FLASH_MAT);
    flashMesh.scale.setScalar(0.45);
    flashMesh.visible = false;
    gun.add(flashMesh);
    group.add(gun);
    this.scene.add(group);
    const f: Figure = {
      group, materials: [], body: null, bodyAt: new THREE.Matrix4(), hit: { value: new THREE.Vector4() }, hitAt: new THREE.Vector3(), soak, gunMats,
      gun, held, magMesh, actionMesh, lastMag: null, torch, flashMesh, weapon: 0, quiet: false,
      id, deadFor: -1, diedAt: 0, snap: null, death: null, fallAt: new THREE.Vector3(), fallYaw: 0, fresh: true, unexplained: 0, rag: null, rig: null, rigSteps: -1, drop: null,
      flash: 0, muzzle: 0, lastX: 0, lastY: 0, lastZ: 0, speed: 0, vy: 0, heading: 0, stride: 0,
      air: 0, mantle: 0, climb: null, airFor: 0, landedFor: LAND_TIME, crouchStride: 1, crouchFast: 0, blade: 1, headFix: 0, duck: 0,
      firedFor: 1e3, hitFor: 1e3, hitHead: false, hitLow: false, hitDir: new THREE.Vector3(0, 0, 1), soldier: null, casters: null,
      // Far off, bodies take turns to be posed rather than all in one frame.
      wait: Math.random() * FAR_UPDATE,
    };
    if (this.model) f.soldier = this.soldier(f, id, team, commander);
    else this.placeholder(f, team);
    for (const m of f.materials) {
      flashWhereHit(m, f.hit);
      dimIndoors(m);
      wetMaterial(m, { gloss: 0.5, soak: f.soak.level });
    }
    group.traverse((o) => {
      o.layers.enable(REFLECTED);
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh && mesh !== torch.lens) mesh.castShadow = mesh.receiveShadow = true;
    });
    return f;
  }

  private placeholder(f: Figure, team: Team): void {
    f.materials = [HEAD, TORSO[team], LEGS[team]].map((color) => new THREE.MeshStandardMaterial({ color, roughness: 0.8 }));
    const [head, torso, legs] = [sphere, cylinder, cylinder].map((geo, i) => {
      const mesh = new THREE.Mesh(geo, f.materials[i]);
      f.group.add(mesh);
      return mesh;
    });
    Object.assign(f, { head, torso, legs });
  }

  private soldier(f: Figure, id: number, team: Team, commander: boolean): Soldier {
    const gltf = this.model!;
    const model = SkeletonUtils.clone(gltf.scene);
    model.scale.setScalar(this.modelScale);
    // The model faces +z; bodies face -z.
    const turned = new THREE.Group();
    turned.rotation.y = Math.PI;
    turned.add(model);
    f.group.add(turned);
    f.group.updateMatrixWorld(true);

    // Its meshes and kit drawn as the first mesh, in its own material for the hit flash.
    const bones = findBones(model);
    const meshes: THREE.SkinnedMesh[] = [];
    model.traverse((o) => (o as THREE.SkinnedMesh).isSkinnedMesh && meshes.push(o as THREE.SkinnedMesh));
    const key = commander ? 'commander' : team;
    let geometry = this.looks.get(key);
    if (!geometry) this.looks.set(key, (geometry = look(meshes, bones, f.group, team, commander)));
    const body = meshes[0];
    for (const m of meshes.slice(1)) m.removeFromParent();
    body.geometry = geometry;
    const material = vertexSurfaces(new THREE.MeshStandardMaterial());
    body.material = material;
    f.materials.push(material);
    // Culled by a sphere round the body, set as it's posed.
    body.boundingSphere = new THREE.Sphere();
    f.body = body;
    f.bodyAt.copy(f.group.matrixWorld).invert().multiply(body.matrixWorld);

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
    // Its own copy of the run, so it plays at its own pace and weight.
    const crouchRun = mixer.clipAction(clip(gltf.animations, 'Run').clone());
    crouchRun.weight = 0;
    crouchRun.play();
    const jump = action('JumpStart', true);
    const airborne = action('JumpLoop');
    const land = action('JumpLand', true);
    const death = action('Death', true);
    idle.weight = 1;
    // Start everyone at a different point in their stride, the same each time for the same body.
    const phase = (id * 0.618034) % 1;
    for (const a of [walk, run, crouchWalk, crouchRun, idle, crouchIdle]) a.time = phase * a.getClip().duration;

    const hands: [Hand, Hand] = [findHand(model, 'L'), findHand(model, 'R')];
    const nade = grenadeModel();
    nade.visible = false;
    f.group.add(nade);
    const fresh = new THREE.Mesh(undefined, f.gunMats[0]);
    fresh.matrixAutoUpdate = false;
    const round = new THREE.Mesh(ROUND_GEO, f.gunMats[1]);
    for (const m of [fresh, round]) {
      m.visible = false;
      f.group.add(m);
    }
    const pack = team === 'operator';
    const animated = Object.values(bones).map((bone) => ({ bone, position: bone.position.clone(), quaternion: bone.quaternion.clone() }));
    const r = this.reactions!;
    const foothold = (): Foothold => ({ at: null, offset: new THREE.Vector3(), last: new THREE.Vector3(), rise: 0 });
    return {
      mixer, idle, walk, run, crouchIdle, crouchWalk, crouchRun, jump, airborne, land, death, bones, hands, nade, fresh, round, pack, animated,
      reacting: [r.shot, r.hit, r.hitHead].map((reaction) => reaction.bones(model)),
      feet: [foothold(), foothold()],
      arm: span(bones.rArm, bones.rForeArm), forearm: span(bones.rForeArm, bones.rHand),
      thigh: span(bones.rUpLeg, bones.rLeg), shin: span(bones.rLeg, bones.rAnkle),
    };
  }

  /**
   * How `id` was last killed by now, at most a moment later (the event can
   * come before the snapshot); only if lately unless `any`.
   */
  private deathOf(id: number, any: boolean): Death | null {
    const list = this.deaths.get(id) ?? [];
    for (let i = list.length - 1; i >= 0; i--) {
      const t = list[i].time!;
      if (t > this.time + DEATH_AHEAD) continue;
      return any || t > this.time - DEATH_WAIT - 1 ? list[i] : null;
    }
    return null;
  }

  /** Take in how it's seen now, and returns that as it's to be drawn. */
  private pose(f: Figure, p: PlayerSnap, dt: number): PlayerSnap {
    // Just seen dead: how it was killed, told by now (always so in a death cam, which replays no kill events).
    if (p.dead && f.deadFor < 0 && !f.death) f.death = this.deathOf(p.id, false);
    // Seen dead before the kill event came: a moment on its feet, waiting for it.
    if (p.dead && f.deadFor < 0 && !f.death && !f.fresh && f.soldier && f.unexplained < DEATH_WAIT) {
      f.unexplained += dt;
      p = { ...p, dead: false };
    } else f.unexplained = 0;
    if (f.weapon !== p.weapon || f.quiet !== p.quiet) {
      f.weapon = p.weapon;
      f.quiet = p.quiet;
      f.held.geometry = GUNS[p.weapon].looks[p.quiet ? 1 : 0];
      mountTorch(f.torch, GUNS[p.weapon].torch);
    }
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
      f.blade += ((p.weapon === PISTOL ? 0 : 1) - f.blade) * k;
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
    this.climbing(f, p, dt);
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
    // Timed from the kill event when there is one, so a death cam's bodies fall on the same steps as the game's.
    if (died) f.diedAt = Math.min(f.death?.time ?? this.time, this.time);
    f.deadFor = p.dead ? Math.max(this.time - f.diedAt, 0) : -1;
    if (died && f.soldier) this.fall(f, p);
    if (revived) {
      f.death = null;
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
      if (died && f.fresh) this.settle(f);
      else if (f.deadFor >= HANDOFF && !f.rag) this.goLimp(f);
    }
    f.fresh = false;
    f.snap = p;
    return p;
  }

  /** Draw it as posed, its fall stepped up to now. */
  private draw(f: Figure, p: PlayerSnap, dt: number): void {
    // Out of sight with no shadow or beam of its own in view, or lost in the fog: not drawn.
    const bounds = this.bounds;
    if (f.rag) bounds.set(V_TMP.set(f.rag.bounds.x, f.rag.bounds.y, f.rag.bounds.z), Math.max(BODY_RADIUS, f.rag.bounds.r + 0.3));
    else bounds.set(V_TMP.set(p.x, p.y + 0.9, p.z), BODY_RADIUS);
    const distance = this.camera.distanceTo(bounds.center);
    // Beyond the cascades, a body's shadow is too small to see but costs a draw in each shadow map.
    const shadow = distance < SHADOW_REACH;
    f.group.visible = (distance < FOG_END && this.frustum.intersectsSphere(bounds)) ||
      (shadow && this.shadowInView(bounds)) || (p.light && !p.dead && distance < LIGHT_REACH);
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
    if (f.body) {
      // Each pass culls the body by its sphere, in the skinned mesh's own space.
      f.group.updateMatrix();
      const toBody = M_A.multiplyMatrices(f.group.matrix, f.bodyAt).invert();
      f.body.boundingSphere!.copy(bounds).applyMatrix4(toBody);
    }

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
   * Keep track of a climb: when one starts, find the ledge's top ahead (the
   * snapshots don't say) and where the hand holds its edge, and then how far
   * up it the body has risen, and how long it has been on top.
   */
  private climbing(f: Figure, p: PlayerSnap, dt: number): void {
    if (p.motion === 'mantle' && !p.dead) {
      if (!f.climb || f.climb.over > 0 && p.y < f.climb.top - 0.3) {
        const from = f.lastY;
        const fx = -Math.sin(p.yaw);
        const fz = -Math.cos(p.yaw);
        const x = p.x + fx * CLIMB_REACH;
        const z = p.z + fz * CLIMB_REACH;
        let top = this.ground.groundHeight(x, z, from + CLIMB_HIGHEST);
        if (top < from + 0.2) top = from + 1;
        // The left hand on the edge, a little to the left.
        const hold = new THREE.Vector3(x + fz * 0.2 - fx * 0.05, top, z - fx * 0.2 - fz * 0.05);
        f.climb = { from, top, hold, rise: 0, over: 0 };
      }
      const c = f.climb;
      c.rise = clamp((p.y - c.from) / Math.max(c.top - c.from, 0.1), 0, 1);
      if (p.y >= c.top - 0.01) c.over += dt;
    } else if (f.climb && f.mantle < 0.01) f.climb = null;
  }

  /** Whether the shadow a body in `bounds` throws, away from the sun, may fall in view. */
  private shadowInView(bounds: THREE.Sphere): boolean {
    // A standing body's head is 2 m up; its shadow runs from its feet, 2 m over the sun's height, away from it.
    const reach = Math.min(2 / Math.max(this.sun.y, 0.05), SHADOW_LENGTH) / 2;
    SHADOW_SPHERE.center.copy(bounds.center).addScaledVector(this.sun, -reach);
    SHADOW_SPHERE.radius = bounds.radius + reach;
    return this.frustum.intersectsSphere(SHADOW_SPHERE);
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

    // The gun falls from about where the hands held it, facing ahead and rolling out of them (upright, it
    // could land balanced on its edge); it's drawn from where it really was, easing onto its fall.
    this.showParts(f, AT_REST);
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
    tumbler.start = stepOf(f.diedAt);
    tumbler.owner = f.id;
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
    f.drop = { tumbler, turn, frame, offset, offsetTurn };
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
    rag.start = stepOf(f.diedAt + HANDOFF);
    rag.owner = f.id;
    f.rag = rag;
    f.rig = new RagRig(f.soldier!.bones, rag, s, f.group);
    f.rigSteps = -1;
  }

  /** First seen dead, as after a death cam: already lying where it came to rest. */
  private settle(f: Figure): void {
    f.diedAt = this.time - HANDOFF;
    this.goLimp(f);
    const rag = f.rag!;
    const tumbler = f.drop?.tumbler;
    while (!rag.asleep) rag.step(this.ground, this.rags);
    while (tumbler && !tumbler.asleep) tumbler.step(this.ground, this.rags.filter((r) => r !== rag));
    // It lay down in no time: its clock starts now.
    for (const v of [rag, tumbler]) if (v) (v.start = stepOf(this.time)), (v.ticks = 0);
    f.diedAt = this.time - HANDOFF - rag.steps * RAGDOLL_STEP;
    f.deadFor = this.time - f.diedAt;
    this.rags.push(rag);
  }

  /**
   * Step every body and dropped gun up to now on the game's clock, all
   * together, onto the ground, the dead and the living, shaken by what
   * blew up or broke near them on the step it did.
   */
  private stepFalls(players: readonly PlayerSnap[]): void {
    const falls: Verlet[] = [];
    for (const f of [...this.figures.values(), ...this.corpses]) {
      if (f.rag) falls.push(f.rag);
      if (f.drop) falls.push(f.drop.tumbler);
    }
    // The same order in a death cam as in the game: by when they started, whose they are, the body before the gun.
    falls.sort((a, b) => a.start - b.start || a.owner - b.owner || b.n - a.n);
    const due = stepOf(this.time);
    const clock = this.clock;
    const crowd = (step: number): Living[] => {
      const out: Living[] = [];
      for (const p of clock ? clock.at(step * RAGDOLL_STEP) : players) {
        if (p.dead) continue;
        const top = p.y + hitboxes({ x: 0, y: 0, z: 0, yaw: 0, duck: p.duck, lean: 0 }).neckY;
        out.push({ x: p.x, z: p.z, bottom: p.y + LIVING_RADIUS, top, r: LIVING_RADIUS });
      }
      return out;
    };
    const knock = (step: number): void => {
      for (const k of this.knocks) if (k.step <= step) this.knock(k, falls);
      this.knocks = this.knocks.filter((k) => k.step > step);
    };
    if (falls.length) stepAll(falls, due, this.ground, this.rags, crowd, knock);
    // Nothing lying to shake by now.
    this.knocks = this.knocks.filter((k) => k.step >= due);
  }

  /** Wake the falls near a knock, throwing them away from a blast that can reach them. */
  private knock(k: Knock, falls: readonly Verlet[]): void {
    for (const v of falls) {
      const b = v.bounds;
      const d = Math.hypot(b.x - k.x, b.y - k.y, b.z - k.z);
      // Those that started falling since were thrown by it already, if at all.
      if (d > k.reach + b.r || v.start >= k.step) continue;
      if (k.force > 0) {
        // Walls and cover shield it.
        const dx = b.x - k.x;
        const dy = b.y - k.y;
        const dz = b.z - k.z;
        if (d > 0.3 && this.ground.raycast(k.x, k.y + 0.2, k.z, dx / d, (dy - 0.2) / d, dz / d, d) < d - b.r) continue;
        for (let i = 0; i < v.n; i++) {
          const x = v.pos[i * 3] - k.x;
          const y = v.pos[i * 3 + 1] - k.y;
          const z = v.pos[i * 3 + 2] - k.z;
          const r = Math.hypot(x, y, z) || 1;
          const s = k.force * Math.max(1 - r / k.reach, 0);
          v.push(i, (x / r) * s, Math.max(y / r, 0) * s + s * BLAST_DOWN_LIFT, (z / r) * s);
        }
      }
      v.wake();
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
      // A body that died out of sight never played its death clip, which lets go of the gun.
      if (f.rigSteps < 0) for (const hand of s.hands) curl(hand, 0.3);
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
    // Crouched and fast, the crouch-walk (a slow sneak) gives way to the run, played low.
    const fast = smoothstep(CROUCH_FAST[0], CROUCH_FAST[1], speed);
    f.crouchFast = fast;
    s.crouchWalk.weight = alive * ground * duck * moving * (1 - fast);
    s.crouchRun.weight = alive * ground * duck * moving * fast;
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
    // The crouch-walk clip is a slow sneak: faster, its strides lengthen a little and its pace quickens,
    // until the low run takes over, its strides shortened.
    f.crouchStride = clamp(speed / (this.gait.crouch * 2), 1, CROUCH_STRIDE);
    s.crouchWalk.timeScale = sign * clamp(speed / (this.gait.crouch * f.crouchStride), 0.6, 2.4);
    s.crouchRun.timeScale = sign * clamp(speed / (this.gait.run * CROUCH_RUN_STRIDE), 0.5, 1.5);
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
    s.fresh.visible = s.round.visible = false;
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
    // Running crouched, low and bent over: the head's put on its hitbox below, the legs bend to the feet.
    const low = f.crouchFast * duck * moving;
    if (low > 0.01) {
      // Tipped over at the hips, which go back to keep the head over the feet.
      rotateWorld(b.body, right, -CROUCH_RUN_BEND * low);
      moveWorld(b.body, V_TMP2.set(0, -CROUCH_RUN_DROP * low, 0).addScaledVector(forward, -CROUCH_RUN_BACK * low));
    }
    // Side-on behind a long gun, as a rifleman stands, the left shoulder forward and the head turned back to the aim;
    // square on to climb.
    const blade = BLADE * f.blade * (1 - f.mantle);
    if (blade > 1e-3) {
      rotateWorld(b.torso, up, -blade * 0.4);
      rotateWorld(b.spine2, up, -blade * 0.6);
      rotateWorld(b.neck, up, blade);
    }
    // Bent forward climbing; aiming, the chest and head follow the pitch.
    const over = f.climb ? Math.sin(Math.PI * clamp(f.climb.rise * 0.7 + smoothstep(0, CLIMB_OVER, f.climb.over) * 0.3, 0, 1)) : 1;
    rotateWorld(b.spine, right, -lerp(0.2, 0.7, over) * f.mantle);
    rotateWorld(b.spine2, right, p.pitch * 0.5);
    rotateWorld(b.neck, right, p.pitch * 0.35);
    this.headOnHitbox(f, s, p, step, right, forward, near);
    this.react(f, s, forward, right);
    // Far off the legs keep the clips' pose, unless the hips were dropped for a low run.
    if (near || low > 0.01) this.legs(f, s, legYaw, step, low);
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
    // First the whole body, feet and all, steps back or forward under the head, as a crouch sits back on its heels,
    // so the back isn't arched to fetch it; climbing keeps its lean.
    if (near) {
      const ahead = this.headAt(s, V_TMP3).sub(origin).dot(forward);
      const back = clamp(-ahead, -ROOT_SHIFT, ROOT_SHIFT) * (1 - f.mantle);
      if (Math.abs(back) > 1e-3) moveWorld(s.bones.root, V_TMP2.copy(forward).multiplyScalar(back));
    }
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

  /**
   * A shot's recoil and a hit's flinch, over the upper body. Each gun kicks
   * its own way: the rifle a short shove at the shoulder, the pistol little
   * but in the arms (see arms), the bolt-action a heavy one that turns the
   * right shoulder back. A hit knocks the chest, or the head, the way the
   * round went, twists the body about the side it struck, and buckles the
   * knees when it struck the legs; the model's own flinch plays under it.
   */
  private react(f: Figure, s: Soldier, forward: THREE.Vector3, right: THREE.Vector3): void {
    const r = this.reactions!;
    const b = s.bones;
    const kick = SHOT_KICK[f.weapon] ?? SHOT_KICK[0];
    r.shot.apply(s.reacting[0], f.firedFor, kick.clip);
    const shove = pulse(f.firedFor, kick.time);
    if (shove > 0.01) {
      rotateWorld(b.spine2, right, kick.back * shove);
      rotateWorld(b.spine2, V_UP, -kick.turn * shove);
    }
    if (f.hitFor < REACT_TIME) {
      r[f.hitHead ? 'hitHead' : 'hit'].apply(s.reacting[f.hitHead ? 2 : 1], f.hitFor, f.hitHead ? 0.4 : 0.6);
      const k = pulse(f.hitFor, 0.08);
      const d = V_TMP2.copy(f.hitDir).applyQuaternion(f.group.quaternion);
      // Toward its back when struck from in front, which bends it back; out to a side, which rolls it that way.
      const back = -d.dot(forward);
      const side = d.dot(right);
      // Struck off its middle, it turns: by the round's push about the spine, from where it struck.
      const off = V_TMP3.copy(f.hitAt).setY(0).applyQuaternion(f.group.quaternion);
      const twist = clamp(V_TMP4.crossVectors(off, d).y / 0.15, -1, 1);
      const bone = f.hitHead ? b.neck : b.spine2;
      const strength = f.hitHead ? 0.55 : f.hitLow ? 0.15 : 0.3;
      rotateWorld(bone, right, back * strength * k);
      rotateWorld(bone, forward, side * strength * 0.8 * k);
      rotateWorld(b.spine, V_UP, twist * (f.hitLow ? 0.08 : 0.35) * k);
      if (f.hitLow) moveWorld(b.body, V_TMP4.set(0, -0.1 * k, 0));
    }
    if (f.firedFor < r.shot.duration || f.hitFor < REACT_TIME) f.group.updateMatrixWorld(true);
  }

  /**
   * Where the feet go. The clips place them; crouched at speed, strides
   * lengthen, and a climb has its own stance. A foot on the ground stays
   * where it landed until the clip lifts it, so it doesn't slide, and it's
   * lifted or lowered onto the ground under it, turned at the ankle to lie
   * along a slope. If a foot is then out of reach, the hips drop to it. The
   * legs then bend to reach them.
   */
  private legs(f: Figure, s: Soldier, legYaw: number, step: number, low: number): void {
    const b = s.bones;
    const origin = f.group.position;
    const forward = V_TMP4.set(0, 0, -1).applyQuaternion(f.group.quaternion).applyAxisAngle(V_UP, legYaw);
    const right = V_TMP5.crossVectors(forward, V_UP);
    const stride = lerp(1, lerp(f.crouchStride, CROUCH_RUN_STRIDE, f.crouchFast), f.duck);
    const grounded = f.air < 0.1 && f.mantle < 0.1;
    // How much the ground under each foot counts: not in the air or climbing.
    const onGround = (1 - f.air) * (1 - f.mantle);
    const legs = [[b.lUpLeg, b.lLeg, b.lAnkle, b.lFoot], [b.rUpLeg, b.rLeg, b.rAnkle, b.rFoot]] as const;
    const targets = legs.map(([, , , foot], i) => {
      const left = i === 0;
      const at = foot.getWorldPosition(V_TMP3).sub(origin);
      // In the legs' frame: x right, y up, z forward.
      let x = at.dot(right);
      // Running low, the feet lift less, or the run's kick behind would reach the lowered hips.
      let y = at.dot(V_UP);
      if (y > FOOT_REST) y = FOOT_REST + (y - FOOT_REST) * lerp(1, CROUCH_RUN_LIFT, low);
      let z = at.dot(forward) * stride;
      // Crouched still, a foot the body's step left behind the legs' hitbox is drawn in under it.
      const tuck = f.duck * (1 - smoothstep(0.3, 1.2, f.speed));
      if (z < -FOOT_TUCK) z = lerp(z, -FOOT_TUCK, tuck);
      // Climbing: the right knee comes up onto the ledge while the left foot pushes off below, then follows.
      if (f.climb && f.mantle > 0.01) {
        const c = f.climb;
        const ledge = c.top - origin.y;
        const ground = c.from - origin.y;
        const up = smoothstep(0.25, 0.85, c.rise);
        const after = smoothstep(0, CLIMB_OVER, c.over);
        const climb = left
          ? [-0.12, lerp(lerp(ground, ground + 0.25, smoothstep(0.55, 1, c.rise)), 0.05, after), lerp(-0.1, 0, after)]
          : [0.12, lerp(lerp(0.1, ledge + 0.08, up), 0.02, after), lerp(lerp(0.05, 0.4, up), 0.1, after)];
        x = lerp(x, climb[0], f.mantle);
        y = lerp(y, climb[1], f.mantle);
        z = lerp(z, climb[2], f.mantle);
      }
      const target = new THREE.Vector3().copy(origin).addScaledVector(right, x).addScaledVector(V_UP, y).addScaledVector(forward, z);

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
      // Onto the ground under it, which the body's own height was taken over.
      if (onGround > 0.01) {
        const rise = this.footRise(target.x, target.z, origin.y);
        hold.rise += (rise - hold.rise) * (1 - Math.exp(-25 * step));
        target.y += hold.rise * onGround;
      }
      return target;
    });

    // A foot below the legs' reach brings the hips down to it, on the ground.
    const length = (s.thigh + s.shin) * 0.97;
    let drop = 0;
    legs.forEach(([thigh], i) => {
      drop = Math.max(drop, thigh.getWorldPosition(V_TMP2).distanceTo(targets[i]) - length);
    });
    if (drop > 1e-3 && onGround > 0.5) moveWorld(b.body, V_TMP2.set(0, -Math.min(drop, FOOT_DROP) * onGround, 0));

    legs.forEach(([thigh, shin, ankle, foot], i) => {
      // Still out of reach, as a climber's trailing foot: as near as the leg goes, so the boot isn't stretched.
      const target = targets[i];
      const hip = thigh.getWorldPosition(V_TMP2);
      const d = hip.distanceTo(target);
      if (d > length) target.sub(hip).multiplyScalar(length / d).add(hip);
      placeWorld(foot, target);
      // Along the slope: turned about the level line across it, as far as an ankle goes.
      if (onGround > 0.01) {
        const n = this.groundNormal(target.x, target.z, origin.y, V_TMP6);
        const tilt = Math.min(Math.acos(clamp(n.y, -1, 1)), ANKLE_TURN) * onGround;
        if (tilt > 0.01) rotateWorld(foot, V_TMP7.crossVectors(V_UP, n).normalize(), tilt);
      }
      // Knees out front.
      const pole = thigh.getWorldPosition(V_TMP2).addScaledVector(forward, 1);
      reach(thigh, shin, ankle, target, pole, s.thigh, s.shin);
    });
  }

  /** How far the ground at (x, z) is above `y`, the body's own height, within a step either way. */
  private footRise(x: number, z: number, y: number): number {
    return clamp(this.ground.groundHeight(x, z, y + FOOT_REACH) - y, -FOOT_REACH, FOOT_REACH);
  }

  /** The ground's slope at (x, z), near `y`, from the heights a little way either side. */
  private groundNormal(x: number, z: number, y: number, out: THREE.Vector3): THREE.Vector3 {
    const d = 0.12;
    const dx = this.footRise(x + d, z, y) - this.footRise(x - d, z, y);
    const dz = this.footRise(x, z + d, y) - this.footRise(x, z - d, y);
    return out.set(-dx, 2 * d, -dz).normalize();
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

    // The sight line runs just under the eye, a long gun's butt against the front of the shoulder, the pistol held
    // out at arm's length.
    const gun = GUNS[f.weapon];
    f.gun.position.set(shoulder.x - 0.1, shoulder.y + 0.06 - low * 0.12, shoulder.z);
    f.gun.rotation.set(lerp(p.pitch, -0.9, low) - reload * 0.3 + kick * 0.12, low * 0.5 * (1 - draw), tip, 'YXZ');
    f.gun.translateZ((pistol ? -0.5 : -(gun.butt + SHOULDER_POCKET)) + kick * 0.04);
    f.gun.translateX(pistol ? -0.08 : 0);
    if (!near) {
      this.showParts(f, AT_REST);
      f.lastMag = null;
      return;
    }

    f.gun.updateMatrixWorld(true);
    const gunForward = V_TMP7.set(0, 0, -1).transformDirection(f.gun.matrixWorld);
    const armReach = (s.arm + s.forearm) * ARM_STRETCH;
    if (pistol) {
      // Arm's length is the arms': drawn in until both wrists, just behind the grip, are within it.
      for (let i = 0; i < 2; i++) {
        const wrist = toGrip(f.gun, gun.grip, gunForward, V_TMP6);
        const over = Math.max(
          b.rArm.getWorldPosition(V_TMP11).distanceTo(wrist), b.lArm.getWorldPosition(V_TMP11).distanceTo(wrist),
        ) - armReach;
        if (over <= 0) break;
        f.gun.translateZ(Math.min(over * 1.2, 0.3));
        f.gun.updateMatrixWorld(true);
      }
    }
    const gunRight = V_TMP6.set(1, 0, 0).transformDirection(f.gun.matrixWorld);
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
    let parts: Parts = p.act === 'none' ? shotParts(f.weapon, f.firedFor) : AT_REST;
    if (p.act === 'reload') {
      const pouch = body(-0.14, 0.95 - p.duck * 0.45, 0.1);
      const work = reloadHands(f.weapon, t, p.rounds ?? SOME_ROUNDS, gun, toWorld, { left: support, right: grip }, pouch, gunBack);
      leftAt = work.left;
      rightAt = work.right;
      rightAway = work.rightAway;
      holding = work.holding;
      parts = work.parts;
    } else if (f.weapon === BOLT && p.act === 'none') {
      const c = (f.firedFor - BOLT_START) / BOLT_TIME;
      if (c > 0 && c < 1) {
        const work = boltHand(c, gun, toWorld, grip);
        rightAt = work.at;
        rightAway = work.away;
        parts = work.parts;
      }
    }
    this.showParts(f, parts);
    // The magazine let go of: it falls from where it was, in the gun or in the hand.
    const was = f.lastMag;
    f.lastMag = parts.mag;
    if (parts.mag === 'gone' && was !== null && was !== 'gone' && gun.mag) {
      const from = was === 'hand' ? this.inHand(f, gun, leftAt, M_B) : M_B.multiplyMatrices(f.gun.matrixWorld, magazineMatrix(gun, was, M_C));
      const heading = p.yaw + f.heading;
      const velocity = V_TMP.set(-Math.sin(heading) * f.speed, -0.5, -Math.cos(heading) * f.speed);
      this.dropMagazine(f.weapon, from, velocity, f.soak.level.value);
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
      // Palm down on the ledge's edge, where it took hold, pulling and then pushing up.
      target = target.clone().lerp(f.climb ? f.climb.hold.clone().setY(f.climb.top + 0.03) : body(-0.2, 1.05, -0.4), climbing);
      along = V_TMP3.copy(forward);
      thumb = V_TMP4.copy(right);
    }
    wristFor('L', target, along, thumb, wrist);
    if (target === support && !pistol) {
      // A fore-end beyond the left arm's reach is held nearer the magazine well, no further back than it.
      let slid = 0;
      const most = Math.max(gun.magazine.z - gun.support.z, 0);
      for (let i = 0; i < 3 && slid < most; i++) {
        const over = b.lArm.getWorldPosition(V_TMP11).distanceTo(wrist) - armReach;
        if (over <= 0) break;
        const back = Math.min(over * 1.2, most - slid);
        slid += back;
        wrist.addScaledVector(gunBack, back);
      }
      if (slid > 0) target = support.clone().addScaledVector(gunBack, slid);
    }
    pole.copy(right).multiplyScalar(-0.6).addScaledVector(up, -0.8).add(wrist);
    reach(b.lArm, b.lForeArm, b.lHand, wrist, pole, s.arm, s.forearm);
    orientHand(s.hands[0], along, thumb);
    curl(s.hands[0], p.act === 'none' || p.act === 'draw' ? closed : 0.8);

    // A fresh magazine sits in the left hand as it would in the gun; a round or a grenade in its fingers.
    if (holding === 'magazine' && gun.mag) {
      s.fresh.geometry = gun.mag;
      s.fresh.matrix.copy(f.group.matrixWorld).invert().multiply(this.inHand(f, gun, target, M_B));
      s.fresh.matrixWorldNeedsUpdate = true;
      s.fresh.visible = true;
    }
    s.round.visible = holding === 'round';
    const carried = s.nade.visible ? s.nade : s.round.visible ? s.round : null;
    if (carried) {
      if (carried === s.round) s.round.quaternion.copy(f.gun.quaternion).premultiply(Q_A.copy(f.group.quaternion).invert());
      const hand = s.hands[0];
      hand.wrist.updateMatrixWorld(true);
      carried.position.copy(hand.wrist.localToWorld(V_TMP.copy(hand.knuckles).multiplyScalar(0.8)));
      f.group.worldToLocal(carried.position);
    }
  }

  /** Where a magazine held in the left hand at `at` is, as a matrix from the gun's space: its base in the palm, as upright as the gun. */
  private inHand(f: Figure, gun: GunShape, at: THREE.Vector3, out: THREE.Matrix4): THREE.Matrix4 {
    out.extractRotation(f.gun.matrixWorld).setPosition(at);
    return out.multiply(M_C.makeTranslation(-gun.magazine.x, -gun.magazine.y, -gun.magazine.z));
  }

  /** Draw the gun whole, or its frame with its moving parts where `parts` puts them. */
  private showParts(f: Figure, parts: Readonly<Parts>): void {
    const gun = GUNS[f.weapon];
    const moved = parts.mag !== 0 || parts.back !== 0 || parts.lift !== 0;
    f.held.geometry = (moved ? gun.frames : gun.looks)[f.quiet ? 1 : 0];
    f.magMesh.visible = moved && typeof parts.mag === 'number' && !!gun.mag;
    if (f.magMesh.visible) {
      f.magMesh.geometry = gun.mag!;
      magazineMatrix(gun, parts.mag as number, f.magMesh.matrix);
      f.magMesh.matrixWorldNeedsUpdate = true;
    }
    f.actionMesh.visible = moved && !!gun.action;
    if (f.actionMesh.visible) {
      f.actionMesh.geometry = gun.action!;
      actionMatrix(gun, parts, f.actionMesh.matrix);
      f.actionMesh.matrixWorldNeedsUpdate = true;
    }
  }
}

/**
 * How far ahead of a climber its hand takes hold of the ledge, the highest
 * ledge looked for over where it started, and how long it takes to get its
 * feet on top once it's up.
 */
const CLIMB_REACH = PLAYER_RADIUS + MANTLE_REACH;
const CLIMB_HIGHEST = 1.6;
const CLIMB_OVER = 0.25;

/** How long a hit's flinch lasts. */
const REACT_TIME = 0.6;

/** How far in front of the shoulder joint a long gun's butt sits, in its pocket. */
const SHOULDER_POCKET = 0.07;
/** How much of an arm's full length the hands reach to, so the elbows stay a little bent. */
const ARM_STRETCH = 0.96;
/** How far behind the grip the wrist of the hand round it is, near enough. */
const GRIP_TO_WRIST = 0.06;

/** Near enough where the wrist of a hand round `grip` is, in the world, for how far the arms must reach. */
function toGrip(gun: THREE.Object3D, grip: THREE.Vector3, forward: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
  return gun.localToWorld(out.copy(grip)).addScaledVector(forward, -GRIP_TO_WRIST);
}

/**
 * How each gun kicks the body, in WEAPONS order: how much of the model's own
 * shooting clip plays, how far the chest is shoved back and the right
 * shoulder turned back (radians), and how soon the shove peaks.
 */
const SHOT_KICK = [
  { clip: 0.7, back: 0.05, turn: 0.04, time: 0.04 },
  { clip: 0.3, back: 0.02, turn: 0.01, time: 0.03 },
  { clip: 1, back: 0.12, turn: 0.14, time: 0.08 },
];

/** A shove `t` seconds in that peaks at `peak` and then dies away: 0 to 1. */
function pulse(t: number, peak: number): number {
  if (t < 0 || t > peak * 8) return 0;
  const x = t / peak;
  return x * Math.exp(1 - x);
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

/**
 * The soldier's `meshes` merged into the first one's geometry, in a side's
 * colours, with the kit that sets the sides apart besides colour: a pack on
 * operators, a helmet band and radio mast on commanders. The kit is placed on
 * the model at rest, standing in `frame` (a figure), each piece skinned
 * wholly to the bone that carries it.
 */
function look(meshes: THREE.SkinnedMesh[], bones: Bones, frame: THREE.Object3D, team: Team, commander: boolean): THREE.BufferGeometry {
  const body = meshes[0];
  const skeleton = body.skeleton.bones;
  // A skinned vertex v ends up at bone.matrixWorld * boneInverse * bindMatrix * v; `bind` is the last two.
  const bind = (m: THREE.SkinnedMesh, j: number): THREE.Matrix4 => m.skeleton.boneInverses[j].clone().multiply(m.bindMatrix);
  const parts: Part[] = [];
  for (const m of meshes) {
    if (m.skeleton.bones.length !== skeleton.length || m.skeleton.bones.some((b, j) => b !== skeleton[j])) {
      throw new Error('Soldier meshes are skinned to different bones');
    }
    // Into the first mesh's space: the same for every bone, or the meshes can't be merged.
    const into = bind(body, 0).invert().multiply(bind(m, 0));
    for (let j = 1; j < skeleton.length; j++) {
      const other = bind(body, j).invert().multiply(bind(m, j));
      if (other.elements.some((e, i) => Math.abs(e - into.elements[i]) > 1e-4)) throw new Error('Soldier meshes are bound differently');
    }
    const p = partOf(m, into);
    const name = (m.material as THREE.Material).name;
    if (name === UNIFORM_MATERIAL) p.color.setHex(commander ? COMMANDER_UNIFORM : UNIFORM[team]);
    if (name === GEAR_MATERIAL) p.color.setHex(commander ? COMMANDER_GEAR : GEAR[team]);
    const joints = m.geometry.getAttribute('skinIndex');
    const weights = m.geometry.getAttribute('skinWeight');
    const index = new Uint16Array(joints.count * 4);
    const weight = new Float32Array(joints.count * 4);
    for (let i = 0; i < joints.count; i++) {
      for (let c = 0; c < 4; c++) {
        index[i * 4 + c] = joints.getComponent(i, c);
        weight[i * 4 + c] = weights.getComponent(i, c);
      }
    }
    p.geometry.setAttribute('skinIndex', new THREE.BufferAttribute(index, 4));
    p.geometry.setAttribute('skinWeight', new THREE.BufferAttribute(weight, 4));
    parts.push(p);
  }

  // Kit, placed in the figure's space at rest facing -z, then carried by a bone.
  const chest = frame.worldToLocal(bones.spine2.getWorldPosition(new THREE.Vector3()));
  const head = frame.worldToLocal(bones.head.getWorldPosition(new THREE.Vector3()));
  const wear = (geometry: THREE.BufferGeometry, hex: number, roughness: number, bone: THREE.Object3D, x: number, y: number, z: number, roll = 0): void => {
    const j = skeleton.indexOf(bone as THREE.Bone);
    const at = new THREE.Matrix4().compose(
      new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(V_BACK, roll), new THREE.Vector3(1, 1, 1),
    ).premultiply(frame.matrixWorld);
    // Solve bone.matrixWorld * bind * v = at * kit for v.
    geometry.applyMatrix4(bind(body, j).invert().multiply(bone.matrixWorld.clone().invert()).multiply(at));
    const n = geometry.getAttribute('position').count;
    const index = new Uint16Array(n * 4);
    const weight = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      index[i * 4] = j;
      weight[i * 4] = 1;
    }
    geometry.setAttribute('skinIndex', new THREE.BufferAttribute(index, 4));
    geometry.setAttribute('skinWeight', new THREE.BufferAttribute(weight, 4));
    parts.push(part(geometry, hex, roughness));
  };
  if (team === 'operator') {
    wear(new THREE.BoxGeometry(0.3, 0.4, 0.16), PACK, 0.9, bones.spine2, chest.x, chest.y - 0.06, chest.z + 0.2);
    wear(new THREE.CylinderGeometry(0.06, 0.06, 0.3, 10).rotateZ(Math.PI / 2), PACK, 0.9, bones.spine2, chest.x, chest.y + 0.17, chest.z + 0.22);
  }
  if (commander) {
    wear(new THREE.TorusGeometry(0.155, 0.025, 6, 20).rotateX(Math.PI / 2), RED, 0.8, bones.head, head.x, head.y + 0.15, head.z - 0.01);
    wear(new THREE.CylinderGeometry(0.006, 0.01, 0.7, 5), MAST, 0.6, bones.spine2, chest.x - 0.1, chest.y + 0.3, chest.z + 0.2, 0.12);
    wear(new THREE.BoxGeometry(0.2, 0.28, 0.12), MAST, 0.6, bones.spine2, chest.x, chest.y - 0.05, chest.z + 0.18);
  }
  return mergeParts(parts, ['skinIndex', 'skinWeight']);
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


/**
 * Light a material up round the point a round landed, fading with distance,
 * rather than all over. `hit` holds the point in the world and the strength.
 */
function flashWhereHit(m: THREE.MeshStandardMaterial, hit: { value: THREE.Vector4 }): void {
  const before = m.onBeforeCompile;
  const key = m.customProgramCacheKey.bind(m);
  m.onBeforeCompile = (shader, renderer) => {
    before.call(m, shader, renderer);
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
  m.customProgramCacheKey = () => `${key()}-hitflash`;
}

const SHADOW_SPHERE = new THREE.Sphere();
const V_UP = new THREE.Vector3(0, 1, 0);
const V_BACK = new THREE.Vector3(0, 0, 1);
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
const M_B = new THREE.Matrix4();
const M_C = new THREE.Matrix4();
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
