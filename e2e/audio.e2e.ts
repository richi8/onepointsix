import { expect, test } from '@playwright/test';
import { SOUNDS } from '../src/client/soundlist.ts';
import { open } from './game.ts';

// The packed sounds are cut by offsets that assume the browser trims the
// encoder's priming (Opus's pre-skip). Each shot is cut to
// start where it first gets loud, so decoded as the game plays it, it should
// get loud straight away, not the priming later.

test('your own sounds are in before the menu shows', async ({ page }) => {
  await open(page);
  const early = await page.evaluate(() => ['rifle', 'pistol', 'bolt', 'grass', 'wind'].filter((k) => window.game.sfx.clips[k]));
  expect(early).toEqual(['rifle', 'pistol', 'bolt', 'grass', 'wind']);
});

test('every shot starts on time in the decoded sound banks', async ({ page }) => {
  await open(page);
  const shots = SOUNDS.filter((s) => s.kind === 'shot').map((s) => s.name);
  const { format, onsets } = await page.evaluate(async (names) => {
    const sfx = window.game.sfx;
    sfx.unlock();
    await sfx.loaded();
    return { format: sfx.format!.ext, onsets: names.map((name) => {
      const { buffer, start } = sfx.clips[name][0];
      const data = buffer.getChannelData(0);
      const rate = buffer.sampleRate;
      const from = Math.round(start * rate);
      const window = Math.round(0.15 * rate);
      let peak = 0;
      for (let i = from; i < from + window; i++) peak = Math.max(peak, Math.abs(data[i]));
      let i = Math.max(from - Math.round(0.02 * rate), 0);
      while (Math.abs(data[i]) < peak * 0.1) i++;
      return { name, ms: ((i - from) / rate) * 1000 };
    }) };
  }, shots);
  expect(format).toBe('ogg');
  expect(onsets.length).toBe(shots.length);
  for (const { name, ms } of onsets) {
    expect(ms, name).toBeGreaterThan(-2);
    expect(ms, name).toBeLessThan(45);
  }
  const sorted = onsets.map((o) => o.ms).sort((a, b) => a - b);
  expect(sorted[Math.floor(sorted.length / 2)]).toBeLessThan(15);
});

test('a far firefight goes to the distant-battle bed and leaves the voices for near sounds', async ({ page }) => {
  await open(page);
  const heard = await page.evaluate(async () => {
    const game = window.game;
    // A fresh engine rendering offline, so it plays without a click.
    const sfx = new (game.sfx.constructor as new (world: unknown) => typeof game.sfx)(game.world);
    sfx.unlock(new OfflineAudioContext(2, 48000 * 4, 48000));
    await sfx.loaded();
    game.camera.updateMatrixWorld();
    sfx.update(game.camera, 0);
    const e = game.camera.matrixWorld.elements;
    const ear = { x: e[12], y: e[13], z: e[14] };
    const pools = sfx as unknown as { pool: { busy(t: number): number }; bedPool: { busy(t: number): number } };
    for (let i = 0; i < 60; i++) sfx.shot(0, { x: ear.x + 250, y: ear.y, z: ear.z + i });
    const far = { voices: pools.pool.busy(0), bed: pools.bedPool.busy(0) };
    sfx.step('grass', 5, false, { x: ear.x + 3, y: ear.y, z: ear.z });
    const near = pools.pool.busy(0);
    return { ...far, near };
  });
  expect(heard.voices).toBe(0);
  expect(heard.bed).toBe(10);
  expect(heard.near).toBe(1);
});
