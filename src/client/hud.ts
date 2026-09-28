import * as THREE from 'three';
import { MAX_HP } from '../shared/constants.ts';
import { wrapAngle } from '../shared/geom.ts';
import type { Zone } from '../shared/hitbox.ts';
import type { Personality } from '../shared/personality.ts';
import type { GameEvent } from '../shared/protocol.ts';
import type { PlayerState } from '../shared/sim.ts';
import { BOLT, WEAPONS, weaponName } from '../shared/weapons.ts';

const HITMARKER_TIME = 0.15;
const KILLMARKER_TIME = 0.35;
const NUMBER_TIME = 0.9;
const FEED_TIME = 6;
const FEED_MAX = 5;
/** Seconds a feed row takes to fade out. */
const FEED_FADE = 0.4;
const HURT_ARC_TIME = 1;
const SLOT_NAMES = ['Rifle', 'Pistol', 'Bolt'];

const $ = (id: string) => document.getElementById(id)!;

interface FloatingNumber {
  el: HTMLElement;
  pos: THREE.Vector3;
  age: number;
}

interface FeedRow {
  el: HTMLElement;
  age: number;
}

/** Everything drawn over the game: health, ammo, crosshair, markers, feed and overlays. */
export class Hud {
  private readonly root = $('hud');
  private readonly crosshair = $('crosshair');
  private readonly hitmarker = $('hitmarker');
  private readonly numbersRoot = $('numbers');
  private readonly feed = $('killfeed');
  private readonly health = $('health');
  private readonly healthText = this.health.querySelector('span')!;
  private readonly healthFill = this.health.querySelector('div div') as HTMLElement;
  private readonly slots: HTMLElement[];
  private readonly weaponName = $('ammo').querySelector('.name')!;
  private readonly mag = $('ammo').querySelector('.mag') as HTMLElement;
  private readonly reserve = $('ammo').querySelector('.reserve')!;
  private readonly reloadBar = $('ammo').querySelector('.reloadbar') as HTMLElement;
  private readonly reloadFill = this.reloadBar.firstElementChild as HTMLElement;
  private readonly nades = $('ammo').querySelector('.nades') as HTMLElement;
  private readonly hurtFlash = $('hurt');
  private readonly hurtDir = $('hurtdir');
  private readonly scope = $('scope');
  private readonly death = $('death');
  private readonly deathText = this.death.querySelector('p')!;
  private readonly stamina = $('stamina');
  private readonly staminaFill = this.stamina.firstElementChild as HTMLElement;
  private readonly numbers: FloatingNumber[] = [];
  private readonly rows: FeedRow[] = [];
  private readonly tmp = new THREE.Vector3();
  private marker = 0;
  private hurt = 0;
  private killer = '';
  /** What kind of operator bot killed you, told as the run ends. */
  killerKind: Personality | null = null;

  constructor() {
    const slotsRoot = $('ammo').querySelector('.slots')!;
    this.slots = SLOT_NAMES.map((name, i) => {
      const el = document.createElement('span');
      el.textContent = `${i + 1} ${name}`;
      slotsRoot.append(el);
      return el;
    });
  }

  show(): void {
    this.root.hidden = false;
  }

  /**
   * Age the feed rows and hit numbers by `dt` seconds of the time shown: real
   * time in play, slowed with the death cam round the kill.
   */
  age(dt: number): void {
    for (const n of this.numbers) n.age += dt;
    for (let i = this.rows.length - 1; i >= 0; i--) {
      const r = this.rows[i];
      r.age += dt;
      if (r.age >= FEED_TIME) r.el.style.opacity = '0';
      if (r.age >= FEED_TIME + FEED_FADE) {
        r.el.remove();
        this.rows.splice(i, 1);
      }
    }
  }

