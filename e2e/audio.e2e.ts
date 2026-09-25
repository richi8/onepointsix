import { expect, test } from '@playwright/test';
import { SOUNDS } from '../src/client/soundlist.ts';
import { open } from './game.ts';

// The packed sounds are cut by offsets that assume the browser trims the AAC
// encoder's priming. Each shot is cut to start where it first gets loud, so
// decoded as the game plays it, it should get loud straight away, not 48 ms
// (the priming) later.

test('every shot starts on time in the decoded sound bank', async ({ page }) => {
  await open(page);
  const shots = SOUNDS.filter((s) => s.kind === 'shot').map((s) => s.name);
  const onsets = await page.evaluate(async (names) => {
    const sfx = window.game.sfx;
    sfx.unlock();
    await sfx.decode();
    const data = sfx.bank!.getChannelData(0);
    const rate = sfx.bank!.sampleRate;
    return names.map((name) => {
      const [start] = sfx.clips![name][0];
      const from = Math.round(start * rate);
      const window = Math.round(0.15 * rate);
      let peak = 0;
      for (let i = from; i < from + window; i++) peak = Math.max(peak, Math.abs(data[i]));
      let i = Math.max(from - Math.round(0.02 * rate), 0);
      while (Math.abs(data[i]) < peak * 0.1) i++;
      return { name, ms: ((i - from) / rate) * 1000 };
    });
  }, shots);
  for (const { name, ms } of onsets) {
    expect(ms, name).toBeGreaterThan(-2);
    expect(ms, name).toBeLessThan(45);
  }
  const sorted = onsets.map((o) => o.ms).sort((a, b) => a - b);
  expect(sorted[Math.floor(sorted.length / 2)]).toBeLessThan(15);
});
