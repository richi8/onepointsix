import { SPEEDS, type Mark } from './replay.ts';

export type ReplayCamera = 'eyes' | 'free';

const $ = (id: string) => document.getElementById(id)!;

/** What the bar shows of the replay each frame. */
export interface ReplayShown {
  start: number;
  end: number;
  time: number;
  speed: number;
  playing: boolean;
}

/** The replay's controls: timeline, play and pause, speed, camera, save and close. */
export class ReplayBar {
  onPlay: (() => void) | null = null;
  onSeek: ((time: number) => void) | null = null;
  onSpeed: ((speed: number) => void) | null = null;
  onCamera: ((cam: ReplayCamera) => void) | null = null;
  onSave: (() => void) | null = null;
  onClose: (() => void) | null = null;
  private readonly root = $('replaybar');
  private readonly who = this.root.querySelector('.who')!;
  private readonly scrub = this.root.querySelector('.scrub') as HTMLInputElement;
  private readonly marks = this.root.querySelector('.marks') as HTMLElement;
  private readonly play = this.root.querySelector('.play') as HTMLButtonElement;
  private readonly clock = this.root.querySelector('.time')!;
  private readonly save = this.root.querySelector('.save') as HTMLButtonElement;
  private readonly speeds: HTMLButtonElement[];
  private readonly cams = [...this.root.querySelectorAll<HTMLButtonElement>('.cams button')];
  /** Held while dragging the timeline, so playing doesn't pull it back. */
  private scrubbing = false;
  private shown = '';

  constructor() {
    const speedsEl = this.root.querySelector('.speeds')!;
    this.speeds = SPEEDS.map((s) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('role', 'radio');
      b.textContent = s === 0.25 ? '¼×' : s === 0.5 ? '½×' : `${s}×`;
      b.onclick = () => this.onSpeed?.(s);
      speedsEl.append(b);
      return b;
    });
    for (const b of this.cams) b.onclick = () => this.onCamera?.(b.dataset.cam as ReplayCamera);
    this.play.onclick = () => this.onPlay?.();
    this.save.onclick = () => this.onSave?.();
    (this.root.querySelector('.close') as HTMLButtonElement).onclick = () => this.onClose?.();
    this.scrub.addEventListener('pointerdown', () => (this.scrubbing = true));
    this.scrub.addEventListener('pointerup', () => (this.scrubbing = false));
    this.scrub.addEventListener('input', () => this.onSeek?.(Number(this.scrub.value)));
    // Keys belong to the replay, not the slider or the last button clicked.
    this.root.addEventListener('keydown', (e) => {
      if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
    });
    this.root.addEventListener('click', (e) => {
      if (e.target instanceof HTMLButtonElement) e.target.blur();
    });
  }

  /** Open for a replay of `title`, `canSave` if it isn't saved yet, with moments to mark on the timeline. */
  show(title: string, start: number, end: number, marks: readonly Mark[], canSave: boolean): void {
    this.who.textContent = title;
    this.scrub.min = String(start);
    this.scrub.max = String(end);
    this.save.hidden = !canSave;
    this.marks.replaceChildren(...marks.map((m) => {
      const el = document.createElement('i');
      el.className = m.kind;
      el.title = m.kind === 'kill' ? 'Kill' : m.kind === 'death' ? 'Killed' : 'Extracted';
      el.style.left = `${((m.at - start) / Math.max(end - start, 1e-6)) * 100}%`;
      return el;
    }));
    this.shown = '';
    this.root.hidden = false;
  }

  hide(): void {
    this.root.hidden = true;
    this.scrubbing = false;
  }

  /** Call once per frame. */
  update(r: ReplayShown, cam: ReplayCamera): void {
    if (!this.scrubbing) this.scrub.value = String(r.time);
    const text = `${clock(r.time - r.start)} / ${clock(r.end - r.start)}`;
    const state = `${text}|${r.playing}|${r.speed}|${cam}`;
    if (state === this.shown) return;
    this.shown = state;
    this.clock.textContent = text;
    this.play.textContent = r.playing ? '❚❚' : '▶';
    this.play.setAttribute('aria-label', r.playing ? 'Pause' : 'Play');
    this.speeds.forEach((b, i) => {
      b.classList.toggle('on', SPEEDS[i] === r.speed);
      b.setAttribute('aria-checked', String(SPEEDS[i] === r.speed));
    });
    for (const b of this.cams) {
      b.classList.toggle('on', b.dataset.cam === cam);
      b.setAttribute('aria-checked', String(b.dataset.cam === cam));
    }
    this.root.classList.toggle('free', cam === 'free');
  }
}

function clock(t: number): string {
  const s = Math.max(Math.floor(t), 0);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
