// Downloads the game's CC0 assets and packs them for the web into
// public/assets. The results are committed, so this only needs running again
// to change them. Runs on macOS (Apple Silicon or Intel) and Linux (x86-64 or
// Arm): ffmpeg resizes the textures (see tools.mjs), and the KTX tools come
// from Khronos's release for the platform if `ktx` isn't on the PATH. The
// downloaded originals stay in node_modules/.cache/fetch-assets/originals,
// for e2e/assets.e2e.ts to measure the packed ones against.
//
//   node scripts/fetch-assets.mjs

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { meshopt, prune, resample } from '@gltf-transform/functions';
import { MeshoptEncoder } from 'meshoptimizer';
import { LAYERS } from '../src/shared/layers.ts';
import { ffmpeg, get } from './tools.mjs';

const OUT = new URL('../public/assets/', import.meta.url).pathname;
const CACHE = new URL('../node_modules/.cache/fetch-assets/', import.meta.url).pathname;
const ORIGINALS = join(CACHE, 'originals');
const SIZE = 512;
const HDRI = 'kloofendal_48d_partly_cloudy_puresky';
/** Quaternius's public-domain SWAT operator, from poly.pizza, and the clips the game plays. */
const SOLDIER = 'https://static.poly.pizza/713f6535-f4f3-4367-a4c6-ced126ae0936.glb';
const SOLDIER_CLIPS = ['Idle', 'Walk', 'Run', 'Death'];
/** Quaternius's public-domain guns, from poly.pizza, in WEAPONS order. */
const GUNS = {
  rifle: 'https://static.poly.pizza/9a0e478c-de82-4773-9b70-a0219bb0057c.glb',
  pistol: 'https://static.poly.pizza/7a31b522-5632-41d9-8274-031795af5d8d.glb',
  bolt: 'https://static.poly.pizza/f03e21b7-e3b7-49fd-b47d-d1908649fcee.glb',
};
const KTX_VERSION = '4.4.2';
/** Khronos's package of the KTX tools for each platform they're fetched on. */
const KTX_BUILDS = {
  'darwin-arm64': 'Darwin-arm64.pkg',
  'darwin-x64': 'Darwin-x86_64.pkg',
  'linux-arm64': 'Linux-arm64.tar.bz2',
  'linux-x64': 'Linux-x86_64.tar.bz2',
};

/** A download kept in the cache, fetched only the first time. */
async function cached(url, path) {
  if (!existsSync(path)) writeFileSync(path, await get(url));
  return path;
}

/** The `ktx` tool and the environment to run it in. */
async function ktxTool() {
  try {
    execFileSync('ktx', ['--version'], { stdio: 'ignore' });
    return { bin: 'ktx', env: process.env };
  } catch {
    // Not installed: unpack Khronos's release into the cache, no install needed.
  }
  const build = KTX_BUILDS[`${process.platform}-${process.arch}`];
  if (!build) throw new Error(`No KTX tools for ${process.platform}-${process.arch}; put \`ktx\` on the PATH`);
  const dir = join(CACHE, `ktx-${KTX_VERSION}-${build}`);
  if (!existsSync(join(dir, 'ktx'))) {
    mkdirSync(CACHE, { recursive: true });
    const url = `https://github.com/KhronosGroup/KTX-Software/releases/download/v${KTX_VERSION}/KTX-Software-${KTX_VERSION}-${build}`;
    const file = join(CACHE, build);
    writeFileSync(file, await get(url));
    const expanded = join(CACHE, 'ktx-unpacked');
    rmSync(expanded, { recursive: true, force: true });
    mkdirSync(expanded, { recursive: true });
    const roots = [];
    if (build.endsWith('.pkg')) {
      execFileSync('pkgutil', ['--expand-full', file, join(expanded, 'pkg')]);
      for (const part of readdirSync(join(expanded, 'pkg'))) roots.push(join(expanded, 'pkg', part, 'Payload/usr/local'));
    } else {
      execFileSync('tar', ['-xjf', file, '-C', expanded]);
      for (const part of readdirSync(expanded)) roots.push(join(expanded, part));
    }
    mkdirSync(dir, { recursive: true });
    for (const root of roots) {
      for (const sub of ['bin', 'lib']) {
        const from = join(root, sub);
        if (existsSync(from)) execFileSync('cp', ['-R', `${from}/.`, dir]);
      }
    }
    rmSync(expanded, { recursive: true, force: true });
  }
  return { bin: join(dir, 'ktx'), env: { ...process.env, DYLD_LIBRARY_PATH: dir, LD_LIBRARY_PATH: dir } };
}

// ------------------------------------------------------------ textures

// Every layer's colour and normal map, each stacked into one KTX2 array
// texture in LAYERS order: Basis ETC1S, which the game transcodes to whatever
// compressed format the GPU has. Images are flipped so v runs up them.
const ktx = await ktxTool();
const work = mkdtempSync(join(tmpdir(), 'fetch-assets-'));
mkdirSync(ORIGINALS, { recursive: true });
const pngs = { color: [], normal: [] };
for (const { polyHaven } of LAYERS) {
  const files = await (await fetch(`https://api.polyhaven.com/files/${polyHaven}`)).json();
  for (const [map, kind] of [['Diffuse', 'color'], ['nor_gl', 'normal']]) {
    const jpg = await cached(files[map]['1k'].jpg.url, join(ORIGINALS, `${polyHaven}_${kind}.jpg`));
    const png = join(work, `${polyHaven}_${kind}.png`);
    ffmpeg(['-i', jpg, '-vf', `scale=${SIZE}:${SIZE}:force_original_aspect_ratio=decrease:flags=lanczos,vflip`, png]);
    pngs[kind].push(png);
  }
  console.log(polyHaven);
}
mkdirSync(join(OUT, 'textures'), { recursive: true });
// The colour space is stated, since ffmpeg's PNGs carry it only when their JPEG did.
const common = ['create', '--layers', String(LAYERS.length), '--generate-mipmap', '--encode', 'basis-lz', '--clevel', '2', '--assign-primaries', 'bt709'];
execFileSync(ktx.bin, [...common, '--format', 'R8G8B8_SRGB', '--assign-tf', 'srgb', '--qlevel', '200',
  ...pngs.color, join(OUT, 'textures/color.ktx2')], { env: ktx.env, stdio: 'inherit' });
