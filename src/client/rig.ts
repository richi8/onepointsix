import * as THREE from 'three';
import { clamp } from '../shared/geom.ts';

// Posing the soldier's skeleton by hand, on top of (or instead of) its clips:
// turning bones in world space, two-bone IK for arms and legs, and closing
// the hands around a grip. Shared by the bodies in the world and the arms in
// first person. Every change here brings the bone's children's world
// matrices up to date, so bones' world matrices are read as they stand rather
// than recomputed up the whole chain: the caller brings the skeleton up to
// date once after the clips have posed it.

/**
 * Bones posed by hand, as named in the Rocketbox avatars' `Bip01` rig (see
 * scripts/rocketbox.py). The root stands on the ground under the body and
 * carries everything; the pelvis carries the legs and the upper body. The
 * feet hang off the shins, so the ankle is the foot bone itself; the head's
 * and the boots' ends are bones added for the game to measure by. Every bone
 * the game turns by hand is here, so it can be put back before the clips play.
 */
export const BONES = {
  root: 'Bip01', body: 'Bip01 Pelvis', spine: 'Bip01 Spine', torso: 'Bip01 Spine1', spine2: 'Bip01 Spine2',
  neck: 'Bip01 Neck', head: 'Bip01 Head', headEnd: 'Bip01 HeadNub',
  lShoulder: 'Bip01 L Clavicle', lArm: 'Bip01 L UpperArm', lForeArm: 'Bip01 L Forearm', lHand: 'Bip01 L Hand',
  rShoulder: 'Bip01 R Clavicle', rArm: 'Bip01 R UpperArm', rForeArm: 'Bip01 R Forearm', rHand: 'Bip01 R Hand',
  lUpLeg: 'Bip01 L Thigh', lLeg: 'Bip01 L Calf', lFoot: 'Bip01 L Foot', lToe: 'Bip01 L Toe0', lToeEnd: 'Bip01 L Toe0Nub',
  rUpLeg: 'Bip01 R Thigh', rLeg: 'Bip01 R Calf', rFoot: 'Bip01 R Foot', rToe: 'Bip01 R Toe0', rToeEnd: 'Bip01 R Toe0Nub',
} as const;
export type BoneName = keyof typeof BONES;
export type Bones = Record<BoneName, THREE.Object3D>;

/** The rig's bones, found by name; the loader turns the spaces in node names into underscores. */
export function findBones(model: THREE.Object3D): Bones {
  const bones = {} as Bones;
  for (const [key, name] of Object.entries(BONES)) bones[key as BoneName] = bone(model, name);
  return bones;
}

/** A bone of the rig, by its name in BONES or as the rig has it. */
export function bone(model: THREE.Object3D, name: string): THREE.Object3D {
  const b = model.getObjectByName(THREE.PropertyBinding.sanitizeNodeName(name));
  if (!b) throw new Error(`Soldier has no ${name} bone`);
  return b;
}

/** A bone's name as the loader leaves it, for matching a clip's tracks. */
export function boneName(key: BoneName): string {
  return THREE.PropertyBinding.sanitizeNodeName(BONES[key]);
}

/** A hand's finger joints, to curl around a grip, with the pose they rest in. */
export interface Hand {
  wrist: THREE.Object3D;
  /** Knuckle to tip, finger by finger from the index, then the thumb. */
  joints: THREE.Object3D[][];
  rest: THREE.Quaternion[][];
  /** What each joint turns about to close the hand, in its own space at rest. */
  axes: THREE.Vector3[][];
  /** Where the fingers leave the palm, in the wrist's own space, and a point off the wrist on the thumb's side. */
  knuckles: THREE.Vector3;
  thumb: THREE.Vector3;
}

/** How far into the palm the thumb's side is taken to lean, in radians. */
const THUMB_TILT = 0.2;

/** In the rig, Finger0 is the thumb and Finger1 to Finger4 the index to the little finger, each three joints long. */
const FINGERS = [1, 2, 3, 4, 0];

export function findHand(model: THREE.Object3D, side: 'L' | 'R'): Hand {
  const wrist = bone(model, `Bip01 ${side} Hand`);
  const joints = FINGERS.map((f) => ['', '1', '2'].map((k) => bone(model, `Bip01 ${side} Finger${f}${k}`)));
  model.updateMatrixWorld(true);
  const at = (o: THREE.Object3D): THREE.Vector3 => o.getWorldPosition(new THREE.Vector3());
  // The middle knuckle marks the palm's far edge.
  const knuckles = wrist.worldToLocal(at(joints[1][0]));
  // The way the palm faces: square to the fingers and the line of the knuckles, mirrored for the left hand.
  const along = at(joints[1][0]).sub(at(wrist)).normalize();
  const across = at(joints[0][0]).sub(at(joints[3][0]));
  across.addScaledVector(along, -across.dot(along)).normalize();
  const palm = (side === 'R' ? across.clone().cross(along) : along.clone().cross(across)).normalize();
  // The thumb's side of the hand, as the poses take it: across the knuckles toward the index, a little into the palm.
  const toThumb = across.clone().multiplyScalar(Math.cos(THUMB_TILT)).addScaledVector(palm, Math.sin(THUMB_TILT));
  const thumb = wrist.worldToLocal(at(wrist).add(toThumb));
  // The thumb closes across the palm toward the little finger.
  const little = at(joints[3][0]);
  const axes = joints.map((js, f) => js.map((j, i) => {
    const from = at(j);
    const next = i < js.length - 1 ? at(js[i + 1]) : from.clone().sub(at(js[i - 1])).add(from);
    const dir = next.sub(from).normalize();
    const toward = f === 4 ? little.clone().sub(from).normalize().add(palm).normalize() : palm;
    // Turning about dir × toward swings the finger toward the palm; in the joint's own space at rest.
    const axis = dir.cross(toward).normalize();
    return axis.applyQuaternion(j.getWorldQuaternion(new THREE.Quaternion()).invert());
  }));
  return { wrist, joints, rest: joints.map((js) => js.map((j) => j.quaternion.clone())), axes, knuckles, thumb };
}

