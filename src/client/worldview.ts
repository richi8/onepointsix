import * as THREE from 'three';
import type { Conditions } from '../shared/conditions.ts';
import type { ExtractView } from '../shared/protocol.ts';
import { mulberry32 } from '../shared/rng.ts';
import { HOUSE_WALL, type PropStyle, type World } from '../shared/world.ts';
import type { Assets } from './assets.ts';
import { Sun } from './cascades.ts';
import type { GroundCover } from './groundcover.ts';
import { Layer } from '../shared/layers.ts';
import { lightingOf, type Lighting } from './lighting.ts';
import { Rain } from './rain.ts';
import { setRooms, surfaceMaterial } from './surfaces.ts';
import { Terrain } from './terrain.ts';
import { Trees } from './trees.ts';
import { Water } from './water.ts';
import { wind } from './wind.ts';

// The island starts out in flat colours and takes on its textures once the
// assets have loaded: blended ground layers, props in wood, concrete and
// metal, rocks and bark, all lit by a real sky. Near the camera it's dressed
// in grass, bushes and pebbles; the terrain and trees get simpler farther off.
// The time of day and the weather set the sky, the sun or moon and the fog.

const FLAG_OPEN = 0x4fd06b;
const FLAG_SHUT = 0xc4453a;
const FLAG_CALLED = 0xf2b33d;

const PROP_COLORS: Record<PropStyle, number[]> = {
  crate: [0x8b6b3e, 0x7a5c33, 0x94784a],
  wall: [0x8d8a82],
  wood: [0x6b4f33],
  metal: [0x7a3b2e, 0x2f5a73, 0x4e6b3a, 0x8a7a3a, 0x5d6166],
  fence: [0x7d6a4f, 0x6e5c42],
  roof: [0x55595c],
};
/** With textures, props are tinted rather than coloured. */
const PROP_TINTS: Record<PropStyle, number[]> = {
  crate: [0xe8e8e0, 0xe0dccc, 0xd4ccbc],
  wall: [0xe0dcd4],
  wood: [0xb0a292],
  metal: [0xc0584a, 0x5d8aad, 0x7d9a5e, 0xc8ae62, 0xa4a8ac],
  fence: [0xffffff, 0xe0d4c0],
  roof: [0xa09a90],
};
/** Wood textures are dark; they're brightened past themselves. */
const GAIN: Partial<Record<PropStyle, number>> = { crate: 1.7, wood: 1.8, fence: 1.5 };
const PROP_LAYERS: Record<PropStyle, number> = {
  crate: Layer.planks,
  wall: Layer.concrete,
  wood: Layer.boards,
  metal: Layer.metal,
  fence: Layer.boards,
  roof: Layer.metal,
};
const GONE = new THREE.Matrix4().makeScale(0, 0, 0);

/** The rendered island: terrain, water, sky, props, vegetation and lighting. */
export class WorldView {
  readonly scene = new THREE.Scene();
  private readonly sun: Sun;
  private readonly sky: THREE.Mesh;
  /** Each extraction point's flag, coloured by whether it's open. */
  private readonly flags: THREE.MeshStandardMaterial[];
  private readonly world: World;
  private readonly props: THREE.InstancedMesh;
  /** Each prop's matrix while it stands. */
  private readonly propMatrices: THREE.Matrix4[];
  private readonly terrain: Terrain;
  private readonly trees: Trees;
  private readonly rocks: THREE.InstancedMesh;
  private readonly water: Water;
  /** Grass, bushes and pebbles near the camera, once their code has loaded. */
  private cover: GroundCover | null = null;
  private assets: Assets | null = null;
  private readonly hemi = new THREE.HemisphereLight(0xcfdcea, 0x5a5440, 1.1);
  private readonly fog = new THREE.Fog(0xffffff);
  private readonly background = new THREE.Color();
  private readonly rain = new Rain();
  private lighting: Lighting;
  private raining: boolean;
  private textured = false;
  private previewing = true;

