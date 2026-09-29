import { expect, test, type Page } from '@playwright/test';
import { dev, open, play } from './game.ts';

// A body killed in play falls as a ragdoll and drops its gun, stays once
// its operator is back in the game, and falls the same in the death cam.
//
// A busy test browser may take a while to let a body come to rest, so bodies
// are looked at a fixed step into their fall instead: the page's ragdolls are
// made to keep a copy of their joints then.

/** Steps into its fall (2.5 s) at which a body's joints are looked at. */
const AT = 150;

interface Fallen {
  rag: { pos: Float64Array; kept?: number[] } | null;
  drop: { tumbler: { pos: Float64Array; kept?: number[] } } | null;
}

/** Have every ragdoll and dropped gun keep a copy of its balls at step AT, or at rest if sooner, once the first appears. */
async function watchFalls(page: Page): Promise<void> {
  await page.evaluate((at) => {
    interface Kept { steps: number; asleep: boolean; pos: Float64Array; kept?: number[] }
    const figures = () => (window.game as unknown as { bodies: { figures: Map<number, Fallen> } }).bodies.figures;
    const look = () => {
      for (const f of figures().values()) {
        const any = f.rag ?? f.drop?.tumbler;
        if (!any) continue;
        // Ragdoll and Tumbler share their parent's step.
        const verlet = Object.getPrototypeOf(Object.getPrototypeOf(any)) as { step(...a: unknown[]): void };
        const step = verlet.step;
        verlet.step = function (this: Kept, ...a: unknown[]) {
          step.apply(this, a);
          if (!this.kept && (this.steps >= at || this.asleep)) this.kept = Array.from(this.pos);
        };
        return;
      }
      requestAnimationFrame(look);
    };
    look();
  }, AT);
}

/** The one fallen body's joints and gun at step AT, or at rest; `id`'s, if given. */
async function fallen(page: Page, stage: string, id?: number): Promise<{ id: number; joints: number[]; gun: number[] }> {
  const read = () => page.evaluate((only) => {
    const figures = (window.game as unknown as { bodies: { figures: Map<number, Fallen> } }).bodies.figures;
    for (const [id, f] of figures) {
      if (only !== null && id !== only) continue;
      if (f.rag?.kept && f.drop?.tumbler.kept) return { id, joints: f.rag.kept, gun: f.drop.tumbler.kept };
    }
    return null;
  }, id ?? null);
  await expect.poll(read, { message: `a body ${AT} steps into its fall ${stage}` }).not.toBeNull();
  return (await read())!;
}

test('a killed rival falls as a ragdoll and drops its gun', async ({ page }) => {
  await open(page);
  await play(page);
  // No one has died yet, so the first ragdoll to appear is the rival's.
  await watchFalls(page);
  await dev(page, { act: 'rival' });
  await page.waitForTimeout(500);
  await dev(page, { act: 'kill' });
  const live = await fallen(page, 'in play');
  // Going down: the head (joint 2) below where the hips (joint 0) started.
  expect(live.joints[7]).toBeLessThan(0.9 + Math.min(live.joints[1], live.joints[4]));
  // Back in the game BODY_TIME (5 s) after dying, the rival leaves its body lying.
  const left = () => page.evaluate(() => (window.game as unknown as { bodies: { corpses: unknown[] } }).bodies.corpses.length);
  await expect.poll(left, { message: 'the body left lying', timeout: 15_000 }).toBe(1);
});

test('the death cam replays a body falling just as it fell in play', async ({ page }) => {
  await open(page);
  await play(page);
  await watchFalls(page);
  await dev(page, { act: 'rival' });
  await page.waitForTimeout(500);
  await dev(page, { act: 'kill' });
  const live = await fallen(page, 'in play');
  // Killed by your own grenade a moment later: the death cam goes back over the rival's fall.
  await dev(page, { act: 'end', outcome: 'killed', self: true });
  await expect(page.locator('#deathcam')).toBeVisible();
  const replayed = await fallen(page, 'in the death cam', live.id);
  expect(replayed.joints).toEqual(live.joints);
  expect(replayed.gun).toEqual(live.gun);
});
