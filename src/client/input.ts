import { Btn } from '../shared/constants.ts';

const KEYS: Record<string, number> = {
  KeyW: Btn.Forward,
  KeyS: Btn.Back,
  KeyA: Btn.Left,
  KeyD: Btn.Right,
  Space: Btn.Jump,
  ShiftLeft: Btn.Sprint,
  KeyR: Btn.Reload,
};

/** Tracks held keys as a Btn bitmask. */
export class Input {
  buttons = 0;

  constructor(target: Window) {
    target.addEventListener('keydown', (e) => {
      const b = KEYS[e.code];
      if (b === undefined || isTyping(e)) return;
      this.buttons |= b;
      e.preventDefault();
    });
    target.addEventListener('keyup', (e) => {
      const b = KEYS[e.code];
      if (b !== undefined) this.buttons &= ~b;
    });
    target.addEventListener('blur', () => (this.buttons = 0));
  }
}

function isTyping(e: KeyboardEvent): boolean {
  return e.target instanceof HTMLInputElement;
}
