import * as THREE from 'three';
import { CALL_TIME, CARRY_HEAVY, EXTRACT_TIME, KILL_SCORE_GUARD, KILL_SCORE_OPERATOR } from '../shared/constants.ts';
import { extractKind, extractName, ITEMS, lootMass, lootValue } from '../shared/loot.ts';
import type { ContractView, ExtractView, GameEvent, RunView } from '../shared/protocol.ts';
import type { World } from '../shared/world.ts';
import { bearing } from './hud.ts';

const $ = (id: string) => document.getElementById(id)!;

/** Items listed in the pack before the rest are summed up. */
const PACK_SHOWN = 8;
/** Contract markers float this far above their target, metres. */
const MARKER_LIFT = 2.5;

export type RunEnd = Extract<GameEvent, { k: 'runEnd' }>;

/** Everything about the run on screen: clock, extraction points, what you face, what you carry, and the results. */
export class RunHud {
  private readonly clock = $('clock');
  private readonly extracts = $('extracts');
  private readonly contracts = $('contracts');
  private readonly markers = $('markers');
  private readonly tmp = new THREE.Vector3();
  private readonly prompt = $('prompt');
  private readonly promptTitle = this.prompt.querySelector('.title')!;
  private readonly promptList = this.prompt.querySelector('ul')!;
  private readonly promptBar = this.prompt.querySelector('.bar') as HTMLElement;
  private readonly promptFill = this.promptBar.firstElementChild as HTMLElement;
  private readonly pack = $('pack');
  private readonly packSum = this.pack.querySelector('.sum')!;
  private readonly packList = this.pack.querySelector('ul')!;
  private readonly results = $('results');
  private readonly world: World;
  private readonly names: string[];
  /** Last rendered text of each part, so the DOM is only touched on change. */
  private shown = { extracts: '', contracts: '', prompt: '', pack: '' };

  constructor(world: World) {
    this.world = world;
    this.names = world.extracts.map((_, i) => extractName(world, i));
  }

  /** Call once per frame while a run is on; null hides it all (e.g. on the range). */
  update(run: RunView | null, views: readonly ExtractView[], x: number, z: number, yaw: number, camera: THREE.Camera): void {
    for (const el of [this.clock, this.extracts, this.prompt, this.pack, this.markers]) el.hidden = !run;
    this.contracts.hidden = !run?.contracts.length;
    if (!run) return;

    this.clock.textContent = clock(run.time);
    this.clock.classList.toggle('low', run.time < 60);

    // Extraction points, nearest first, with where they are and whether they're open.
    const rows = views
      .map((v, i) => ({ v, i, d: Math.hypot(this.world.extracts[i].x - x, this.world.extracts[i].z - z) }))
      .sort((a, b) => a.d - b.d)
      .map(({ v, i, d }) => {
        const e = this.world.extracts[i];
        const arrow = arrowFor(bearing(x, z, yaw, e.x, e.z));
        const status = v.call >= 0 ? `pickup ${clock(v.call)}` : v.open ? `open · ${clock(v.next)}` : `shut · ${clock(v.next)}`;
        const cls = v.call >= 0 ? 'called' : v.open ? 'open' : 'shut';
        return `<div class="${cls}${i === run.zone ? ' here' : ''}"><b>${arrow}</b><span>${this.names[i]}</span><em>${Math.round(d)} m</em><i>${status}</i></div>`;
      })
      .join('');
    this.set('extracts', this.extracts, rows);
    this.updateContracts(run.contracts, x, z, yaw, camera);

    this.updatePrompt(run, views);

    const mass = lootMass(run.items);
    const value = lootValue(run.items);
    const counts = new Map<number, number>();
    for (const i of run.items) counts.set(i, (counts.get(i) ?? 0) + 1);
    const lines = [...counts].slice(0, PACK_SHOWN).map(([i, n]) => `<li>${ITEMS[i].name}${n > 1 ? ` ×${n}` : ''}</li>`);
    if (counts.size > PACK_SHOWN) lines.push(`<li>+${counts.size - PACK_SHOWN} more</li>`);
    const kills = run.kills + run.guardKills;
    const sum = `<b>${money(value)}</b> · <span class="${mass >= CARRY_HEAVY ? 'heavy' : ''}">${mass.toFixed(1)} kg</span>` +
      (kills ? ` · ${kills} kill${kills > 1 ? 's' : ''}` : '');
    this.set('pack', this.pack, `${sum}|${lines.join('')}`, () => {
      this.packSum.innerHTML = sum;
      this.packList.innerHTML = lines.join('') + (run.items.length ? '<li class="hint">X drop last</li>' : '');
    });
  }

