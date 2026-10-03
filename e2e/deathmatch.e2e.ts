import { expect, test } from '@playwright/test';
import { DEATHMATCH_CAPACITY } from '../src/shared/constants.ts';
import { dev, open, play } from './game.ts';

/** Our own life count and whether we're down, as the client has it. */
async function me(page: import('@playwright/test').Page): Promise<{ life: number; dead: boolean }> {
  return page.evaluate(() => {
    const s = window.game.conn!.predictor.state as unknown as { life: number; dead: boolean };
    return { life: s.life, dead: s.dead };
  });
}

test('Deathmatch: no clock or extraction, every operator on Tab, and back in after the death cam', async ({ page }) => {
  await open(page);
  await page.click('#modes [data-mode=deathmatch]');
  await expect(page.locator('#board .empty')).toHaveText('Deathmatch keeps no scores: hold Tab in a game for kills and deaths.');
  await play(page, 'deathmatch');
  await expect(page.locator('#clock')).toBeHidden();
  await expect(page.locator('#extracts')).toBeHidden();
  await expect(page.locator('#pack')).toBeHidden();

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
});
