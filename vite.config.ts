import { statSync } from 'node:fs';
import { join } from 'node:path';
import { defineConfig, type Plugin, type Rollup } from 'vite';

type OutputChunk = Rollup.OutputChunk;

/** Files in public/ the loading screen waits for, and ones loaded in their place in other browsers. */
const START_FILES = [
  'assets/basis/basis_transcoder.js', 'assets/basis/basis_transcoder.wasm',
  'assets/textures/color.ktx2', 'assets/textures/normal.ktx2', 'assets/sky.hdr',
  'assets/soldier.glb', 'assets/guns/rifle.glb', 'assets/guns/pistol.glb', 'assets/guns/bolt.glb',
  'assets/sounds.json', 'assets/sounds-early.ogg',
];
const ALTERNATIVES = ['assets/sounds-early.m4a'];
/** Modules the game imports lazily, but at once, while the loading screen is up. */
const START_MODULES = ['src/client/assets.ts', 'src/client/groundcover.ts', 'src/client/impostors.ts'];

/**
 * The size of everything the loading screen waits for, uncompressed, put in
 * the page for its loading bar (see src/client/loading.ts): the scripts, when
 * built, and the files from public/. The dev server's scripts aren't counted.
 */
function loadingSizes(): Plugin {
  const publicSize = (files: string[]) => Object.fromEntries(files.map((f) => [f, statSync(join('public', f)).size]));
  return {
    name: 'loading-sizes',
    transformIndexHtml: {
      order: 'post',
      handler(_html, ctx) {
        const files: Record<string, number> = {};
        const bundle = ctx.bundle;
        if (bundle) {
          const chunks = Object.values(bundle).filter((c): c is OutputChunk => c.type === 'chunk');
          const add = (chunk: OutputChunk | undefined): void => {
            if (!chunk || chunk.fileName in files) return;
            files[chunk.fileName] = Buffer.byteLength(chunk.code);
            for (const css of chunk.viteMetadata?.importedCss ?? []) {
              const asset = bundle[css];
              if (asset?.type === 'asset') files[css] = Buffer.byteLength(asset.source);
            }
            for (const imported of chunk.imports) add(bundle[imported] as OutputChunk);
          };
          add(chunks.find((c) => c.isEntry && c.fileName === ctx.chunk?.fileName));
          for (const m of START_MODULES) add(chunks.find((c) => c.facadeModuleId?.endsWith(m)));
        }
        Object.assign(files, publicSize(START_FILES));
        const sizes = { files, alternatives: publicSize(ALTERNATIVES) };
        return [{ tag: 'script', attrs: { id: 'sizes', type: 'application/json' }, children: JSON.stringify(sizes), injectTo: 'head' }];
      },
    },
  };
}

/**
 * three.js's own Basis transcoder left out of the build: the game always
 * loads its smaller one (see scripts/build-transcoder.mjs), and KTX2Loader
 * only falls back to three's when no transcoder path is set.
 */
function withoutDefaultTranscoder(): Plugin {
  return {
    name: 'without-default-transcoder',
    enforce: 'pre',
    transform(code, id) {
      if (!id.includes('KTX2Loader.js')) return;
      const out = code.replace(/new URL\( '\.\.\/libs\/basis\/basis_transcoder\.(?:wasm|js)', import\.meta\.url \)\.toString\(\)/g, "''");
      if (out === code) this.warn("KTX2Loader no longer names its transcoder as expected; three.js's is back in the build");
      return out;
    },
  };
}

export default defineConfig({
  // Relative asset paths so the build works under a GitHub Pages subpath (/<repo>/).
  base: './',
  worker: { format: 'es' },
  plugins: [withoutDefaultTranscoder(), loadingSizes()],
  // Every page's dependencies found at start, so the dev server never stops
  // to add one and reloads a page mid-test.
  optimizeDeps: { entries: ['index.html', 'dev/*.html'] },
  build: {
    rolldownOptions: {
      // three.js in chunks of its own (its core, and the WebGL renderer), loaded
      // in parallel with the game's code and kept in the cache across updates to it.
      output: {
        codeSplitting: {
          groups: [
            { name: 'three-core', test: /node_modules[\\/]three[\\/]build[\\/]three\.core/ },
            { name: 'three-webgl', test: /node_modules[\\/]three[\\/]build[\\/]three\.module/ },
          ],
        },
      },
    },
  },
});
