import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { endRun, open, play } from './game.ts';

test('Stats sums up your runs, and exports them as a file', async ({ page }) => {
  await open(page);
  await page.click('#stats-open');
  const stats = page.locator('#stats');
  await expect(stats).toBeVisible();
  await expect(stats.locator('.empty')).toBeVisible();
  await expect(stats.locator('.export')).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(stats).toBeHidden();

  await play(page);
  await endRun(page, 'extracted');
  await page.click('#to-menu');
  await page.click('#stats-open');
  await expect(stats.locator('.empty')).toBeHidden();
  await expect(stats.locator('.tiles div').first()).toHaveText('1Runs');
  await expect(stats.locator('.tiles div').nth(1)).toHaveText('100%Extracted');
  await expect(stats.locator('.recent li')).toHaveCount(1);
  await expect(stats.locator('.recent li')).toHaveText(/^Extracted · [\d,]+ · Default island · Day · \d+:\d\d · /);

  const download = page.waitForEvent('download');
  await stats.locator('.export').click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/^onepointsix-runs-\d{4}-\d\d-\d\d\.json$/);
  const data = JSON.parse(await readFile((await file.path())!, 'utf8'));
  expect(data).toMatchObject({ format: 'onepointsix-runs', version: 2, runs: [{ outcome: 'extracted', mode: 'offline' }] });
  expect(typeof data.build).toBe('string');
  await expect(page.locator('#toast')).toHaveText('Runs exported. Send the file to the developer.');
});

test("PvE's old boards are cleared out of storage", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('board:42:pve', '[{"name":"Old","score":5,"date":"2026-09-20"}]');
    localStorage.setItem('board:42:offline', '[{"name":"New","score":6,"date":"2026-09-26"}]');
  });
  await open(page);
  expect(await page.evaluate(() => [localStorage.getItem('board:42:pve'), localStorage.getItem('board:42:offline')]))
    .toEqual([null, '[{"name":"New","score":6,"date":"2026-09-26"}]']);
});
