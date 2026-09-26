import { expect, test, type Page } from '@playwright/test';
import { dev, endRun, open, play } from './game.ts';

// A body killed in play falls as a ragdoll, and its replay lays it in exactly
// the same place: seeking past the kill, and playing through it at 4×.
//
// Dead operators go after BODY_TIME (5 s), sooner than a busy test browser may
// let a body come to rest, so bodies are compared at a fixed step of their fall
// instead: the page's ragdolls are made to keep a copy of their joints then.

/** Steps into its fall (2.5 s) at which a body's joints are compared. */
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

/** The one fallen body's joints and gun at step AT, or at rest. */
async function fallen(page: Page, stage: string): Promise<{ id: number; joints: number[]; gun: number[] }> {
  const read = () => page.evaluate(() => {
    const figures = (window.game as unknown as { bodies: { figures: Map<number, Fallen> } }).bodies.figures;
    for (const [id, f] of figures) {
      if (f.rag?.kept && f.drop?.tumbler.kept) return { id, joints: f.rag.kept, gun: f.drop.tumbler.kept };
    }
    return null;
  });
  await expect.poll(read, { message: `a body ${AT} steps into its fall ${stage}` }).not.toBeNull();
  return (await read())!;
}

test('a killed rival falls as a ragdoll, and its replay falls exactly the same', async ({ page }) => {
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

  await endRun(page, 'extracted');
  await page.click('#watch-run');
  await expect(page.locator('#replaybar')).toBeVisible();

  // Seeking to just after the kill: the body is first seen dead, and falls in one go.
  if (await page.evaluate(() => window.game.replay!.playing)) await page.keyboard.press('Space');
  const scrub = page.locator('#replaybar .scrub');
  // The scrubber runs in server time, and takes a value only as the input would write it.
  const killed = await page.evaluate(() => {
    const r = window.game.replay as unknown as { data: { events: [number, { k: string }][] } };
    return r.data.events.find(([, e]) => e.k === 'kill')![0];
  });
  await scrub.fill(String(Math.round((killed + 0.5) * 100) / 100));
  expect(await fallen(page, 'after seeking')).toEqual(live);

  // Played through at 4×, from before the kill.
  await scrub.fill(String(Math.ceil(Number(await scrub.getAttribute('min')) * 100) / 100));
  await page.keyboard.press('BracketRight');
  await page.keyboard.press('BracketRight');
  await page.keyboard.press('Space');
  expect(await fallen(page, 'played through')).toEqual(live);
});
