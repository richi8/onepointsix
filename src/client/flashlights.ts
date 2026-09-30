import * as THREE from 'three';
import type { PlayerSnap } from '../shared/protocol.ts';
import { localLights } from './locallights.ts';

// Flashlights after dark. Your own lights the way from just below your eye,
// and casts shadows from a map of its own, so it doesn't light the far side
// of a wall. Others' shine from the torches on their guns: each lit one
// lights the world with the local lights (see locallights.ts), the nearest
// casting shadows too, and shows a faint beam and a glare when it points
// your way, which is how you spot a guard across the island at night. Your
// own light stays in the scene all the time, by day too at no brightness, so
// neither switching it on nor nightfall recompiles every lit material: on a
// cold shader cache, that stalled a switch to night for seconds.

/** Others' lit flashlights, nearest first, whose beams light the rain. */
export const RAIN_BEAMS = 3;
/** Your own light's shadow map, texels a side. */
const SHADOW_MAP = 1024;
/** Beams and glares drawn for others' lights this far off, at most this many. */
const BEAM_RANGE = 220;
const BEAMS = 24;
const INTENSITY = 90;
const DISTANCE = 70;
const DECAY = 1.4;
/** Half-angle of the beam, radians, and how soft its edge is. */
const ANGLE = 0.32;
const PENUMBRA = 0.55;
const BEAM_LENGTH = 14;
/** Where your own light sits relative to your eye: a little right and below. */
const OWN_OFFSET = new THREE.Vector3(0.18, -0.22, 0);

export class Flashlights {
  private readonly own: THREE.SpotLight;
  private readonly color = new THREE.Color(0xfff2de);
  private readonly beams: THREE.Mesh[] = [];
  private readonly glares: THREE.Sprite[] = [];
  private night = false;
  private fogNear = 0;
  private fogFar = 1;

  constructor(scene: THREE.Scene) {
    const spot = (): THREE.SpotLight => {
      const s = new THREE.SpotLight(0xfff2de, 0, DISTANCE, ANGLE, PENUMBRA, DECAY);
      scene.add(s, s.target);
      return s;
    };
    this.own = spot();
    // Drawn only while it's on: turning its shadow off would recompile every material.
    this.own.castShadow = true;
    this.own.shadow.mapSize.set(SHADOW_MAP, SHADOW_MAP);
    this.own.shadow.camera.near = 0.2;
    this.own.shadow.bias = -0.0005;
    this.own.shadow.normalBias = 0.03;
    this.own.shadow.autoUpdate = false;

    const beamGeo = new THREE.ConeGeometry(Math.tan(ANGLE) * BEAM_LENGTH, BEAM_LENGTH, 20, 1, true)
      .translate(0, -BEAM_LENGTH / 2, 0)
      .rotateX(-Math.PI / 2);
    const glareMap = glareTexture();
    for (let i = 0; i < BEAMS; i++) {
      const beam = new THREE.Mesh(beamGeo, beamMaterial());
      beam.visible = false;
      beam.frustumCulled = false;
      const glare = new THREE.Sprite(new THREE.SpriteMaterial({
        map: glareMap, color: 0xfff2de, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, toneMapped: false,
      }));
      glare.visible = false;
      scene.add(beam, glare);
      this.beams.push(beam);
      this.glares.push(glare);
    }
  }

  /** Whether it's dark enough for flashlights. */
  get dark(): boolean {
    return this.night;
  }

  /** Whether it's dark enough for flashlights, and the fog they fade into. */
  setConditions(dark: boolean, fogNear: number, fogFar: number): void {
    this.night = dark;
    this.fogNear = fogNear;
    this.fogFar = fogFar;
    if (!dark) this.own.intensity = 0;
    // Its shadow map drawn once, by day too, so there's one to bind before
    // it's first switched on: until then three.js binds a stand-in, which
    // Chrome on Metal builds every lit material's pipeline afresh for.
    this.own.shadow.needsUpdate = true;
    if (!dark) for (let i = 0; i < BEAMS; i++) this.beams[i].visible = this.glares[i].visible = false;
  }

