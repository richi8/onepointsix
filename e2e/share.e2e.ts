import { expect, test } from '@playwright/test';
import { parseShareLink } from '../src/shared/share.ts';
import { DEFAULT_WORLD } from '../src/shared/worldconfig.ts';
import { copyLinks, open, seedBoard } from './game.ts';

test('Share link copies the island, mode and your best to beat', async ({ page }) => {
  await copyLinks(page);
  await seedBoard(page, DEFAULT_WORLD.seed, 'offline', [{ name: 'Ana', score: 9100, date: '2026-09-20' }]);
  await open(page, '?time=night');
  await page.click('#modes [data-mode=offline]');
  await page.click('#share-island');
  await expect(page.locator('#toast')).toHaveText('Link copied. Send it to a friend.');
  const copied = await page.evaluate(() => window.copied);
  expect(copied).toHaveLength(1);
  const url = new URL(copied[0]);
  expect(url.origin + url.pathname).toBe(new URL(page.url()).origin + '/');
  expect(parseShareLink(url.search)).toEqual({
    world: { ...DEFAULT_WORLD, time: 'night' },
    mode: 'offline',
    challenge: { name: 'Ana', score: 9100 },
  });
});

test('with no best yet, the link is just the island', async ({ page }) => {
  await copyLinks(page);
  await open(page);
  await page.click('#modes [data-mode=online]');
  await page.click('#share-island');
  const copied = await page.evaluate(() => window.copied);
  expect(parseShareLink(new URL(copied[0]).search)).toMatchObject({ mode: 'online', challenge: null });
});

test('where copying is refused, the link is shown to copy by hand', async ({ page }) => {
  await copyLinks(page, true);
  await open(page);
  // The prompt holds up the click until it's answered.
  const shown = new Promise<{ type: string; message: string; value: string }>((resolve) => {
    page.once('dialog', (d) => {
      resolve({ type: d.type(), message: d.message(), value: d.defaultValue() });
      void d.dismiss();
    });
  });
  await page.click('#share-island');
  const dialog = await shown;
  expect(dialog.type).toBe('prompt');
  expect(dialog.message).toBe('Copy this link:');
  expect(dialog.value).toMatch(/\?world=\d+&mode=/);
});
