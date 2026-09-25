import * as THREE from 'three';
import { clamp } from '../shared/geom.ts';

// Posing the soldier's skeleton by hand, on top of (or instead of) its clips:
// turning bones in world space, two-bone IK for arms and legs, and closing
// the hands around a grip. Shared by the bodies in the world and the arms in
// first person.

/**
 * Bones posed by hand, as named in Quaternius's rig. Its feet hang off the
 * root, not the shins: the clips place them, and the legs reach for them.
 * The body carries the pelvis, the legs and the upper body.
 */
export const BONES = {
  root: 'Root', body: 'Body', spine: 'Abdomen', spine2: 'Chest', neck: 'Neck', head: 'Head', headEnd: 'Head_end',
  lShoulder: 'Shoulder.L', lArm: 'UpperArm.L', lForeArm: 'LowerArm.L', lHand: 'Wrist.L',
  rShoulder: 'Shoulder.R', rArm: 'UpperArm.R', rForeArm: 'LowerArm.R', rHand: 'Wrist.R',
  lUpLeg: 'UpperLeg.L', lLeg: 'LowerLeg.L', lAnkle: 'LowerLeg.L_end', lFoot: 'Foot.L',
  rUpLeg: 'UpperLeg.R', rLeg: 'LowerLeg.R', rAnkle: 'LowerLeg.R_end', rFoot: 'Foot.R',
} as const;
export type BoneName = keyof typeof BONES;
export type Bones = Record<BoneName, THREE.Object3D>;

const FINGERS = ['Index', 'Middle', 'Ring', 'Pinky'];

/** The rig's bones, found by name; the loader drops the dots from node names. */
export function findBones(model: THREE.Object3D): Bones {
  const bones = {} as Bones;
  for (const [key, name] of Object.entries(BONES)) bones[key as BoneName] = bone(model, name);
  return bones;
}

function bone(model: THREE.Object3D, name: string): THREE.Object3D {
  const b = model.getObjectByName(THREE.PropertyBinding.sanitizeNodeName(name));
  if (!b) throw new Error(`Soldier has no ${name} bone`);
  return b;
}

/**
 * The model's gloved hands are oversized for real guns (it's stylized), so
 * they're drawn smaller. Only the hands: the arms keep their length.
 */
const HAND_SCALE = 0.8;

/** A hand's finger joints, to curl around a grip, with the pose they rest in. */
export interface Hand {
  wrist: THREE.Object3D;
  /** Knuckle to tip, finger by finger, then the thumb. */
  joints: THREE.Object3D[][];
  rest: THREE.Quaternion[][];
  /** Where the fingers leave the palm, in the wrist's own space, and which way the thumb points. */
  knuckles: THREE.Vector3;
  thumb: THREE.Vector3;
}

export function findHand(model: THREE.Object3D, side: 'L' | 'R'): Hand {
  const wrist = bone(model, `Wrist.${side}`);
  // Each finger's first bone runs through the palm from the wrist to the knuckle.
  const joints = FINGERS.map((f) => [1, 2, 3, 4].map((i) => bone(model, `${f}${i}.${side}`)));
  joints.push([1, 2, 3].map((i) => bone(model, `Thumb${i}.${side}`)));
  model.updateMatrixWorld(true);
  // Fingers run along their bones' y axes; the middle knuckle marks the palm's far edge.
  const knuckles = wrist.worldToLocal(joints[1][1].getWorldPosition(new THREE.Vector3()));
  const thumb = wrist.worldToLocal(joints[4][2].getWorldPosition(new THREE.Vector3()));
  wrist.scale.multiplyScalar(HAND_SCALE);
  return { wrist, joints, rest: joints.map((js) => js.map((j) => j.quaternion.clone())), knuckles, thumb };
}

/** How far each joint bends in a closed hand, knuckle to tip, and the thumb's. */
const FINGER_CURL = [0.05, 1.0, 0.85, 0.5];
const THUMB_CURL = [0.8, -0.4, -0.4];

