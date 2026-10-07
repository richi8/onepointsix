import { SIDES, type BoardRow, type Side } from '../shared/protocol.ts';

/** What each side is called. */
export const SIDE_NAMES: Record<Side, string> = { red: 'Red', blue: 'Blue' };

/**
 * The scoreboard, shown while Tab is held during a run: every player in the game, bots left
 * out, with their kills, deaths, best run and total score over the game. In Deathmatch, every
 * operator, bots too, with only their kills and deaths; in Team Deathmatch, under their sides,
 * yours first, each with its score.
 */
export class Scoreboard {
  private readonly el = document.getElementById('scoreboard')!;
  private readonly body = this.el.querySelector('tbody')!;
  private readonly head = this.el.querySelector('thead tr')!;
  private readonly caption = this.el.querySelector('caption')!;
  /** Tab is held down. */
  private held = false;
  private shown: { rows: readonly BoardRow[]; me: number; deathmatch: boolean; teams: Record<Side, number> | null } | null = null;

  /** `active` says whether a run is going on, so Tab is ours and not the page's. */
  constructor(target: Window, active: () => boolean) {
    target.addEventListener('keydown', (e) => {
      if (e.code !== 'Tab' || !active()) return;
      e.preventDefault();
      this.held = true;
    });
    target.addEventListener('keyup', (e) => {
      if (e.code === 'Tab') this.held = false;
    });
    target.addEventListener('blur', () => (this.held = false));
  }

  /**
   * Call once per frame with the board and which row is ours; `can` false hides it whatever is
   * held. `deathmatch` lists kills and deaths alone, and `teams`, Team Deathmatch's scores, by side.
   */
  update(rows: readonly BoardRow[], me: number, can: boolean, deathmatch = false, teams: Record<Side, number> | null = null): void {
    this.el.hidden = !(this.held && can);
    const s = this.shown;
    if (this.el.hidden || (s?.rows === rows && s.me === me && s.deathmatch === deathmatch && s.teams === teams)) return;
    if (s?.deathmatch !== deathmatch || !s.teams !== !teams) {
      this.el.classList.toggle('compact', deathmatch);
      this.caption.innerHTML = teams ? 'Red against Blue' : deathmatch ? 'Operators in this game' : 'Players in this game <small>bots aren’t listed</small>';
      this.head.replaceChildren(...['Operator', 'Kills', 'Deaths', ...(deathmatch ? [] : ['Best run', 'Total'])].map((text) => {
        const th = document.createElement('th');
        th.textContent = text === 'Operator' && !deathmatch ? 'Player' : text;
        return th;
      }));
    }
    this.shown = { rows, me, deathmatch, teams };
    const line = (r: BoardRow) => {
      const tr = document.createElement('tr');
      tr.classList.toggle('you', r.id === me);
      for (const text of [r.name, String(r.kills), String(r.deaths), ...(deathmatch ? [] : [money(r.best), money(r.total)])]) {
        tr.appendChild(document.createElement('td')).textContent = text;
      }
      return tr;
    };
    if (!teams) {
      this.body.replaceChildren(...rows.map(line));
      return;
    }
    const mine = rows.find((r) => r.id === me)?.side;
    const sides = [...SIDES].sort((a, b) => Number(b === mine) - Number(a === mine));
    this.body.replaceChildren(...sides.flatMap((side) => {
      const tr = document.createElement('tr');
      tr.className = `heading ${side}`;
      const name = tr.appendChild(document.createElement('td'));
      name.colSpan = 3;
      name.textContent = `${SIDE_NAMES[side]}${side === mine ? ' · your side' : ''}`;
      const score = name.appendChild(document.createElement('b'));
      score.textContent = String(teams[side]);
      return [tr, ...rows.filter((r) => r.side === side).map(line)];
    }));
  }
}

function money(value: number): string {
  return `$${value.toLocaleString('en-US')}`;
}