  /** Your contracts in the corner, and a marker over each one still open. */
  private updateContracts(contracts: readonly ContractView[], x: number, z: number, yaw: number, camera: THREE.Camera): void {
    const rows = contracts.map((c) => {
      const d = Math.hypot(c.x - x, c.z - z);
      const wrecked = c.kind === 'cache' && c.state === 'open' && this.world.panels[c.panel]?.box.gone;
      const status = c.state === 'done' ? `done · +${money(c.reward)} on extraction`
        : c.state === 'failed' ? 'failed — someone else got there first'
        : wrecked ? 'wrecked by someone else — rebuilt in a few minutes'
        : `${this.where(c)} · ${money(c.reward)}`;
      const arrow = c.state === 'open' ? arrowFor(bearing(x, z, yaw, c.x, c.z)) : c.state === 'done' ? '✓' : '✗';
      const far = c.state === 'open' ? `${Math.round(d)} m` : '';
      return `<div class="${c.state}"><b>${arrow}</b><span>${contractTitle(c)}</span><em>${far}</em><i>${status}</i></div>`;
    });
    this.set('contracts', this.contracts, rows.join(''));

    while (this.markers.children.length < contracts.length) this.markers.append(document.createElement('div'));
    [...this.markers.children].forEach((el, i) => {
      const m = el as HTMLElement;
      const c = contracts[i];
      const v = c && c.state === 'open' ? this.tmp.set(c.x, c.y + MARKER_LIFT, c.z).project(camera) : null;
      m.hidden = !v || v.z > 1 || Math.abs(v.x) > 1 || Math.abs(v.y) > 1;
      if (m.hidden || !v) return;
      const text = `${Math.round(Math.hypot(c.x - x, c.z - z))} m`;
      if (m.textContent !== text) m.textContent = text;
      m.style.transform = `translate(${((v.x + 1) / 2) * innerWidth}px, ${((1 - v.y) / 2) * innerHeight}px)`;
    });
  }

  /** Where a contract is, e.g. "Outpost Kilo watchtower". */
  private where(c: ContractView): string {
    const name = this.world.outposts[c.outpost]?.name ?? '';
    return c.kind === 'intel' ? `${name} watchtower` : name;
  }

  /** What you're facing or standing in, and what pressing F would do. */
  private updatePrompt(run: RunView, views: readonly ExtractView[]): void {
    let title = '';
    let items: string[] = [];
    let bar = -1;
    const loot = run.loot;
    const intel = run.contracts[run.intel];
    if (intel) {
      title = `Hold <kbd>F</kbd> grab the intel`;
      bar = intel.progress;
    } else if (loot) {
      const what = loot.kind === 'bag' ? 'bag' : 'crate';
      if (!loot.searched) {
        title = `Hold <kbd>F</kbd> search ${what}`;
        bar = loot.progress;
      } else if (loot.items.length) {
        title = `<kbd>F</kbd> take`;
        items = loot.items.map((i) => {
          const it = ITEMS[i];
          return `<li>${it.name}<em>${it.use ? 'use now' : `${money(it.value)} · ${it.mass} kg`}</em></li>`;
        });
      } else title = `Empty ${what}`;
    } else if (run.zone >= 0) {
      const v = views[run.zone];
      const call = extractKind(run.zone) === 'call';
      if (v && v.call >= 0) {
        title = `Pickup in ${Math.ceil(v.call)} — hold the zone`;
        bar = 1 - v.call / CALL_TIME;
      } else if (v && !v.open) title = `Extraction shut — opens in ${clock(v.next)}`;
      else if (call) title = `<kbd>F</kbd> call a pickup — it will be heard`;
      else {
        title = 'Extracting — stay in the zone';
        bar = run.hold / EXTRACT_TIME;
      }
    }
    const key = `${title}|${items.join('')}`;
    this.prompt.hidden = !title;
    this.set('prompt', this.prompt, key, () => {
      this.promptTitle.innerHTML = title;
      this.promptList.innerHTML = items.join('');
    });
    this.promptBar.hidden = bar < 0;
    this.promptFill.style.width = `${Math.min(Math.max(bar, 0), 1) * 100}%`;
  }

