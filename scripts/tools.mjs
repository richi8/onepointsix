// What the asset and sound scripts share: downloading, and running ffmpeg,
// which they need on the PATH on any platform (`brew install ffmpeg` on a Mac,
// `apt install ffmpeg` on Debian or Ubuntu).

import { execFileSync } from 'node:child_process';

// Named, since some hosts' bot rules turn away Node's default User-Agent.
const USER_AGENT = 'onepointsix-asset-scripts (+https://github.com/richi8/onepointsix)';

export async function get(url, init = {}) {
  const res = await fetch(url, { ...init, headers: { 'User-Agent': USER_AGENT, ...init.headers } });
  if (!res.ok) {
    // Cloudflare says when a bot rule, not the file, is the reason.
    const rule = res.headers.get('cf-mitigated');
    throw new Error(`${res.status} ${url}${rule ? ` (Cloudflare: ${rule})` : ''}`);
  }
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
