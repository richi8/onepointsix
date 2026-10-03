import type { BoardRow } from '../shared/protocol.ts';

/**
 * The scoreboard, shown while Tab is held during a run: every player in the game, bots left
 * out, with their kills, deaths, best run and total score over the game.
 */
export class Scoreboard {
  private readonly el = document.getElementById('scoreboard')!;
  private readonly body = this.el.querySelector('tbody')!;
  /** Tab is held down. */
  private held = false;
  private shown: { rows: readonly BoardRow[]; me: number } | null = null;

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

  /** Call once per frame with the board and which row is ours; `can` false hides it whatever is held. */
  update(rows: readonly BoardRow[], me: number, can: boolean): void {
    this.el.hidden = !(this.held && can);
    if (this.el.hidden || (this.shown?.rows === rows && this.shown.me === me)) return;
    this.shown = { rows, me };
    this.body.replaceChildren(
      ...rows.map((r) => {
        const tr = document.createElement('tr');
        tr.classList.toggle('you', r.id === me);
        for (const text of [r.name, String(r.kills), String(r.deaths), money(r.best), money(r.total)]) {
          tr.appendChild(document.createElement('td')).textContent = text;
        }
        return tr;
      }),
    );
  }
}

function money(value: number): string {
  return `$${value.toLocaleString('en-US')}`;
}