  /**
   * Call once per frame. `spreadPx` is the current spread cone's radius on
   * screen; `aim` and `yaw` are the rendered values. `deathNotice` is off for
   * someone else's view, such as a killer's in the death cam.
   */
  update(dt: number, s: PlayerState | null, aim: number, spreadPx: number, sprinting: boolean, camera: THREE.Camera, deathNotice = true): void {
    this.marker = Math.max(this.marker - dt, 0);
    this.hitmarker.style.opacity = String(Math.min(this.marker / HITMARKER_TIME, 1));
    this.hurt = Math.max(this.hurt - dt * 1.5, 0);
    this.hurtFlash.style.opacity = String(this.hurt);
    this.updateNumbers(camera);
    if (!s) return;

    const w = WEAPONS[s.weapon];
    this.crosshair.style.setProperty('--gap', `${Math.round(spreadPx + 3)}px`);
    this.crosshair.style.opacity = s.dead || sprinting || aim > 0.5 ? '0' : '1';
    this.scope.style.opacity = s.weapon === BOLT ? String(Math.max((aim - 0.8) / 0.2, 0)) : '0';

    this.healthText.textContent = String(Math.ceil(s.hp));
    this.healthFill.style.width = `${(s.hp / MAX_HP) * 100}%`;
    this.health.classList.toggle('low', s.hp <= 30);

    this.slots.forEach((el, i) => el.classList.toggle('on', i === s.weapon));
    this.weaponName.textContent = s.suppressed[s.weapon] ? `${w.name} · suppressed` : w.name;
    this.mag.textContent = String(s.mag[s.weapon]);
    this.mag.classList.toggle('low', s.mag[s.weapon] <= w.magSize / 5);
    this.reserve.textContent = `/ ${s.reserve[s.weapon]}`;
    this.reloadBar.classList.toggle('on', s.reload > 0);
    this.reloadFill.style.width = `${(1 - s.reload / w.reloadTime) * 100}%`;
    this.nades.textContent = `G grenade × ${s.grenades}`;
    this.nades.classList.toggle('none', s.grenades === 0);

    this.stamina.hidden = s.stamina >= 1 && !s.winded;
    this.staminaFill.style.width = `${s.stamina * 100}%`;
    this.stamina.classList.toggle('winded', s.winded);

    this.death.hidden = !s.dead || !deathNotice;
    if (s.dead) this.deathText.textContent = this.killer ? `by ${this.killer}${this.killerKind ? `, a ${this.killerKind}` : ''}` : '';
  }

  /** The server confirmed one of our rounds hit. */
  hit(zone: Zone, killed: boolean, damage: number, x: number, y: number, z: number): void {
    this.mark(zone === 'head', killed);
    const el = document.createElement('span');
    el.textContent = String(damage);
    el.className = killed ? 'kill' : zone;
    el.style.opacity = '0';
    this.numbersRoot.append(el);
    this.numbers.push({ el, pos: new THREE.Vector3(x, y, z), age: 0 });
  }

  /** Flash the hit marker, bigger for a kill. */
  mark(head: boolean, killed: boolean): void {
    this.hitmarker.className = `hitmarker${head ? ' head' : ''}${killed ? ' kill' : ''}`;
    this.marker = killed ? KILLMARKER_TIME : HITMARKER_TIME;
  }

  /** We took damage from someone standing at `bearing` radians right of where we face. */
  hurtFrom(damage: number, bearing: number): void {
    this.hurt = Math.min(this.hurt + 0.35 + damage / 100, 1);
    const arc = document.createElement('i');
    arc.style.transform = `rotate(${bearing}rad) scale(3)`;
    this.hurtDir.append(arc);
    setTimeout(() => (arc.style.opacity = '0'), (HURT_ARC_TIME - 0.6) * 1000);
    setTimeout(() => arc.remove(), HURT_ARC_TIME * 1000);
  }

