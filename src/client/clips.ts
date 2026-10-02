import * as THREE from 'three';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { lerp, TAU } from '../shared/geom.ts';
import { bone, boneName, BONES, placeWorld, reach, span, turnWorld } from './rig.ts';

// What the game reads from the soldier's clips when it loads: how fast each
// gait carries the body, and short reactions (a shot's recoil, being hit)
// that play over the upper body on top of whatever else it's doing. It also
// keys one clip by hand, the crouched run, which no CC0 library has.

/**
 * `clips`, keyed for the avatar in `from`, for the one in `to`, both at rest.
 * Every avatar's bones are turned to take the same turns (see
 * scripts/retarget.mjs), but each one's pelvis moves as far for its height,
 * from where it rests.
 */
export function clipsFor(from: THREE.Object3D, to: THREE.Object3D, clips: THREE.AnimationClip[]): THREE.AnimationClip[] {
  if (from === to) return clips;
  const rest = (scene: THREE.Object3D): { at: THREE.Vector3; height: number } => {
    scene.updateMatrixWorld(true);
    const y = (name: string): number => bone(scene, name).getWorldPosition(new THREE.Vector3()).y;
    return { at: bone(scene, BONES.body).position.clone(), height: y(BONES.body) - y(BONES.lToe) };
  };
  const a = rest(from);
  const b = rest(to);
  const scale = b.height / a.height;
  const track = `${boneName('body')}.position`;
  return clips.map((c) => {
    const out = c.clone();
    for (const t of out.tracks) {
      if (t.name !== track) continue;
      for (let i = 0; i < t.values.length; i += 3) {
        V_CLIP.fromArray(t.values, i).sub(a.at).multiplyScalar(scale).add(b.at).toArray(t.values, i);
      }
    }
    return out;
  });
}

const V_CLIP = new THREE.Vector3();

export function clip(clips: THREE.AnimationClip[], name: string): THREE.AnimationClip {
  const c = THREE.AnimationClip.findByName(clips, name);
  if (!c) throw new Error(`Soldier has no ${name} animation`);
  return c;
}

/**
 * How fast a looping gait carries the body, in the model's units per second,
 * from its feet: in place, each foot slides back under the body while it's
 * planted, at the speed the body would move. Only the frames where a foot is
 * within a few centimetres of its lowest count, which is its time on the ground.
 */
export function gaitSpeed(scene: THREE.Object3D, gait: THREE.AnimationClip): number {
  const model = SkeletonUtils.clone(scene);
  const mixer = new THREE.AnimationMixer(model);
  mixer.clipAction(gait).play();
  const feet = (['lFoot', 'rFoot'] as const).map((key) => model.getObjectByName(boneName(key))!);
  const steps = 120;
  const dt = gait.duration / steps;
  const path = feet.map(() => [] as THREE.Vector3[]);
  for (let i = 0; i <= steps; i++) {
    mixer.setTime(i * dt);
    model.updateMatrixWorld(true);
    feet.forEach((foot, k) => path[k].push(foot.getWorldPosition(new THREE.Vector3())));
  }
  let back = 0;
  let time = 0;
  for (const at of path) {
    const low = Math.min(...at.map((p) => p.y)) + DOWN;
    for (let i = 1; i < at.length; i++) {
      // The model faces +z: a planted foot slides toward -z.
      if (at[i].y > low || at[i - 1].y > low || at[i].z > at[i - 1].z) continue;
      back += at[i - 1].z - at[i].z;
      time += dt;
    }
  }
  return time > 0 ? back / time : 0;
}

/**
 * The crouched run, keyed by hand in the model's units: low over bent knees,
 * bent forward at the hips with the head up, in short quick strides that
 * keep the feet near the ground. The model faces +z with its left to +x.
 */
const LOW_RUN = {
  /** Seconds a stride takes, left foot down to left foot down. */
  duration: 0.66,
  /** Share of the stride a foot is on the ground. */
  stance: 0.42,
  /** The hips: how high, how far back of the feet, how far they dip after each footfall, and how they sway and twist. */
  hips: 0.6, back: -0.42, dip: 0.025, sway: 0.02, twist: 0.12, roll: 0.04,
  /** Forward bend at the hips, then down the spine, and back up at the neck and head so the eyes stay ahead. */
  bend: 0.65, spine: [0.1, 0.1, 0.05], look: [-0.35, -0.3],
  /** How far apart the feet run. */
  width: 0.12,
  /**
   * One foot's swing after it leaves the ground, as [share of the stride,
   * forward, up, toe-down pitch]: it pushes off on the toe, kicks up a little
   * behind, comes through low with the knee up, reaches and pulls back to
   * land on the heel. Before it, the foot slides back on the ground from the
   * last key to the first.
   */
  swing: [
    [0.42, -0.4, 0.09, 0.5],
    [0.55, -0.46, 0.2, 0.6],
    [0.7, -0.19, 0.24, 0.3],
    [0.85, 0.16, 0.14, -0.05],
    [0.95, 0.24, 0.04, -0.2],
    [1, 0.2, 0, -0.12],
  ],
};