/** How far each joint bends in a closed hand, knuckle to tip, and the thumb's. */
const FINGER_CURL = [1.0, 0.95, 0.6];
const THUMB_CURL = [0.3, 0.35, 0.35];

/** Curl the fingers by `amount`, 0 open to 1 closed around a grip. */
export function curl(hand: Hand, amount: number): void {
  hand.joints.forEach((joints, f) => {
    const bend = f === 4 ? THUMB_CURL : FINGER_CURL;
    joints.forEach((j, i) => {
      j.quaternion.copy(hand.rest[f][i]).multiply(Q_A.setFromAxisAngle(hand.axes[f][i], bend[i] * amount));
    });
  });
}

/**
 * Turn a hand so its fingers point along `along` and its thumb side faces
 * `thumb`, both world directions. The knuckles then follow.
 */
export function orientHand(hand: Hand, along: THREE.Vector3, thumb: THREE.Vector3): void {
  const w = hand.wrist;
  w.parent!.matrixWorld.decompose(V_G, Q_A, V_H);
  // Local frame of the hand at rest: fingers along +a, thumb side along +b.
  const a = V_A.copy(hand.knuckles).normalize();
  const b = V_B.copy(hand.thumb).addScaledVector(a, -hand.thumb.dot(a)).normalize();
  const c = V_C.crossVectors(a, b);
  M_A.makeBasis(a, b, c);
  // The world frame we want.
  const wa = V_D.copy(along).normalize();
  const wb = V_E.copy(thumb).addScaledVector(wa, -thumb.dot(wa)).normalize();
  const wc = V_F.crossVectors(wa, wb);
  M_B.makeBasis(wa, wb, wc);
  // world = parent * local; local frame R maps rest to want: local = parent^-1 * want * rest^-1.
  Q_B.setFromRotationMatrix(M_B);
  Q_C.setFromRotationMatrix(M_A).invert();
  w.quaternion.copy(Q_A.invert()).multiply(Q_B).multiply(Q_C);
  w.updateMatrixWorld(true);
}

/**
 * Keep a wrist from bending more than `maxBend` radians: turn the wanted
 * finger and thumb directions (changed in place) back toward `arm`, the way
 * the forearm runs, since the skin at a wrist bent further folds in on itself.
 */
export function limitBend(along: THREE.Vector3, thumb: THREE.Vector3, arm: THREE.Vector3, maxBend: number): void {
  const want = V_A.copy(along).normalize();
  const line = V_B.copy(arm).normalize();
  const bend = Math.acos(clamp(want.dot(line), -1, 1));
  if (bend <= maxBend) return;
  Q_D.setFromUnitVectors(want, line);
  Q_E.identity().slerp(Q_D, 1 - maxBend / bend);
  along.copy(want).applyQuaternion(Q_E);
  thumb.applyQuaternion(Q_E);
}

/**
 * Roll the forearm with the hand, as a real one turns, so the wrist twists
 * no more than `maxTwist` radians about the forearm: twisted further, the skin
 * there wrings into a thin strip. The hand stays where it is, turned the same.
 */
export function untwist(hand: Hand, maxTwist: number): void {
  const w = hand.wrist;
  const axis = V_A.copy(w.position).normalize();
  const q = w.quaternion;
  const along = axis.x * q.x + axis.y * q.y + axis.z * q.z;
  const twist = 2 * Math.atan2(along, q.w);
  const angle = Math.atan2(Math.sin(twist), Math.cos(twist));
  const move = Math.sign(angle) * Math.max(Math.abs(angle) - maxTwist, 0);
  if (move === 0) return;
  // The wrist sits on the forearm's axis, so rolling the forearm about it leaves the wrist in place.
  Q_D.setFromAxisAngle(axis, move);
  w.parent!.quaternion.multiply(Q_D);
  q.premultiply(Q_D.invert());
  w.parent!.updateMatrixWorld(true);
}

/** How far the middle of the palm is from the wrist, along the fingers and out of the palm. */
const PALM_LENGTH = 0.06;
const PALM_DEPTH = 0.005;

/**
 * Where a wrist goes so the palm closes on `point`, with the fingers along
 * `along` and the thumb toward `thumb` (world directions, as for orientHand).
 */
