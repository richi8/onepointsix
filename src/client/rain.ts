import * as THREE from 'three';

// Rain: thin streaks falling through a box that follows the camera. Every
// drop has a fixed place in the world that wraps round the box, so turning
// or walking doesn't drag the rain along; the vertex shader does all the
// moving, so it costs one draw call and no work on the CPU.

const DROPS = 9000;
/** Metres across and high of the box of rain round the camera. */
const BOX = 50;
const HEIGHT = 26;
/** How the drops fall, in m/s: slanted a little by the wind. */
const FALL = new THREE.Vector3(1.6, -10, 0.9);
/** Seconds of fall each streak shows, which sets its length. */
const STREAK = 0.05;

export class Rain {
  readonly mesh: THREE.LineSegments;
  private readonly material: THREE.ShaderMaterial;

  constructor() {
    const seeds = new Float32Array(DROPS * 2 * 3);
    const tips = new Float32Array(DROPS * 2);
    for (let i = 0; i < DROPS; i++) {
      const s = [Math.random(), Math.random(), Math.random()];
      seeds.set(s, i * 6);
      seeds.set(s, i * 6 + 3);
      tips[i * 2 + 1] = 1;
    }
    const geo = new THREE.BufferGeometry();
    // Positions are made up in the shader; this only sizes the draw.
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(DROPS * 2 * 3), 3));
    geo.setAttribute('seed', new THREE.BufferAttribute(seeds, 3));
    geo.setAttribute('tip', new THREE.BufferAttribute(tips, 1));
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        center: { value: new THREE.Vector3() },
        time: { value: 0 },
        color: { value: new THREE.Color() },
      },
      vertexShader: /* glsl */ `
        uniform vec3 center;
        uniform float time;
        attribute vec3 seed;
        attribute float tip;
        varying float vFade;
        const vec3 box = vec3(${BOX.toFixed(1)}, ${HEIGHT.toFixed(1)}, ${BOX.toFixed(1)});
        const vec3 fall = vec3(${FALL.x.toFixed(2)}, ${FALL.y.toFixed(2)}, ${FALL.z.toFixed(2)});
        void main() {
          // Where the drop is now, wrapped into the box round the camera.
          vec3 p = seed * box + fall * time;
          p = center + (fract((p - center) / box + 0.5) - 0.5) * box;
          p -= fall * ${STREAK.toFixed(3)} * tip;
          vec4 view = modelViewMatrix * vec4(p, 1.0);
          float d = length(view.xyz);
          // Thin out far off and right in front of the eye.
          vFade = smoothstep(${(BOX / 2).toFixed(1)}, ${(BOX / 4).toFixed(1)}, d) * smoothstep(0.3, 1.5, d);
          gl_Position = projectionMatrix * view;
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 color;
        varying float vFade;
        void main() {
          gl_FragColor = vec4(color, 0.4 * vFade);
          #include <colorspace_fragment>
        }`,
      transparent: true,
      depthWrite: false,
      toneMapped: false,
    });
    this.mesh = new THREE.LineSegments(geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
  }

  /** Rain or not, and the colour the streaks catch from the sky. */
  set(on: boolean, color: THREE.Color): void {
    this.mesh.visible = on;
    this.material.uniforms.color.value.copy(color);
  }

  /** Fall round `eye` at `time` seconds. */
  update(eye: THREE.Vector3, time: number): void {
    if (!this.mesh.visible) return;
    this.material.uniforms.center.value.copy(eye);
    this.material.uniforms.time.value = time % 1000;
  }
}