/**
 * The crouched run, as a clip for the soldier in `scene`. Every bone either
 * of `others` moves is keyed, so it blends with them: the spine and feet by
 * hand (LOW_RUN), the legs bent to reach the feet, and the rest held at the
 * run's average, for the game poses the arms.
 */
export function crouchRun(scene: THREE.Object3D, run: THREE.AnimationClip, others: THREE.AnimationClip[]): THREE.AnimationClip {
  const model = SkeletonUtils.clone(scene);
  const bone = (name: string): THREE.Object3D => model.getObjectByName(name)!;
  const key = (k: Parameters<typeof boneName>[0]): THREE.Object3D => bone(boneName(k));
  const feet = [key('lFoot'), key('rFoot')];
  const legs = [[key('lUpLeg'), key('lLeg')], [key('rUpLeg'), key('rLeg')]];
  // The run's average pose, upright and square, which the keys below turn from; and each foot flat on the
  // ground, as the run has it where the foot is lowest.
  const mixer = new THREE.AnimationMixer(model);
  mixer.clipAction(run).play();
  const names = [...new Set([run, ...others].flatMap((c) => c.tracks.map((t) => t.name.split('.')[0])))];
  const base = new Map(names.map((n) => [n, new THREE.Vector4()]));
  const flat = feet.map(() => new THREE.Quaternion());
  const lowest = feet.map(() => Infinity);
  const samples = 24;
  for (let i = 0; i < samples; i++) {
    mixer.setTime((i / samples) * run.duration);
    model.updateMatrixWorld(true);
    for (const [n, sum] of base) {
      const q = bone(n).quaternion;
      // Kept in one hemisphere, so the average doesn't cancel out.
      const sign = sum.dot(V4.set(q.x, q.y, q.z, q.w)) < 0 ? -1 : 1;
      sum.addScaledVector(V4, sign);
    }
    feet.forEach((foot, k) => {
      const y = foot.getWorldPosition(V).y;
      if (y >= lowest[k]) return;
      lowest[k] = y;
      foot.getWorldQuaternion(flat[k]);
    });
  }
  mixer.stopAllAction();
  const rest = new Map([...base].map(([n, sum]) => [n, new THREE.Quaternion(sum.x, sum.y, sum.z, sum.w).normalize()]));
  // The ankle's height with the foot flat.
  const ground = Math.min(...lowest);
  const thigh = span(legs[0][0], legs[0][1]);
  const shin = span(legs[0][1], feet[0]);

  const L = LOW_RUN;
  const frames = 30;
  const times = new Float32Array(frames + 1);
  const body = key('body');
  const turns = new Map(names.map((n) => [n, new Float32Array((frames + 1) * 4)]));
  const moves = new Float32Array((frames + 1) * 3);
  const spine = [key('spine'), key('torso'), key('spine2')];
  const look = [key('neck'), key('head')];
  const X = new THREE.Vector3(1, 0, 0);
  const Y = new THREE.Vector3(0, 1, 0);
  const Z = new THREE.Vector3(0, 0, 1);
  const turn = (b: THREE.Object3D, axis: THREE.Vector3, angle: number): void => {
    turnWorld(b, Q.setFromAxisAngle(axis, angle));
  };
  for (let f = 0; f <= frames; f++) {
    const u = f / frames;
    times[f] = u * L.duration;
    for (const [n, q] of rest) bone(n).quaternion.copy(q);
    model.updateMatrixWorld(true);
    // The hips dip as each foot takes the weight, sway over it, and twist with the legs: left hip forward as the
    // left foot lands.
    const dip = -Math.cos(2 * TAU * (u - 0.12));
    placeWorld(body, V.set(L.sway * Math.cos(TAU * (u - 0.2)), L.hips + L.dip * dip, L.back));
    turn(body, Y, -L.twist * Math.cos(TAU * u));
    turn(body, X, L.bend);
    turn(body, Z, L.roll * Math.sin(TAU * u));
    model.updateMatrixWorld(true);
    // The chest stays square to the gun, the spine bent on over, and the head up.
    spine.forEach((b, i) => {
      if (i === 1) turn(b, Y, L.twist * Math.cos(TAU * u));
      turn(b, X, L.spine[i]);
    });
    look.forEach((b, i) => turn(b, X, L.look[i]));
    // The legs reach for the feet, knees out front, and each foot is turned as keyed.
    feet.forEach((foot, i) => {
      const [z, y, pitch] = footAt((u + i * 0.5) % 1);
      const [upper, lower] = legs[i];
      const target = V.set(i === 0 ? L.width : -L.width, ground + y, z);
      reach(upper, lower, foot, target, V2.copy(upper.getWorldPosition(V3)).add(Z), thigh, shin);
      foot.parent!.getWorldQuaternion(Q2);
      foot.quaternion.copy(Q2.invert()).multiply(Q3.setFromAxisAngle(X, pitch)).multiply(flat[i]);
    });
    model.updateMatrixWorld(true);
    for (const [n, out] of turns) bone(n).quaternion.toArray(out, f * 4);
    body.position.toArray(moves, f * 3);
  }
  const tracks: THREE.KeyframeTrack[] = [
    ...[...turns].map(([n, v]) => new THREE.QuaternionKeyframeTrack(`${n}.quaternion`, times, v)),
    new THREE.VectorKeyframeTrack(`${body.name}.position`, times, moves),
  ];
  return new THREE.AnimationClip('CrouchRun', L.duration, tracks);
}

