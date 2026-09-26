import * as THREE from 'three';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';

// What the game reads from the soldier's clips when it loads: how fast each
// gait carries the body, and short reactions (a shot's recoil, being hit)
// that play over the upper body on top of whatever else it's doing.

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
  const feet = ['FootL', 'FootR'].map((name) => model.getObjectByName(name)!);
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

/** How far above its lowest a foot still counts as down, in the model's units. */
const DOWN = 0.025;

/** Bones a reaction moves: the spine and head, above the legs and below the arms, which the game poses. */
const UPPER = ['Abdomen', 'Torso', 'Chest', 'Neck', 'Head'];

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
