import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { endRun, open, play } from './game.ts';

/** Play a short run on the island at `query` as Tester and extract. */
async function shortRun(page: Page, query = ''): Promise<void> {
  await open(page, query);
  await page.fill('#name', 'Tester');
  await page.locator('#name').blur();
  await play(page);
  await page.waitForTimeout(1500);
  await endRun(page, 'extracted');
}

/** Save the run's replay from the results; returns the file. */
async function saveRun(page: Page): Promise<{ name: string; buffer: Buffer }> {
  const download = page.waitForEvent('download');
  await page.click('#save-run');
  const file = await download;
  await expect(page.locator('#toast')).toHaveText(/^Replay saved \(\d+ kB\)\. Send the file to a friend\.$/);
  expect(file.suggestedFilename()).toMatch(/^onepointsix-tester-\d{4}-\d\d-\d\d-\d{4}\.replay$/);
  return { name: file.suggestedFilename(), buffer: await readFile(await file.path()) };
}

const bar = (page: Page) => page.locator('#replaybar');

test('watch your run: pause, speed, scrubbing, cameras, and back to the results', async ({ page }) => {
  await shortRun(page);
  await page.click('#watch-run');
  await expect(bar(page)).toBeVisible();
  await expect(page.locator('#results')).toBeHidden();
  await expect(bar(page).locator('.who')).toHaveText(/^Tester · Default island · Day · Extracted · [\d,]+$/);
  await expect(bar(page).locator('.save')).toBeVisible();
  await expect(bar(page).locator('.marks i.extract')).toHaveCount(1);
  await expect(page.locator('#hud')).toHaveClass(/replaying/);

  // Space pauses and plays.
  await expect(bar(page).locator('.play')).toHaveAttribute('aria-label', 'Pause');
  await page.keyboard.press('Space');
  await expect(bar(page).locator('.play')).toHaveAttribute('aria-label', 'Play');
  const paused = await page.evaluate(() => window.game.replay!.time);
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => window.game.replay!.time)).toBe(paused);
  await bar(page).locator('.play').click();
  await expect(bar(page).locator('.play')).toHaveAttribute('aria-label', 'Pause');

  // Speeds, by button and by key.
  await bar(page).locator('.speeds button', { hasText: '2×' }).click();
  await expect(bar(page).locator('.speeds button.on')).toHaveText('2×');
  await page.keyboard.press('BracketLeft');
  await expect(bar(page).locator('.speeds button.on')).toHaveText('1×');

  // Back to the start on the timeline.
  await page.keyboard.press('Space');
  const start = Number(await bar(page).locator('.scrub').getAttribute('min'));
  await bar(page).locator('.scrub').fill(String(start));
  expect(await page.evaluate(() => window.game.replay!.time)).toBeCloseTo(start, 1);
  await expect(bar(page).locator('.time')).toHaveText(/^0:00 \/ 0:0\d$/);

  // The free camera, and back to the eyes.
  await page.keyboard.press('KeyV');
  await expect(bar(page)).toHaveClass(/free/);
  await expect(page.locator('#hud')).toHaveClass(/free/);
  await bar(page).locator('.cams [data-cam=eyes]').click();
  await expect(bar(page)).not.toHaveClass(/free/);

  await page.keyboard.press('Escape');
  await expect(bar(page)).toBeHidden();
  await expect(page.locator('#results')).toBeVisible();
});

test('a saved replay opens from the file picker and by dropping it on the menu', async ({ page }) => {
  await shortRun(page);
  const file = await saveRun(page);
  await page.click('#to-menu');
  await expect(page.locator('#menu')).toBeVisible();

  await page.locator('#replay-file').setInputFiles({ name: file.name, mimeType: 'application/gzip', buffer: file.buffer });
  await expect(bar(page)).toBeVisible();
  await expect(bar(page).locator('.who')).toHaveText(/^Tester · Default island/);
  // Already saved, so no Save button.
  await expect(bar(page).locator('.save')).toBeHidden();
  await bar(page).locator('.close').click();
  await expect(bar(page)).toBeHidden();
  await expect(page.locator('#menu')).toBeVisible();

  await page.evaluate(({ name, bytes }) => {
    const data = new DataTransfer();
    data.items.add(new File([Uint8Array.from(bytes)], name, { type: 'application/gzip' }));
    window.dispatchEvent(new DragEvent('dragover', { dataTransfer: data, cancelable: true }));
    if (document.getElementById('drop')!.hidden) throw new Error('No drop target shown');
    window.dispatchEvent(new DragEvent('drop', { dataTransfer: data, cancelable: true }));
  }, { name: file.name, bytes: [...file.buffer] });
  await expect(page.locator('#drop')).toBeHidden();
  await expect(bar(page)).toBeVisible();
});

test("a file that isn't a replay says so", async ({ page }) => {
  await open(page);
  await page.locator('#replay-file').setInputFiles({ name: 'notes.replay', mimeType: 'application/gzip', buffer: Buffer.from('hello') });
  await expect(page.locator('#toast')).toBeVisible();
  await expect(bar(page)).toBeHidden();
});

test('a replay from another island takes you there and opens paused', async ({ page }) => {
  await shortRun(page, '?world=4242&time=dusk');
  const file = await saveRun(page);
  await page.click('#to-menu');
  await open(page);
  await page.locator('#replay-file').setInputFiles({ name: file.name, mimeType: 'application/gzip', buffer: file.buffer });
  await page.waitForURL(/world=4242/);
  await expect(page).toHaveURL(/time=dusk/);
  await expect(page.locator('#loading')).toHaveCount(0, { timeout: 60_000 });
  await expect(bar(page)).toBeVisible();
  await expect(bar(page).locator('.who')).toHaveText(/^Tester · Island #4242 · Dusk/);
  await expect(bar(page).locator('.play')).toHaveAttribute('aria-label', 'Play');
  // Closing it leaves you on that island's menu.
  await bar(page).locator('.close').click();
  await expect(page.locator('#world-label')).toHaveText('Island #4242');
});
