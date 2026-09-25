import { expect, test } from '@playwright/test';

// Runs first; the frame-cost benchmark is its teardown, so it runs after every
// other test has finished.

test('the dev server serves the game', async ({ request }) => {
  const page = await request.get('./');
  expect(page.ok()).toBe(true);
  expect(await page.text()).toContain('src/client/main.ts');
});
