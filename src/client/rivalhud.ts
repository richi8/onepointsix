import * as THREE from 'three';
import { BOUNTY_PING } from '../shared/constants.ts';
import type { BagSnap, BountyView } from '../shared/protocol.ts';
import type { World } from '../shared/world.ts';

const $ = (id: string) => document.getElementById(id)!;

/** Bags this close show what they're worth, if in sight. */
const BAG_RANGE = 40;
/** Tags float this far above a bag, and the bounty's marker this far above the ground. */
const BAG_LIFT = 0.8;
const BOUNTY_LIFT = 3;
/** Seconds the bounty's marker shows after each call, the last of them fading. */
const BOUNTY_SHOW = 8;
const BOUNTY_FADE = 2;

/** The other operators as a threat and a prize: what bags are worth, and the bounty. */
export class RivalHud {
  private readonly tags = $('tags');
  private readonly marker = $('bountymark');
  private readonly line = $('bounty');
  private readonly world: World;
  private readonly tmp = new THREE.Vector3();
  private shownLine = '';

  constructor(world: World) {
    this.world = world;
  }

  /**
   * Call once per frame. `me` is whose eyes we see through, at `eye`; `now` is
   * the server time shown. Null `eye` hides it all.
   */
  update(bags: readonly BagSnap[], bounty: BountyView | null, me: number, eye: THREE.Vector3 | null, now: number, camera: THREE.Camera): void {
    this.tags.hidden = this.marker.hidden = this.line.hidden = !eye;
    if (!eye) return;
    this.updateTags(bags, eye, camera);

    // Where the bounty was called, for a while after each call.
    const age = bounty ? now - bounty.at : Infinity;
    const mark = bounty && bounty.id !== me && age < BOUNTY_SHOW ? this.project(bounty.x, this.ground(bounty.x, bounty.z) + BOUNTY_LIFT, bounty.z, camera) : null;
    this.marker.hidden = !mark;
    if (mark && bounty) {
      const d = Math.round(Math.hypot(bounty.x - eye.x, bounty.z - eye.z));
      const text = `${bounty.name} · ${money(bounty.value)} · ${d} m`;
      if (this.marker.textContent !== text) this.marker.textContent = text;
      this.marker.style.transform = `translate(${mark.x}px, ${mark.y}px)`;
      this.marker.style.opacity = String(Math.min((BOUNTY_SHOW - age) / BOUNTY_FADE, 1));
    }

    let line = '';
    if (bounty?.id === me) line = `<b>You carry the bounty</b> · ${money(bounty.value)} · everyone is told roughly where you are every ${BOUNTY_PING} s`;
    else if (bounty) line = `<b>Bounty</b> · ${bounty.name} carries ${money(bounty.value)}`;
    this.line.hidden = !line;
    this.line.classList.toggle('you', bounty?.id === me);
    if (line !== this.shownLine) {
      this.shownLine = line;
      this.line.innerHTML = line;
    }
  }

  /** What each bag in sight nearby is worth. */
  private updateTags(bags: readonly BagSnap[], eye: THREE.Vector3, camera: THREE.Camera): void {
    let n = 0;
    for (const b of bags) {
      if (!b.value || Math.hypot(b.x - eye.x, b.z - eye.z) > BAG_RANGE) continue;
      const y = b.y + BAG_LIFT;
      if (!this.world.hasLineOfSight(eye.x, eye.y, eye.z, b.x, y, b.z)) continue;
      const at = this.project(b.x, y, b.z, camera);
      if (!at) continue;
      const el = (this.tags.children[n++] as HTMLElement | undefined) ?? this.tags.appendChild(document.createElement('div'));
      const text = money(b.value);
      if (el.textContent !== text) el.textContent = text;
      el.hidden = false;
      el.style.transform = `translate(${at.x}px, ${at.y}px)`;
    }
    for (let i = n; i < this.tags.children.length; i++) (this.tags.children[i] as HTMLElement).hidden = true;
  }

  /** Where a point is on screen, or null if behind the camera or off screen. */
  private project(x: number, y: number, z: number, camera: THREE.Camera): { x: number; y: number } | null {
    const v = this.tmp.set(x, y, z).project(camera);
    if (v.z > 1 || Math.abs(v.x) > 1 || Math.abs(v.y) > 1) return null;
    return { x: ((v.x + 1) / 2) * innerWidth, y: ((1 - v.y) / 2) * innerHeight };
  }

  private ground(x: number, z: number): number {
    return this.world.groundHeight(x, z, this.world.floorHeight(x, z));
  }
}

function money(value: number): string {
  return `$${value.toLocaleString('en-US')}`;
}
