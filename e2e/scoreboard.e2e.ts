import { expect, test } from '@playwright/test';
import { dev, endRun, GOLD, open, play } from './game.ts';

test('holding Tab shows the players in the game, and their record carries on to the next run, under any name', async ({ page }) => {
  await open(page);
  await page.fill('#name', 'Tester');
  await page.locator('#name').blur();
  await play(page);
  const board = page.locator('#scoreboard');
  await expect(board).toBeHidden();
  await page.keyboard.down('Tab');
  await expect(board).toBeVisible();
  // Only us: the bots aren't listed.
  await expect(board.locator('tbody tr')).toHaveCount(1);
  await expect(board.locator('tbody tr.you')).toHaveText('Tester00$0$0');
  await page.keyboard.up('Tab');
  await expect(board).toBeHidden();

  await dev(page, { act: 'rival' });
  await dev(page, { act: 'kill' });
  await dev(page, { act: 'give', items: [GOLD] });
  await endRun(page, 'extracted');
  const score = (await page.locator('#results .score span').textContent())!;
  // Not over the results.
  await page.keyboard.down('Tab');
  await expect(board).toBeHidden();
  await page.keyboard.up('Tab');

  // Back by the menu under another name: the record follows the player, not the name.
  await page.click('#to-menu');
  await page.fill('#name', 'Renamed');
  await page.locator('#name').blur();
  await play(page);
  await page.keyboard.down('Tab');
  await expect(board.locator('tbody tr')).toHaveCount(1);
  await expect(board.locator('tbody tr.you')).toHaveText(`Renamed10$${score}$${score}`);
  await page.keyboard.up('Tab');
});
