import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { dev, endRun, open, play } from './game.ts';

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

  // Back to the start on the timeline, paused. A slow run may have played it
  // to the end already, where Space would start it again.
  if (await page.evaluate(() => window.game.replay!.playing)) await page.keyboard.press('Space');
  await expect(bar(page).locator('.play')).toHaveAttribute('aria-label', 'Play');
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

test('a replay from another island opens that island in place, without a reload', async ({ page }) => {
  await shortRun(page, '?world=4242&time=dusk');
  const file = await saveRun(page);
  await page.click('#to-menu');
  await open(page);
  await expect(page.locator('#world-label')).toHaveText('Default island');
  // Marked, to tell a reload from none.
  await page.evaluate(() => Object.assign(window, { sameDocument: true }));
  await page.locator('#replay-file').setInputFiles({ name: file.name, mimeType: 'application/gzip', buffer: file.buffer });
  await expect(bar(page)).toBeVisible();
  await expect(bar(page).locator('.who')).toHaveText(/^Tester · Island #4242 · Dusk/);
  await expect(page).toHaveURL(/world=4242/);
  await expect(page).toHaveURL(/time=dusk/);
  expect(await page.evaluate(() => (window as unknown as { sameDocument?: boolean }).sameDocument)).toBe(true);
  // Opened from a click, so it plays at once.
  await expect(bar(page).locator('.play')).toHaveAttribute('aria-label', 'Pause');
  // Closing it leaves you on that island's menu, and a run there is on it.
  await bar(page).locator('.close').click();
  await expect(page.locator('#world-label')).toHaveText('Island #4242');
  await play(page);
  expect(await page.evaluate(() => (window.game.world as { seed: number }).seed)).toBe(4242);
});

test('New island opens one in place, without a reload', async ({ page }) => {
  await open(page);
  await page.evaluate(() => Object.assign(window, { sameDocument: true }));
  await page.click('#new-island');
  await expect(page.locator('#world-label')).toHaveText(/^Island #\d+$/);
  const seed = Number((await page.locator('#world-label').textContent())!.slice('Island #'.length));
  await expect(page).toHaveURL(new RegExp(`world=${seed}`));
  expect(await page.evaluate(() => (window as unknown as { sameDocument?: boolean }).sameDocument)).toBe(true);
  await play(page);
  await endRun(page, 'extracted');
});

test('your last runs are kept in the browser, and one is watched exactly from the menu', async ({ page }) => {
  await shortRun(page);
  await page.click('#to-menu');
  await page.click('#replay-open');
  const dialog = page.locator('#replays');
  await expect(dialog).toBeVisible();
  const rows = dialog.locator('.kept li');
  await expect(rows).toHaveCount(1);
  await expect(rows.first().locator('b')).toHaveText(/^Extracted · [\d,]+$/);
  await expect(rows.first().locator('span')).toHaveText(/^Tester · Default island · Day · 0:0\d · /);
  await rows.first().locator('.watch').click();
  await expect(dialog).toBeHidden();
  await expect(bar(page)).toBeVisible();
  await expect(bar(page).locator('.who')).toHaveText(/^Tester · Default island · Day · Extracted/);
  // The game is run again from its log, and everyone shown exactly.
  await page.waitForFunction(() => window.game.replay?.exactNow, null, { timeout: 30_000 });
  await bar(page).locator('.close').click();

  // A second run goes above the first.
  await play(page);
  await page.waitForTimeout(500);
  await endRun(page, 'mia');
  await page.click('#to-menu');
  await page.click('#replay-open');
  await expect(rows).toHaveCount(2);
  await expect(rows.first().locator('b')).toHaveText('Missing in action');
  // Saved from the list as a file.
  const download = page.waitForEvent('download');
  await rows.nth(1).locator('.save').click();
  expect((await download).suggestedFilename()).toMatch(/\.replay$/);
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
});

test('seeking rebuilds the feed; a friend sees the player’s name, not "You"', async ({ page, browser }) => {
  await open(page);
  await page.fill('#name', 'Tester');
  await page.locator('#name').blur();
  await play(page);
  await dev(page, { act: 'rival' });
  await page.waitForTimeout(300);
  await dev(page, { act: 'kill' });
  await expect(page.locator('#killfeed div.you')).toHaveCount(1);
  const killAt = await page.evaluate(() => window.game.conn!.lastTick / 30);
  await page.waitForTimeout(1500);
  await endRun(page, 'extracted');
  await page.click('#watch-run');
  await expect(bar(page)).toBeVisible();
  await page.keyboard.press('Space');
  // A moment after the kill: its row is there, as it was then.
  await page.evaluate((t) => {
    const scrub = document.querySelector('#replaybar .scrub') as HTMLInputElement;
    scrub.value = String(t);
    scrub.dispatchEvent(new Event('input'));
  }, killAt + 1);
  await expect(page.locator('#killfeed div.you')).toHaveCount(1);
  await expect(page.locator('#killfeed div.you')).toHaveText(/^You/);
  // Paused, it stays; the feed ages on the replay's time.
  await page.waitForTimeout(7000);
  await expect(page.locator('#killfeed div.you')).toHaveCount(1);
  const download = page.waitForEvent('download');
  await bar(page).locator('.save').click();
  const saved = await download;
  const file = { name: saved.suggestedFilename(), buffer: await readFile(await saved.path()) };

  // A friend opens the file in their own browser.
  const friend = await browser.newPage();
  await open(friend);
  await friend.locator('#replay-file').setInputFiles({ name: file.name, mimeType: 'application/gzip', buffer: file.buffer });
  await expect(bar(friend)).toBeVisible();
  await friend.keyboard.press('Space');
  await friend.evaluate((t) => {
    const scrub = document.querySelector('#replaybar .scrub') as HTMLInputElement;
    scrub.value = String(t);
    scrub.dispatchEvent(new Event('input'));
  }, killAt + 1);
  await expect(friend.locator('#killfeed div.you')).toHaveText(/^Tester/);
  await friend.close();
});

test('an Offline game waits while you watch your replay, and an Online one goes on', async ({ page }) => {
  for (const mode of ['offline', 'online'] as const) {
    await open(page);
    await play(page, mode);
    await page.waitForTimeout(500);
    await endRun(page, 'extracted');
    // What the page tells the local host.
    await page.evaluate(() => {
      const t = window.game.conn!.transport;
      const send = t.send.bind(t);
      t.sent = [];
      t.send = (m) => {
        t.sent!.push(JSON.stringify(m));
        send(m);
      };
    });
    const sent = () => page.evaluate(() => window.game.conn!.transport.sent!.filter((m) => m.includes('pause')));
    await page.click('#watch-run');
    await expect(bar(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('#results')).toBeVisible();
    expect(await sent()).toEqual(mode === 'offline'
      ? ['{"t":"pause","on":true}', '{"t":"pause","on":false}']
      : ['{"t":"pause","on":false}']);
  }
});
