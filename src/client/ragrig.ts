import * as THREE from 'three';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { clip } from './clips.ts';
import { JOINT as J, JOINTS, RAGDOLL_STEP, type Ragdoll } from './ragdoll.ts';
import { type BoneName, type Bones, findBones } from './rig.ts';

// The soldier's skeleton, laid over a ragdoll's joints. The ragdoll starts
// from the death clip's pose at a fixed moment (the slump), worked out once
// on a copy of the model; from then on each bone turns from where it was in
// that pose by as much as the joints around it have: the trunk with the
// frames of the hips and shoulders, each limb bone swung to point at its
// joint. Bones are only turned, never stretched, so the skin holds its shape.

/** The bones a ragdoll drives, parents before children. */
const DRIVEN = [
  'body', 'spine', 'torso', 'spine2', 'neck', 'head',
  'lShoulder', 'lArm', 'lForeArm', 'lHand', 'rShoulder', 'rArm', 'rForeArm', 'rHand',
  'lUpLeg', 'lLeg', 'lFoot', 'rUpLeg', 'rLeg', 'rFoot',
] as const satisfies readonly BoneName[];
type Driven = (typeof DRIVEN)[number];
const D = Object.fromEntries(DRIVEN.map((name, i) => [name, i])) as Record<Driven, number>;

/** Where the ragdoll's back joint sits, from the chest bone, in the figure's space at rest: within the ribs. */
const BACK_OFFSET = new THREE.Vector3(0, -0.1, 0.06);

/**
 * The death clip's pose at the moment a ragdoll takes over, in the space of
 * a figure at the origin facing -z: the joints then and a step before (for
 * their speed), and each driven bone's position and world turn then.
 */
export interface Slump {
  now: Float64Array;
  before: Float64Array;
  at: THREE.Vector3[];
  turn: THREE.Quaternion[];
}

/** The slump `time` seconds into the death clip of a soldier drawn at `scale`. */
export function slump(gltf: GLTF, scale: number, time: number): Slump {
  const model = SkeletonUtils.clone(gltf.scene);
  model.scale.setScalar(scale);
  const turned = new THREE.Group();
  turned.rotation.y = Math.PI;
  turned.add(model);
  const figure = new THREE.Group();
  figure.add(turned);
  figure.updateMatrixWorld(true);
  const bones = findBones(model);
  const backAt = bones.spine2.worldToLocal(bones.spine2.getWorldPosition(new THREE.Vector3()).add(BACK_OFFSET));

  const mixer = new THREE.AnimationMixer(model);
  const action = mixer.clipAction(clip(gltf.animations, 'Death')).setLoop(THREE.LoopOnce, 1);
  action.clampWhenFinished = true;
  action.play();
  const joints = (): Float64Array => {
    figure.updateMatrixWorld(true);
    const out = new Float64Array(JOINTS.length * 3);
    const put = (i: number, v: THREE.Vector3): void => void v.toArray(out, i * 3);
    const at = (o: THREE.Object3D): THREE.Vector3 => o.getWorldPosition(new THREE.Vector3());
    put(J.pelvis, at(bones.body));
    put(J.chest, at(bones.spine2));
    put(J.head, at(bones.head).lerp(at(bones.headEnd), 0.4));
    put(J.lShoulder, at(bones.lArm));
    put(J.lElbow, at(bones.lForeArm));
    put(J.lHand, at(bones.lHand));
    put(J.rShoulder, at(bones.rArm));
    put(J.rElbow, at(bones.rForeArm));
    put(J.rHand, at(bones.rHand));
    put(J.lHip, at(bones.lUpLeg));
    put(J.lKnee, at(bones.lLeg));
    put(J.lAnkle, at(bones.lFoot));
    put(J.rHip, at(bones.rUpLeg));
    put(J.rKnee, at(bones.rLeg));
    put(J.rAnkle, at(bones.rFoot));
    put(J.lToe, at(bones.lToeEnd));
    put(J.rToe, at(bones.rToeEnd));
    put(J.back, bones.spine2.localToWorld(backAt.clone()));
    return out;
  };
  mixer.update(time - RAGDOLL_STEP);
  const before = joints();
  mixer.update(RAGDOLL_STEP);
  const now = joints();
  return {
    now, before,
    at: DRIVEN.map((name) => bones[name].getWorldPosition(new THREE.Vector3())),
    turn: DRIVEN.map((name) => bones[name].getWorldQuaternion(new THREE.Quaternion())),
  };
}