  /** The run is over: show how it went. */
  showResults(e: RunEnd): void {
    const title = { extracted: 'Extracted', killed: 'Killed in action', mia: 'Missing in action' }[e.outcome];
    const why = {
      extracted: 'You made it off the island.',
      killed: e.killer ? `Killed by ${e.killer}. Your loot stays with your body.` : 'You died. Your loot stays with your body.',
      mia: 'The run clock ran out. Nobody came for you.',
    }[e.outcome];
    const out = e.outcome === 'extracted';
    const rows: [string, string][] = [
      ['Loot', out ? money(e.value) : `<s>${money(e.value)}</s>`],
      [`Operators killed × ${KILL_SCORE_OPERATOR}`, String(e.kills)],
      [`Guards killed × ${KILL_SCORE_GUARD}`, String(e.guardKills)],
      ...e.contracts.map((c): [string, string] => {
        const pay = c.state === 'done' ? `+${money(c.reward)}` : c.state === 'failed' ? 'failed' : 'not done';
        return [contractTitle(c), c.state === 'done' && !out ? `<s>${pay}</s>` : pay];
      }),
      ['Time', clock(e.time)],
    ];
    const counts = new Map<number, number>();
    for (const i of e.items) counts.set(i, (counts.get(i) ?? 0) + 1);
    const r = this.results;
    r.classList.toggle('good', out);
    r.querySelector('h2')!.textContent = title;
    r.querySelector('.why')!.textContent = why;
    r.querySelector('.score span')!.textContent = e.score.toLocaleString('en-US');
    r.querySelector('dl')!.innerHTML = rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');
    r.querySelector('.items')!.innerHTML = [...counts]
      .map(([i, n]) => `<li>${ITEMS[i].name}${n > 1 ? ` ×${n}` : ''}</li>`)
      .join('');
    r.hidden = false;
    (r.querySelector('button') as HTMLButtonElement).focus();
  }

  hideResults(): void {
    this.results.hidden = true;
  }

  private set(key: keyof RunHud['shown'], el: HTMLElement, html: string, apply = () => void (el.innerHTML = html)): void {
    if (this.shown[key] === html) return;
    this.shown[key] = html;
    apply();
  }
}

/** What a contract asks for. */
export function contractTitle(c: ContractView): string {
  if (c.kind === 'intel') return 'Grab the intel';
  if (c.kind === 'cache') return 'Destroy the supply cache';
  return `Eliminate ${c.name || 'the commander'}`;
}

function clock(seconds: number): string {
  const s = Math.max(Math.ceil(seconds), 0);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function money(value: number): string {
  return `$${value.toLocaleString('en-US')}`;
}

/** An arrow pointing from straight ahead toward something `bearing` radians clockwise. */
function arrowFor(bearing: number): string {
  const arrows = ['↑', '↗', '→', '↘', '↓', '↙', '←', '↖'];
  return arrows[((Math.round(bearing / (Math.PI / 4)) % 8) + 8) % 8];
}
