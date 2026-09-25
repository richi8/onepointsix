// Downloads the game's CC0 assets into public/assets. The results are committed,
// so this only needs running again to change them. Needs macOS (sips) to resize.
//
//   node scripts/fetch-assets.mjs

import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const OUT = new URL('../public/assets/', import.meta.url).pathname;
/** Poly Haven textures, in the order of the layers in src/client/assets.ts; keep the two lists in step. */
const TEXTURES = [
  'grass_ground', 'withered_grass', 'dirt', 'aerial_rocks_02', 'coast_sand_01',
  'weathered_planks', 'concrete_wall_004', 'corrugated_iron', 'wood_plank_wall', 'bark_brown_02',
];
const SIZE = 512;
const HDRI = 'kloofendal_48d_partly_cloudy_puresky';
/** A Mixamo-rigged and animated soldier, as shipped with the three.js examples. */
const SOLDIER = 'https://threejs.org/examples/models/gltf/Soldier.glb';
/** Quaternius's public-domain guns, from poly.pizza, in WEAPONS order. */
const GUNS = {
  rifle: 'https://static.poly.pizza/9a0e478c-de82-4773-9b70-a0219bb0057c.glb',
  pistol: 'https://static.poly.pizza/7a31b522-5632-41d9-8274-031795af5d8d.glb',
  bolt: 'https://static.poly.pizza/f03e21b7-e3b7-49fd-b47d-d1908649fcee.glb',
};

async function get(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

mkdirSync(join(OUT, 'textures'), { recursive: true });
for (const id of TEXTURES) {
  const files = await (await fetch(`https://api.polyhaven.com/files/${id}`)).json();
  for (const [map, suffix] of [['Diffuse', 'color'], ['nor_gl', 'normal']]) {
    const path = join(OUT, 'textures', `${id}_${suffix}.jpg`);
    writeFileSync(path, await get(files[map]['1k'].jpg.url));
    execFileSync('sips', ['-Z', String(SIZE), '-s', 'formatOptions', '80', path], { stdio: 'ignore' });
    console.log(path);
  }
}
const hdri = await (await fetch(`https://api.polyhaven.com/files/${HDRI}`)).json();
writeFileSync(join(OUT, 'sky.hdr'), await get(hdri.hdri['1k'].hdr.url));
writeFileSync(join(OUT, 'soldier.glb'), await get(SOLDIER));
mkdirSync(join(OUT, 'guns'), { recursive: true });
for (const [name, url] of Object.entries(GUNS)) writeFileSync(join(OUT, 'guns', `${name}.glb`), await get(url));
console.log('done');
