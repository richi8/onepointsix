import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { pieces } from '../src/client/guns.ts';
import { actionMatrix, boltHand, type GunPoints, HANDLE_GONE, HANDLE_PULLED, type Parts, reloadHands } from '../src/client/handwork.ts';
import { BOLT, PISTOL, RIFLE } from '../src/shared/weapons.ts';

// The hands and the gun's moving parts through a reload, in the gun's own
// space (so toWorld leaves points where they are).

const gun: GunPoints = {
  grip: new THREE.Vector3(0, -0.08, 0),
  support: new THREE.Vector3(0, -0.1, -0.3),
  magazine: new THREE.Vector3(0, -0.27, -0.15),
  bolt: new THREE.Vector3(0.035, -0.045, -0.04),
  pivot: new THREE.Vector3(-0.011, -0.04, -0.04),
  well: new THREE.Vector3(0, -1, 0),
};
const rest = { left: gun.support.clone(), right: gun.grip.clone() };
const pouch = new THREE.Vector3(-0.2, -0.6, 0.2);
const back = new THREE.Vector3(0, 0, 1);
const same = (p: THREE.Vector3): THREE.Vector3 => p;
const work = (weapon: number, t: number, rounds = 3) => reloadHands(weapon, t, rounds, gun, same, rest, pouch, back);
const handle = (parts: Parts): THREE.Vector3 => gun.bolt.clone().applyMatrix4(actionMatrix(gun, parts, new THREE.Matrix4()));

describe('reloads', () => {
  it('strips the rifle magazine, lets it go, and seats a full one from the hand', () => {
    const states = [0, 0.1, 0.18, 0.3, 0.5, 0.7, 0.9].map((t) => work(RIFLE, t).parts.mag);
    expect(states[0]).toBe(0);
    expect(states[2]).toBeGreaterThan(0);
    expect(states[3]).toBe('gone');
    expect(states[4]).toBe('hand');
    expect(states[5]).toBeGreaterThan(0);
    expect(states[6]).toBe(0);
    // The hand is on the magazine's base while it draws it out.
    const w = work(RIFLE, 0.18);
    expect(w.left.distanceTo(gun.magazine.clone().addScaledVector(gun.well, w.parts.mag as number))).toBeLessThan(1e-9);
  });

  it('draws the rifle charging handle back with the left hand on it, then lets it go', () => {
    expect(work(RIFLE, 0.7).parts.back).toBe(0);
    for (const t of [HANDLE_PULLED, 0.9]) {
      const w = work(RIFLE, t);
      expect(w.parts.back).toBeGreaterThan(0.06);
      expect(w.leftHook).toBe(1);
      expect(w.left.distanceTo(handle(w.parts))).toBeLessThan(1e-9);
    }
    expect(work(RIFLE, HANDLE_GONE + 0.02).parts.back).toBe(0);
    expect(work(RIFLE, 1)).toMatchObject({ leftHook: 0, parts: { mag: 0, back: 0 } });
    expect(work(RIFLE, 1).left.distanceTo(rest.left)).toBeLessThan(1e-9);
  });

  it('drops the pistol magazine and racks the slide', () => {
    expect(work(PISTOL, 0.03).parts.mag).toBe(0);
    expect(work(PISTOL, 0.1).parts.mag).toBe('gone');
    expect(work(PISTOL, 0.45).holding).toBe('magazine');
    expect(work(PISTOL, 0.81).parts.back).toBeGreaterThan(0.03);
    expect(work(PISTOL, 0.95).parts.back).toBe(0);
  });

  it('keeps the right hand on the bolt handle as it turns up and draws back', () => {
    for (const t of [0.1, 0.15, 0.5, 0.84, 0.88]) {
      const w = work(BOLT, t);
      expect(w.right.distanceTo(handle(w.parts))).toBeLessThan(1e-9);
    }
    const open = work(BOLT, 0.5).parts;
    expect(open.lift).toBe(1);
    expect(handle(open).y).toBeGreaterThan(gun.bolt.y + 0.03);
    expect(work(BOLT, 1).parts).toEqual({ mag: 0, back: 0, lift: 0 });
    for (const c of [0.3, 0.5, 0.7]) {
      const b = boltHand(c, gun, same, rest.right);
      expect(b.at.distanceTo(handle(b.parts))).toBeLessThan(1e-9);
    }
  });

  it('makes one trip to the pouch for each round the bolt-action needs', () => {
    const trips = (rounds: number): number => {
      let n = 0;
      let away = false;
      for (let t = 0; t <= 1; t += 0.001) {
        const near = work(BOLT, t, rounds).left.distanceTo(pouch) < 1e-6;
        if (near && !away) n++;
        away = near;
      }
      return n;
    };
    expect([1, 2, 5].map(trips)).toEqual([1, 2, 5]);
  });
});

describe('pieces', () => {
  it('splits a geometry into the parts that share no corner', () => {
    const a = new THREE.BoxGeometry(1, 1, 1);
    const b = new THREE.BoxGeometry(1, 1, 1).translate(3, 0, 0);
    const merged = new THREE.BufferGeometry();
    const pa = a.toNonIndexed().getAttribute('position').array as Float32Array;
    const pb = b.toNonIndexed().getAttribute('position').array as Float32Array;
    merged.setAttribute('position', new THREE.BufferAttribute(Float32Array.from([...pa, ...pb]), 3));
    const found = pieces(merged);
    expect(found.map((p) => p.length).sort()).toEqual([12, 12]);
  });
});