/** A soldier's bones following its ragdoll. */
export class RagRig {
  private readonly bones: Bones;
  private readonly rag: Ragdoll;
  /** The slump in the world: joints, bone positions and turns, and the trunk's two frames. */
  private readonly joints: Float64Array;
  private readonly at: THREE.Vector3[];
  private readonly turn: THREE.Quaternion[];
  private readonly hips0: THREE.Quaternion;
  private readonly shoulders0: THREE.Quaternion;

  /** `figure` is where the figure stood as the ragdoll took over; the ragdoll started from `slump` placed there. */
  constructor(bones: Bones, rag: Ragdoll, slump: Slump, figure: THREE.Object3D) {
    this.bones = bones;
    this.rag = rag;
    this.joints = Float64Array.from(rag.pos);
    const q = figure.getWorldQuaternion(new THREE.Quaternion());
    this.at = slump.at.map((v) => figure.localToWorld(v.clone()));
    this.turn = slump.turn.map((t) => t.clone().premultiply(q));
    this.hips0 = this.hips(this.joints, new THREE.Quaternion()).invert();
    this.shoulders0 = this.shoulders(this.joints, new THREE.Quaternion()).invert();
  }

  /** Pose the bones from where the joints are now. The figure's own transform isn't touched. */
  apply(): void {
    const b = this.bones;
    const p = this.rag.pos;
    const lower = this.hips(p, Q_LOWER).multiply(this.hips0);
    const upper = this.shoulders(p, Q_UPPER).multiply(this.shoulders0);
    b.root.updateMatrixWorld(false);

    // The trunk: the hips turn with the hip frame, the chest and collarbones with the shoulders', the spine between.
    const pelvis = joint(p, J.pelvis, V_A);
    const offset = V_B.copy(this.at[D.body]).sub(joint(this.joints, J.pelvis, V_C)).applyQuaternion(lower);
    this.set(b.body, D.body, lower, pelvis.add(offset));
    // The hips bone between, which the ragdoll leaves as it is.
    refresh(b.spine.parent!);
    this.set(b.spine, D.spine, Q_A.slerpQuaternions(lower, upper, 1 / 3));
    this.set(b.torso, D.torso, Q_A.slerpQuaternions(lower, upper, 2 / 3));
    this.set(b.spine2, D.spine2, upper);
    this.set(b.lShoulder, D.lShoulder, upper);
    this.set(b.rShoulder, D.rShoulder, upper);

    // The neck points at the head; each limb bone at its next joint, turning on from its parent.
    const neck = this.swing(b.neck, D.neck, J.head, upper, Q_B);
    this.set(b.head, D.head, neck);
    for (const [arm, fore, hand, dArm, dFore, dHand, elbow, wrist] of [
      [b.lArm, b.lForeArm, b.lHand, D.lArm, D.lForeArm, D.lHand, J.lElbow, J.lHand],
      [b.rArm, b.rForeArm, b.rHand, D.rArm, D.rForeArm, D.rHand, J.rElbow, J.rHand],
    ] as const) {
      const r = this.swing(arm, dArm, elbow, upper, Q_B);
      const f = this.swing(fore, dFore, wrist, r, Q_C);
      this.set(hand, dHand, f);
    }
    for (const [thigh, shin, foot, dThigh, dShin, dFoot, knee, heel, toe] of [
      [b.lUpLeg, b.lLeg, b.lFoot, D.lUpLeg, D.lLeg, D.lFoot, J.lKnee, J.lAnkle, J.lToe],
      [b.rUpLeg, b.rLeg, b.rFoot, D.rUpLeg, D.rLeg, D.rFoot, J.rKnee, J.rAnkle, J.rToe],
    ] as const) {
      const t = this.swing(thigh, dThigh, knee, lower, Q_B);
      const s = this.swing(shin, dShin, heel, t, Q_C);
      this.swing(foot, dFoot, toe, s, Q_D);
    }
  }

