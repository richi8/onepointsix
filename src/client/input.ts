import { Btn, MAX_PITCH } from '../shared/constants.ts';
import { clamp, wrapAngle } from '../shared/geom.ts';

const KEYS: Record<string, number> = {
  KeyW: Btn.Forward,
  KeyS: Btn.Back,
  KeyA: Btn.Left,
  KeyD: Btn.Right,
  Space: Btn.Jump,
  ShiftLeft: Btn.Sprint,
  KeyC: Btn.Crouch,
  KeyQ: Btn.LeanLeft,
  KeyE: Btn.LeanRight,
  KeyR: Btn.Reload,
};

/** Radians per pixel of mouse movement. */
const SENSITIVITY = 0.0022;
/** Some browsers report a bogus huge delta right after locking; ignore those. */
const MAX_MOUSE_DELTA = 400;

/**
 * Keyboard and mouse look. Input only counts while the pointer is locked, so
 * the mouse is free for the menu and the net panel otherwise.
 */
export class Input {
  yaw = 0;
  pitch = 0;
  locked = false;
  onLockChange: ((locked: boolean) => void) | null = null;
  private held = 0;
  private readonly element: HTMLElement;

  constructor(target: Window, element: HTMLElement) {
    this.element = element;
    target.addEventListener('keydown', (e) => {
      const b = KEYS[e.code];
      if (b === undefined || isTyping(e)) return;
      this.held |= b;
      if (this.locked) e.preventDefault();
    });
    target.addEventListener('keyup', (e) => {
      const b = KEYS[e.code];
      if (b !== undefined) this.held &= ~b;
    });
    target.addEventListener('blur', () => (this.held = 0));
    target.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      if (Math.abs(e.movementX) > MAX_MOUSE_DELTA || Math.abs(e.movementY) > MAX_MOUSE_DELTA) return;
      this.yaw = wrapAngle(this.yaw - e.movementX * SENSITIVITY);
      this.pitch = clamp(this.pitch - e.movementY * SENSITIVITY, -MAX_PITCH, MAX_PITCH);
    });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.element;
      if (!this.locked) this.held = 0;
      this.onLockChange?.(this.locked);
    });
  }

  /** Held buttons as a Btn bitmask; nothing while the pointer is free. */
  get buttons(): number {
    return this.locked ? this.held : 0;
  }

  /** Must be called from a user gesture (click or key press). */
  lock(): void {
    // Raw mouse input skips OS acceleration where supported; fall back if not.
    // Re-locking too soon after Esc is refused; the user just clicks again.
    this.element
      .requestPointerLock({ unadjustedMovement: true })
      ?.catch(() => this.element.requestPointerLock()?.catch(() => {}));
  }
}

function isTyping(e: KeyboardEvent): boolean {
  return e.target instanceof HTMLInputElement;
}
