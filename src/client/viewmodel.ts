import * as THREE from 'three';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { clamp, lerp } from '../shared/geom.ts';
import { BOLT } from '../shared/weapons.ts';
import { grenadeModel } from './grenade.ts';
import { wetMaterial } from './rain.ts';
import { fitGun } from './guns.ts';
import { lightTorch, makeTorch, mountTorch, torchMaterial, torchMount, type Torch } from './torch.ts';
import {
  actionMatrix, BOLT_START, BOLT_TIME, boltHand, type GunPoints, magazineMatrix, type Parts, path, reloadHands, shotParts,
} from './handwork.ts';
import { type Bones, curl, findBones, findHand, type Hand, limitBend, orientHand, placeWorld, reach, span, untwist, wristFor } from './rig.ts';

// The weapon in your hands. It is drawn in its own scene after the world, over
// a cleared depth buffer, so it never clips into walls. Simple shapes stand in
// until the gun models have loaded, and boxes for hands until the soldier has:
// then your arms are the soldier's own, reaching for the gun. Each gun reloads
// its own way (see handwork.ts), the bolt-action's bolt is worked after every
// shot, and the left hand throws the grenades.

const FOV = 60;
const ARMS_AT = new THREE.Vector3(0, -1.6, 0);
/**
 * Where the shoulders are, in view space: below and either side of the eye,
 * the left brought forward as it is when holding a long gun. The guns are
 * held further out here than real ones are, to look right on screen, so the
 * arms' bones are lengthened to reach them rather than the arms drawn larger.
 */
const RIGHT_SHOULDER = new THREE.Vector3(0.19, -0.3, -0.02);
const LEFT_SHOULDER = new THREE.Vector3(-0.12, -0.32, -0.22);
/** How far a wrist bends from its forearm's line at most, in radians, before its skin folds up. */
const WRIST_BEND = 0.7;
/** How far the left wrist twists about its forearm at most, aiming the pistol, before its skin wrings. */
const WRIST_TWIST = 0.4;
/** How straight an arm is at least, as its reach over its length: a near hand sends the shoulder back. */
const ARM_STRAIGHT = 0.9;
/** Where the left hand goes for a magazine or a round, out of sight below. */
const POUCH = new THREE.Vector3(-0.1, -0.75, -0.3);
/** Only the parts of the soldier weighted to these bones are kept for the arms. */
const ARM_BONES = /^(UpperArm|LowerArm|Wrist|Index|Middle|Ring|Pinky|Thumb)/;
/** The uniform's colour on an operator, as the bodies in the world wear it. */
const SLEEVE = 0x44566a;
/** Length of a suppressor on the barrel. */
const CAN_LENGTH = 0.15;
const FLASH_TIME = 0.045;
/**
 * How far the sky's light on the gun leans toward the brighter side indoors,
 * for each step from dark to fully lit across a metre, and at most, as a
 * share of straight up.
 */
const LEAN = 2;
const MAX_LEAN = 1.2;
const TORCH_MAT = torchMaterial();

interface Model {
  group: THREE.Group;
  /** The gun itself, swapped for the loaded model. */
  body: THREE.Object3D[];
  /** Gloved hands, on the grip and the fore-end. */
  hands: [THREE.Object3D, THREE.Object3D];
  /** Where the grip sits in the model's space. */
  grip: THREE.Vector3;
  /** The gun's marked points, in the model's space, and in the gun's own (where its parts move). */
  points: GunPoints;
  own: GunPoints;
  /** The gun's magazine and its slide or bolt handle, and a fresh magazine for the left hand. */
  magazine: THREE.Object3D | null;
  action: THREE.Object3D | null;
  fresh: THREE.Object3D | null;
  flash: THREE.Mesh;
  /** The suppressor on the barrel, shown when fitted. */
  can: THREE.Mesh;
  /** The flashlight on the gun. */
  torch: Torch;
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
  /** How many rounds a reload loads. */
  rounds: number;
  /** 0 to 1 through a grenade throw, or -1 when not throwing. */
  throwing: number;
}

