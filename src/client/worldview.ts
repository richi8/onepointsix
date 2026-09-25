import * as THREE from 'three';
import { WATER_LEVEL } from '../shared/constants.ts';
import type { ExtractView } from '../shared/protocol.ts';
import { clamp, smoothstep } from '../shared/geom.ts';
import { fbm, mulberry32 } from '../shared/rng.ts';
import type { PropStyle, World } from '../shared/world.ts';
import { Layer, type Assets } from './assets.ts';
import { surfaceMaterial } from './surfaces.ts';
import { Trees } from './trees.ts';

// The island starts out in flat colours and takes on its textures once the
// assets have loaded: blended ground layers, props in wood, concrete and
// metal, rocks and bark, all lit by a real sky.

const HORIZON = new THREE.Color(0xb9c9d6);
const ZENITH = new THREE.Color(0x4f7fae);
const SUN_DIR = new THREE.Vector3(0.45, 0.6, 0.35).normalize();
const FOG_NEAR = 60;
const FOG_FAR = 750;
const SHADOW_MAP = 2048;

const SAND = new THREE.Color(0xb8a57a);
const GRASS = new THREE.Color(0x5b7338);
const GRASS_DRY = new THREE.Color(0x857a45);
const DIRT = new THREE.Color(0x76674c);
const ROCK = new THREE.Color(0x6f6b63);
const SEABED = new THREE.Color(0x6b6450);
const TINT_LUSH = new THREE.Color(0xa4c886);
const TINT_GRASS = new THREE.Color(0xcfe0b8);
const WHITE = new THREE.Color(0xffffff);
const TINT_SEABED = new THREE.Color(0x7d7460);

const FLAG_OPEN = 0x4fd06b;
const FLAG_SHUT = 0xc4453a;
const FLAG_CALLED = 0xf2b33d;

const PROP_COLORS: Record<PropStyle, number[]> = {
  crate: [0x8b6b3e, 0x7a5c33, 0x94784a],
  wall: [0x8d8a82],
  wood: [0x6b4f33],
  metal: [0x7a3b2e, 0x2f5a73, 0x4e6b3a, 0x8a7a3a, 0x5d6166],
  fence: [0x7d6a4f, 0x6e5c42],
};
/** With textures, props are tinted rather than coloured. */
const PROP_TINTS: Record<PropStyle, number[]> = {
  crate: [0xe8e8e0, 0xe0dccc, 0xd4ccbc],
  wall: [0xe0dcd4],
  wood: [0xb0a292],
  metal: [0xc0584a, 0x5d8aad, 0x7d9a5e, 0xc8ae62, 0xa4a8ac],
  fence: [0xffffff, 0xe0d4c0],
};
/** Wood textures are dark; they're brightened past themselves. */
const GAIN: Partial<Record<PropStyle, number>> = { crate: 1.7, wood: 1.8, fence: 1.5 };
const PROP_LAYERS: Record<PropStyle, number> = {
  crate: Layer.planks,
  wall: Layer.concrete,
  wood: Layer.boards,
  metal: Layer.metal,
  fence: Layer.boards,
};
/** Each layer's average colour, for debris flying off it. */
const LAYER_MEAN: Partial<Record<number, number>> = {
  [Layer.planks]: 0x6e5d4b,
  [Layer.concrete]: 0x9a968a,
  [Layer.boards]: 0x75614d,
};
const GONE = new THREE.Matrix4().makeScale(0, 0, 0);

/** The rendered island: terrain, water, sky, props, vegetation and lighting. */
export class WorldView {
  readonly scene = new THREE.Scene();
  private readonly sun: THREE.DirectionalLight;
  private readonly sky: THREE.Mesh;
  /** Each extraction point's flag, coloured by whether it's open. */
  private readonly flags: THREE.MeshStandardMaterial[];
  private readonly world: World;
  private readonly props: THREE.InstancedMesh;
  /** Each prop's matrix while it stands. */
  private readonly propMatrices: THREE.Matrix4[];
  private readonly terrain: THREE.Mesh;
  private readonly trees: Trees;
  private readonly rocks: THREE.InstancedMesh;
  private readonly hemi = new THREE.HemisphereLight(0xcfdcea, 0x5a5440, 1.1);
  private textured = false;

  constructor(world: World) {
    const scene = this.scene;
    scene.fog = new THREE.Fog(HORIZON, FOG_NEAR, FOG_FAR);
    scene.background = HORIZON;

    this.sky = makeSky();
    scene.add(this.sky);

    scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xfff1dc, 2.6);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(SHADOW_MAP, SHADOW_MAP);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.04;
    scene.add(this.sun, this.sun.target);