  constructor(world: World, conditions: Conditions) {
    const scene = this.scene;
    this.lighting = lightingOf(conditions);
    this.raining = conditions.weather === 'rain';
    scene.fog = this.fog;
    scene.background = this.background;

    this.sky = makeSky();
    scene.add(this.sky);

    scene.add(this.hemi);
    this.sun = new Sun(0xffffff, 1, this.lighting.sunDir);
    this.sun.addTo(scene);
    this.light();

    this.world = world;
    setRooms(world.buildings, HOUSE_WALL);
    const extracts = makeExtracts(world);
    this.flags = extracts.flags;
    const props = makeProps(world);
    this.props = props.mesh;
    this.propMatrices = props.matrices;
    this.terrain = new Terrain(world);
    this.trees = new Trees(world);
    this.rocks = makeRocks(world);
    this.water = new Water(world);
    scene.add(this.terrain.group, this.water.group, this.props, this.trees.group, this.rocks, extracts.group, this.rain.mesh);
  }

  /**
   * The parts that load lazily, the ground cover and the far trees'
   * impostors, whose picture needs the renderer to bake.
   */
  async prepare(renderer: THREE.WebGLRenderer): Promise<void> {
    await Promise.all([
      this.trees.bake(renderer),
      import('./groundcover.ts').then(({ GroundCover }) => {
        this.cover = new GroundCover(this.world);
        if (this.assets) this.cover.applyAssets(this.assets);
        this.scene.add(this.cover.group);
      }),
    ]);
  }

  /** How the island is lit now. */
  get lit(): Readonly<Lighting> {
    return this.lighting;
  }

  /** Light the island for another time of day or weather. */
  setConditions(conditions: Conditions): void {
    this.lighting = lightingOf(conditions);
    this.raining = conditions.weather === 'rain';
    this.light();
  }

  /** Whether the island is seen from the menu's orbit, through thinner fog, or played in. */
  set preview(on: boolean) {
    if (on === this.previewing) return;
    this.previewing = on;
    this.light();
  }

  private light(): void {
    const l = this.lighting;
    this.sun.set(l.sunColor, l.sunIntensity, l.sunDir);
    this.hemi.intensity = this.textured ? l.hemiTextured : l.hemi;
    this.hemi.color.copy(l.hemiSky);
    this.hemi.groundColor.copy(l.hemiGround);
    this.scene.environmentIntensity = l.environment;
    this.fog.color.copy(l.horizon);
    this.background.copy(l.horizon);
    this.fog.near = this.previewing ? l.previewFogNear : l.fogNear;
    this.fog.far = this.previewing ? l.previewFogFar : l.fogFar;
    const u = (this.sky.material as THREE.ShaderMaterial).uniforms;
    u.horizon.value.copy(l.horizon);
    u.zenith.value.copy(l.zenith);
    u.sunDir.value.copy(l.sunDir);
    u.sunColor.value.copy(l.sunColor).multiplyScalar(l.disc);
    u.stars.value = l.stars;
    // The streaks catch the light of the sky around them.
    this.rain.set(this.raining, l.horizon.clone().multiplyScalar(1.25));
  }

  /** Swap the flat colours for textures and light everything from the sky. */
  applyAssets(assets: Assets): void {
    this.scene.environment = assets.environment;
    this.textured = true;
    this.light();

    this.terrain.applyMaterial(surfaceMaterial(assets, { kind: 'terrain' }, { vertexColors: true, roughness: 0.95 }, 1, { indoor: true }));

    const props = this.props;
    const layers = new Float32Array(this.world.props.length);
    const c = new THREE.Color();
    this.world.props.forEach(({ style, tint }, i) => {
      layers[i] = PROP_LAYERS[style];
      props.setColorAt(i, c.setHex(pick(PROP_TINTS[style], tint)).multiplyScalar(GAIN[style] ?? 1));
    });
    props.geometry.setAttribute('layer', new THREE.InstancedBufferAttribute(layers, 1));
    props.instanceColor!.needsUpdate = true;
    const old = props.material as THREE.Material;
    props.material = surfaceMaterial(assets, { kind: 'instanced' }, { roughness: 0.8, metalness: 0 }, 1, { indoor: true });
    old.dispose();

    this.trees.applyAssets(assets);
    this.cover?.applyAssets(assets);
    this.assets = assets;
    this.rocks.material = surfaceMaterial(assets, { kind: 'fixed', layer: Layer.rock }, { roughness: 0.9 });
    const rand = mulberry32(this.world.seed + 29);
    for (let i = 0; i < this.rocks.count; i++) {
      const v = 0.75 + rand() * 0.25;
      this.rocks.setColorAt(i, c.setRGB(v, v, v * 0.96));
    }
    this.rocks.instanceColor!.needsUpdate = true;
  }

