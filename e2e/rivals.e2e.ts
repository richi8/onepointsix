import { expect, test } from '@playwright/test';
import { dev, face, GOLD, open, play } from './game.ts';

test('carrying the most loot makes you the bounty', async ({ page }) => {
  await open(page);
  await play(page);
  await expect(page.locator('#bounty')).toBeHidden();
  await dev(page, { act: 'give', items: [GOLD] });
  const line = page.locator('#bounty');
  await expect(line).toBeVisible();
  await expect(line).toHaveClass(/you/);
  await expect(line).toHaveText(/^You carry the bounty · \$4,000 · everyone is told roughly where you are every \d+ s$/);
  await expect(page.locator('#killfeed div.you.bounty')).toHaveText('Youcarry the bounty · $4,000');
  // Nobody is shown their own marker.
  await expect(page.locator('#bountymark')).toBeHidden();
});

test("a rival with the bounty is marked; killing them shows in the feed, and their bag shows what it's worth", async ({ page }) => {
  await open(page);
  await play(page);
  // The rival brought in front, so it's also the one killed after.
  await dev(page, { act: 'rival' });
  await dev(page, { act: 'give', items: [GOLD, GOLD], rival: true });
  const line = page.locator('#bounty');
  await expect(line).toHaveText(/^Bounty · .+ carries \$8,000$/);
  await expect(line).not.toHaveClass(/you/);
  const name = await page.evaluate(() => window.game.conn!.bounty!.name);
  await expect(page.locator('#killfeed div.bounty')).toHaveText(`${name}carries the bounty · $8,000`);

  // Where they were called, when we look that way.
  const called = await page.evaluate(() => window.game.conn!.bounty!);
  await face(page, called.x, called.z);
  const mark = page.locator('#bountymark');
  await expect(mark).toBeVisible();
  await expect(mark).toHaveText(new RegExp(`^${name} · \\$8,000 · \\d+ m$`));

  await dev(page, { act: 'kill' });
  const row = page.locator('#killfeed div.you', { hasText: name }).filter({ has: page.locator('em.bounty') });
  await expect(row).toHaveCount(1);
  await expect(line).toBeHidden();

  // Their loot lies in a bag where they fell.
  await page.waitForFunction(() => window.game.conn!.bags.some((b) => b.value === 8000));
  const bag = await page.evaluate(() => window.game.conn!.bags.find((b) => b.value === 8000)!);
  await face(page, bag.x, bag.z);
  await expect(page.locator('#tags div', { hasText: '$8,000' })).toBeVisible();
});