    this.world = world;
    const extracts = makeExtracts(world);
    this.flags = extracts.flags;
    const props = makeProps(world);
    this.props = props.mesh;
    this.propMatrices = props.matrices;
    this.terrain = makeTerrain(world);
    this.trees = new Trees(world);
    this.rocks = makeRocks(world);
    scene.add(this.terrain, makeWater(), this.props, this.trees.group, this.rocks, extracts.group);
  }

  /** Swap the flat colours for textures and light everything from the sky. */
  applyAssets(assets: Assets): void {
    this.textured = true;
    this.scene.environment = assets.environment;
    this.scene.environmentIntensity = 1.7;
    this.hemi.intensity = 0.4;

    const terrain = this.terrain.geometry;
    terrain.setAttribute('color', terrain.getAttribute('tint'));
    this.terrain.material = surfaceMaterial(assets, { kind: 'terrain' }, { vertexColors: true, roughness: 0.95 });

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
    props.material = surfaceMaterial(assets, { kind: 'instanced' }, { roughness: 0.8, metalness: 0 });
    old.dispose();

    this.trees.applyAssets(assets);
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

  /** A panel's colour, for its debris. */
  panelColor(id: number, out: THREE.Color): THREE.Color {
    const p = this.world.panels[id];
    if (!p) return out;
    this.props.getColorAt(p.prop, out);
    const mean = LAYER_MEAN[PROP_LAYERS[this.world.props[p.prop].style]];
    if (this.textured && mean !== undefined) out.multiply(new THREE.Color(mean));
    return out;
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

  /** Keep the sky around the camera and the shadow frustum over what matters. */
  update(camera: THREE.Camera, focus: THREE.Vector3, shadowRadius: number): void {
    this.sky.position.copy(camera.position);
    const cam = this.sun.shadow.camera;
    cam.left = cam.bottom = -shadowRadius;
    cam.right = cam.top = shadowRadius;
    cam.near = 1;
    cam.far = shadowRadius * 2 + 400;
    cam.updateProjectionMatrix();
    // Snap to shadow texels so shadows don't shimmer as the focus moves.
    const texel = (shadowRadius * 2) / SHADOW_MAP;
    const fx = Math.round(focus.x / texel) * texel;
    const fz = Math.round(focus.z / texel) * texel;
    this.sun.target.position.set(fx, focus.y, fz);
    this.sun.position.copy(this.sun.target.position).addScaledVector(SUN_DIR, shadowRadius + 200);
  }
}

function makeSky(): THREE.Mesh {
  const material = new THREE.ShaderMaterial({
    uniforms: {
      horizon: { value: HORIZON },
      zenith: { value: ZENITH },
      sunDir: { value: SUN_DIR },
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
      varying vec3 vDir;
      void main() {
        vec3 dir = normalize(vDir);
        vec3 col = mix(horizon, zenith, pow(max(dir.y, 0.0), 0.6));
        float s = max(dot(dir, sunDir), 0.0);
        col += vec3(1.0, 0.95, 0.85) * (pow(s, 1500.0) * 6.0 + pow(s, 12.0) * 0.18);
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

/** Heightfield mesh whose triangulation matches World.terrainHeight exactly. */
function makeTerrain(world: World): THREE.Mesh {
  const n = world.res + 1;
  const pos = new Float32Array(n * n * 3);
  for (let iz = 0; iz < n; iz++) {
    for (let ix = 0; ix < n; ix++) {
      const i = (iz * n + ix) * 3;
      pos[i] = -world.half + ix * world.cell;
      pos[i + 1] = world.heights[iz * n + ix];
      pos[i + 2] = -world.half + iz * world.cell;
    }
  }
  const index: number[] = [];
  for (let iz = 0; iz < world.res; iz++) {
    for (let ix = 0; ix < world.res; ix++) {
      const a = iz * n + ix;
      const b = a + 1;
      const c = a + n;
      const d = c + 1;
      index.push(a, c, b, b, c, d);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setIndex(index);
  geo.computeVertexNormals();

  // Each vertex gets a flat colour for before the textures arrive, the weights
  // of the five ground layers, and a tint over them for variety and the sea bed.
  const normals = geo.getAttribute('normal');
  const colors = new Float32Array(n * n * 3);
  const tints = new Float32Array(n * n * 3);
  const splatA = new Float32Array(n * n * 4);
  const splatB = new Float32Array(n * n);
  const c = new THREE.Color();
  const w = [0, 0, 0, 0, 0];
  const toward = (layer: number, t: number): void => {
    t = clamp(t, 0, 1);
    for (let k = 0; k < w.length; k++) w[k] = w[k] * (1 - t) + (k === layer ? t : 0);
  };
  for (let i = 0; i < n * n; i++) {
    const x = pos[i * 3];
    const y = pos[i * 3 + 1];
    const z = pos[i * 3 + 2];
    const flat = normals.getY(i);
    const dry = fbm(x / 60, z / 60, world.seed + 5, 3);
    const outpost = world.nearestOutpost(x, z);
    const dirt = outpost ? smoothstep(26, 16, outpost.dist) : 0;
    const rock = smoothstep(0.86, 0.72, flat) + smoothstep(38, 52, y);
    const sand = smoothstep(2.2, 0.8, y);
    const seabed = smoothstep(-0.5, -3, y);

    c.copy(GRASS).lerp(GRASS_DRY, smoothstep(0.45, 0.7, dry));
    c.lerp(DIRT, dirt).lerp(ROCK, rock).lerp(SAND, sand).lerp(SEABED, seabed);
    c.toArray(colors, i * 3);

    w.fill(0);
    w[Layer.grass] = 1;
    toward(Layer.dryGrass, smoothstep(0.42, 0.72, dry));
    toward(Layer.dirt, dirt);
    toward(Layer.rock, rock);
    toward(Layer.sand, sand);
    splatA.set(w.slice(0, 4), i * 4);
    splatB[i] = w[4];

    const lush = fbm(x / 23, z / 23, world.seed + 11, 2);
    c.copy(TINT_GRASS).lerp(TINT_LUSH, smoothstep(0.35, 0.75, lush)).lerp(WHITE, Math.max(sand, rock));
    c.lerp(TINT_SEABED, seabed);
    c.toArray(tints, i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.setAttribute('tint', new THREE.BufferAttribute(tints, 3));
  geo.setAttribute('splatA', new THREE.BufferAttribute(splatA, 4));
  geo.setAttribute('splatB', new THREE.BufferAttribute(splatB, 1));

  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 }));
  mesh.receiveShadow = true;
  return mesh;
}

function makeWater(): THREE.Mesh {
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(4000, 4000).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: 0x2b5a6e, roughness: 0.12, metalness: 0.2, transparent: true, opacity: 0.82 }),
  );
  mesh.position.y = WATER_LEVEL;
  mesh.receiveShadow = true;
  return mesh;
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