  /** Show panels standing or broken as the world has them. */
  syncPanels(): void {
    this.world.panels.forEach((p) => this.props.setMatrixAt(p.prop, p.box.gone ? GONE : this.propMatrices[p.prop]));
    this.props.instanceMatrix.needsUpdate = true;
  }

  /** Show one panel as the world has it. */
  updatePanel(id: number): void {
    const p = this.world.panels[id];
    if (!p) return;
    this.props.setMatrixAt(p.prop, p.box.gone ? GONE : this.propMatrices[p.prop]);
    this.props.instanceMatrix.needsUpdate = true;
  }

  /** A panel's colour, for its debris: flat, or a tint over its texture once textured. */
  panelColor(id: number, out: THREE.Color): THREE.Color {
    const p = this.world.panels[id];
    if (p) this.props.getColorAt(p.prop, out);
    return out;
  }

  /** A panel's texture layer, for its debris. */
  panelLayer(id: number): number {
    const p = this.world.panels[id];
    return p ? PROP_LAYERS[this.world.props[p.prop].style] : Layer.concrete;
  }

  /** Green flags fly over open extraction points, red over shut ones; a called pickup flashes amber. */
  setExtracts(views: readonly ExtractView[], time: number): void {
    views.forEach((v, i) => {
      const m = this.flags[i];
      if (!m) return;
      const called = v.call >= 0 && Math.floor(time * 3) % 2 === 0;
      const hex = called ? FLAG_CALLED : v.open ? FLAG_OPEN : FLAG_SHUT;
      m.color.setHex(hex);
      m.emissive.setHex(hex).multiplyScalar(0.55);
    });
  }

  /**
   * Once a frame: keep the sky and sea round the camera, the shadow cascades
   * `near` and `far` metres round `focus`, the detail near the camera, and
   * the wind and waves at `time` seconds.
   */
  update(camera: THREE.Camera, focus: THREE.Vector3, near: number, far: number, time: number): void {
    this.sky.position.copy(camera.position);
    this.sun.update(focus, near, far);
    wind.value = time;
    this.water.update(camera, time, this.scene, this.sky);
    this.trees.update(camera.position);
    this.cover?.update(camera.position);
    this.rain.update(camera.position, time);
  }
}

