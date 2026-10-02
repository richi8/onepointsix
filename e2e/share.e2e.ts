import { expect, test } from '@playwright/test';
import { parseShareLink } from '../src/shared/share.ts';
import { DEFAULT_WORLD } from '../src/shared/worldconfig.ts';
import { copyLinks, open, seedBoard } from './game.ts';

/** A private island to share from. */
const PRIVATE = { seed: 4242 };

test('Share link makes a fresh private island and takes you there', async ({ page }) => {
  await copyLinks(page);
  await seedBoard(page, DEFAULT_WORLD.seed, 'offline', [{ name: 'Ana', score: 9100, date: '2026-09-20' }]);
  // An old link's weather and time of day aren't passed on.
  await open(page, '?time=night&weather=fog');
  await expect(page.locator('#world-label')).toBeHidden();
  await page.click('#modes [data-mode=offline]');
  await page.click('#share-island');
  // Offline takes nobody, so the island is shared as Online, and a score from elsewhere doesn't count on it.
  await page.waitForURL(/[?&]private=1/);
  const url = new URL(page.url());
  const shared = parseShareLink(url.search);
  expect(shared).toMatchObject({ mode: 'online', private: true, challenge: null });
  expect(shared.world).not.toEqual(DEFAULT_WORLD);
  await expect(page.locator('#loading')).toHaveCount(0, { timeout: 60_000 });
  await expect(page.locator('#world-label')).toHaveText('Private island');
  await expect(page.locator('#toast')).toHaveText('Link copied. Send it to a friend.');
});

test('on a private island, the link is that island with your best to beat', async ({ page }) => {
  await copyLinks(page);
  await seedBoard(page, PRIVATE.seed, 'online', [{ name: 'Ana', score: 9100, date: '2026-09-20' }]);
  await open(page, `?world=${PRIVATE.seed}&private=1`);
  await page.click('#modes [data-mode=online]');
  await page.click('#share-island');
  await expect(page.locator('#toast')).toHaveText('Link copied. Send it to a friend.');
  const copied = await page.evaluate(() => window.copied);
  expect(copied).toHaveLength(1);
  const url = new URL(copied[0]);
  expect(url.origin + url.pathname).toBe(new URL(page.url()).origin + '/');
  expect(parseShareLink(url.search)).toEqual({
    world: PRIVATE,
    mode: 'online',
    private: true,
    challenge: { name: 'Ana', score: 9100 },
  });
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
  expect(dialog.value).toMatch(/\?world=\d+&mode=\w+&private=1$/);
});

test('where there is a share sheet, the link goes through it with your best to beat', async ({ page }) => {
  await copyLinks(page);
  await page.addInitScript(() => {
    window.shared = [];
    Object.defineProperty(navigator, 'share', {
      value: async (data: ShareData) => void window.shared.push(data),
    });
  });
  await seedBoard(page, PRIVATE.seed, 'offline', [{ name: 'Ana', score: 9100, date: '2026-09-20' }]);
  await open(page, `?world=${PRIVATE.seed}&private=1`);
  await page.click('#modes [data-mode=offline]');
  await page.click('#share-island');
  await expect.poll(() => page.evaluate(() => window.shared.length)).toBe(1);
  const [data] = await page.evaluate(() => window.shared);
  expect(data.text).toBe('Beat my 9,100 on this island.');
  expect(parseShareLink(new URL(data.url!).search)).toMatchObject({ mode: 'offline', private: true, challenge: { name: 'Ana', score: 9100 } });
  // Shared, not copied as well.
  expect(await page.evaluate(() => window.copied)).toEqual([]);
});

test('closing the share sheet without sharing does nothing more', async ({ page }) => {
  await copyLinks(page);
  await page.addInitScript(() => {
    window.shared = [];
    Object.defineProperty(navigator, 'share', {
      value: async (data: ShareData) => {
        window.shared.push(data);
        throw new DOMException('Share canceled', 'AbortError');
      },
    });
  });
  await open(page);
  const before = page.url();
  await page.click('#share-island');
  await expect.poll(() => page.evaluate(() => window.shared.length)).toBe(1);
  await page.waitForTimeout(200);
  expect(await page.evaluate(() => window.copied)).toEqual([]);
  await expect(page.locator('#toast')).toBeHidden();
  // Still on the island it started on.
  expect(page.url()).toBe(before);
});
