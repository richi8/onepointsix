import { expect, type Page } from '@playwright/test';
import { ITEMS } from '../src/shared/loot.ts';
import type { BoardEntry } from '../src/client/leaderboard.ts';
import type { DevCmd, Mode } from '../src/shared/protocol.ts';

// Driving the game in a test browser, through the page and the development
// build's window.game.

export const GOLD = ITEMS.findIndex((i) => i.name === 'Gold bar');

/** What the tests use of the game's sound. */
export interface Sfx {
  unlock(context?: BaseAudioContext): void;
  loaded(): Promise<void>;
  update(camera: Game['camera'], dt: number): void;
  shot(weapon: number, at?: { x: number; y: number; z: number }, quiet?: boolean): void;
  boom(at: { x: number; y: number; z: number }): void;
  step(surface: string, speed: number, crouched: boolean, at?: { x: number; y: number; z: number }): void;
  ago: number;
  format: { ext: string } | null;
  clips: Record<string, { buffer: AudioBuffer; start: number; duration: number }[]>;
}

/** What the tests read of window.game; the rest is there for the console. */
interface Game {
  dev(cmd: DevCmd): void;
  conn: {
    id: number;
    run: { items: number[] } | null;
    over: boolean;
    lastTick: number;
    transport: { send(msg: { t: string }): void; sent?: string[] };
    bounty: { id: number; name: string; x: number; z: number } | null;
    bags: { x: number; z: number; value?: number; kind?: string }[];
    predictor: { state: { x: number; z: number } };
  } | null;
  deathcam: object | null;
  sfx: Sfx;
  world: unknown;
  camera: { matrixWorld: { elements: number[] }; updateMatrixWorld(): void };
  input: { yaw: number; pitch: number; freedAt: number; light: boolean };
  /** Your own flashlight's spotlight is private to the class, but there to read. */
  flashlights: { own: { intensity: number } };
}

declare global {
  interface Window {
    game: Game;
    /** Links the page copied, with the clipboard stubbed by copyLinks. */
    copied: string[];
    /** What the page handed a stubbed share sheet. */
    shared: ShareData[];
  }
}

/** Open the game at `query` and wait for the loading screen to go. */
export async function open(page: Page, query = ''): Promise<void> {
  await page.goto(`./${query}`);
  await expect(page.locator('#loading')).toHaveCount(0, { timeout: 60_000 });
}

/** Start a run from the menu. */
export async function play(page: Page, mode: Mode = 'offline'): Promise<void> {
  await page.click(`#modes [data-mode=${mode}]`);
  await page.click('#play');
  await page.waitForFunction(() => !!window.game.conn?.run);
  await expect(page.locator('#hud')).toBeVisible();
}

/** A development shortcut: end the run, give loot, bring or kill a rival. */
export async function dev(page: Page, cmd: DevCmd): Promise<void> {
  await page.evaluate((c) => window.game.dev(c), cmd);
}

/** End the run as `outcome` and wait for the results (after the death cam, when killed, skipped). */
export async function endRun(page: Page, outcome: 'extracted' | 'killed' | 'mia'): Promise<void> {
  await dev(page, { act: 'end', outcome });
  if (outcome === 'killed') {
    await expect(page.locator('#deathcam')).toBeVisible();
    await page.locator('#deathcam').click();
  }
  await expect(page.locator('#results')).toBeVisible();
}

/** Turn our own view to face (x, z). */
export async function face(page: Page, x: number, z: number): Promise<void> {
  await page.evaluate(([x, z]) => {
    const me = window.game.conn!.predictor.state;
    window.game.input.yaw = Math.atan2(-(x - me.x), -(z - me.z));
    window.game.input.pitch = 0;
  }, [x, z]);
}

/**
 * Catch what the page copies to the clipboard in window.copied, the same in
 * every engine, or with `refuse` make copying fail as a browser may.
 */
export async function copyLinks(page: Page, refuse = false): Promise<void> {
  await page.addInitScript((refuse) => {
    window.copied = [];
    // No share sheet, so the link is copied, as in Firefox.
    Object.defineProperty(navigator, 'share', { value: undefined, configurable: true });
    Object.defineProperty(navigator, 'clipboard', {
      value: {
        writeText: async (text: string) => {
          if (refuse) throw new Error('Not allowed');
          window.copied.push(text);
        },
      },
    });
  }, refuse);
}

/** Put scores on this browser's board before the page loads. */
export async function seedBoard(page: Page, seed: number, mode: Mode, entries: BoardEntry[]): Promise<void> {
  await page.addInitScript(([key, value]) => localStorage.setItem(key, value), [`board:${seed >>> 0}:${mode}`, JSON.stringify(entries)]);
}
