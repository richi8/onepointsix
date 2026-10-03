import { expect, test } from '@playwright/test';
import { DEATHMATCH_CAPACITY } from '../src/shared/constants.ts';
import { dev, open, pickMode, play } from './game.ts';

/** Our own life count and whether we're down, as the client has it. */
async function me(page: import('@playwright/test').Page): Promise<{ life: number; dead: boolean }> {
  return page.evaluate(() => {
    const s = window.game.conn!.predictor.state as unknown as { life: number; dead: boolean };
    return { life: s.life, dead: s.dead };
  });
}

test('Deathmatch: no clock or extraction, every operator on Tab, and back in after the death cam', async ({ page }) => {
  await open(page);
  await pickMode(page, 'deathmatch');
  // Its own island: three towns, and no outposts or extraction points, on the menu too.
  expect(await page.evaluate(() => {
    const w = window.game.world as { towns: unknown[]; outposts: unknown[]; roads: unknown[] };
    return [w.towns.length, w.outposts.length, w.roads.length];
  })).toEqual([3, 0, 3]);
  expect(await page.evaluate(() => (window.game.view as unknown as { extractGroup: { visible: boolean } }).extractGroup.visible)).toBe(false);
  await expect(page.locator('#board .empty')).toHaveText('No games yet. Leave a Deathmatch game with a kill to post it.');
  await play(page, 'deathmatch');
  await expect(page.locator('#clock')).toBeHidden();
  await expect(page.locator('#extracts')).toBeHidden();
  await expect(page.locator('#pack')).toBeHidden();
  // No extraction points to see either.
  expect(await page.evaluate(() => (window.game.view as unknown as { extractGroup: { visible: boolean } }).extractGroup.visible)).toBe(false);

  // Everyone, bots too, with kills and deaths alone.
  await page.keyboard.down('Tab');
  const board = page.locator('#scoreboard');
  await expect(board.locator('tbody tr')).toHaveCount(DEATHMATCH_CAPACITY);
  await expect(board.locator('thead th')).toHaveText(['Operator', 'Kills', 'Deaths']);
  await page.keyboard.up('Tab');

  // Killed: no results, the death cam plays by itself, and skipping it puts us back in.
  const before = await me(page);
  await dev(page, { act: 'rival' });
  await dev(page, { act: 'end', outcome: 'killed' });
  await expect(page.locator('#death .respawn')).toBeVisible();
  await expect(page.locator('#deathcam')).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('#deathcam .skip')).toHaveText('Press Space to skip and respawn');
  await page.keyboard.press('Space');
  await expect(page.locator('#deathcam')).toBeHidden();
  await page.waitForFunction((life) => {
    const s = window.game.conn!.predictor.state as unknown as { life: number; dead: boolean };
    return !s.dead && s.life > life;
  }, before.life);
  await expect(page.locator('#results')).toBeHidden();
  await expect(page.locator('#hud')).toBeVisible();
  await page.keyboard.down('Tab');
  await expect(board.locator('tbody tr.you td').nth(2)).toHaveText('1');
  await page.keyboard.up('Tab');

  // Skipped before the death cam even starts: straight back in.
  const second = await me(page);
  await dev(page, { act: 'end', outcome: 'killed', self: true });
  await page.waitForFunction(() => (window.game.conn!.predictor.state as unknown as { dead: boolean }).dead);
  await page.keyboard.press('Space');
  await page.waitForFunction((life) => {
    const s = window.game.conn!.predictor.state as unknown as { life: number; dead: boolean };
    return !s.dead && s.life > life;
  }, second.life);
  expect(await page.evaluate(() => !!window.game.deathcam)).toBe(false);

  // Leaving posts the game's kills and deaths to this island's board.
  await dev(page, { act: 'rival' });
  await dev(page, { act: 'kill' });
  await page.waitForFunction(() => window.game.conn!.board.some((r) => r.id === window.game.conn!.id && r.kills === 1));
  await page.evaluate(() => document.exitPointerLock());
  await expect(page.locator('#paused')).toBeVisible();
  await page.click('#leave');
  await expect(page.locator('#board li').first()).toContainText('1 kill · 2 deaths');
  expect(await page.evaluate(() => (window.game.view as unknown as { extractGroup: { visible: boolean } }).extractGroup.visible)).toBe(false);

  // Back to Extraction: its island again, outposts and all.
  await pickMode(page, 'extraction');
  expect(await page.evaluate(() => (window.game.world as { outposts: unknown[] }).outposts.length)).toBe(6);
  expect(await page.evaluate(() => (window.game.view as unknown as { extractGroup: { visible: boolean } }).extractGroup.visible)).toBe(true);
});
