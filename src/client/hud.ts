import * as THREE from 'three';
import { MAX_HP, RESPAWN_TIME } from '../shared/constants.ts';
import { wrapAngle } from '../shared/geom.ts';
import type { Zone } from '../shared/hitbox.ts';
import type { GameEvent } from '../shared/protocol.ts';
import type { PlayerState } from '../shared/sim.ts';
import { BOLT, WEAPONS, weaponName } from '../shared/weapons.ts';

const HITMARKER_TIME = 0.15;
const KILLMARKER_TIME = 0.35;
const NUMBER_TIME = 0.9;
const FEED_TIME = 6;
const FEED_MAX = 5;
const HURT_ARC_TIME = 1;
const SLOT_NAMES = ['Rifle', 'Pistol', 'Bolt'];

const $ = (id: string) => document.getElementById(id)!;

interface FloatingNumber {
  el: HTMLElement;
  pos: THREE.Vector3;
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
  private readonly tmp = new THREE.Vector3();
  private marker = 0;
  private hurt = 0;
  private killer = '';
  private respawnIn = 0;
  /** Playing a run, where the dead don't respawn. */
  runs = false;

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
   * Call once per frame. `spreadPx` is the current spread cone's radius on
   * screen; `aim` and `yaw` are the rendered values.
   */
  update(dt: number, s: PlayerState | null, aim: number, spreadPx: number, sprinting: boolean, camera: THREE.Camera): void {
    this.marker = Math.max(this.marker - dt, 0);
    this.hitmarker.style.opacity = String(Math.min(this.marker / HITMARKER_TIME, 1));
    this.hurt = Math.max(this.hurt - dt * 1.5, 0);
    this.hurtFlash.style.opacity = String(this.hurt);
    this.updateNumbers(dt, camera);
    if (!s) return;

    const w = WEAPONS[s.weapon];
    this.crosshair.style.setProperty('--gap', `${Math.round(spreadPx + 3)}px`);
    this.crosshair.style.opacity = s.dead || sprinting || aim > 0.5 ? '0' : '1';
    this.scope.style.opacity = s.weapon === BOLT ? String(Math.max((aim - 0.8) / 0.2, 0)) : '0';

    this.healthText.textContent = String(Math.ceil(s.hp));
    this.healthFill.style.width = `${(s.hp / MAX_HP) * 100}%`;
    this.health.classList.toggle('low', s.hp <= 30);

    this.slots.forEach((el, i) => el.classList.toggle('on', i === s.weapon));
    this.weaponName.textContent = w.name;
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

    this.death.hidden = !s.dead;
    if (s.dead) {
      this.respawnIn = Math.max(this.respawnIn - dt, 0);
      const by = this.killer ? `by ${this.killer}` : '';
      this.deathText.textContent = this.runs ? by : `${by ? `${by} · ` : ''}respawning in ${this.respawnIn.toFixed(1)}`;
    }
  }

  /** The server confirmed one of our rounds hit. */
  hit(zone: Zone, killed: boolean, damage: number, x: number, y: number, z: number): void {
    this.hitmarker.className = `hitmarker${zone === 'head' ? ' head' : ''}${killed ? ' kill' : ''}`;
    this.marker = killed ? KILLMARKER_TIME : HITMARKER_TIME;
    const el = document.createElement('span');
    el.textContent = String(damage);
    el.className = killed ? 'kill' : zone;
    this.numbersRoot.append(el);
    this.numbers.push({ el, pos: new THREE.Vector3(x, y, z), age: 0 });
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
    if (e.killer === me || e.victim === me) row.className = 'you';
    this.pushFeed(row);
    if (e.victim === me) {
      this.killer = e.killer === me ? '' : e.killerName;
      this.respawnIn = RESPAWN_TIME;
    }
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

  /** Clear what's left over from the last run. */
  reset(): void {
    this.death.hidden = true;
    this.killer = '';
    this.feed.replaceChildren();
    this.hurt = 0;
  }

  private pushFeed(row: HTMLElement): void {
    this.feed.append(row);
    while (this.feed.children.length > FEED_MAX) this.feed.firstElementChild!.remove();
    setTimeout(() => (row.style.opacity = '0'), FEED_TIME * 1000);
    setTimeout(() => row.remove(), FEED_TIME * 1000 + 400);
  }

  private updateNumbers(dt: number, camera: THREE.Camera): void {
    for (let i = this.numbers.length - 1; i >= 0; i--) {
      const n = this.numbers[i];
      n.age += dt;
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