  /**
   * Once a frame: your own light from `camera` if `on`, and the lit ones
   * among `players`, shining from `torch` where the body is drawn, along the
   * gun, or else from the eye along the aim. Returns the lit ones' lenses and
   * directions, nearest first, into `lit`, for the rain.
   */
  update(
    camera: THREE.Camera, on: boolean, players: readonly PlayerSnap[],
    torch: (id: number, out: THREE.Vector3, dir: THREE.Vector3) => THREE.Vector3 | null,
    lit: { at: THREE.Vector3; dir: THREE.Vector3 }[] = [],
  ): { at: THREE.Vector3; dir: THREE.Vector3 }[] {
    lit.length = 0;
    if (!this.night) return lit;
    const eye = camera.position;
    this.own.intensity = on ? INTENSITY : 0;
    this.own.shadow.autoUpdate = on;
    if (on) {
      this.own.position.copy(OWN_OFFSET).applyQuaternion(camera.quaternion).add(eye);
      this.own.target.position.set(0, 0, -10).applyQuaternion(camera.quaternion).add(eye);
      this.own.target.updateMatrixWorld();
    }

    const others: { p: PlayerSnap; at: THREE.Vector3; dir: THREE.Vector3; d: number }[] = [];
    for (const p of players) {
      if (!p.light || p.dead) continue;
      const d = Math.hypot(p.x - eye.x, p.z - eye.z);
      if (d > BEAM_RANGE) continue;
      const dir = new THREE.Vector3();
      let at = torch(p.id, new THREE.Vector3(), dir);
      if (!at) {
        at = new THREE.Vector3(p.x, p.y + 1.4, p.z);
        const cp = Math.cos(p.pitch);
        dir.set(-Math.sin(p.yaw) * cp, Math.sin(p.pitch), -Math.cos(p.yaw) * cp);
      }
      others.push({ p, at, dir, d });
    }
    others.sort((a, b) => a.d - b.d);

    for (const o of others) {
      // Its light reaches DISTANCE round it: past that and the fog, nothing of it shows.
      if (o.d - DISTANCE > this.fogFar) continue;
      const light = localLights.add();
      light.x = o.at.x;
      light.y = o.at.y;
      light.z = o.at.z;
      light.dx = o.dir.x;
      light.dy = o.dir.y;
      light.dz = o.dir.z;
      light.color.copy(this.color);
      light.intensity = INTENSITY;
      light.range = DISTANCE;
      light.decay = DECAY;
      light.angle = ANGLE;
      light.penumbra = PENUMBRA;
      light.shadow = true;
      light.near = o.d;
    }
    const toEye = new THREE.Vector3();
    for (let i = 0; i < BEAMS; i++) {
      const l = others[i];
      const beam = this.beams[i];
      const glare = this.glares[i];
      beam.visible = glare.visible = !!l;
      if (!l) continue;
      // Faded by the fog like anything else that far off.
      const fade = 1 - THREE.MathUtils.smoothstep(l.d, this.fogNear, this.fogFar);
      beam.position.copy(l.at);
      beam.lookAt(toEye.copy(l.at).add(l.dir));
      (beam.material as THREE.ShaderMaterial).uniforms.strength.value = fade;
      // The glare: bright when the light points at you, gone from behind.
      toEye.copy(eye).sub(l.at).normalize();
      const facing = THREE.MathUtils.smoothstep(toEye.dot(l.dir), 0.55, 0.97);
      glare.position.copy(l.at).addScaledVector(l.dir, 0.1);
      // Keeps a few pixels across however far off it is.
      glare.scale.setScalar(0.35 + l.d * 0.012);
      glare.material.opacity = facing * Math.max(fade, 0.25);
    }
    for (let i = 0; i < Math.min(others.length, RAIN_BEAMS); i++) lit.push(others[i]);
    return lit;
  }
}

function beamMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { strength: { value: 1 } },
    vertexShader: /* glsl */ `
      varying float vAlong;
      varying vec3 vNormal;
      varying vec3 vView;
      void main() {
        // The cone runs from its tip at the lamp (z = 0) to its open end.
        vAlong = clamp(position.z / ${BEAM_LENGTH.toFixed(1)}, 0.0, 1.0);
        vec4 view = modelViewMatrix * vec4(position, 1.0);
        vNormal = normalize(normalMatrix * normal);
        vView = normalize(-view.xyz);
        gl_Position = projectionMatrix * view;
      }`,
    fragmentShader: /* glsl */ `
      uniform float strength;
      varying float vAlong;
      varying vec3 vNormal;
      varying vec3 vView;
      void main() {
        // Denser near the lamp, and soft at the cone's silhouette.
        float edge = abs(dot(normalize(vNormal), normalize(vView)));
        float a = pow(1.0 - vAlong, 1.8) * edge * 0.09 * strength;
        gl_FragColor = vec4(vec3(1.0, 0.95, 0.87) * a, 1.0);
      }`,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
}

/** A soft round glare with a hot middle. */
function glareTexture(): THREE.Texture {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const g = canvas.getContext('2d')!;
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.15, 'rgba(255,245,225,0.8)');
  grad.addColorStop(0.45, 'rgba(255,235,200,0.15)');
  grad.addColorStop(1, 'rgba(255,235,200,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
