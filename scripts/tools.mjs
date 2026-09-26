// What the asset and sound scripts share: downloading, and running ffmpeg,
// which they need on the PATH on any platform (`brew install ffmpeg` on a Mac,
// `apt install ffmpeg` on Debian or Ubuntu).

import { execFileSync } from 'node:child_process';

export async function get(url, init) {
  const res = await fetch(url, init);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

/** Run ffmpeg quietly, overwriting its output. */
export function ffmpeg(args) {
  try {
    execFileSync('ffmpeg', ['-hide_banner', '-v', 'error', '-y', ...args], { stdio: ['ignore', 'inherit', 'inherit'] });
  } catch (e) {
    if (e.code === 'ENOENT') throw new Error('ffmpeg isn\'t on the PATH: brew install ffmpeg, or apt install ffmpeg');
    throw e;
  }
}