// Two-channel normals (X in RGB, Y in alpha); the shader rebuilds Z.
execFileSync(ktx.bin, [...common, '--format', 'R8G8B8_UNORM', '--assign-tf', 'linear', '--normal-mode', '--qlevel', '192',
  ...pngs.normal, join(OUT, 'textures/normal.ktx2')], { env: ktx.env, stdio: 'inherit' });
rmSync(work, { recursive: true });

// ----------------------------------------------------------------- sky

// Only used for image-based lighting, so half the smallest size Poly Haven has is plenty.
const hdri = await (await fetch(`https://api.polyhaven.com/files/${HDRI}`)).json();
const sky1k = await cached(hdri.hdri['1k'].hdr.url, join(ORIGINALS, 'sky.hdr'));
writeFileSync(join(OUT, 'sky.hdr'), halveHdr(readFileSync(sky1k)));
console.log('sky.hdr');

/** A Radiance .hdr at half the width and height, averaging each 2×2 block. */
function halveHdr(file) {
  const { width, height, rgbe } = readHdr(file);
  const w = width >> 1;
  const h = height >> 1;
  const out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const sum = [0, 0, 0];
      for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
        const i = ((y * 2 + dy) * width + x * 2 + dx) * 4;
        const scale = rgbe[i + 3] ? 2 ** (rgbe[i + 3] - 136) : 0;
        for (let c = 0; c < 3; c++) sum[c] += rgbe[i + c] * scale / 4;
      }
      const max = Math.max(...sum);
      const o = (y * w + x) * 4;
      if (max < 1e-32) continue;
      const e = Math.ceil(Math.log2(max * 256 / 255.5));
      const k = 256 / 2 ** e;
      for (let c = 0; c < 3; c++) out[o + c] = Math.min(255, Math.floor(sum[c] * k));
      out[o + 3] = e + 128;
    }
  }
  return writeHdr(w, h, out);
}

function readHdr(file) {
  let at = 0;
  const line = () => {
    const end = file.indexOf(10, at);
    const s = file.subarray(at, end).toString('latin1');
    at = end + 1;
    return s;
  };
  while (line() !== '');
  const [, height, , width] = line().split(' ').map(Number);
  const rgbe = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    // New-style run-length encoding: four channels one after another.
    if (file[at] !== 2 || file[at + 1] !== 2) throw new Error('Only run-length encoded .hdr files are supported');
    at += 4;
    for (let c = 0; c < 4; c++) {
      for (let x = 0; x < width;) {
        let n = file[at++];
        if (n > 128) {
          n -= 128;
          const v = file[at++];
          while (n--) rgbe[(y * width + x++) * 4 + c] = v;
        } else {
          while (n--) rgbe[(y * width + x++) * 4 + c] = file[at++];
        }
      }
    }
  }
  return { width, height, rgbe };
}

function writeHdr(width, height, rgbe) {
  const parts = [Buffer.from(`#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y ${height} +X ${width}\n`, 'latin1')];
  for (let y = 0; y < height; y++) {
    const row = [2, 2, width >> 8, width & 255];
    for (let c = 0; c < 4; c++) {
      const v = (x) => rgbe[(y * width + x) * 4 + c];
      for (let x = 0; x < width;) {
        let run = 1;
        while (x + run < width && run < 127 && v(x + run) === v(x)) run++;
        if (run > 2) {
          row.push(128 + run, v(x));
          x += run;
          continue;
        }
        // Literals up to the next run of three.
        let n = 0;
        while (x + n < width && n < 128 && !(x + n + 2 < width && v(x + n) === v(x + n + 1) && v(x + n) === v(x + n + 2))) n++;
        row.push(n);
        for (let i = 0; i < n; i++) row.push(v(x + i));
        x += n;
      }
    }
    parts.push(Buffer.from(row));
  }
  return Buffer.concat(parts);
}

// -------------------------------------------------------------- models

// Meshopt-compressed and quantized, which three.js's GLTFLoader decodes.
await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });

/** Download a model, let `edit` change it, and write it out compressed. */
async function model(url, path, edit = () => {}) {
  const doc = await io.readBinary(new Uint8Array(await get(url)));
  edit(doc);
  // Leaf nodes stay: the game finds where a shin ends by its end bone.
  await doc.transform(prune({ keepLeaves: true }), resample(), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
  writeFileSync(path, await io.writeBinary(doc));
  console.log(path);
}

await model(SOLDIER, join(OUT, 'soldier.glb'), (doc) => {
  // Only the clips the game plays, named without the armature.
  for (const anim of doc.getRoot().listAnimations()) {
    const name = anim.getName().replace(/^.*\|/, '');
    if (SOLDIER_CLIPS.includes(name)) anim.setName(name);
    else anim.dispose();
  }
});
mkdirSync(join(OUT, 'guns'), { recursive: true });
for (const [name, url] of Object.entries(GUNS)) await model(url, join(OUT, 'guns', `${name}.glb`));
console.log('done');