  kill(e: Extract<GameEvent, { k: 'kill' }>, me: number): void {
    const row = document.createElement('div');
    const killer = e.killer === me ? 'You' : e.killerName;
    const victim = e.victim === me ? 'you' : e.victimName;
    row.append(killer);
    const how = document.createElement('em');
    how.textContent = `${weaponName(e.weapon)}${e.head ? ' · headshot' : ''}`;
    row.append(how, victim);
    // An operator bot's kind is known once it's dead.
    if (e.victimKind) {
      const kind = document.createElement('em');
      kind.className = 'kind';
      kind.textContent = e.victimKind;
      row.append(kind);
    }
    if (e.bounty) {
      const b = document.createElement('em');
      b.className = 'bounty';
      b.textContent = 'bounty';
      row.append(b);
    }
    if (e.killer === me || e.victim === me) row.className = 'you';
    this.pushFeed(row);
    if (e.victim === me) this.killer = e.killer === me ? '' : e.killerName;
  }

  /** Someone left the island. */
  extract(e: Extract<GameEvent, { k: 'extract' }>, me: number): void {
    const row = document.createElement('div');
    row.append(e.id === me ? 'You' : e.name);
    const how = document.createElement('em');
    how.textContent = `extracted · $${e.value.toLocaleString('en-US')}`;
    row.append(how);
    row.className = e.id === me ? 'you extract' : 'extract';
    this.pushFeed(row);
  }

  /** Someone now carries the bounty; nobody losing it is told by the kill or extraction. */
  bounty(e: Extract<GameEvent, { k: 'bounty' }>, me: number): void {
    if (!e.id) return;
    const row = document.createElement('div');
    row.append(e.id === me ? 'You' : e.name);
    const how = document.createElement('em');
    how.textContent = `${e.id === me ? 'carry' : 'carries'} the bounty · $${e.value.toLocaleString('en-US')}`;
    row.append(how);
    row.className = e.id === me ? 'you bounty' : 'bounty';
    this.pushFeed(row);
  }

  /** Someone called in a pickup at a landing zone. */
  call(e: Extract<GameEvent, { k: 'call' }>, where: string, me: number): void {
    const row = document.createElement('div');
    row.append(e.id === me ? 'You' : e.name);
    const how = document.createElement('em');
    how.textContent = `called a pickup · ${where}`;
    row.append(how);
    row.className = 'extract';
    this.pushFeed(row);
  }

  /** One of our contracts was done, or someone else got to it first. */
  contract(title: string, state: 'done' | 'failed'): void {
    const row = document.createElement('div');
    row.append('Contract');
    const how = document.createElement('em');
    how.textContent = `${title} · ${state === 'done' ? 'done — get out to be paid' : 'failed'}`;
    row.append(how);
    row.className = state === 'done' ? 'you extract' : 'you';
    this.pushFeed(row);
  }

  /** Clear what's left over from the last run. */
  reset(): void {
    this.death.hidden = true;
    this.killer = '';
    this.killerKind = null;
    this.feed.replaceChildren();
    this.rows.length = 0;
    for (const n of this.numbers) n.el.remove();
    this.numbers.length = 0;
    this.marker = 0;
    this.hurt = 0;
  }

  private pushFeed(row: HTMLElement): void {
    this.feed.append(row);
    this.rows.push({ el: row, age: 0 });
    while (this.rows.length > FEED_MAX) this.rows.shift()!.el.remove();
  }

  private updateNumbers(camera: THREE.Camera): void {
    for (let i = this.numbers.length - 1; i >= 0; i--) {
      const n = this.numbers[i];
      if (n.age >= NUMBER_TIME) {
        n.el.remove();
        this.numbers.splice(i, 1);
        continue;
      }
      const v = this.tmp.copy(n.pos).project(camera);
      if (v.z > 1) {
        n.el.style.opacity = '0';
        continue;
      }
      const x = ((v.x + 1) / 2) * innerWidth + 18;
      const y = ((1 - v.y) / 2) * innerHeight - 10 - n.age * 50;
      n.el.style.left = `${x}px`;
      n.el.style.top = `${y}px`;
      n.el.style.opacity = String(1 - (n.age / NUMBER_TIME) ** 2);
    }
  }
}

/** Radians clockwise on screen from straight ahead to a point, for a viewer at (x, z) facing yaw. */
export function bearing(x: number, z: number, yaw: number, tx: number, tz: number): number {
  return -wrapAngle(Math.atan2(-(tx - x), -(tz - z)) - yaw);
}
