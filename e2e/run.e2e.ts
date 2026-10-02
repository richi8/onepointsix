import { expect, test } from '@playwright/test';
import { EXTRACT_FEE } from '../src/shared/constants.ts';
import { lootValue } from '../src/shared/loot.ts';
import { dev, endRun, GOLD, open, play } from './game.ts';

test.describe('results', () => {
  test('extracting scores the loot and posts it', async ({ page }) => {
    await open(page);
    await page.fill('#name', 'Tester');
    await page.locator('#name').blur();
    await play(page);
    await dev(page, { act: 'give', items: [GOLD, GOLD] });
    await endRun(page, 'extracted');
    const results = page.locator('#results');
    await expect(results.locator('h2')).toHaveText('Extracted');
    await expect(results.locator('.why')).toHaveText('You made it off the island.');
    const score = Number((await results.locator('.score span').textContent())!.replace(/,/g, ''));
    expect(score).toBeGreaterThanOrEqual(lootValue([GOLD, GOLD]) - EXTRACT_FEE);
    await expect(results.locator('.standing')).toHaveText('New best on this island!');
    await expect(results.locator('.items')).toHaveText('Gold bar ×2');
    // A game opens on a clear day.
    await expect(results.locator('dl')).toContainText('WeatherClear');
    for (const id of ['again', 'to-menu']) await expect(page.locator(`#${id}`)).toBeVisible();
    await expect(page.locator('#watch-deathcam')).toBeHidden();

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
    // The killer is the nearest operator bot, and the banner says what kind.
    const banner = (await deathcam.locator('.banner span').textContent())!;
    const [, killer, kind] = banner.match(/^Killed by (.+), a (rat|hunter|camper|looter)$/) ?? [];
    expect(killer).toBeTruthy();
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
    await expect(results.locator('.why')).toHaveText(`Killed by ${killer}, a ${kind}. Your loot stays with your body.`);
    // What that kind of rival does.
    await expect(results.locator('.rival')).toHaveText(new RegExp(`^${kind[0].toUpperCase()}${kind.slice(1)}s `));
    await expect(page.locator('#watch-deathcam')).toBeVisible();

    await page.click('#watch-deathcam');
    await expect(deathcam).toBeVisible();
    await expect(results).toBeHidden();
    await page.keyboard.press('Space');
    await expect(deathcam).toBeHidden();
    await expect(results).toBeVisible();
  });

  test('shows your own grenade killing you through your own eyes', async ({ page }) => {
    await open(page);
    await play(page);
    await dev(page, { act: 'end', outcome: 'killed', self: true });
    const deathcam = page.locator('#deathcam');
    await expect(deathcam).toBeVisible();
    await expect(deathcam.locator('.banner span')).toHaveText('Killed by your own grenade');
    await deathcam.click();
    await expect(page.locator('#results .why')).toHaveText('You died. Your loot stays with your body.');
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

test.describe('resuming', () => {
  // Chromium grants the pointer lock on a real click, but a key pressed by the
  // test doesn't free it, so Chrome's hold after Esc can't be brought about: a
  // refusing requestPointerLock stands in for it.
  test('a click takes the mouse back, or says why it can’t', async ({ page }) => {
    await open(page);
    await play(page);
    const card = page.locator('#paused');
    const note = card.locator('.resume');
    await expect(card).toBeHidden();
    await page.evaluate(() => document.exitPointerLock());
    await expect(card).toBeVisible();
    await expect(note).toHaveText('Click anywhere to resume');
    await card.locator('.score').click();
    await expect(card).toBeHidden();

    await page.evaluate(() => {
      document.exitPointerLock();
      HTMLElement.prototype.requestPointerLock = () => Promise.reject(new DOMException('held', 'SecurityError'));
    });
    await expect(card).toBeVisible();
    // As if Esc had freed it a moment ago.
    await page.evaluate(() => (window.game.input.freedAt = performance.now()));
    await card.locator('.score').click();
    await expect(note).toContainText('holds the mouse for a moment after Esc');
    await expect(note).toHaveText('Your browser didn’t give the mouse back. Click again to resume.', { timeout: 10_000 });
  });
});
