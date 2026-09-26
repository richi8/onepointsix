// Builds a smaller Basis Universal transcoder for KTX2Loader into
// public/assets/basis: the same version three.js ships (v1.50), but with only
// what the game's textures need. They're all ETC1S, so UASTC, UASTC HDR and
// Zstandard are left out, as are the targets three.js never picks for ETC1S
// (ASTC), a desktop browser never offers (PVRTC) or that barely beat another
// (BC7). The result is committed,
// so this only needs running again to change it. Needs git, and either
// Emscripten's em++ on the PATH or Docker to run it in.
//
//   node scripts/build-transcoder.mjs

import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const OUT = new URL('../public/assets/basis/', import.meta.url).pathname;
const CACHE = new URL('../node_modules/.cache/build-transcoder/', import.meta.url).pathname;
const TAG = 'v1_50_0_2';
const EMSDK_IMAGE = 'emscripten/emsdk:4.0.10';

const DEFINES = {
  NDEBUG: 1,
  BASISD_SUPPORT_KTX2: 1,
  BASISD_SUPPORT_KTX2_ZSTD: 0,
  BASISD_SUPPORT_UASTC: 0,
  BASISD_SUPPORT_UASTC_HDR: 0,
  // ETC1S reaches the GPU as ETC1/ETC2 or BC1/BC3, or failing those as plain
  // RGBA. BC7 is left out too: measured against the originals it was at most
  // 0.5 dB better than BC1 (e2e/assets.e2e.ts), for 70 kB more transcoder.
  BASISD_SUPPORT_BC7: 0,
  BASISD_SUPPORT_ASTC: 0,
  BASISD_SUPPORT_ASTC_HIGHER_OPAQUE_QUALITY: 0,
  BASISD_SUPPORT_PVRTC1: 0,
  BASISD_SUPPORT_PVRTC2: 0,
  BASISD_SUPPORT_ATC: 0,
  BASISD_SUPPORT_FXT1: 0,
  BASISD_SUPPORT_ETC2_EAC_RG11: 0,
  BASISU_SUPPORT_ENCODING: 0,
  BASISD_ENABLE_DEBUG_FLAGS: 0,
};
// The same link flags as three.js's build, so KTX2Loader loads it the same way.
// The wrapper reaches the memory through Module.HEAP8, which newer Emscripten
// only puts there when asked.
const LINK = [
  '--bind', '-s', 'ALLOW_MEMORY_GROWTH=1', '-s', 'ASSERTIONS=0', '-s', 'MALLOC=emmalloc', '-s', 'MODULARIZE=1', '-s', 'EXPORT_NAME=BASIS',
  '-s', 'EXPORTED_RUNTIME_METHODS=HEAP8',
];

const src = join(CACHE, TAG);
if (!existsSync(src)) {
  mkdirSync(CACHE, { recursive: true });
  execFileSync('git', ['clone', '--quiet', '--depth', '1', '--branch', TAG, 'https://github.com/BinomialLLC/basis_universal.git', src], { stdio: 'inherit' });
}
const build = join(CACHE, 'out');
mkdirSync(build, { recursive: true });

/** em++ from the PATH, or failing that from Emscripten's Docker image, with the source and output mounted. */
function emxx(args) {
  try {
    execFileSync('em++', ['--version'], { stdio: 'ignore' });
    execFileSync('em++', args, { cwd: join(src, 'webgl/transcoder'), stdio: 'inherit' });
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
    const mapped = args.map((a) => a.replace(src, '/src').replace(build, '/out'));
    execFileSync('docker', ['run', '--rm', '-v', `${src}:/src`, '-v', `${build}:/out`, '-w', '/src/webgl/transcoder', EMSDK_IMAGE, 'em++', ...mapped], { stdio: 'inherit' });
  }
}

emxx([
  ...Object.entries(DEFINES).map(([k, v]) => `-D${k}=${v}`),
  '-O3', '-fno-strict-aliasing', '-Wno-nontrivial-memcall', `-I${join(src, 'transcoder')}`,
  join(src, 'transcoder/basisu_transcoder.cpp'), join(src, 'webgl/transcoder/basis_wrappers.cpp'),
  ...LINK, '-O3', '-o', join(build, 'basis_transcoder.js'),
]);
mkdirSync(OUT, { recursive: true });
for (const f of ['basis_transcoder.js', 'basis_transcoder.wasm']) {
  copyFileSync(join(build, f), join(OUT, f));
  console.log(`${f} ${statSync(join(OUT, f)).size} bytes`);
}
// Apache 2.0: the licence goes with the build.
copyFileSync(join(src, 'LICENSE'), join(OUT, 'LICENSE'));
