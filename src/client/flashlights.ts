import * as THREE from 'three';
import type { PlayerSnap } from '../shared/protocol.ts';

// Flashlights after dark. Your own lights the way from just below your eye.
// Others' shine from their guns: the nearest few really light the ground,
// and every lit one shows a faint beam and a glare when it points your way,
// which is how you spot a guard across the island at night. Every light
// that could be used stays in the scene all the time, so switching one on
// never recompiles a material.

/** Others' flashlights that light the world, nearest first. */
const LIT_OTHERS = 2;
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
  private readonly others: THREE.SpotLight[] = [];
  private readonly beams: THREE.Mesh[] = [];
  private readonly glares: THREE.Sprite[] = [];
  private dark = false;
  private fogNear = 0;
  private fogFar = 1;

  constructor(scene: THREE.Scene) {
    const spot = (): THREE.SpotLight => {
      const s = new THREE.SpotLight(0xfff2de, 0, DISTANCE, ANGLE, PENUMBRA, DECAY);
      s.visible = false;
      scene.add(s, s.target);
      return s;
    };
    this.own = spot();
    for (let i = 0; i < LIT_OTHERS; i++) this.others.push(spot());

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

  /** Whether it's dark enough for flashlights, and the fog they fade into. */
  setConditions(dark: boolean, fogNear: number, fogFar: number): void {
    this.dark = dark;
    this.fogNear = fogNear;
    this.fogFar = fogFar;
    for (const s of [this.own, ...this.others]) s.visible = dark;
    if (!dark) for (let i = 0; i < BEAMS; i++) this.beams[i].visible = this.glares[i].visible = false;
  }

  /**
   * Once a frame: your own light from `camera` if `on`, and the lit ones
   * among `players`, shining from `muzzle` where the body is drawn.
   */
  update(camera: THREE.Camera, on: boolean, players: readonly PlayerSnap[], muzzle: (id: number, out: THREE.Vector3) => THREE.Vector3 | null): void {
    if (!this.dark) return;
    const eye = camera.position;
    this.own.intensity = on ? INTENSITY : 0;
    if (on) {
      this.own.position.copy(OWN_OFFSET).applyQuaternion(camera.quaternion).add(eye);
      this.own.target.position.set(0, 0, -10).applyQuaternion(camera.quaternion).add(eye);
      this.own.target.updateMatrixWorld();
    }

    const lit: { p: PlayerSnap; at: THREE.Vector3; dir: THREE.Vector3; d: number }[] = [];
    for (const p of players) {
      if (!p.light || p.dead) continue;
      const d = Math.hypot(p.x - eye.x, p.z - eye.z);
      if (d > BEAM_RANGE) continue;
      const at = muzzle(p.id, new THREE.Vector3()) ?? new THREE.Vector3(p.x, p.y + 1.4, p.z);
      const cp = Math.cos(p.pitch);
      const dir = new THREE.Vector3(-Math.sin(p.yaw) * cp, Math.sin(p.pitch), -Math.cos(p.yaw) * cp);
      lit.push({ p, at, dir, d });
    }
    lit.sort((a, b) => a.d - b.d);

    this.others.forEach((s, i) => {
      const l = lit[i];
      s.intensity = l ? INTENSITY : 0;
      if (!l) return;
      s.position.copy(l.at);
      s.target.position.copy(l.at).add(l.dir);
      s.target.updateMatrixWorld();
    });

    const toEye = new THREE.Vector3();
    for (let i = 0; i < BEAMS; i++) {
      const l = lit[i];
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