/** The soldier's arms, posed to hold the gun. */
interface Arms {
  bones: Bones;
  hands: [left: Hand, right: Hand];
  /** Every bone's resting turn, put back before each pose so nothing drifts. */
  rest: [THREE.Object3D, THREE.Quaternion][];
  arm: number;
  forearm: number;
  nade: THREE.Object3D;
  /** A round in the left hand. */
  round: THREE.Mesh;
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
  /** Seconds since the last shot, for the bolt-action's bolt. */
  private firedFor = 1e3;
  private sprintBlend = 0;
  private suppressed = false;
  private arms: Arms | null = null;
  /** Where the magazine was last frame, to see it let go. */
  private lastMag: Parts['mag'] = 0;
  /**
   * A magazine let go of in a reload: `weapon`'s, placed by `matrix` in view
   * space (from the gun's own space), to drop into the world.
   */
  onDrop: ((weapon: number, matrix: THREE.Matrix4) => void) | null = null;
  private readonly tmp = new THREE.Vector3();
  private readonly hemi = new THREE.HemisphereLight(0xcfdcea, 0x5a5440, 1.4);
  private readonly sun = new THREE.DirectionalLight(0xfff1dc, 2);
  /** The spill of your own flashlight on the gun, always there so switching it never recompiles. */
  private readonly torch = new THREE.PointLight(0xfff2de, 0, 3, 2);
  /**
   * How soaked your hands and gun are, 0 to 1 (see Soak), and the world's up
   * in the view's space: the view has no place in the world to get wet by.
   */
  readonly soak = { value: 0 };
  readonly up = { value: new THREE.Vector3(0, 1, 0) };
  /** The materials in the hands made to get wet, each standing in for the one it was copied from. */
  private readonly wet = new Map<THREE.Material, THREE.MeshStandardMaterial>();
  private sky = 1;
  private sunShare = 0;
  /** The sky's and the ground's colours, before the light where you stand dims and tints them. */
  private readonly skyColor = new THREE.Color(0xcfdcea);
  private readonly groundColor = new THREE.Color(0x5a5440);
  /** The sky's light where the gun is, red, green and blue, white outdoors, and which way it's brighter, in the view's space. */
  private readonly indoors = new THREE.Color(1, 1, 1);
  private readonly towards = new THREE.Vector3();
  /** The sun's light bounced to it, as a share of the sun's, red, green and blue. */
  private readonly bounced = new THREE.Color(0, 0, 0);
  private readonly sunBounce = new THREE.Color();
  /** Its share, as bright: what dims the sun and the reflections. */
  private share = 1;

  constructor() {
    this.scene.add(this.hemi);
    this.sun.position.set(0.4, 1, 0.3);
    this.scene.add(this.sun);
    this.torch.position.set(0.25, -0.1, -0.2);
    this.camera.add(this.torch);
    this.scene.add(this.camera);
    this.camera.add(this.root);
    // In WEAPONS order.
    this.models = [rifle(), pistol(), boltAction()];
    this.models.forEach((m, i) => {
      mountTorch(m.torch, torchMount(i, m.muzzle, m.points.support));
      m.group.visible = false;
      this.root.add(m.group);
    });
    this.takeShadows();
    this.wetAll();
  }

