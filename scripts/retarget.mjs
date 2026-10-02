// Moves clips from Quaternius's Universal Animation Library onto a Rocketbox
// avatar's `Bip01` rig, for scripts/fetch-assets.mjs. The library binds in a
// T-pose and the avatars in an A-pose, so first the avatar's limbs are swung,
// bone by bone, to point the way the library's do at bind. Then each bone
// takes the turn its counterpart makes away from that pose, in world space,
// and the pelvis moves as the library's hips do, scaled by the ratio of their
// heights. Both rigs' feet hang off their shins, so the feet go where the
// legs take them; the game's leg IK plants them. Only the first avatar
// carries the clips: the others' bones are turned to play them as well (see
// rebase).

import { Quaternion, Matrix4, Object3D, Vector3 } from 'three';

/** The avatar's bones and the library bones they follow. Fingers are posed by the game. */
const MAP = {
  'Bip01 Pelvis': 'DEF-hips', 'Bip01 Spine': 'DEF-spine.001', 'Bip01 Spine1': 'DEF-spine.002', 'Bip01 Spine2': 'DEF-spine.003',
  'Bip01 Neck': 'DEF-neck', 'Bip01 Head': 'DEF-head',
};
for (const side of ['L', 'R']) {
  Object.assign(MAP, {
    [`Bip01 ${side} Clavicle`]: `DEF-shoulder.${side}`, [`Bip01 ${side} UpperArm`]: `DEF-upper_arm.${side}`,
    [`Bip01 ${side} Forearm`]: `DEF-forearm.${side}`, [`Bip01 ${side} Hand`]: `DEF-hand.${side}`,
    [`Bip01 ${side} Thigh`]: `DEF-thigh.${side}`, [`Bip01 ${side} Calf`]: `DEF-shin.${side}`,
    [`Bip01 ${side} Foot`]: `DEF-foot.${side}`, [`Bip01 ${side} Toe0`]: `DEF-toe.${side}`,
  });
}
/**
 * The limbs lined up with the library's at bind: each bone and the child
 * (the avatar's, then the library's) it points at.
 */
const ALIGN = ['L', 'R'].flatMap((s) => [
  [`Bip01 ${s} Clavicle`, `Bip01 ${s} UpperArm`, `DEF-upper_arm.${s}`],
  [`Bip01 ${s} UpperArm`, `Bip01 ${s} Forearm`, `DEF-forearm.${s}`],
  [`Bip01 ${s} Forearm`, `Bip01 ${s} Hand`, `DEF-hand.${s}`],
  [`Bip01 ${s} Hand`, `Bip01 ${s} Finger2`, `DEF-f_middle.01.${s}`],
  [`Bip01 ${s} Thigh`, `Bip01 ${s} Calf`, `DEF-shin.${s}`],
  [`Bip01 ${s} Calf`, `Bip01 ${s} Foot`, `DEF-foot.${s}`],
  [`Bip01 ${s} Foot`, `Bip01 ${s} Toe0`, `DEF-toe.${s}`],
]);
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
  joints.sort((a, b) => depth(a.o) - depth(b.o));
  for (const { o, world } of joints) {
    o.parent.updateMatrixWorld(true);
    new Matrix4().copy(o.parent.matrixWorld).invert().multiply(world).decompose(o.position, o.quaternion, o.scale);
    o.updateMatrixWorld(true);
  }
}

const depth = (o) => (o.parent ? depth(o.parent) + 1 : 0);
const at = (o) => o.getWorldPosition(new Vector3());

