// Cuts the game's CC0 sounds from Freesound (see src/client/soundlist.ts),
// committed as the previews in scripts/originals/sounds (any missing there are
// downloaded, to be committed too, so nothing depends on Freesound staying up), and packs them into three files, the early sounds, the ambience
// and the late ones (see BANKS), each as Opus: public/assets/sounds-early.ogg,
// sounds-ambience.ogg and sounds-late.ogg, with where each sound sits in
// public/assets/sounds.json. The results are committed, so this only needs
// running again to change them. Needs ffmpeg with libopus (see tools.mjs), on
// macOS or Linux.
//
//   node scripts/fetch-sounds.mjs

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { BANKS, SOUNDS } from '../src/client/soundlist.ts';
import { ffmpeg } from './tools.mjs';

const OUT = new URL('../public/assets/', import.meta.url).pathname;
const CACHE = new URL('../node_modules/.cache/fetch-sounds/', import.meta.url).pathname;
const ORIGINALS = new URL('originals/sounds/', import.meta.url).pathname;
const RATE = 44100;
/** Silence between sounds in the packed file, so none bleeds into the next. */
const GAP = 0.05;
/** Seconds a loop's end fades over its start. */
const CROSSFADE = 2;
/**
 * How each bank is encoded: Opus at 40 kbps, which every browser the game
 * runs in decodes (Safari from macOS 15.4). The file says how much silence
 * the encoder put in front (Opus's pre-skip), which not every browser trims;
 * the game checks (see bankLead).
 */
const FORMATS = [
  { ext: 'ogg', type: 'audio/ogg; codecs=opus', args: ['-c:a', 'libopus', '-b:a', '40k', '-application', 'audio'], priming: opusPreSkip },
];