  /**
   * Everything in the hands gets wet as you are: each material copied once,
   * so what it's shared with in the world is left alone, and copies shared as
   * the materials were.
   */
  private wetAll(): void {
    const made = new Set(this.wet.values());
    this.root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      const m = mesh.material;
      if (!mesh.isMesh || Array.isArray(m) || !(m instanceof THREE.MeshStandardMaterial) || made.has(m)) return;
      let wet = this.wet.get(m);
      if (!wet) {
        wet = wetMaterial(m.clone(), { gloss: 0.4, soak: this.soak, held: this.up });
        this.wet.set(m, wet);
      }
      mesh.material = wet;
    });
  }

  /** Everything in the hands takes the shadows of the lamps and others' flashlights, as it would in the world. */
  private takeShadows(): void {
    this.root.traverse((o) => (o.receiveShadow = true));
  }

  /**
   * Light the gun like the world round it: `ambient` is the share of a clear
   * day's light, `sun` the sun's or moon's colour and `sunShare` its share.
   */
  setLight(ambient: number, sun: THREE.Color, sunShare: number, sky: THREE.Color, ground: THREE.Color): void {
    this.skyColor.copy(sky);
    this.groundColor.copy(ground);
    this.sun.color.copy(sun);
    this.sunShare = sunShare;
    this.sky = ambient;
    this.shade(this.indoors, this.towards, this.bounced);
  }

  /**
   * How much of the sky's light reaches the gun, in red, green and blue, from
   * white outdoors down to a dim room's, and how fast it brightens which way,
   * per metre in the view's space: the gun is lit that much less, in that
   * colour, and from the side of a window or a doorway. The sun is dimmed
   * too, as walls and a roof mostly keep it off. `bounced` is the sun's
   * light bounced to the gun, as a share of the sun's, from all round.
   */
  shade(light: THREE.Color, towards: THREE.Vector3, bounced: THREE.Color): void {
    this.indoors.copy(light);
    this.towards.copy(towards);
    this.bounced.copy(bounced);
    this.share = 0.2126 * light.r + 0.7152 * light.g + 0.0722 * light.b;
    // The sun's light bounced, as the sky's light it adds to.
    this.sunBounce.copy(this.sun.color).multiply(bounced).multiplyScalar(this.sky > 0 ? (2 * this.sunShare) / (1.4 * this.sky) : 0);
    this.hemi.color.copy(this.skyColor).multiply(light).add(this.sunBounce);
    this.hemi.groundColor.copy(this.groundColor).multiply(light).add(this.sunBounce);
    this.hemi.intensity = 1.4 * this.sky;
    // From overhead, leaning toward the brighter side.
    this.hemi.position.copy(towards).multiplyScalar(LEAN);
    if (this.hemi.position.length() > MAX_LEAN) this.hemi.position.setLength(MAX_LEAN);
    this.hemi.position.y += 1;
    this.sun.intensity = 2 * this.sunShare * this.share;
    this.scene.environmentIntensity = 0.8 * this.sky * this.share;
  }

  /** Your flashlight is on, lighting the gun from the side. */
  set torchOn(on: boolean) {
    this.torch.intensity = on ? 1.5 : 0;
    for (const m of this.models) lightTorch(m.torch, on);
  }

  /** Swap the stand-in shapes for real guns, in WEAPONS order, lit by the sky. */
  setGuns(guns: GLTF[], environment: THREE.Texture): void {
    this.scene.environment = environment;
    this.scene.environmentIntensity = 0.8 * this.sky * this.share;
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
      mountTorch(m.torch, torchMount(i, gun.muzzle, gun.support).add(m.grip));
      m.hands[0].position.copy(gun.grip).add(m.grip).y -= 0.03;
      m.hands[1].position.copy(gun.support).add(m.grip).y -= 0.03;
      const shift = (v: THREE.Vector3): THREE.Vector3 => v.clone().add(m.grip);
      m.own = gun;
      m.points = {
        grip: shift(gun.grip), support: shift(gun.support), magazine: shift(gun.magazine), bolt: shift(gun.bolt),
        pivot: shift(gun.pivot), well: gun.well.clone(),
      };
      m.magazine = gun.magazinePart;
      m.action = gun.actionPart;
      for (const part of [m.magazine, m.action]) part && (part.matrixAutoUpdate = false);
      m.fresh = gun.magazinePart?.clone() ?? null;
      if (m.fresh) {
        m.fresh.matrixAutoUpdate = false;
        m.fresh.visible = false;
        this.root.add(m.fresh);
      }
    });
    this.takeShadows();
    this.wetAll();
  }

  /** Swap the boxes for hands for the soldier's own arms. */
  setArms(gltf: GLTF): void {
    const model = SkeletonUtils.clone(gltf.scene);
    const meshes: THREE.SkinnedMesh[] = [];
    model.traverse((o) => {
      const mesh = o as THREE.SkinnedMesh;
      if (mesh.isSkinnedMesh) meshes.push(mesh);
    });
    for (const mesh of meshes) {
      const geometry = armsOnly(mesh);
      if (!geometry) {
        mesh.removeFromParent();
        continue;
      }
      mesh.geometry = geometry;
      const m = (mesh.material as THREE.MeshStandardMaterial).clone();
      if (m.name === 'Swat') m.color.setHex(SLEEVE);
      mesh.material = m;
      mesh.frustumCulled = false;
    }
    // The model faces +z; the view looks down -z.
    const rig = new THREE.Group();
    rig.position.copy(ARMS_AT);
    rig.rotation.y = Math.PI;
    rig.add(model);
    this.root.add(rig);
    this.root.updateMatrixWorld(true);
    const bones = findBones(model);
    // Long enough for the left hand to reach the furthest fore-end from its shoulder, with the elbow a little bent.
    const reachOut = Math.max(...this.models.map((m) =>
      m.hip.clone().add(m.points.support).distanceTo(LEFT_SHOULDER))) - 0.05;
    // Both halves of the arm lengthened alike, so the elbow sits where a real one would.
    const length = Math.max((reachOut * 1.04) / (span(bones.lArm, bones.lForeArm) + span(bones.lForeArm, bones.lHand)), 1);
    for (const mesh of meshes) if (mesh.parent) lengthenArms(mesh, bones, length, length);
    const rest: [THREE.Object3D, THREE.Quaternion][] = [];
    model.traverse((o) => rest.push([o, o.quaternion.clone()]));
    const nade = grenadeModel();
    nade.visible = false;
    this.root.add(nade);
    const round = new THREE.Mesh(ROUND_GEO, BRASS);
    round.visible = false;
    this.root.add(round);
    this.arms = {
      bones, hands: [findHand(model, 'L'), findHand(model, 'R')], rest,
      arm: span(bones.rArm, bones.rForeArm), forearm: span(bones.rForeArm, bones.rHand), nade, round,
    };
    for (const m of this.models) for (const h of m.hands) h.visible = false;
    this.takeShadows();
    this.wetAll();
  }

  resize(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  /** A round just left the barrel. */
  fire(weapon: number): void {
    this.firedFor = 0;
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
    this.firedFor += dt;
    // The bolt-action rolls a little toward you as its bolt is worked.
    const cycle = s.weapon === BOLT && s.reload === 0 ? (this.firedFor - BOLT_START) / BOLT_TIME : -1;
    const working = cycle > 0 && cycle < 1 ? Math.sin(Math.PI * cycle) : 0;
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
      reloadDip * 0.5 + this.sprintBlend * 0.2 + working * 0.2,
    );

    this.flashLeft = Math.max(this.flashLeft - dt, 0);
    m.flash.visible = this.flashLeft > 0 && !this.suppressed;
    if (this.arms) this.poseArms(this.arms, m, s, cycle);
  }

  /**
   * Both hands on the gun: the right round the grip, the left under the
   * fore-end, or both round a pistol's grip. A reload has the hands do what
   * that gun needs; working the bolt-action's bolt takes the right hand off
   * the grip; a throw takes the left hand up and forward.
   */
  private poseArms(a: Arms, m: Model, s: HeldState, cycle: number): void {
    for (const [bone, q] of a.rest) bone.quaternion.copy(q);
    this.root.updateMatrixWorld(true);
    const g = m.group;
    const right = V_RIGHT.set(1, 0, 0).transformDirection(g.matrixWorld);
    const up = V_UP.set(0, 1, 0).transformDirection(g.matrixWorld);
    const forward = V_FORWARD.set(0, 0, -1).transformDirection(g.matrixWorld);
    const back = V_BACK.copy(forward).negate();
    const pistol = m === this.models[1];
    const b = a.bones;
    const wrist = new THREE.Vector3();
    const pole = new THREE.Vector3();
    const toWorld = (v: THREE.Vector3): THREE.Vector3 => g.localToWorld(v);

    const grip = g.localToWorld(m.hands[0].position.clone().setY(m.hands[0].position.y + 0.03));
    let support = g.localToWorld(m.hands[1].position.clone());
    if (pistol) support = grip.clone().addScaledVector(right, -0.03);
    let rightAt = grip;
    let leftAt = support;
    let rightAway = 0;
    let leftHook = 0;
    let holding: 'magazine' | 'round' | null = null;
    let parts = shotParts(this.current, this.firedFor);
    if (s.reload > 0) {
      const work = reloadHands(this.current, s.reload, s.rounds, m.points, toWorld, { left: support, right: grip },
        this.root.localToWorld(this.tmp.copy(POUCH)).clone(), back);
      leftAt = work.left;
      rightAt = work.right;
      rightAway = work.rightAway;
      leftHook = work.leftHook;
      holding = work.holding;
      parts = work.parts;
    } else if (cycle > 0 && cycle < 1) {
      const work = boltHand(cycle, m.points, toWorld, grip);
      rightAt = work.at;
      rightAway = work.away;
      parts = work.parts;
    }
    this.showParts(m, parts, leftAt);

    let along = new THREE.Vector3().copy(forward).addScaledVector(up, -0.3);
    let thumb = new THREE.Vector3().copy(up);
    if (rightAway > 0) {
      // Fingers down over the bolt's handle.
      along.lerp(new THREE.Vector3().copy(forward).multiplyScalar(0.4).sub(up), rightAway);
      thumb.lerp(forward, rightAway);
    }
    // Aiming the pistol the arms reach out and the grip would bend the wrists back on themselves.
    const bend = pistol ? lerp(Math.PI, WRIST_BEND, s.aim) : Math.PI;
    limitBend(along, thumb, this.reachFrom(RIGHT_SHOULDER, rightAt), bend);
    wristFor('R', rightAt, along, thumb, wrist);
    this.shoulder(a.bones.rArm, RIGHT_SHOULDER, wrist, a);
    pole.set(0.5, -0.8, 0.3).add(wrist);
    reach(b.rArm, b.rForeArm, b.rHand, wrist, pole, a.arm, a.forearm);
    orientHand(a.hands[1], along, thumb);
    curl(a.hands[1], lerp(0.9, 0.6, rightAway));

    let target = leftAt;
    along = new THREE.Vector3().copy(right).addScaledVector(forward, 0.9);
    thumb = new THREE.Vector3().copy(forward).addScaledVector(right, -0.5).addScaledVector(up, 0.4);
    if (pistol) {
      // Wrapped round the right hand's fingers from the left, the thumb forward along the frame.
      along = new THREE.Vector3().copy(right).addScaledVector(up, -0.35).addScaledVector(forward, 0.2);
      thumb = new THREE.Vector3().copy(forward).addScaledVector(up, 0.3);
    }
    if (leftHook > 0) {
      // Fingers down over the charging handle's latch, the palm back.
      along.lerp(new THREE.Vector3().copy(up).negate().addScaledVector(forward, -0.3), leftHook);
      thumb.lerp(right, leftHook);
    }
    a.nade.visible = false;
    let closed = s.reload > 0 ? 0.8 : pistol ? 0.9 : 0.8;
    if (s.throwing >= 0) {
      // Up beside the head, forward and away, then back down to the gun.
      const t = s.throwing;
      const cocked = new THREE.Vector3(-0.32, -0.02, -0.4);
      const release = new THREE.Vector3(-0.12, 0.02, -0.7);
      const follow = new THREE.Vector3(0.02, -0.35, -0.55);
      const low = new THREE.Vector3(-0.25, -0.75, -0.3);
      target = this.root.localToWorld(path(t, [[0, low], [0.1, cocked], [0.2, cocked], [0.32, release], [0.45, follow], [0.7, low], [1, low]]).clone());
      // Fingers up and the palm forward, the grenade in it.
      along = new THREE.Vector3(0, 1, -0.3).transformDirection(this.root.matrixWorld);
      thumb = new THREE.Vector3(1, 0, 0).transformDirection(this.root.matrixWorld);
      closed = 0.7;
      a.nade.visible = t < 0.3;
    }
    limitBend(along, thumb, this.reachFrom(LEFT_SHOULDER, target), bend);
    wristFor('L', target, along, thumb, wrist);
    this.shoulder(a.bones.lArm, LEFT_SHOULDER, wrist, a);
    pole.set(-0.6, -0.8, 0.3).add(wrist);
    reach(b.lArm, b.lForeArm, b.lHand, wrist, pole, a.arm, a.forearm);
    orientHand(a.hands[0], along, thumb);
    // Wrapped round the pistol the left hand is turned half over; the forearm turns with it.
    if (pistol) untwist(a.hands[0], lerp(Math.PI, WRIST_TWIST, s.aim));
    curl(a.hands[0], closed);

    // A fresh magazine sits in the left hand as it would in the gun; a round or a grenade in its fingers.
    for (const other of this.models) if (other.fresh) other.fresh.visible = false;
    if (holding === 'magazine' && m.fresh) {
      this.inHand(m, target, m.fresh.matrix);
      m.fresh.matrixWorldNeedsUpdate = true;
      m.fresh.visible = true;
    }
    a.round.visible = holding === 'round';
    if (a.round.visible) a.round.quaternion.copy(g.quaternion);
    const carried = a.nade.visible ? a.nade : a.round.visible ? a.round : null;
    if (carried) {
      const hand = a.hands[0];
      hand.wrist.updateMatrixWorld(true);
      const at = hand.wrist.localToWorld(this.tmp.copy(hand.knuckles).multiplyScalar(0.6));
      if (carried === a.nade) at.addScaledVector(V_FORWARD.crossVectors(along, thumb).normalize(), 0.05);
      carried.position.copy(this.root.worldToLocal(at));
    }
  }

  /**
   * Pose the gun's moving parts where `parts` puts them, and when the
   * magazine is let go of, drop it into the world from where it was: in the
   * gun, or in the left hand at `hand`.
   */
  private showParts(m: Model, parts: Parts, hand: THREE.Vector3): void {
    const was = this.lastMag;
    this.lastMag = parts.mag;
    if (m.magazine) {
      m.magazine.visible = typeof parts.mag === 'number';
      if (m.magazine.visible) magazineMatrix(m.own, parts.mag as number, m.magazine.matrix);
      m.magazine.matrixWorldNeedsUpdate = true;
    }
    if (m.action) {
      actionMatrix(m.own, parts, m.action.matrix);
      m.action.matrixWorldNeedsUpdate = true;
    }
    if (parts.mag !== 'gone' || was === 'gone' || !m.magazine) return;
    // In the root's space, which is the camera's.
    const at = new THREE.Matrix4();
    if (was === 'hand') this.inHand(m, hand, at);
    else at.multiplyMatrices(m.group.matrix, m.body[0].matrix).multiply(magazineMatrix(m.own, was, new THREE.Matrix4()));
    this.onDrop?.(this.current, at);
  }

  /** Where a magazine held at `at` (the camera's space) is, as a matrix from the gun's own space: its base in the palm. */
  private inHand(m: Model, at: THREE.Vector3, out: THREE.Matrix4): THREE.Matrix4 {
    const base = m.own.magazine;
    out.makeRotationFromQuaternion(m.group.quaternion).setPosition(this.root.worldToLocal(this.tmp.copy(at)));
    return out.multiply(M_A.makeTranslation(-base.x, -base.y, -base.z));
  }

  /** Roughly the way a forearm runs to a hand at `to` (world) from a shoulder at `from` (view space). */
  private reachFrom(from: THREE.Vector3, to: THREE.Vector3): THREE.Vector3 {
    return new THREE.Vector3().copy(to).sub(this.root.localToWorld(this.tmp.copy(from)));
  }

  /**
   * Put a shoulder where it sits, in view space, or further back if the hand
   * is so near that the long arm would fold up in front of the eye: back
   * until the arm is nearly straight. Behind the eye it can't be seen.
   */
  private shoulder(bone: THREE.Object3D, at: THREE.Vector3, wrist: THREE.Vector3, a: Arms): void {
    const hand = this.root.worldToLocal(V_REACH.copy(wrist));
    const want = (a.arm + a.forearm) * ARM_STRAIGHT;
    // Back along +z by t, until |hand - (at + t z)| = want.
    const dx = hand.x - at.x;
    const dy = hand.y - at.y;
    const dz = hand.z - at.z;
    const flat = want * want - dx * dx - dy * dy;
    const t = flat > 0 ? Math.max(dz + Math.sqrt(flat), 0) : 0;
    placeWorld(bone, this.root.localToWorld(this.tmp.set(at.x, at.y, at.z + t)));
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
const BRASS = new THREE.MeshStandardMaterial({ color: 0xb08a3e, roughness: 0.35, metalness: 0.8 });
/** A round, loaded into the bolt-action one at a time. */
const ROUND_GEO = new THREE.CylinderGeometry(0.005, 0.005, 0.07, 6).rotateX(Math.PI / 2);
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
  const torch = makeTorch(TORCH_MAT);
  group.add(flash, can, torch.object);
  const grip = hands[0].position.clone().setY(0);
  const support = hands[1].position;
  const bolt = grip.clone().add(new THREE.Vector3(0.03, -0.03, -0.1));
  const points = {
    grip: hands[0].position.clone(), support: support.clone(),
    magazine: grip.clone().lerp(support, 0.4).setY(-0.12), bolt, pivot: bolt.clone().setX(0), well: new THREE.Vector3(0, -1, 0),
  };
  return {
    group, body, hands, grip, points, own: points, magazine: null, action: null, fresh: null,
    flash, can, torch, muzzle: new THREE.Vector3(0, muzzleY, muzzleZ), canMuzzle: new THREE.Vector3(0, muzzleY, muzzleZ - CAN_LENGTH),
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
    -0.02, -0.145, 0.04, 0.014, new THREE.Vector3(0.17, -0.15, -0.5), -0.6, 0.05, 0.14,
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

const V_RIGHT = new THREE.Vector3();
const V_UP = new THREE.Vector3();
const V_FORWARD = new THREE.Vector3();
const V_BACK = new THREE.Vector3();
const V_REACH = new THREE.Vector3();
const M_A = new THREE.Matrix4();

/**
 * A copy of a soldier mesh's geometry with only the triangles that move
 * with the arms, or null if there are none.
 */
function armsOnly(mesh: THREE.SkinnedMesh): THREE.BufferGeometry | null {
  const geometry = mesh.geometry;
  const index = geometry.index;
  const joints = geometry.getAttribute('skinIndex');
  const weights = geometry.getAttribute('skinWeight');
  if (!index || !joints || !weights) return null;
  const arm = mesh.skeleton.bones.map((b) => ARM_BONES.test(b.name));
  // A vertex belongs to the bone that moves it most.
  const onArm = (v: number): boolean => {
    let best = 0;
    let bone = 0;
    for (let k = 0; k < 4; k++) {
      const w = weights.getComponent(v, k);
      if (w > best) (best = w), (bone = joints.getComponent(v, k));
    }
    return arm[bone];
  };
  const kept: number[] = [];
  for (let i = 0; i < index.count; i += 3) {
    const a = index.getX(i);
    const b = index.getX(i + 1);
    const c = index.getX(i + 2);
    if (onArm(a) && onArm(b) && onArm(c)) kept.push(a, b, c);
  }
  if (!kept.length) return null;
  const out = geometry.clone();
  out.setIndex(kept);
  return out;
}

/**
 * Lengthen the arms of a skinned mesh: the upper arms by `upper` and the
 * forearms by `lower`, times their length, without thickening them. The
 * skin's vertices move with the bones they follow, as if the bones had been
 * that long when it was bound, so the elbow stretches smoothly.
 */
function lengthenArms(mesh: THREE.SkinnedMesh, bones: Bones, upper: number, lower: number): void {
  const skeleton = mesh.skeleton;
  // Its own copies: the skeletons of every clone share the model's bind matrices.
  skeleton.boneInverses = skeleton.boneInverses.map((m) => m.clone());
  const shift = skeleton.bones.map(() => new THREE.Vector3());
  /** Where each arm bone runs in the bind pose and how far its end moves, so its skin stretches along it. */
  const along = new Map<number, { from: THREE.Vector3; to: THREE.Vector3; start: THREE.Vector3; end: THREE.Vector3 }>();
  const bindAt = (bone: THREE.Object3D): THREE.Vector3 =>
    new THREE.Vector3().setFromMatrixPosition(skeleton.boneInverses[skeleton.bones.indexOf(bone as THREE.Bone)].clone().invert());
  for (const [arm, fore, hand] of [[bones.lArm, bones.lForeArm, bones.lHand], [bones.rArm, bones.rForeArm, bones.rHand]]) {
    const elbow = bindAt(fore).sub(bindAt(arm)).multiplyScalar(upper - 1);
    const wrist = bindAt(hand).sub(bindAt(fore)).multiplyScalar(lower - 1).add(elbow);
    along.set(skeleton.bones.indexOf(arm as THREE.Bone), { from: bindAt(arm), to: bindAt(fore), start: new THREE.Vector3(), end: elbow });
    along.set(skeleton.bones.indexOf(fore as THREE.Bone), { from: bindAt(fore), to: bindAt(hand), start: elbow, end: wrist });
    fore.traverse((o) => {
      const i = skeleton.bones.indexOf(o as THREE.Bone);
      if (i >= 0) shift[i].copy(elbow);
    });
    hand.traverse((o) => {
      const i = skeleton.bones.indexOf(o as THREE.Bone);
      if (i >= 0) shift[i].copy(wrist);
    });
  }
  // The bind pose, moved: each bone's inverse bind matrix and each vertex, by its weights. A vertex on an
  // upper arm or forearm moves by how far along that bone it is, so the sleeve lengthens evenly rather
  // than the skin stretching at the joints.
  skeleton.boneInverses.forEach((m, i) => {
    if (shift[i].lengthSq() > 0) m.multiply(new THREE.Matrix4().makeTranslation(shift[i].clone().negate()));
  });
  // Quantized positions would clip the longer arms to the model's old bounds: unpack them to floats.
  const packed = mesh.geometry.getAttribute('position');
  const position = new THREE.Float32BufferAttribute(packed.count * 3, 3);
  for (let i = 0; i < packed.count; i++) position.setXYZ(i, packed.getX(i), packed.getY(i), packed.getZ(i));
  mesh.geometry.setAttribute('position', position);
  const joints = mesh.geometry.getAttribute('skinIndex');
  const weights = mesh.geometry.getAttribute('skinWeight');
  // Not bindMatrixInverse, which three.js keeps as the inverse of the mesh's world matrix once attached.
  const unbind = mesh.bindMatrix.clone().invert();
  const v = new THREE.Vector3();
  const move = new THREE.Vector3();
  for (let i = 0; i < position.count; i++) {
    move.set(0, 0, 0);
    v.fromBufferAttribute(position, i).applyMatrix4(mesh.bindMatrix);
    for (let k = 0; k < 4; k++) {
      const j = joints.getComponent(i, k);
      const w = weights.getComponent(i, k);
      const bone = along.get(j);
      if (!bone) {
        move.addScaledVector(shift[j], w);
        continue;
      }
      const run = V_REACH.copy(bone.to).sub(bone.from);
      const f = clamp(V_UP.copy(v).sub(bone.from).dot(run) / run.lengthSq(), 0, 1);
      move.addScaledVector(V_UP.lerpVectors(bone.start, bone.end, f), w);
    }
    if (move.lengthSq() === 0) continue;
    v.add(move).applyMatrix4(unbind);
    position.setXYZ(i, v.x, v.y, v.z);
  }
  // The bones themselves, once for the model: each child sits along its parent.
  if (!bones.lForeArm.userData.lengthened) {
    for (const [fore, hand] of [[bones.lForeArm, bones.lHand], [bones.rForeArm, bones.rHand]]) {
      fore.position.multiplyScalar(upper);
      hand.position.multiplyScalar(lower);
    }
    bones.lForeArm.userData.lengthened = true;
  }
}