function makeSky(): THREE.Mesh {
  const material = new THREE.ShaderMaterial({
    uniforms: {
      horizon: { value: new THREE.Color() },
      zenith: { value: new THREE.Color() },
      sunDir: { value: new THREE.Vector3(0, 1, 0) },
      sunColor: { value: new THREE.Color() },
      stars: { value: 0 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 horizon;
      uniform vec3 zenith;
      uniform vec3 sunDir;
      uniform vec3 sunColor;
      uniform float stars;
      varying vec3 vDir;
      void main() {
        vec3 dir = normalize(vDir);
        vec3 col = mix(horizon, zenith, pow(max(dir.y, 0.0), 0.6));
        float s = max(dot(dir, sunDir), 0.0);
        col += sunColor * (pow(s, 1500.0) * 6.0 + pow(s, 12.0) * 0.18);
        if (stars > 0.0 && dir.y > 0.0) {
          // A fixed scatter of stars, fading out toward the horizon's haze.
          vec3 cell = floor(dir * 260.0);
          float h = fract(sin(dot(cell, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
          float bright = smoothstep(0.9975, 1.0, h) * smoothstep(0.05, 0.35, dir.y);
          col += vec3(0.8, 0.85, 1.0) * bright * stars;
        }
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }`,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    // Fog is blended in output space without tone mapping, so the sky skips it
    // too; that way the horizon and distant fog are exactly the same colour.
    toneMapped: false,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(1500, 32, 16), material);
  sky.renderOrder = -1;
  sky.frustumCulled = false;
  return sky;
}

function pick(palette: number[], t: number): number {
  return palette[Math.min(palette.length - 1, Math.floor(t * palette.length))];
}

function makeProps(world: World): { mesh: THREE.InstancedMesh; matrices: THREE.Matrix4[] } {
  const props = world.props;
  const mesh = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshStandardMaterial({ roughness: 0.85 }),
    props.length,
  );
  const c = new THREE.Color();
  const matrices = props.map(({ box, style, tint }, i) => {
    const m = new THREE.Matrix4().makeScale(box.maxX - box.minX, box.maxY - box.minY, box.maxZ - box.minZ);
    m.setPosition((box.minX + box.maxX) / 2, (box.minY + box.maxY) / 2, (box.minZ + box.maxZ) / 2);
    mesh.setMatrixAt(i, box.gone ? GONE : m);
    mesh.setColorAt(i, c.setHex(pick(PROP_COLORS[style], tint)));
    return m;
  });
  mesh.castShadow = mesh.receiveShadow = true;
  return { mesh, matrices };
}

/** A tall pole with a bright flag at each extraction point, visible from far off. */
function makeExtracts(world: World): { group: THREE.Group; flags: THREE.MeshStandardMaterial[] } {
  const group = new THREE.Group();
  const flags: THREE.MeshStandardMaterial[] = [];
  const pole = new THREE.CylinderGeometry(0.06, 0.08, 8, 6).translate(0, 4, 0);
  const flag = new THREE.BoxGeometry(1.6, 1, 0.04).translate(0.8, 7.4, 0);
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x9a9a92, roughness: 0.6, metalness: 0.4 });
  for (const e of world.extracts) {
    const flagMat = new THREE.MeshStandardMaterial({ color: FLAG_OPEN, emissive: 0x2a8c3e, emissiveIntensity: 0.8, roughness: 0.9 });
    flags.push(flagMat);
    const marker = new THREE.Group();
    const p = new THREE.Mesh(pole, poleMat);
    const f = new THREE.Mesh(flag, flagMat);
    p.castShadow = f.castShadow = true;
    marker.add(p, f);
    marker.position.set(e.x, e.y, e.z);
    // Poles carry no collider; they stand just off the spot so nobody stands inside one.
    marker.position.x += 1.5;
    group.add(marker);
  }
  return { group, flags };
}

function makeRocks(world: World): THREE.InstancedMesh {
  // One lumpy unit rock, jittered deterministically, shared by all instances.
  const geo = new THREE.IcosahedronGeometry(1, 1);
  const pos = geo.getAttribute('position');
  const rand = mulberry32(world.seed + 23);
  const jitter = new Map<string, number>();
  for (let i = 0; i < pos.count; i++) {
    const key = `${pos.getX(i).toFixed(3)},${pos.getY(i).toFixed(3)},${pos.getZ(i).toFixed(3)}`;
    let k = jitter.get(key);
    if (k === undefined) jitter.set(key, (k = 0.8 + rand() * 0.35));
    pos.setXYZ(i, pos.getX(i) * k, pos.getY(i) * k, pos.getZ(i) * k);
  }
  geo.computeVertexNormals();

  const mesh = new THREE.InstancedMesh(
    geo,
    new THREE.MeshStandardMaterial({ roughness: 0.95, flatShading: true }),
    world.rocks.length,
  );
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const c = new THREE.Color();
  world.rocks.forEach((r, i) => {
    q.setFromAxisAngle(up, r.rot);
    m.compose(new THREE.Vector3(r.x, r.y, r.z), q, new THREE.Vector3(r.r, r.h * 0.9, r.r));
    mesh.setMatrixAt(i, m);
    const v = 0.36 + rand() * 0.12;
    mesh.setColorAt(i, c.setRGB(v, v * 0.97, v * 0.92, THREE.SRGBColorSpace));
  });
  mesh.castShadow = mesh.receiveShadow = true;
  return mesh;
}
