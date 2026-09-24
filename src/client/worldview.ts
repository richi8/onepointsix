import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { WATER_LEVEL } from '../shared/constants.ts';
import { smoothstep } from '../shared/geom.ts';
import { fbm, mulberry32 } from '../shared/rng.ts';
import type { PropStyle, World } from '../shared/world.ts';

// Placeholder look until chunk 9: flat colours, instanced primitives, one sun.

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

const PROP_COLORS: Record<PropStyle, number[]> = {
  crate: [0x8b6b3e, 0x7a5c33, 0x94784a],
  wall: [0x8d8a82],
  wood: [0x6b4f33],
  metal: [0x7a3b2e, 0x2f5a73, 0x4e6b3a, 0x8a7a3a, 0x5d6166],
};

/** The rendered island: terrain, water, sky, props, vegetation and lighting. */
export class WorldView {
  readonly scene = new THREE.Scene();
  private readonly sun: THREE.DirectionalLight;
  private readonly sky: THREE.Mesh;

  constructor(world: World) {
    const scene = this.scene;
    scene.fog = new THREE.Fog(HORIZON, FOG_NEAR, FOG_FAR);
    scene.background = HORIZON;

    this.sky = makeSky();
    scene.add(this.sky);

    scene.add(new THREE.HemisphereLight(0xcfdcea, 0x5a5440, 1.1));
    this.sun = new THREE.DirectionalLight(0xfff1dc, 2.6);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(SHADOW_MAP, SHADOW_MAP);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.04;
    scene.add(this.sun, this.sun.target);

    scene.add(makeTerrain(world), makeWater(), makeProps(world), makeTrees(world), makeRocks(world));
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

  const normals = geo.getAttribute('normal');
  const colors = new Float32Array(n * n * 3);
  const c = new THREE.Color();
  for (let i = 0; i < n * n; i++) {
    const x = pos[i * 3];
    const y = pos[i * 3 + 1];
    const z = pos[i * 3 + 2];
    const flat = normals.getY(i);
    const dry = fbm(x / 60, z / 60, world.seed + 5, 3);
    c.copy(GRASS).lerp(GRASS_DRY, smoothstep(0.45, 0.7, dry));
    const outpost = world.nearestOutpost(x, z);
    if (outpost) c.lerp(DIRT, smoothstep(26, 16, outpost.dist));
    c.lerp(ROCK, smoothstep(0.86, 0.72, flat) + smoothstep(38, 52, y));
    c.lerp(SAND, smoothstep(2.2, 0.8, y));
    c.lerp(SEABED, smoothstep(-0.5, -3, y));
    c.toArray(colors, i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

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

function makeProps(world: World): THREE.InstancedMesh {
  const props = world.props;
  const mesh = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshStandardMaterial({ roughness: 0.85 }),
    props.length,
  );
  const m = new THREE.Matrix4();
  const c = new THREE.Color();
  props.forEach(({ box, style, tint }, i) => {
    m.makeScale(box.maxX - box.minX, box.maxY - box.minY, box.maxZ - box.minZ);
    m.setPosition((box.minX + box.maxX) / 2, (box.minY + box.maxY) / 2, (box.minZ + box.maxZ) / 2);
    mesh.setMatrixAt(i, m);
    mesh.setColorAt(i, c.setHex(pick(PROP_COLORS[style], tint)));
  });
  mesh.castShadow = mesh.receiveShadow = true;
  return mesh;
}

function makeTrees(world: World): THREE.Group {
  // Unit tree 7 m tall, matching the collider height in World.placeTrees.
  const trunkGeo = new THREE.CylinderGeometry(0.2, 0.3, 2.6, 6).translate(0, 1.3, 0);
  const canopyGeo = mergeGeometries([
    new THREE.ConeGeometry(1.9, 3.6, 7).translate(0, 3.2, 0),
    new THREE.ConeGeometry(1.4, 2.8, 7).translate(0, 4.6, 0),
    new THREE.ConeGeometry(0.9, 2.2, 7).translate(0, 5.9, 0),
  ]);
  const count = world.trees.length;
  const trunks = new THREE.InstancedMesh(trunkGeo, new THREE.MeshStandardMaterial({ color: 0x4a3526, roughness: 1 }), count);
  const canopies = new THREE.InstancedMesh(
    canopyGeo,
    new THREE.MeshStandardMaterial({ roughness: 0.9, flatShading: true }),
    count,
  );
  const rand = mulberry32(world.seed + 17);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const c = new THREE.Color();
  world.trees.forEach((t, i) => {
    q.setFromAxisAngle(up, rand() * Math.PI * 2);
    m.compose(new THREE.Vector3(t.x, t.y - 0.2, t.z), q, new THREE.Vector3(t.s, t.s, t.s));
    trunks.setMatrixAt(i, m);
    canopies.setMatrixAt(i, m);
    canopies.setColorAt(i, c.setHSL(0.27 + rand() * 0.06, 0.35 + rand() * 0.15, 0.17 + rand() * 0.06));
  });
  trunks.castShadow = canopies.castShadow = true;
  trunks.receiveShadow = canopies.receiveShadow = true;
  const group = new THREE.Group();
  group.add(trunks, canopies);
  return group;
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
