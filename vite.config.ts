import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
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
const ALTERNATIVES: string[] = [];
/** Modules the game imports lazily, but at once, while the loading screen is up. */
const START_MODULES = ['src/client/assets.ts', 'src/client/groundcover.ts', 'src/client/impostors.ts'];

/**
 * The size of everything the loading screen waits for, uncompressed, put in
 * the page for its loading bar (see src/client/loading.ts): the scripts, when
 * built, and the files from public/. The dev server's scripts aren't counted.
 */
function loadingSizes(scripts: boolean): Plugin {
  const publicSize = (files: string[]) => Object.fromEntries(files.map((f) => [f, statSync(join('public', f)).size]));
  return {
    name: 'loading-sizes',
    transformIndexHtml: {
      order: 'post',
      handler(_html, ctx) {
        const files: Record<string, number> = {};
        const bundle = ctx.bundle;
        if (bundle && scripts) {
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

/** Every file under `dir`, as paths relative to it with forward slashes. */
function filesUnder(dir: string): string[] {
  return readdirSync(dir, { recursive: true, encoding: 'utf8' })
    .map((f) => f.split('\\').join('/'))
    .filter((f) => statSync(join(dir, f)).isFile() && !f.endsWith('.DS_Store'))
    .sort();
}

const MIME: Record<string, string> = {
  js: 'text/javascript', json: 'application/json', wasm: 'application/wasm', glb: 'model/gltf-binary',
  ktx2: 'image/ktx2', hdr: 'image/vnd.radiance', ogg: 'audio/ogg', m4a: 'audio/mp4',
};

/**
 * Serves the files packed into the page (see singleFile) to the game's
 * fetch() and Worker calls, which a page opened from disk can't make.
 * Classic, so it runs before the game's module; `FILES` is filled in by the build.
 */
function unpacker(): void {
  const files: Record<string, [id: string, type: string]> = FILES;
  const dir = new URL('./', document.baseURI).href;
  const find = (url: string | URL) => {
    const href = new URL(url, document.baseURI).href;
    if (!href.startsWith(dir)) return undefined;
    return files[decodeURIComponent(href.slice(dir.length).split(/[?#]/)[0])];
  };
  const bytes = ([id]: [string, string]) => {
    const text = document.getElementById(id)!.textContent!.trim();
    const from = (Uint8Array as { fromBase64?: (s: string) => Uint8Array<ArrayBuffer> }).fromBase64;
    return from ? from(text) : Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
  };
  const net = window.fetch;
  window.fetch = function (input, init) {
    const file = find(input instanceof Request ? input.url : input);
    if (!file) return net.call(this, input, init);
    const body = bytes(file);
    return Promise.resolve(new Response(body, { headers: { 'Content-Type': file[1], 'Content-Length': String(body.byteLength) } }));
  };
  const Real = window.Worker;
  window.Worker = class extends Real {
    constructor(url: string | URL, options?: WorkerOptions) {
      const file = find(url);
      if (!file) {
        super(url, options);
        return;
      }
      // Classic: Chrome won't start a module worker from a blob on a page
      // opened from disk. The single build makes workers that need no imports.
      super(URL.createObjectURL(new Blob([bytes(file)], { type: file[1] })), { ...options, type: 'classic' });
    }
  };
}
declare const FILES: Record<string, [string, string]>;

/**
 * `vite build --mode single`: the whole game in one HTML file that plays when
 * opened from disk, where browsers refuse module scripts from other files,
 * fetch() and workers by URL. The code is one script inline (no chunks to
 * import), the styles inline, and the workers and everything in public/
 * packed into the page in base64, served by the unpacker above.
 */
function singleFile(): Plugin {
  const escape = (code: string) => code.replace(/<\/(script)/gi, '<\\/$1');
  return {
    name: 'single-file',
    apply: 'build',
    enforce: 'post',
    generateBundle: {
      order: 'post',
      handler(_options, bundle) {
        const page = bundle['index.html'];
        if (page?.type !== 'asset') return this.error('No index.html in the bundle');
        let html = String(page.source);
        const packed: [path: string, bytes: Uint8Array][] = [];
        const notices: string[] = [];
        for (const [name, out] of Object.entries(bundle)) {
          if (name === 'index.html') continue;
          if (out.type === 'chunk') {
            if (!out.isEntry) return this.error(`${name} is a chunk of its own; the single file needs one script`);
            const tag = new RegExp(`<script type="module" crossorigin src="\\./${name}"></script>`);
            if (!tag.test(html)) return this.error(`No script tag for ${name}`);
            html = html.replace(tag, () => `<script type="module">${escape(out.code)}</script>`);
          } else if (name.endsWith('.css')) {
            const tag = new RegExp(`<link rel="stylesheet" crossorigin href="\\./${name}">`);
            if (!tag.test(html)) return this.error(`No stylesheet link for ${name}`);
            html = html.replace(tag, () => `<style>${String(out.source)}</style>`);
          } else {
            // The script names these relative to its own folder, now the page's.
            packed.push([name.replace(/^assets\//, ''), typeof out.source === 'string' ? Buffer.from(out.source) : out.source]);
          }
          delete bundle[name];
        }
        html = html.replace(/<link rel="modulepreload"[^>]*>/g, '');
        for (const f of filesUnder('public')) {
          const path = join('public', f);
          if (/(^|\/)(CREDITS\.md|LICENSE)$/.test(f)) notices.push(`${f}\n\n${readFileSync(path, 'utf8')}`);
          else packed.push([f, readFileSync(path)]);
        }
        const files = Object.fromEntries(packed.map(([f], i) => [f, [`packed-${i}`, MIME[f.split('.').pop()!] ?? 'application/octet-stream']]));
        const shim = `<script>(${unpacker.toString()})()</script>`.replace('FILES', () => JSON.stringify(files));
        const data = packed.map(([, b], i) => `<script type="text/plain" id="packed-${i}">${Buffer.from(b).toString('base64')}</script>`).join('\n');
        const comment = `<!--\n${notices.join('\n\n').replace(/--/g, '- -')}\n-->\n`;
        html = html.replace('<head>', () => `<head>\n${shim}`).replace('</body>', () => `${data}\n</body>`).replace('<html', () => `${comment}<html`);
        this.emitFile({ type: 'asset', fileName: 'onepointsix.html', source: html });
        delete bundle['index.html'];
      },
    },
  };
}

/**
 * A hash of the simulation's code, the shared and server sources: the build a
 * run was played on, as the stats export records it.
 */
function simulationHash(): string {
  const hash = createHash('sha256');
  for (const dir of ['src/shared', 'src/server']) {
    for (const f of readdirSync(dir).sort()) {
      hash.update(f);
      hash.update(readFileSync(join(dir, f)));
    }
  }
  return hash.digest('hex').slice(0, 12);
}

export default defineConfig(({ mode }) => ({
  define: { __BUILD__: JSON.stringify(simulationHash()) },
  // Relative asset paths so the build works under a GitHub Pages subpath (/<repo>/).
  base: './',
  worker: { format: mode === 'single' ? 'iife' : 'es' },
  plugins: [withoutDefaultTranscoder(), loadingSizes(mode !== 'single'), ...(mode === 'single' ? [singleFile()] : [])],
  // The single file packs public/ into the page itself.
  publicDir: mode === 'single' ? false : 'public',
  // Every page's dependencies found at start, so the dev server never stops
  // to add one and reloads a page mid-test.
  optimizeDeps: { entries: ['index.html', 'dev/*.html'] },
  build: mode === 'single' ? { outDir: 'dist-single', rolldownOptions: { output: { codeSplitting: false } } } : {
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
}));
