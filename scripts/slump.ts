// Writes test/slump.json: each soldier's death clip where the ragdoll takes
// over, as ragrig.ts works it out in the game, for the unit tests, by avatar.
// The models' textures are dropped, as Node can't decode them.
// Run: node scripts/slump.ts > test/slump.json

import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTMeshoptCompression } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clipsFor } from '../src/client/clips.ts';
import { slump } from '../src/client/ragrig.ts';
import { AVATAR_NAMES } from '../src/shared/avatars.ts';
import { PLAYER_HEIGHT } from '../src/shared/constants.ts';

await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });

async function load(name: string) {
  const doc = await io.read(`public/assets/soldiers/${name}.glb`);
  for (const t of doc.getRoot().listTextures()) t.dispose();
  for (const e of doc.getRoot().listExtensionsUsed()) if (e instanceof EXTMeshoptCompression || e.extensionName === 'KHR_texture_basisu') e.dispose();
  const glb = await io.writeBinary(doc);
  return new GLTFLoader().parseAsync(glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.byteLength) as ArrayBuffer, '');
}

const reference = await load(AVATAR_NAMES[0]);
const r = (a: Float64Array) => Array.from(a, (v) => Math.round(v * 1000) / 1000);
const out: Record<string, { now: number[]; before: number[] }> = {};
for (const name of AVATAR_NAMES) {
  const model = name === AVATAR_NAMES[0] ? reference : await load(name);
  const gltf = { ...model, animations: clipsFor(reference.scene, model.scene, reference.animations) };
  const box = new THREE.Box3().setFromObject(gltf.scene);
  const scale = PLAYER_HEIGHT / (box.max.y - box.min.y);
  const s = slump(gltf, scale, 0.35); // HANDOFF in bodies.ts
  out[name] = { now: r(s.now), before: r(s.before) };
}
console.log(JSON.stringify(out, null, 1).replace(/\n\s+(?=[-\d\]])/g, ' '));