/** Curl the fingers by `amount`, 0 open to 1 closed around a grip. */
export function curl(hand: Hand, amount: number): void {
  hand.joints.forEach((joints, f) => {
    const bend = f === 4 ? THUMB_CURL : FINGER_CURL;
    joints.forEach((j, i) => {
      j.quaternion.copy(hand.rest[f][i]);
      // Fingers close about their joints' x axes; the thumb folds in across the palm.
      j.quaternion.multiply(Q_A.setFromAxisAngle(X_AXIS, -bend[i] * amount));
    });
  });
}

/**
 * Turn a hand so its fingers point along `along` and its thumb side faces
 * `thumb`, both world directions. The knuckles then follow.
 */
export function orientHand(hand: Hand, along: THREE.Vector3, thumb: THREE.Vector3): void {
  const w = hand.wrist;
  w.parent!.getWorldQuaternion(Q_A);
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

/** How far the middle of the palm is from the wrist, along the fingers and out of the palm. */
const PALM_LENGTH = 0.07 * HAND_SCALE;
const PALM_DEPTH = 0.035 * HAND_SCALE;

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
  const parent = bone.parent!;
  parent.getWorldQuaternion(Q_A);
  // local' = parent^-1 * R * parent * local
  Q_B.setFromAxisAngle(axis, angle);
  Q_C.copy(Q_A).invert().multiply(Q_B).multiply(Q_A);
  bone.quaternion.premultiply(Q_C);
  bone.updateMatrixWorld(true);
}

/** Shift a bone by a world-space offset. */
export function moveWorld(bone: THREE.Object3D, offset: THREE.Vector3): void {
  const world = bone.getWorldPosition(V_A).add(offset);
  placeWorld(bone, world);
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
  const s = upper.getWorldPosition(new THREE.Vector3());
  const toTarget = target.clone().sub(s);
  const c = clamp(toTarget.length(), Math.abs(a - b) + 1e-3, a + b - 1e-3);
  const dir = toTarget.normalize();
  // Where the middle joint must be: along the reach by x, out toward the pole by h.
  const x = (a * a - b * b + c * c) / (2 * c);
  const h = Math.sqrt(Math.max(a * a - x * x, 0));
  const bend = pole.clone().sub(s);
  bend.addScaledVector(dir, -bend.dot(dir));
  if (bend.lengthSq() < 1e-8) bend.set(0, -1, 0);
  bend.normalize();
  const joint = s.clone().addScaledVector(dir, x).addScaledVector(bend, h);

  aimBone(upper, lower.getWorldPosition(new THREE.Vector3()), joint);
  aimBone(lower, end.getWorldPosition(new THREE.Vector3()), s.addScaledVector(dir, c));
}

/** Turn a bone so the child now at `from` swings to `to`. */
export function aimBone(bone: THREE.Object3D, from: THREE.Vector3, to: THREE.Vector3): void {
  const origin = bone.getWorldPosition(new THREE.Vector3());
  const u = from.sub(origin).normalize();
  const v = to.sub(origin).normalize();
  const turn = new THREE.Quaternion().setFromUnitVectors(u, v);
  const axis = new THREE.Vector3(turn.x, turn.y, turn.z);
  const sin = axis.length();
  if (sin < 1e-6) return;
  rotateWorld(bone, axis.divideScalar(sin), 2 * Math.atan2(sin, turn.w));
}

/** Distance between two bones, in world units. */
export function span(a: THREE.Object3D, b: THREE.Object3D): number {
  return a.getWorldPosition(V_A).distanceTo(b.getWorldPosition(V_B));
}

const X_AXIS = new THREE.Vector3(1, 0, 0);
const V_A = new THREE.Vector3();
const V_B = new THREE.Vector3();
const V_C = new THREE.Vector3();
const V_D = new THREE.Vector3();
const V_E = new THREE.Vector3();
const V_F = new THREE.Vector3();
const Q_A = new THREE.Quaternion();
const Q_B = new THREE.Quaternion();
const Q_C = new THREE.Quaternion();
const M_A = new THREE.Matrix4();
const M_B = new THREE.Matrix4();
