// The loading bar, drawn by a small script in index.html before any module
// runs. It counts every file the game waits for before the menu by its
// uncompressed size, which the build lists (see vite.config.ts): the scripts,
// the transcoder, textures, models, the sky and the early sounds. It sees
// files land by itself; the ones still coming in are reported from here.

interface LoadingBar {
  /** `bytes` of the file at `url` are in so far. */
  progress(url: string, bytes: number): void;
  /** The file at `to` is loaded instead of the one at `from`, say in another format. */
  swap(from: string, to: string): void;
}

declare global {
  interface Window {
    loading?: LoadingBar;
  }
}

export function progress(url: string, bytes: number): void {
  window.loading?.progress(url, bytes);
}

export function swap(from: string, to: string): void {
  window.loading?.swap(from, to);
}

/** A loader's progress callback that reports to the bar. */
export function reporter(url: string): (e: ProgressEvent) => void {
  return (e) => progress(url, e.loaded);
}

/** A file's bytes, reported to the bar as they arrive. */
export async function download(url: string): Promise<ArrayBuffer> {
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`${res.status} ${url}`);
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.byteLength;
    progress(url, loaded);
  }
  const out = new Uint8Array(loaded);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.byteLength;
  }
  return out.buffer;
}
