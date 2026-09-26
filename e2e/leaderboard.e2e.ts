import { expect, test } from '@playwright/test';
import { shareQuery } from '../src/shared/share.ts';
import { DEFAULT_WORLD } from '../src/shared/worldconfig.ts';
import { open, seedBoard } from './game.ts';

const SEED = DEFAULT_WORLD.seed;
const rows = (page: import('@playwright/test').Page) => page.locator('#board li');

test('an empty board says how to get on it, keeping its size', async ({ page }) => {
  await open(page);
  await expect(page.locator('#board .empty')).toHaveText('No scores yet. Get off the island with loot to post one.');
  await expect(rows(page)).toHaveCount(5);
  await expect(page.locator('#board h3')).toHaveText(/Your best here · (Online|Offline)/);
});

test('shows this mode\'s best runs, best first, filled out with open places', async ({ page }) => {
  await seedBoard(page, SEED, 'offline', [
    { name: 'Ana', score: 9100, date: '2026-09-20' },
    { name: 'Ben', score: 4200, date: '2026-09-21' },
  ]);
  await open(page);
  await page.click('#modes [data-mode=offline]');
  await expect(page.locator('#board .empty')).toBeHidden();
  await expect(rows(page)).toHaveCount(5);
  await expect(rows(page).nth(0)).toContainText('1.Ana9,100');
  await expect(rows(page).nth(1)).toContainText('2.Ben4,200');
  await expect(rows(page).nth(2)).toHaveClass('open');
  // Another mode has its own board.
  await page.click('#modes [data-mode=online]');
  await expect(page.locator('#board .empty')).toBeVisible();
});

test('a challenge link puts the score to beat among yours', async ({ page }) => {
  await seedBoard(page, SEED, 'offline', [
    { name: 'Me', score: 8000, date: '2026-09-20' },
    { name: 'Me', score: 3000, date: '2026-09-21', time: 'night', weather: 'rain' },
  ]);
  await open(page, shareQuery(DEFAULT_WORLD, 'offline', { name: 'Rival', score: 5000 }));
  const challenge = page.locator('#challenge');
  await expect(challenge).toHaveText('Rival scored 5,000 on this island in Offline. Beat it.');
  await expect(page.locator('#modes [data-mode=offline]')).toHaveAttribute('aria-checked', 'true');
  await expect(rows(page).nth(1)).toHaveClass(/rival/);
  // Each row shows the conditions its score was set in: the link's for the challenge.
  await expect(rows(page).nth(0)).toContainText('1.Me8,000');
  await expect(rows(page).nth(1)).toContainText('RivalDay5,000to beat');
  await expect(rows(page).nth(2)).toContainText('3.MeNight · Rain3,000');
  // In the other mode it fades and leaves the board.
  await page.click('#modes [data-mode=online]');
  await expect(challenge).toHaveClass(/off/);
  await expect(page.locator('#board li.rival')).toHaveCount(0);
});

test('keeps the challenge in view below the rows shown', async ({ page }) => {
  await seedBoard(page, SEED, 'offline', [9, 8, 7, 6, 5, 4].map((k) => ({ name: `Me${k}`, score: k * 1000, date: '2026-09-20' })));
  await open(page, shareQuery(DEFAULT_WORLD, 'offline', { name: 'Low', score: 100 }));
  await expect(rows(page)).toHaveCount(5);
  await expect(rows(page).nth(4)).toContainText('7.LowDay100to beat');
});
