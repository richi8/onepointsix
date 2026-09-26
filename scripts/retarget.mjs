// Moves clips from Quaternius's Universal Animation Library onto the soldier's
// rig, for scripts/fetch-assets.mjs. Both rigs are bound in a T-pose facing
// +z, so each bone takes the turn its counterpart makes away from its own
// bind pose, in world space; the hips' movement is scaled by the ratio of hip
// heights. The soldier's feet hang off its root rather than its shins (an IK
// rig), so each foot moves as the library's does, and the game's leg IK
// reaches for it.

import { Quaternion, Matrix4, Object3D, Vector3 } from 'three';

/** The soldier's bones and the library bones they follow. Fingers are posed by the game. */
const MAP = {
  Body: 'DEF-hips', Hips: 'DEF-hips',
  Abdomen: 'DEF-spine.001', Torso: 'DEF-spine.002', Chest: 'DEF-spine.003', Neck: 'DEF-neck', Head: 'DEF-head',
  'Shoulder.L': 'DEF-shoulder.L', 'UpperArm.L': 'DEF-upper_arm.L', 'LowerArm.L': 'DEF-forearm.L', 'Wrist.L': 'DEF-hand.L',
  'Shoulder.R': 'DEF-shoulder.R', 'UpperArm.R': 'DEF-upper_arm.R', 'LowerArm.R': 'DEF-forearm.R', 'Wrist.R': 'DEF-hand.R',
  'UpperLeg.L': 'DEF-thigh.L', 'LowerLeg.L': 'DEF-shin.L', 'Foot.L': 'DEF-foot.L',
  'UpperLeg.R': 'DEF-thigh.R', 'LowerLeg.R': 'DEF-shin.R', 'Foot.R': 'DEF-foot.R',
};
/** Samples a second: resampling drops the keys a straight line would give anyway. */
const FPS = 20;

/** A glTF-Transform document's default scene as three.js objects, which can be posed by its clips. */
function rig(doc) {
  const root = doc.getRoot();
  const objects = new Map();
  const scene = new Object3D();
  const build = (node, parent) => {
    const o = new Object3D();
    o.name = node.getName();
    o.position.fromArray(node.getTranslation());
    o.quaternion.fromArray(node.getRotation());
    o.scale.fromArray(node.getScale());
    objects.set(node, o);
    parent.add(o);
    for (const child of node.listChildren()) build(child, o);
  };
  for (const node of root.getDefaultScene().listChildren()) build(node, scene);
  scene.updateMatrixWorld(true);
  const named = (name) => {
    const o = scene.getObjectByName(name);
    if (!o) throw new Error(`No ${name} bone`);
    return o;
  };
  return { scene, objects, named };
}

/**
 * Put a rig's bones in the pose its skin was bound in, worked out from the
 * inverse bind matrices, since a node's own transform can be any pose.
 */
function bindPose(doc, r) {
  const mesh = doc.getRoot().listNodes().find((n) => n.getSkin());
  const skin = mesh.getSkin();
  const ibm = skin.getInverseBindMatrices().getArray();
  const meshWorld = r.objects.get(mesh).matrixWorld;
  const joints = skin.listJoints().map((j, i) => ({
    o: r.objects.get(j),
    world: new Matrix4().fromArray(ibm, i * 16).invert().premultiply(meshWorld),
  }));
  // Parents before children, so each local transform is taken against its posed parent.
  const depth = (o) => (o.parent ? depth(o.parent) + 1 : 0);
  joints.sort((a, b) => depth(a.o) - depth(b.o));
  for (const { o, world } of joints) {
    o.parent.updateMatrixWorld(true);
    new Matrix4().copy(o.parent.matrixWorld).invert().multiply(world).decompose(o.position, o.quaternion, o.scale);
    o.updateMatrixWorld(true);
  }
}

/** Pose a rig by one of its clips at `t` seconds, from where `rest` left each bone. */
function sample(channels, rest, t) {
  for (const [o, r] of rest) {
    o.position.copy(r.position);
    o.quaternion.copy(r.quaternion);
  }
  for (const { o, path, times, values, step } of channels) {
    let i = 0;
    while (i < times.length - 1 && times[i + 1] <= t) i++;
    const j = Math.min(i + 1, times.length - 1);
    const k = step || j === i ? 0 : Math.min(Math.max((t - times[i]) / (times[j] - times[i]), 0), 1);
    if (path === 'rotation') {
      o.quaternion.fromArray(values, i * 4).slerp(Q.fromArray(values, j * 4), k);
    } else if (path === 'translation') {
      o.position.fromArray(values, i * 3).lerp(V.fromArray(values, j * 3), k);
    }
  }
}

const Q = new Quaternion();
const V = new Vector3();

/**
 * Copy `clips` (source name to new name) from the library document `from`
 * onto the soldier document `to`, as new animations.
 */