export function wristFor(side: 'L' | 'R', point: THREE.Vector3, along: THREE.Vector3, thumb: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
  const a = V_A.copy(along).normalize();
  const b = V_B.copy(thumb).addScaledVector(a, -thumb.dot(a)).normalize();
  // The palm faces across from the thumb: the hands are mirror images.
  const palm = V_C.crossVectors(a, b).multiplyScalar(side === 'L' ? 1 : -1);
  return out.copy(point).addScaledVector(a, -PALM_LENGTH).addScaledVector(palm, -PALM_DEPTH);
}

/** Turn a bone by `angle` about a world-space axis, then bring its children along. */
export function rotateWorld(bone: THREE.Object3D, axis: THREE.Vector3, angle: number): void {
  if (Math.abs(angle) < 1e-5) return;
  turnWorld(bone, Q_D.setFromAxisAngle(axis, angle));
}

/** Turn a bone by a world-space rotation, then bring its children along. */
export function turnWorld(bone: THREE.Object3D, turn: THREE.Quaternion): void {
  bone.parent!.matrixWorld.decompose(V_G, Q_A, V_H);
  // local' = parent^-1 * R * parent * local
  Q_C.copy(Q_A).invert().multiply(turn).multiply(Q_A);
  bone.quaternion.premultiply(Q_C);
  bone.updateMatrixWorld(true);
}

/** Shift a bone by a world-space offset. */
export function moveWorld(bone: THREE.Object3D, offset: THREE.Vector3): void {
  placeWorld(bone, V_A.setFromMatrixPosition(bone.matrixWorld).add(offset));
}

/** Put a bone at a world position. */
export function placeWorld(bone: THREE.Object3D, world: THREE.Vector3): void {
  bone.position.copy(bone.parent!.worldToLocal(V_B.copy(world)));
  bone.updateMatrixWorld(true);
}

/**
 * Two-bone IK: bend a limb so its end reaches `target`, with the middle joint
 * toward `pole`. Lengths are the upper and lower bones' in world units.
 */
export function reach(
  upper: THREE.Object3D, lower: THREE.Object3D, end: THREE.Object3D,
  target: THREE.Vector3, pole: THREE.Vector3, a: number, b: number,
): void {
  const s = V_R1.setFromMatrixPosition(upper.matrixWorld);
  const toTarget = V_R2.copy(target).sub(s);
  const c = clamp(toTarget.length(), Math.abs(a - b) + 1e-3, a + b - 1e-3);
  const dir = toTarget.normalize();
  // Where the middle joint must be: along the reach by x, out toward the pole by h.
  const x = (a * a - b * b + c * c) / (2 * c);
  const h = Math.sqrt(Math.max(a * a - x * x, 0));
  const bend = V_R3.copy(pole).sub(s);
  bend.addScaledVector(dir, -bend.dot(dir));
  if (bend.lengthSq() < 1e-8) bend.set(0, -1, 0);
  bend.normalize();
  const joint = V_R4.copy(s).addScaledVector(dir, x).addScaledVector(bend, h);

  aimBone(upper, V_R5.setFromMatrixPosition(lower.matrixWorld), joint);
  aimBone(lower, V_R5.setFromMatrixPosition(end.matrixWorld), s.addScaledVector(dir, c));
}

/** Turn a bone so the child now at `from` swings to `to`. Both vectors are used up. */
export function aimBone(bone: THREE.Object3D, from: THREE.Vector3, to: THREE.Vector3): void {
  const origin = V_R6.setFromMatrixPosition(bone.matrixWorld);
  const u = from.sub(origin).normalize();
  const v = to.sub(origin).normalize();
  const turn = Q_E.setFromUnitVectors(u, v);
  if (1 - Math.abs(turn.w) < 1e-12) return;
  turnWorld(bone, turn);
}

/** Distance between two bones, in world units. */
export function span(a: THREE.Object3D, b: THREE.Object3D): number {
  a.updateWorldMatrix(true, false);
  b.updateWorldMatrix(true, false);
  return V_A.setFromMatrixPosition(a.matrixWorld).distanceTo(V_B.setFromMatrixPosition(b.matrixWorld));
}

const V_A = new THREE.Vector3();
const V_B = new THREE.Vector3();
const V_C = new THREE.Vector3();
const V_D = new THREE.Vector3();
const V_E = new THREE.Vector3();
const V_F = new THREE.Vector3();
const Q_A = new THREE.Quaternion();
const Q_B = new THREE.Quaternion();
const Q_C = new THREE.Quaternion();
const Q_D = new THREE.Quaternion();
const Q_E = new THREE.Quaternion();
const V_G = new THREE.Vector3();
const V_H = new THREE.Vector3();
const V_R1 = new THREE.Vector3();
const V_R2 = new THREE.Vector3();
const V_R3 = new THREE.Vector3();
const V_R4 = new THREE.Vector3();
const V_R5 = new THREE.Vector3();
const V_R6 = new THREE.Vector3();
const M_A = new THREE.Matrix4();
const M_B = new THREE.Matrix4();
