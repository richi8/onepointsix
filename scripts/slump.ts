// Writes test/slump.json: the soldier's death clip where the ragdoll takes
// over, as ragrig.ts works it out in the game, for the unit tests.
// The model's textures are dropped, as Node can't decode them.
// Run: node scripts/slump.ts > test/slump.json

import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTMeshoptCompression } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { slump } from '../src/client/ragrig.ts';
import { PLAYER_HEIGHT } from '../src/shared/constants.ts';

await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
const doc = await io.read('public/assets/soldier.glb');
for (const t of doc.getRoot().listTextures()) t.dispose();
for (const e of doc.getRoot().listExtensionsUsed()) if (e instanceof EXTMeshoptCompression || e.extensionName === 'KHR_texture_basisu') e.dispose();
const glb = await io.writeBinary(doc);
const gltf = await new GLTFLoader().parseAsync(glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.byteLength) as ArrayBuffer, '');
const box = new THREE.Box3().setFromObject(gltf.scene);
const scale = PLAYER_HEIGHT / (box.max.y - box.min.y);
const s = slump(gltf, scale, 0.35); // HANDOFF in bodies.ts
const r = (a: Float64Array) => Array.from(a, (v) => Math.round(v * 1000) / 1000);
console.log(JSON.stringify({ now: r(s.now), before: r(s.before) }));