/**
 * Where one foot of the crouched run is `u` of the way through its stride
 * from landing, as [forward, up, toe-down pitch]: sliding back along the
 * ground, then through the swing's keys, smoothly.
 */
function footAt(u: number): [number, number, number] {
  const keys = LOW_RUN.swing;
  const [land, off] = [keys[keys.length - 1], keys[0]];
  if (u < LOW_RUN.stance) {
    const k = u / LOW_RUN.stance;
    // Rolling from the heel onto the flat foot, then toward the toe.
    return [lerp(land[1], off[1], k), lerp(0, off[2], Math.max(k * 4 - 3, 0) ** 2), lerp(land[3], off[3], k ** 3)];
  }
  // Catmull-Rom through the swing's keys, carried on past each end by the ground's slide.
  let i = 0;
  while (keys[i + 1][0] < u) i++;
  const ahead = (k: number): number[] => {
    if (k < 0) return [LOW_RUN.stance * 0.75, lerp(land[1], off[1], 0.75), 0, lerp(land[3], off[3], 0.75 ** 3)];
    if (k >= keys.length) return [1 + LOW_RUN.stance * 0.25, lerp(land[1], off[1], 0.25), 0, lerp(land[3], off[3], 0.25 ** 3)];
    return keys[k];
  };
  const [p0, p1, p2, p3] = [ahead(i - 1), keys[i], keys[i + 1], ahead(i + 2)];
  const t = (u - p1[0]) / (p2[0] - p1[0]);
  const out: [number, number, number] = [0, 0, 0];
  for (let c = 1; c <= 3; c++) {
    const [a, b, d, e] = [p0[c], p1[c], p2[c], p3[c]];
    out[c - 1] = 0.5 * (2 * b + (d - a) * t + (2 * a - 5 * b + 4 * d - e) * t * t + (3 * b - a - 3 * d + e) * t * t * t);
  }
  out[1] = Math.max(out[1], 0);
  return out;
}

const V = new THREE.Vector3();
const V2 = new THREE.Vector3();
const V3 = new THREE.Vector3();
const V4 = new THREE.Vector4();
const Q = new THREE.Quaternion();
const Q2 = new THREE.Quaternion();
const Q3 = new THREE.Quaternion();

/** How far above its lowest a foot still counts as down, in the model's units. */
const DOWN = 0.025;

/** Bones a reaction moves: the spine and head, above the legs and below the arms, which the game poses. */
const UPPER = (['spine', 'torso', 'spine2', 'neck', 'head'] as const).map(boneName);

/**
 * A clip's movement of the upper body away from its first frame, to be laid
 * over any pose: each bone turns by the clip's turn since the start.
 */
export class Reaction {
  readonly duration: number;
  private readonly tracks: { bone: string; ref: THREE.Quaternion; sample: THREE.Interpolant }[] = [];

  constructor(source: THREE.AnimationClip) {
    this.duration = source.duration;
    for (const track of source.tracks) {
      const [bone, property] = track.name.split('.');
      if (property !== 'quaternion' || !UPPER.includes(bone)) continue;
      const ref = new THREE.Quaternion().fromArray(track.values, 0).invert();
      const sample = new THREE.QuaternionLinearInterpolant(track.times, track.values, 4, new Float32Array(4));
      this.tracks.push({ bone, ref, sample });
    }
  }

  /** The bones it moves, found in a soldier. */
  bones(model: THREE.Object3D): THREE.Object3D[] {
    return this.tracks.map((t) => model.getObjectByName(t.bone)!);
  }

  /** Turn `bones` (as `bones()` found them) by the reaction `t` seconds in, scaled by `weight`. */
  apply(bones: THREE.Object3D[], t: number, weight: number): void {
    if (weight <= 0 || t >= this.duration) return;
    this.tracks.forEach((track, i) => {
      Q_A.fromArray(track.sample.evaluate(t) as unknown as number[]);
      Q_A.premultiply(track.ref);
      if (weight < 1) Q_A.slerp(Q_ID, 1 - weight);
      bones[i].quaternion.multiply(Q_A);
    });
  }
}

const Q_A = new THREE.Quaternion();
const Q_ID = new THREE.Quaternion();
