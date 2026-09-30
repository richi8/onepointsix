import * as THREE from 'three';
import { LAMP_HEIGHT, LAMP_LIGHT, lampFrom, type World } from '../shared/world.ts';
import { localLights } from './locallights.ts';
import { onTiles } from './terrain.ts';

// The outposts' lamps after dark. Each pole carries a lamp on an arm, its
// housing a breakable panel drawn with the other props; here are the pole,
// the arm, the glowing bulb under the housing and a glare that shows from
// across the island. Every lamp within FAR of the camera lights the world
// with the local lights (see locallights.ts), the nearest casting shadows,
// fading out over the last HANDOVER metres. Its cone is the one bots see by
// (see World.lamplight).

/** A lamp lights the world out to FAR from the camera, fading over the last HANDOVER metres. */
const HANDOVER = 20;
const FAR = 150;
const COLOR = 0xffd6a0;
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
  private readonly color = new THREE.Color(COLOR);
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
    this.show();
  }

  /** Whether it's dark enough for the lamps to be on, and the fog they fade into. */
  setConditions(dark: boolean, fogNear: number, fogFar: number): void {
    this.dark = dark;
    this.fogNear = fogNear;
    this.fogFar = fogFar;
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

  /** Once a frame: light the world from the lamps round `eye`, and fade the glares by the fog. */
  update(eye: THREE.Vector3): void {
    if (!this.dark) return;
    const { intensity, range, decay, angle, penumbra, tilt } = LAMP_LIGHT;
    const down = Math.hypot(tilt, 1);
    this.world.lamps.forEach((l, i) => {
      const glare = this.glares[i];
      if (this.world.panels[l.panel].box.gone) {
        glare.visible = false;
        return;
      }
      const d = Math.hypot(l.hx - eye.x, l.hy - eye.y, l.hz - eye.z);
      const fade = 1 - THREE.MathUtils.smoothstep(d, this.fogNear, this.fogFar);
      glare.visible = fade > 0.01;
      // Keeps a few pixels across however far off it is.
      glare.scale.setScalar(0.9 + d * 0.012);
      glare.material.opacity = 0.8 * fade;
      // Its light reaches `range` round it: past that and FAR, nothing of it shows.
      if (d - range > FAR) return;
      const at = lampFrom(l);
      const light = localLights.add();
      light.x = at.x;
      light.y = at.y;
      light.z = at.z;
      light.dx = (l.dx * tilt) / down;
      light.dy = -1 / down;
      light.dz = (l.dz * tilt) / down;
      light.color.copy(this.color);
      light.intensity = intensity * (1 - THREE.MathUtils.smoothstep(d - range, FAR - HANDOVER, FAR));
      light.range = range;
      light.decay = decay;
      light.angle = angle;
      light.penumbra = penumbra;
      light.shadow = true;
      // Ranked by how near the camera comes to what it lights.
      light.near = Math.max(d - range * 0.5, 0);
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
