import * as THREE from 'three';
import { LAMP_HEIGHT, type World } from '../shared/world.ts';
import { onTiles } from './terrain.ts';

// The outposts' lamps after dark. Each pole carries a lamp on an arm, its
// housing a breakable panel drawn with the other props; here are the pole,
// the arm, the glowing bulb under the housing and a glare that shows from
// across the island. Only the lamps nearest the camera really light the
// ground, a few spotlights handed from lamp to lamp as you move, each fading
// out before it's handed on. The spotlights stay in the scene all the time
// after dark, so switching one never recompiles a material.

/** Lamps that light the world, nearest the camera first. */
const LIT = 4;
/** A lit lamp fades out over this many metres before the next nearest takes its light, and past FAR. */
const HANDOVER = 20;
const FAR = 150;
const COLOR = 0xffd6a0;
const INTENSITY = 36;
const DISTANCE = 24;
const DECAY = 1.4;
/** Half-angle of the light, radians, and how soft its edge is. */
const ANGLE = 0.95;
const PENUMBRA = 0.75;
/** Where the light points: this far toward the outpost's middle for every metre down. */
const TILT = 0.45;
/** The bulb: a flat panel under the housing, and how far past white it glows. */
const BULB = new THREE.Vector3(0.36, 0.03, 0.36);
const GLOW = 4;
const GONE = new THREE.Matrix4().makeScale(0, 0, 0);

export class Lamps {
  readonly group = new THREE.Group();
  private readonly world: World;
  private readonly bulbs: THREE.InstancedMesh;
  private readonly bulbMatrices: THREE.Matrix4[];
  private readonly glares: THREE.Sprite[] = [];
  private readonly lights: THREE.SpotLight[] = [];
  /** Standing lamps by distance from the camera, reused each frame. */
  private readonly order: { i: number; d: number }[] = [];
  private dark = false;
  private fogNear = 0;
  private fogFar = 1;

  constructor(world: World) {
    this.world = world;
    const lamps = world.lamps;
    const metal = onTiles(new THREE.MeshStandardMaterial({ color: 0x55595d, roughness: 0.55, metalness: 0.5 }), world);
    const poles = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.06, 0.09, 1, 8).translate(0, 0.5, 0), metal, lamps.length);
    const arms = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1).translate(0.5, 0, 0), metal, lamps.length);
    this.bulbs = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1, 1),
      onTiles(new THREE.MeshBasicMaterial({ color: new THREE.Color(COLOR).multiplyScalar(GLOW), toneMapped: false }), world),
      lamps.length,
    );
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    this.bulbMatrices = lamps.map((l, i) => {
      poles.setMatrixAt(i, m.compose(new THREE.Vector3(l.x, l.y - 0.5, l.z), q.identity(), new THREE.Vector3(1, LAMP_HEIGHT + 0.5, 1)));
      const reach = Math.hypot(l.hx - l.x, l.hz - l.z);
      q.setFromAxisAngle(up, Math.atan2(-l.dz, l.dx));
      arms.setMatrixAt(i, m.compose(new THREE.Vector3(l.x, l.hy + 0.1, l.z), q, new THREE.Vector3(reach, 0.06, 0.06)));
      return new THREE.Matrix4().compose(new THREE.Vector3(l.hx, l.hy - 0.09, l.hz), q.identity(), BULB);
    });
    poles.castShadow = arms.castShadow = true;
    poles.receiveShadow = arms.receiveShadow = true;
    this.group.add(poles, arms, this.bulbs);

    const glareMap = glareTexture();
    for (const l of lamps) {
      const glare = new THREE.Sprite(new THREE.SpriteMaterial({
        map: glareMap, color: COLOR, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, toneMapped: false,
      }));
      glare.position.set(l.hx, l.hy - 0.15, l.hz);
      glare.visible = false;
      this.glares.push(glare);
      this.group.add(glare);
    }
    for (let i = 0; i < LIT; i++) {
      const s = new THREE.SpotLight(COLOR, 0, DISTANCE, ANGLE, PENUMBRA, DECAY);
      s.visible = false;
      this.lights.push(s);
      this.group.add(s, s.target);
    }
    this.show();
  }

  /** Whether it's dark enough for the lamps to be on, and the fog they fade into. */
  setConditions(dark: boolean, fogNear: number, fogFar: number): void {
    this.dark = dark;
    this.fogNear = fogNear;
    this.fogFar = fogFar;
    for (const s of this.lights) s.visible = dark;
    this.show();
  }

  /** Show each lamp lit, dark or shot out as the world has it. */
  show(): void {
    this.world.lamps.forEach((l, i) => {
      const on = this.dark && !this.world.panels[l.panel].box.gone;
      this.bulbs.setMatrixAt(i, on ? this.bulbMatrices[i] : GONE);
      if (!on) this.glares[i].visible = false;
    });
    this.bulbs.instanceMatrix.needsUpdate = true;
  }

  /** Once a frame: hand the lights to the lamps nearest `eye`, and fade the glares by the fog. */
  update(eye: THREE.Vector3): void {
    if (!this.dark) return;
    const lamps = this.world.lamps;
    const order = this.order;
    order.length = 0;
    lamps.forEach((l, i) => {
      const d = Math.hypot(l.hx - eye.x, l.hy - eye.y, l.hz - eye.z);
      const glare = this.glares[i];
      if (this.world.panels[l.panel].box.gone) {
        glare.visible = false;
        return;
      }
      order.push({ i, d });
      const fade = 1 - THREE.MathUtils.smoothstep(d, this.fogNear, this.fogFar);
      glare.visible = fade > 0.01;
      // Keeps a few pixels across however far off it is.
      glare.scale.setScalar(0.9 + d * 0.012);
      glare.material.opacity = 0.8 * fade;
    });
    order.sort((a, b) => a.d - b.d);
    const next = order[LIT]?.d ?? Infinity;
    this.lights.forEach((s, k) => {
      const o = order[k];
      if (!o) {
        s.intensity = 0;
        return;
      }
      const l = lamps[o.i];
      const w = Math.min(Math.min((next - o.d) / HANDOVER, 1), 1 - THREE.MathUtils.smoothstep(o.d, FAR - HANDOVER, FAR));
      s.intensity = INTENSITY * Math.max(w, 0);
      s.position.set(l.hx, l.hy - 0.12, l.hz);
      s.target.position.set(l.hx + l.dx * TILT, l.hy - 1.12, l.hz + l.dz * TILT);
      s.target.updateMatrixWorld();
    });
  }
}

/** A soft round glare with a hot middle. */
function glareTexture(): THREE.Texture {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const g = canvas.getContext('2d')!;
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.12, 'rgba(255,236,200,0.7)');
  grad.addColorStop(0.4, 'rgba(255,220,170,0.12)');
  grad.addColorStop(1, 'rgba(255,220,170,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