export function retarget(from, to, clips) {
  const src = rig(from);
  const dst = rig(to);
  bindPose(to, dst);
  const srcRest = new Map([...src.objects.values()].map((o) => [o, { position: o.position.clone(), quaternion: o.quaternion.clone() }]));
  const dstRest = new Map([...dst.objects.values()].map((o) => [o, { position: o.position.clone(), quaternion: o.quaternion.clone() }]));

  // Each pair: the soldier's bone, the library's, and both bind turns in world space.
  const bones = Object.entries(MAP).map(([d, s]) => ({
    d: dst.named(d), s: src.named(s),
    dBind: dst.named(d).getWorldQuaternion(new Quaternion()),
    sBind: src.named(s).getWorldQuaternion(new Quaternion()),
  }));
  const depth = (o) => (o.parent ? depth(o.parent) + 1 : 0);
  bones.sort((a, b) => depth(a.d) - depth(b.d));
  const body = dst.named('Body');
  const hips = src.named('DEF-hips');
  const bodyBind = body.getWorldPosition(new Vector3());
  const hipsBind = hips.getWorldPosition(new Vector3());
  // Heights above the feet, in each rig's world units.
  const scale = (bodyBind.y - dst.named('Foot.L').getWorldPosition(new Vector3()).y) /
    (hipsBind.y - src.named('DEF-toe.L').getWorldPosition(new Vector3()).y);
  // Each foot and the library's foot it follows, where both stand at bind.
  const feet = ['L', 'R'].map((side) => {
    const foot = dst.named(`Foot.${side}`);
    const from = src.named(`DEF-foot.${side}`);
    return { foot, from, at: foot.getWorldPosition(new Vector3()), fromAt: from.getWorldPosition(new Vector3()) };
  });
  const nodes = new Map([...dst.objects].map(([node, o]) => [o, node]));

  const root = to.getRoot();
  const buffer = root.listBuffers()[0];
  for (const [name, as] of Object.entries(clips)) {
    const anim = from.getRoot().listAnimations().find((a) => a.getName() === name);
    if (!anim) throw new Error(`The library has no ${name} clip`);
    const channels = anim.listChannels().map((c) => ({
      o: src.objects.get(c.getTargetNode()), path: c.getTargetPath(),
      times: c.getSampler().getInput().getArray(), values: c.getSampler().getOutput().getArray(),
      step: c.getSampler().getInterpolation() === 'STEP',
    }));
    const duration = Math.max(...channels.map((c) => c.times[c.times.length - 1]));
    const frames = Math.round(duration * FPS) + 1;
    const times = new Float32Array(frames);
    const tracks = new Map(bones.map(({ d }) => [d, new Float32Array(frames * 4)]));
    const moves = new Float32Array(frames * 3);
    const feetAt = feet.map(() => new Float32Array(frames * 3));
    for (let f = 0; f < frames; f++) {
      const t = Math.min(f / FPS, duration);
      times[f] = t;
      sample(channels, srcRest, t);
      src.scene.updateMatrixWorld(true);
      for (const [o, r] of dstRest) {
        o.position.copy(r.position);
        o.quaternion.copy(r.quaternion);
      }
      // The hips carry the body, scaled to the soldier's size.
      const shift = hips.getWorldPosition(new Vector3()).sub(hipsBind).multiplyScalar(scale);
      body.position.copy(body.parent.worldToLocal(bodyBind.clone().add(shift)));
      for (const { d, s, dBind, sBind } of bones) {
        // The library bone's turn away from its bind pose, applied to ours: world = turn * bind.
        const world = s.getWorldQuaternion(new Quaternion()).multiply(sBind.clone().invert()).multiply(dBind);
        d.parent.updateMatrixWorld(true);
        d.quaternion.copy(d.parent.getWorldQuaternion(new Quaternion()).invert().multiply(world));
        d.updateMatrixWorld(true);
      }
      dst.scene.updateMatrixWorld(true);
      // Each foot moves as the library's does, scaled; the game's leg IK reaches for it.
      feet.forEach(({ foot, from, at, fromAt }, i) => {
        const moved = from.getWorldPosition(new Vector3()).sub(fromAt).multiplyScalar(scale);
        foot.position.copy(foot.parent.worldToLocal(at.clone().add(moved)));
        foot.position.toArray(feetAt[i], f * 3);
      });
      for (const [o, out] of tracks) o.quaternion.toArray(out, f * 4);
      body.position.toArray(moves, f * 3);
    }

    const input = to.createAccessor().setType('SCALAR').setArray(times).setBuffer(buffer);
    const out = to.createAnimation(as);
    const channel = (o, path, array, type) => {
      const sampler = to.createAnimationSampler().setInput(input).setInterpolation('LINEAR')
        .setOutput(to.createAccessor().setType(type).setArray(array).setBuffer(buffer));
      out.addSampler(sampler).addChannel(to.createAnimationChannel().setTargetNode(nodes.get(o)).setTargetPath(path).setSampler(sampler));
    };
    for (const [o, array] of tracks) channel(o, 'rotation', array, 'VEC4');
    channel(body, 'translation', moves, 'VEC3');
    feet.forEach(({ foot }, i) => channel(foot, 'translation', feetAt[i], 'VEC3'));
    console.log(`  ${name} → ${as}: ${duration.toFixed(2)} s`);
  }
}