  /**
   * Turn a bone as its parent turned (`parent`, a world turn from the slump)
   * and then swing it so it points at joint `to` as it pointed at it then.
   * Returns its whole turn from the slump, in `out`.
   */
  private swing(bone: THREE.Object3D, d: number, to: number, parent: THREE.Quaternion, out: THREE.Quaternion): THREE.Quaternion {
    const from = joint(this.joints, to, V_A).sub(this.at[d]).applyQuaternion(parent).normalize();
    const at = bone.parent!.localToWorld(V_C.copy(bone.position));
    const now = joint(this.rag.pos, to, V_B).sub(at).normalize();
    out.setFromUnitVectors(from, now).multiply(parent);
    this.set(bone, d, out);
    return out;
  }

  /** Give a bone its slump turn after `turn`, and a world position if given. */
  private set(bone: THREE.Object3D, d: number, turn: THREE.Quaternion, at?: THREE.Vector3): void {
    const parent = bone.parent!;
    parent.matrixWorld.decompose(V_D, Q_P, V_S);
    bone.quaternion.copy(Q_P).invert().multiply(Q_T.copy(turn).multiply(this.turn[d]));
    if (at) bone.position.copy(parent.worldToLocal(V_D.copy(at)));
    refresh(bone);
  }

  /** The hips' frame: across the hips, and up the spine. */
  private hips(p: ArrayLike<number>, out: THREE.Quaternion): THREE.Quaternion {
    const across = joint(p, J.rHip, V_A).sub(joint(p, J.lHip, V_B));
    const up = joint(p, J.chest, V_B).sub(joint(p, J.pelvis, V_C));
    return frame(across, up, out);
  }

  /** The shoulders' frame: across them, and up from the pelvis to between them. */
  private shoulders(p: ArrayLike<number>, out: THREE.Quaternion): THREE.Quaternion {
    const across = joint(p, J.rShoulder, V_A).sub(joint(p, J.lShoulder, V_B));
    const up = joint(p, J.lShoulder, V_B).add(joint(p, J.rShoulder, V_C)).multiplyScalar(0.5).sub(joint(p, J.pelvis, V_C));
    return frame(across, up, out);
  }
}

function joint(p: ArrayLike<number>, i: number, out: THREE.Vector3): THREE.Vector3 {
  return out.set(p[i * 3], p[i * 3 + 1], p[i * 3 + 2]);
}

/** A turn from x along `across` and y as near `up` as it can be. Both vectors are used up. */
function frame(across: THREE.Vector3, up: THREE.Vector3, out: THREE.Quaternion): THREE.Quaternion {
  const x = across.normalize();
  const z = V_Z.crossVectors(x, up).normalize();
  const y = up.crossVectors(z, x);
  return out.setFromRotationMatrix(M.makeBasis(x, y, z));
}

/** Bring one bone's world matrix up to date from its parent's, leaving its children. */
function refresh(bone: THREE.Object3D): void {
  bone.updateMatrix();
  bone.matrixWorld.multiplyMatrices(bone.parent!.matrixWorld, bone.matrix);
}

const V_A = new THREE.Vector3();
const V_B = new THREE.Vector3();
const V_C = new THREE.Vector3();
const V_D = new THREE.Vector3();
const V_S = new THREE.Vector3();
const V_Z = new THREE.Vector3();
const Q_A = new THREE.Quaternion();
const Q_B = new THREE.Quaternion();
const Q_C = new THREE.Quaternion();
const Q_D = new THREE.Quaternion();
const Q_P = new THREE.Quaternion();
const Q_T = new THREE.Quaternion();
const Q_LOWER = new THREE.Quaternion();
const Q_UPPER = new THREE.Quaternion();
const M = new THREE.Matrix4();