/** Swing the avatar's limbs, parents first, to point as the library's do at bind. */
function align(src, dst) {
  for (const [bone, child, toward] of ALIGN) {
    const d = dst.named(bone);
    const want = at(src.named(toward)).sub(at(src.named(MAP[bone]))).normalize();
    const now = at(dst.named(child)).sub(at(d)).normalize();
    const world = new Quaternion().setFromUnitVectors(now, want).multiply(d.getWorldQuaternion(new Quaternion()));
    d.quaternion.copy(d.parent.getWorldQuaternion(new Quaternion()).invert().multiply(world));
    d.updateMatrixWorld(true);
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
 * onto the avatar document `to`, as new animations.
 */
export function retarget(from, to, clips) {
  const src = rig(from);
  const dst = rig(to);
  bindPose(from, src);
  bindPose(to, dst);
  // The pelvis and hips' heights above the feet at bind, before the legs are swung.
  const scale = (at(dst.named('Bip01 Pelvis')).y - at(dst.named('Bip01 L Toe0')).y) /
    (at(src.named('DEF-hips')).y - at(src.named('DEF-toe.L')).y);
  align(src, dst);
  const srcRest = new Map([...src.objects.values()].map((o) => [o, { position: o.position.clone(), quaternion: o.quaternion.clone() }]));
  const dstRest = new Map([...dst.objects.values()].map((o) => [o, { position: o.position.clone(), quaternion: o.quaternion.clone() }]));

  // Each pair: the avatar's bone, the library's, and both bind turns in world space.
  const bones = Object.entries(MAP).map(([d, s]) => ({
    d: dst.named(d), s: src.named(s),
    dBind: dst.named(d).getWorldQuaternion(new Quaternion()),
    sBind: src.named(s).getWorldQuaternion(new Quaternion()),
  }));
  bones.sort((a, b) => depth(a.d) - depth(b.d));
  const pelvis = dst.named('Bip01 Pelvis');
  const hips = src.named('DEF-hips');
  const pelvisBind = at(pelvis);
  const hipsBind = at(hips);
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
    for (let f = 0; f < frames; f++) {
      const t = Math.min(f / FPS, duration);
      times[f] = t;
      sample(channels, srcRest, t);
      src.scene.updateMatrixWorld(true);
      for (const [o, r] of dstRest) {
        o.position.copy(r.position);
        o.quaternion.copy(r.quaternion);
      }
      // The hips carry the body, scaled to the avatar's size.
      const shift = at(hips).sub(hipsBind).multiplyScalar(scale);
      pelvis.parent.updateMatrixWorld(true);
      pelvis.position.copy(pelvis.parent.worldToLocal(pelvisBind.clone().add(shift)));
      for (const { d, s, dBind, sBind } of bones) {
        // The library bone's turn away from its bind pose, applied to ours: world = turn * bind.
        const world = s.getWorldQuaternion(new Quaternion()).multiply(sBind.clone().invert()).multiply(dBind);
        d.parent.updateMatrixWorld(true);
        d.quaternion.copy(d.parent.getWorldQuaternion(new Quaternion()).invert().multiply(world));
        d.updateMatrixWorld(true);
      }
      for (const [o, out] of tracks) o.quaternion.toArray(out, f * 4);
      pelvis.position.toArray(moves, f * 3);
    }

    const input = to.createAccessor().setType('SCALAR').setArray(times).setBuffer(buffer);
    const out = to.createAnimation(as);
    const channel = (o, path, array, type) => {
      const sampler = to.createAnimationSampler().setInput(input).setInterpolation('LINEAR')
        .setOutput(to.createAccessor().setType(type).setArray(array).setBuffer(buffer));
      out.addSampler(sampler).addChannel(to.createAnimationChannel().setTargetNode(nodes.get(o)).setTargetPath(path).setSampler(sampler));
    };
    for (const [o, array] of tracks) channel(o, 'rotation', array, 'VEC4');
    channel(pelvis, 'translation', moves, 'VEC3');
    console.log(`  ${name} → ${as}: ${duration.toFixed(2)} s`);
  }
}

/**
 * Turn each bone of the avatar document `to` the clips move so its frame,
 * once its limbs are swung to the library's (`from`) bind, lies as the same
 * bone's does in `ref`'s, keeping the skin where it is: then `ref`'s clips,
 * retargeted onto it, pose `to` just as clips retargeted onto `to` itself
 * would, but for the pelvis's moves, which the game scales to each avatar's
 * size (see src/client/avatars.ts). Every bone's rest is its bind pose, as
 * Blender exports them.
 */
export function rebase(from, ref, to) {
  const src = rig(from);
  bindPose(from, src);
  const r = rig(ref);
  bindPose(ref, r);
  align(src, r);
  const dst = rig(to);
  bindPose(to, dst);
  const mesh = to.getRoot().listNodes().find((n) => n.getSkin());
  const skin = mesh.getSkin();
  const nodes = new Map([...dst.objects].map(([node, o]) => [o, node]));
  // Every bone's world matrix at bind, and as it's to be: turned in its own frame, in place.
  const bind = new Map([...dst.objects.values()].map((o) => [o, o.matrixWorld.clone()]));
  align(src, dst);
  const want = new Map(bind);
  for (const name of ['Bip01', ...Object.keys(MAP)]) {
    const o = dst.named(name);
    const turn = o.getWorldQuaternion(new Quaternion()).invert().multiply(r.named(name).getWorldQuaternion(new Quaternion()));
    want.set(o, bind.get(o).clone().multiply(new Matrix4().makeRotationFromQuaternion(turn)));
  }
  // Each node's rest from its parent's, and the skin bound to the new frames.
  const position = new Vector3();
  const quaternion = new Quaternion();
  const scale = new Vector3();
  for (const [o, world] of want) {
    new Matrix4().copy(want.get(o.parent) ?? o.parent.matrixWorld).invert().multiply(world).decompose(position, quaternion, scale);
    nodes.get(o).setTranslation(position.toArray()).setRotation(quaternion.toArray()).setScale(scale.toArray());
  }
  const meshWorld = bind.get(dst.objects.get(mesh));
  const ibm = skin.getInverseBindMatrices();
  const array = ibm.getArray().slice();
  skin.listJoints().forEach((j, i) => {
    new Matrix4().copy(want.get(dst.objects.get(j))).invert().multiply(meshWorld).toArray(array, i * 16);
  });
  ibm.setArray(array);
}
