import * as THREE from 'three';
import { SIDES, type BoardRow, type PlayerSnap, type Side } from '../shared/protocol.ts';
import { SIDE_NAMES } from './scoreboard.ts';

const $ = (id: string) => document.getElementById(id)!;

/** A friend's marker floats this far above their feet, metres. */
const MARKER_LIFT = 2.3;
/** Past this far a friend's marker drops their name. */
const NAME_RANGE = 40;

/** Team Deathmatch on screen: both sides' scores at the top, and a marker over each friend, through walls too. */
export class TeamHud {
  private readonly score = $('teamscore');
  private readonly friends = $('friends');
  private readonly tmp = new THREE.Vector3();
  private shownScore = '';

  /**
   * Call once per frame. `teams` is each side's score, null outside Team Deathmatch or with
   * nothing to show; `me` is our id, `eye` where we look from, and `players` everyone as drawn.
   */
  update(teams: Record<Side, number> | null, board: readonly BoardRow[], me: number, players: readonly PlayerSnap[], eye: THREE.Vector3 | null, camera: THREE.Camera): void {
    const mine = teams ? board.find((r) => r.id === me)?.side : undefined;
    this.score.hidden = this.friends.hidden = !teams || !mine || !eye;
    if (!teams || !mine || !eye) return;

    // Your side first.
    const [a, b] = [...SIDES].sort((x, y) => Number(y === mine) - Number(x === mine));
    const text = `<span class="${a}">${SIDE_NAMES[a]} <b>${teams[a]}</b></span><span class="${b}"><b>${teams[b]}</b> ${SIDE_NAMES[b]}</span>`;
    if (text !== this.shownScore) {
      this.shownScore = text;
      this.score.innerHTML = text;
    }

    const names = new Map(board.map((r) => [r.id, r.name]));
    let n = 0;
    for (const p of players) {
      if (p.id === me || p.dead || p.side !== mine) continue;
      const v = this.tmp.set(p.x, p.y + MARKER_LIFT, p.z).project(camera);
      if (v.z > 1 || Math.abs(v.x) > 1 || Math.abs(v.y) > 1) continue;
      const el = (this.friends.children[n++] as HTMLElement | undefined) ?? this.friends.appendChild(document.createElement('div'));
      const far = Math.hypot(p.x - eye.x, p.z - eye.z) > NAME_RANGE;
      const label = far ? '' : (names.get(p.id) ?? '');
      if (el.textContent !== label) el.textContent = label;
      el.className = mine;
      el.hidden = false;
      el.style.transform = `translate(${((v.x + 1) / 2) * innerWidth}px, ${((1 - v.y) / 2) * innerHeight}px)`;
    }
    for (let i = n; i < this.friends.children.length; i++) (this.friends.children[i] as HTMLElement).hidden = true;
  }
}
