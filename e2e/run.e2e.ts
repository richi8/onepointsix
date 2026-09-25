import { expect, test } from '@playwright/test';
import { lootValue } from '../src/shared/loot.ts';
import { parseShareLink } from '../src/shared/share.ts';
import { copyLinks, dev, endRun, GOLD, open, play } from './game.ts';

test.describe('results', () => {
  test('extracting scores the loot, posts it and offers to share it', async ({ page }) => {
    await copyLinks(page);
    await open(page);
    await page.fill('#name', 'Tester');
    await page.locator('#name').blur();
    await play(page);
    await dev(page, { act: 'give', items: [GOLD] });
    await endRun(page, 'extracted');
    const results = page.locator('#results');
    await expect(results.locator('h2')).toHaveText('Extracted');
    await expect(results.locator('.why')).toHaveText('You made it off the island.');
    const score = Number((await results.locator('.score span').textContent())!.replace(/,/g, ''));
    expect(score).toBeGreaterThanOrEqual(lootValue([GOLD]));
    await expect(results.locator('.standing')).toHaveText('New best on this island!');
    await expect(results.locator('.items')).toHaveText('Gold bar');
    for (const id of ['again', 'to-menu', 'share-run', 'watch-run', 'save-run']) await expect(page.locator(`#${id}`)).toBeVisible();
    await expect(page.locator('#replay')).toBeHidden();

    await expect(page.locator('#share-run')).toHaveText('Challenge a friend');
    await page.click('#share-run');
    const copied = await page.evaluate(() => window.copied);
    expect(parseShareLink(new URL(copied[0]).search)).toMatchObject({ mode: 'offline', challenge: { name: 'Tester', score } });

    await page.click('#to-menu');
    await expect(page.locator('#menu')).toBeVisible();
    await expect(page.locator('#board li').first()).toContainText(`1.Tester${score.toLocaleString('en-US')}`);
  });

  test('Play again starts a fresh run', async ({ page }) => {
    await open(page);
    await play(page);
    await endRun(page, 'mia');
    await expect(page.locator('#results h2')).toHaveText('Missing in action');
    await expect(page.locator('#results .score span')).toHaveText('0');
    await expect(page.locator('#share-run')).toHaveText('Share island');
    await page.click('#again');
    await expect(page.locator('#results')).toBeHidden();
    await expect(page.locator('#hud')).toBeVisible();
    await page.waitForFunction(() => !!window.game.conn?.run && !window.game.conn.over);
  });
});

test.describe('death cam', () => {
  test("plays from the killer's eyes with their HUD, then the results; it can be watched again", async ({ page }) => {
    await open(page);
    await play(page);
    await dev(page, { act: 'end', outcome: 'killed' });
    // The death camera sinks first, with the death notice.
    await expect(page.locator('#death')).toBeVisible();
    const deathcam = page.locator('#deathcam');
    await expect(deathcam).toBeVisible();
    const killer = (await deathcam.locator('.banner span').textContent())!.replace(/^Killed by /, '');
    expect(killer).not.toBe('');
    await expect(page.locator('#hud')).toHaveClass(/watching/);
    await expect(page.locator('#hud')).toBeVisible();
    await expect(page.locator('#health')).toBeVisible();
    await expect(page.locator('#ammo .name')).not.toBeEmpty();
    // No death notice over the killer's view.
    await expect(page.locator('#death')).toBeHidden();

    await deathcam.click();
    await expect(deathcam).toBeHidden();
    const results = page.locator('#results');
    await expect(results.locator('h2')).toHaveText('Killed in action');
    await expect(results.locator('.why')).toHaveText(`Killed by ${killer}. Your loot stays with your body.`);
    await expect(page.locator('#replay')).toBeVisible();

    await page.click('#replay');
    await expect(deathcam).toBeVisible();
    await expect(results).toBeHidden();
    await page.keyboard.press('Space');
    await expect(deathcam).toBeHidden();
    await expect(results).toBeVisible();
  });

  test('ends by itself and shows the results', async ({ page }) => {
    await open(page);
    await play(page);
    await dev(page, { act: 'end', outcome: 'killed' });
    await expect(page.locator('#deathcam')).toBeVisible();
    await expect(page.locator('#deathcam')).toBeHidden({ timeout: 30_000 });
    await expect(page.locator('#results')).toBeVisible();
  });
});
