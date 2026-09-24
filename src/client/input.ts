import { Btn, MAX_PITCH } from '../shared/constants.ts';
import { clamp, wrapAngle } from '../shared/geom.ts';
import { WEAPONS } from '../shared/weapons.ts';

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

const MOUSE: Record<number, number> = { 0: Btn.Fire, 2: Btn.Aim };
const SLOTS: Record<string, number> = { Digit1: 0, Digit2: 1, Digit3: 2 };

/** Radians per pixel of mouse movement. */
const SENSITIVITY = 0.0022;
/** Some browsers report a bogus huge delta right after locking; ignore those. */
const MAX_MOUSE_DELTA = 400;

/**
 * Keyboard, mouse buttons, weapon selection and mouse look. Input only counts while the pointer is locked, so
 * the mouse is free for the menu and the net panel otherwise.
 */
export class Input {
  yaw = 0;
  pitch = 0;
  locked = false;
  /** Weapon the player has selected, as an index into WEAPONS. */
  weapon = 0;
  /** Multiplies mouse sensitivity; lowered while zoomed in. */
  lookScale = 1;
  onLockChange: ((locked: boolean) => void) | null = null;
  private held = 0;
  /** Buttons pressed since the last sample, so a tap between samples still counts. */
  private tapped = 0;
  private readonly element: HTMLElement;

  constructor(target: Window, element: HTMLElement) {
    this.element = element;
    target.addEventListener('keydown', (e) => {
      if (isTyping(e)) return;
      const slot = SLOTS[e.code];
      if (slot !== undefined && this.locked) this.weapon = slot;
      const b = KEYS[e.code];
      if (b === undefined) return;
      this.held |= b;
      this.tapped |= b;
      if (this.locked) e.preventDefault();
    });
    target.addEventListener('keyup', (e) => {
      const b = KEYS[e.code];
      if (b !== undefined) this.held &= ~b;
    });
    target.addEventListener('blur', () => (this.held = this.tapped = 0));
    target.addEventListener('mousedown', (e) => {
      const b = MOUSE[e.button];
      if (b === undefined || !this.locked) return;
      this.held |= b;
      this.tapped |= b;
    });
    target.addEventListener('mouseup', (e) => {
      const b = MOUSE[e.button];
      if (b !== undefined) this.held &= ~b;
    });
    target.addEventListener('contextmenu', (e) => {
      if (this.locked) e.preventDefault();
    });
    target.addEventListener('wheel', (e) => {
      if (!this.locked || e.deltaY === 0) return;
      const n = WEAPONS.length;
      this.weapon = (this.weapon + (e.deltaY > 0 ? 1 : n - 1)) % n;
    });
    target.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      if (Math.abs(e.movementX) > MAX_MOUSE_DELTA || Math.abs(e.movementY) > MAX_MOUSE_DELTA) return;
      const k = SENSITIVITY * this.lookScale;
      this.yaw = wrapAngle(this.yaw - e.movementX * k);
      this.pitch = clamp(this.pitch - e.movementY * k, -MAX_PITCH, MAX_PITCH);
    });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.element;
      this.held = this.tapped = 0;
      this.onLockChange?.(this.locked);
    });
  }

  /**
   * Buttons for the next command as a Btn bitmask: those held, plus any
   * pressed and already released since the last sample. Nothing while the
   * pointer is free.
   */
  sample(): number {
    const b = this.held | this.tapped;
    this.tapped = 0;
    return this.locked ? b : 0;
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