/** A recording's preview as mono samples, checked to be CC0 on its page first. */
async function recording(id) {
  const mp3 = join(ORIGINALS, `${id}.mp3`);
  if (!existsSync(mp3)) {
    const page = await (await fetch(`https://freesound.org/s/${id}/`, { headers: { 'User-Agent': 'Mozilla/5.0' } })).text();
    if (!page.includes('creativecommons.org/publicdomain/zero/1.0')) throw new Error(`Freesound ${id} isn't CC0`);
    const url = page.match(/https:\/\/cdn\.freesound\.org\/previews\/\d+\/\d+_\d+-hq\.mp3/)?.[0];
    if (!url) throw new Error(`No preview for Freesound ${id}`);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${res.status} ${url}`);
    writeFileSync(mp3, Buffer.from(await res.arrayBuffer()));
  }
  const wav = join(CACHE, `${id}.wav`);
  ffmpeg(['-i', mp3, '-ac', '1', '-ar', String(RATE), '-c:a', 'pcm_s16le', wav]);
  return readWav(readFileSync(wav));
}

function readWav(b) {
  for (let at = 12; at < b.length;) {
    const id = b.toString('latin1', at, at + 4);
    const size = b.readUInt32LE(at + 4);
    if (id === 'data') {
      const out = new Float32Array(size >> 1);
      for (let i = 0; i < out.length; i++) out[i] = b.readInt16LE(at + 8 + i * 2) / 32768;
      return out;
    }
    at += 8 + size + (size & 1);
  }
  throw new Error('No data in WAV');
}

function writeWav(samples) {
  const b = Buffer.alloc(44 + samples.length * 2);
  b.write('RIFF', 0, 'latin1');
  b.writeUInt32LE(36 + samples.length * 2, 4);
  b.write('WAVEfmt ', 8, 'latin1');
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(RATE, 24);
  b.writeUInt32LE(RATE * 2, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write('data', 36, 'latin1');
  b.writeUInt32LE(samples.length * 2, 40);
  samples.forEach((v, i) => b.writeInt16LE(Math.round(Math.max(-1, Math.min(1, v)) * 32767), 44 + i * 2));
  return b;
}

/** Loudness in 10 ms windows. */
function envelope(s) {
  const n = RATE / 100;
  const out = [];
  for (let i = 0; i + n <= s.length; i += n) {
    let sum = 0;
    for (let j = 0; j < n; j++) sum += s[i + j] ** 2;
    out.push(Math.sqrt(sum / n));
  }
  return out;
}

const peak = (s) => s.reduce((m, v) => Math.max(m, Math.abs(v)), 0);

/** Scaled to peak at `to`, faded in over 3 ms and out over the last `fade` seconds. */
function finish(s, fade, to = 0.9) {
  const k = to / (peak(s) || 1);
  const out = s.map((v) => v * k);
  const fin = Math.floor(RATE * 0.003);
  const fout = Math.floor(RATE * fade);
  for (let i = 0; i < fin && i < out.length; i++) out[i] *= i / fin;
  for (let i = 0; i < fout && i < out.length; i++) out[out.length - 1 - i] *= (i / fout) ** 2;
  return out;
}

/** From just before the first moment the range gets loud, faded out over `fade` seconds or a quarter second. */
function shot(s, fade) {
  const top = peak(s);
  let start = s.findIndex((v) => Math.abs(v) > top * 0.1);
  start = Math.max(0, start - Math.floor(RATE * 0.008));
  const cut = s.subarray(start);
  return [finish(cut, Math.min(fade ?? 0.25, cut.length / RATE / 3))];
}

/** The `count` loudest footfalls at least 0.35 s apart, each `length` long. */
function steps(s, count, length) {
  const env = envelope(s);
  const picked = [];
  const cuts = [];
  const order = env.map((v, i) => i).sort((a, b) => env[b] - env[a]);
  for (const i of order) {
    if (cuts.length === count) break;
    if (picked.some((j) => Math.abs(i - j) < 35)) continue;
    picked.push(i);
    // Walk back to where it starts rising, so the attack is kept.
    let on = i;
    while (on > 0 && env[on - 1] > env[i] * 0.3 && i - on < 5) on--;
    const from = Math.max(0, on * (RATE / 100) - Math.floor(RATE * 0.01));
    const to = from + Math.floor(RATE * length);
    if (to <= s.length) cuts.push(finish(s.subarray(from, to), length * 0.5));
  }
  if (cuts.length < count) throw new Error(`Only ${cuts.length} footfalls found`);
  return cuts;
}

/** Looped: the tail past the end fades in over the start, so it runs on seamlessly. */
function loop(s) {
  const x = Math.floor(RATE * CROSSFADE);
  const body = s.slice(0, s.length - x);
  for (let i = 0; i < x; i++) {
    const t = i / x;
    body[i] = body[i] * Math.sqrt(t) + s[s.length - x + i] * Math.sqrt(1 - t);
  }
  // Loudness by RMS rather than peak, so the beds sit at a known level.
  const rms = Math.sqrt(body.reduce((a, v) => a + v * v, 0) / body.length);
  const k = Math.min(0.12 / rms, 0.95 / peak(body));
  return [body.map((v) => v * k)];
}

/** Seconds of silence an Ogg Opus file's decoder should drop: the pre-skip in its OpusHead, always at 48 kHz. */
function opusPreSkip(file) {
  const at = file.indexOf('OpusHead');
  if (at < 0) throw new Error('No OpusHead');
  return file.readUInt16LE(at + 10) / 48000;
}

mkdirSync(CACHE, { recursive: true });
mkdirSync(ORIGINALS, { recursive: true });
const banks = BANKS.map(({ name, has }) => ({ name, sounds: SOUNDS.filter((s) => has(s.name)) }));
const round = (v) => Math.round(v * 1e5) / 1e5;
const formats = FORMATS.map(({ ext, type }) => ({ ext, type, priming: 0 }));
const packed = [];
for (const bank of banks) {
  const parts = [];
  const clips = {};
  let at = 0;
  for (const sound of bank.sounds) {
    const s = await recording(sound.freesound);
    const range = s.subarray(Math.floor(sound.from * RATE), Math.min(s.length, Math.floor(sound.to * RATE)));
    const cuts = sound.kind === 'steps' ? steps(range, sound.count, sound.length)
      : sound.kind === 'loop' ? loop(range)
      : shot(range, sound.fade);
    clips[sound.name] = cuts.map((cut) => {
      parts.push({ at, cut });
      const clip = [round(at / RATE), round(cut.length / RATE)];
      at += cut.length + Math.floor(RATE * GAP);
      return clip;
    });
    console.log(sound.name, cuts.map((c) => (c.length / RATE).toFixed(2)).join(' '));
  }
  const all = new Float32Array(at);
  for (const { at, cut } of parts) all.set(cut, at);
  const wav = join(CACHE, `sounds-${bank.name}.wav`);
  writeFileSync(wav, writeWav(all));
  FORMATS.forEach(({ ext, args, priming }, i) => {
    const out = join(OUT, `sounds-${bank.name}.${ext}`);
    // Bit-exact, so running it again makes the same files.
    ffmpeg(['-i', wav, ...args, '-map_metadata', '-1', '-fflags', '+bitexact', '-flags:a', '+bitexact', out]);
    formats[i].priming = round(priming(readFileSync(out)));
  });
  packed.push({ name: bank.name, length: round(at / RATE), clips });
  console.log(`${bank.name}: ${(at / RATE).toFixed(1)} s packed`);
}
writeFileSync(join(OUT, 'sounds.json'), `${JSON.stringify({ banks: packed, formats })}\n`);
