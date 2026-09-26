import { expect, test } from '@playwright/test';
import { SOUNDS } from '../src/client/soundlist.ts';
import { open } from './game.ts';

// The packed sounds are cut by offsets that assume the browser trims the
// encoder's priming (Opus's pre-skip, AAC's priming). Each shot is cut to
// start where it first gets loud, so decoded as the game plays it, it should
// get loud straight away, not the priming later.

test('your own sounds are in before the menu shows', async ({ page }) => {
  await open(page);
  const early = await page.evaluate(() => ['rifle', 'pistol', 'bolt', 'grass', 'wind'].filter((k) => window.game.sfx.clips[k]));
  expect(early).toEqual(['rifle', 'pistol', 'bolt', 'grass', 'wind']);
});

for (const forced of [null, 'm4a']) {
  test(`every shot starts on time in the decoded sound banks${forced ? ', as AAC' : ''}`, async ({ page, browserName }) => {
    // Without Opus, the game falls back to the AAC files.
    if (forced) await page.route('**/*.ogg', (route) => route.abort());
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
    console.log(`Sounds in ${browserName}: ${format}`);
    if (forced) expect(format).toBe(forced);
    expect(onsets.length).toBe(shots.length);
    for (const { name, ms } of onsets) {
      expect(ms, name).toBeGreaterThan(-2);
      expect(ms, name).toBeLessThan(45);
    }
    const sorted = onsets.map((o) => o.ms).sort((a, b) => a - b);
    expect(sorted[Math.floor(sorted.length / 2)]).toBeLessThan(15);
  });
}
