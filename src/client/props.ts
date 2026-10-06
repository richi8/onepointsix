import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mulberry32 } from '../shared/rng.ts';
import type { World } from '../shared/world.ts';
import { dimIndoors } from './indoorlight.ts';
import { onTiles } from './terrain.ts';
import { ALL_EDGES, openEdges, roundCode } from './rounding.ts';

// The props drawn in the shapes of what they are, not as the boxes they
// collide as: a crate with battens along its edges and a brace across each
// side, a fence of boards nailed to two rails between posts, a table on
// four legs, a stair's step with a tread on it, a window's sill standing out from the wall and a frame round its
// glass. Walls, posts, roofs and floors are concrete and steel slabs, and stay boxes.
//
// Each shape is one geometry stretched over its prop's box, but its parts keep
// their size in metres as it stretches: every vertex is a point of the unit
// box (its `position`) plus an offset in metres (`inset`), divided back by the
// instance's scale in the shader. A batten is 9 cm wide on a crate of any size.

/** How each prop is drawn. `glass` is see-through and drawn apart, with its frame. */
type Shape = 'box' | 'crate' | 'fence' | 'table' | 'step' | 'sill' | 'glass' | 'frame';

const GONE = new THREE.Matrix4().makeScale(0, 0, 0);
const TURN = new THREE.Matrix4().makeRotationY(Math.PI / 2);

/** A coordinate across a prop: a fraction of its size from its middle (-0.5 to 0.5), plus metres. */
type At = readonly [number, number];
/** `m` metres in from the low side, the high side or (either way) the middle. */
const lo = (m = 0): At => [-0.5, m];
const hi = (m = 0): At => [0.5, -m];
const mid = (m = 0): At => [0, m];
type Corner = (sx: number, sy: number, sz: number) => [At, At, At];

/** Parts of one shape, each eight corners of its own shade. */
class Slices {
  private readonly pieces: THREE.BufferGeometry[] = [];

  box(x0: At, y0: At, z0: At, x1: At, y1: At, z1: At, shade = 1): void {
    this.hexa((sx, sy, sz) => [sx < 0 ? x0 : x1, sy < 0 ? y0 : y1, sz < 0 ? z0 : z1], shade);
  }

  /**
   * A box bent to the eight corners `corner` gives for each side (-1 or 1)
   * of each axis. Its faces keep a box's normals, so only boxes and shapes
   * slanted across faces too small to see the light on should use this.
   */
  hexa(corner: Corner, shade = 1): void {
    const g = new THREE.BoxGeometry(1, 1, 1);
    g.deleteAttribute('uv');
    const pos = g.getAttribute('position');
    const inset = new Float32Array(pos.count * 3);
    // For rounding it as a box of its own (see rounding.ts): which corner each vertex is, and its half-size along each axis, as a fraction of the prop's plus metres.
    const sign = new Float32Array(pos.count * 3);
    const halfF = new Float32Array(pos.count * 3);
    const halfM = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      const s = [Math.sign(pos.getX(i)), Math.sign(pos.getY(i)), Math.sign(pos.getZ(i))] as const;
      const c = corner(...s);
      for (let k = 0; k < 3; k++) {
        pos.setComponent(i, k, c[k][0]);
        inset[i * 3 + k] = c[k][1];
        const flip = [...s] as [number, number, number];
        flip[k] = -flip[k];
        const o = corner(...flip)[k];
        sign[i * 3 + k] = s[k];
        halfF[i * 3 + k] = (s[k] * (c[k][0] - o[0])) / 2;
        halfM[i * 3 + k] = (s[k] * (c[k][1] - o[1])) / 2;
      }
    }
    g.setAttribute('inset', new THREE.BufferAttribute(inset, 3));
    g.setAttribute('roundSign', new THREE.BufferAttribute(sign, 3));
    g.setAttribute('roundHalfF', new THREE.BufferAttribute(halfF, 3));
    g.setAttribute('roundHalfM', new THREE.BufferAttribute(halfM, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(new Array(pos.count * 3).fill(shade), 3));
    this.pieces.push(g);
  }

  geometry(): THREE.BufferGeometry {
    const g = mergeGeometries(this.pieces)!;
    for (const p of this.pieces) p.dispose();
    return g;
  }
}

/** A crate: planked sides set back between battens along every edge, and a brace across each side. */
function crate(): THREE.BufferGeometry {
  const s = new Slices();
  const B = 0.09;
  const SET = 0.025;
  s.box(lo(SET), lo(SET), lo(SET), hi(SET), hi(SET), hi(SET));
  for (const a of [lo(0), hi(B)]) {
    for (const b of [lo(0), hi(B)]) {
      const a1: At = [a[0], a[1] + B];
      const b1: At = [b[0], b[1] + B];
      s.box(a, lo(0), b, a1, hi(0), b1, 0.8);
      s.box(lo(B), a, b, hi(B), a1, b1, 0.8);
      s.box(a, b, lo(B), a1, b1, hi(B), 0.8);
    }
  }
  // Each brace climbs from a bottom corner to the top one across, between the battens.
  for (const across of [0, 2]) {
    for (const side of [-1, 1]) {
      s.hexa((sx, sv, sz) => {
        // Each corner's x still follows its own side of x, and z of z, so the faces keep their winding.
        const [su, sw] = across === 2 ? [sx, sz] : [sz, sx];
        const along = su < 0 ? lo(B) : hi(B);
        const up = su < 0 ? (sv < 0 ? lo(B) : lo(B + 0.11)) : sv < 0 ? hi(B + 0.11) : hi(B);
        const depth = side > 0 ? (sw < 0 ? hi(SET) : hi(0)) : sw < 0 ? lo(0) : lo(SET);
        return across === 2 ? [along, up, depth] : [depth, up, along];
      }, 0.85);
    }
  }
  return s.geometry();
}

/**
 * A fence section, long along x: a post at each end and boards across between
 * them with a finger's gap, down to the ground however far it reaches below.
 * Across, as the wood's grain runs in the texture.
 */
function fence(): THREE.BufferGeometry {
  const s = new Slices();
  const rand = mulberry32(31);
  const P = 0.09;
  for (const [x0, x1] of [[lo(0), lo(P)], [hi(P), hi(0)]]) s.box(x0, lo(0), lo(0), x1, hi(0), hi(0), 0.75);
  const boards = 6;
  for (let k = 0; k < boards; k++) {
    const top = 0.05 + k * 0.19;
    const y0 = k === boards - 1 ? lo(0) : hi(top + 0.165);
    s.box(lo(0.02), y0, lo(0.015), hi(0.02), hi(top), hi(0.015), 0.8 + rand() * 0.25);
  }
  return s.geometry();
}

/** A table, long along x: a top on four legs, with an apron under its edge. */
function table(): THREE.BufferGeometry {
  const s = new Slices();
  const TOP = 0.05;
  s.box(lo(0), hi(TOP), lo(0), hi(0), hi(0), hi(0));
  for (const [x0, x1] of [[lo(0.03), lo(0.1)], [hi(0.1), hi(0.03)]]) {
    for (const [z0, z1] of [[lo(0.03), lo(0.1)], [hi(0.1), hi(0.03)]]) s.box(x0, lo(0), z0, x1, hi(TOP), z1, 0.8);
  }
  const y0 = hi(TOP + 0.11);
  const y1 = hi(TOP);
  for (const [z0, z1] of [[lo(0.04), lo(0.065)], [hi(0.065), hi(0.04)]]) s.box(lo(0.1), y0, z0, hi(0.1), y1, z1, 0.7);
  for (const [x0, x1] of [[lo(0.04), lo(0.065)], [hi(0.065), hi(0.04)]]) s.box(x0, y0, lo(0.1), x1, y1, hi(0.1), 0.7);
  return s.geometry();
}

/** A stair's step, across x: a darker block under a tread whose nosing stands out a little each way. */
function step(): THREE.BufferGeometry {
  const s = new Slices();
  s.box(lo(0), lo(0), lo(0), hi(0), hi(0.04), hi(0), 0.7);
  s.box(lo(0), hi(0.04), lo(-0.02), hi(0), hi(0), hi(-0.02), 1.05);
  return s.geometry();
}

/** The wall under a window, along x: a sill on top standing out a little from both faces. */
function sill(): THREE.BufferGeometry {
  const s = new Slices();
  s.box(lo(0), lo(0), lo(0), hi(0), hi(0), hi(0));
  s.box(lo(-0.03), hi(0.06), lo(-0.05), hi(-0.03), hi(0), hi(-0.05), 1.1);
  return s.geometry();
}

/** A window's frame, round its glass along x: stiles, rails and a mullion down the middle. */
function frame(): THREE.BufferGeometry {
  const s = new Slices();
  const F = 0.06;
  const z0 = mid(-0.04);
  const z1 = mid(0.04);
  s.box(lo(0), lo(0), z0, lo(F), hi(0), z1);
  s.box(hi(F), lo(0), z0, hi(0), hi(0), z1);
  s.box(lo(F), lo(0), z0, hi(F), lo(F), z1);
  s.box(lo(F), hi(F), z0, hi(F), hi(0), z1);
  s.box(mid(-0.025), lo(F), mid(-0.03), mid(0.025), hi(F), mid(0.03), 0.9);
  return s.geometry();
}

function plain(): THREE.BufferGeometry {
  const s = new Slices();
  s.box(lo(0), lo(0), lo(0), hi(0), hi(0), hi(0));
  return s.geometry();
}

const GEOMETRY: Record<Shape, () => THREE.BufferGeometry> = { box: plain, crate, fence, table, step, sill, glass: plain, frame };

/** The window frames' colour: flat, and as a tint over the boards once textured. */
export const FRAME_COLOR = 0x8a8478;
export const FRAME_TINT = 0xf0ece4;

/** How a prop is drawn, from what it is and what it's part of. */
function shapeOf(world: World, i: number): Shape {
  const p = world.props[i];
  if (p.style === 'glass') return 'glass';
  if (p.style === 'crate') return 'crate';
  if (p.style === 'fence') return 'fence';
  if (p.box.part === 'step' || p.box.part === 'table' || p.box.part === 'sill') return p.box.part;
  return 'box';
}

/** Add the metres each vertex is set in from its point of the unit box, whatever the instance's scale. */
function sliced<M extends THREE.Material>(material: M): M {
  const before = material.onBeforeCompile;
  const key = material.customProgramCacheKey.bind(material);
  material.onBeforeCompile = (shader, renderer) => {
    before.call(material, shader, renderer);
    for (const anchor of ['#include <common>', '#include <begin_vertex>']) {
      if (!shader.vertexShader.includes(anchor)) throw new Error(`Shader anchor ${anchor} is missing`);
    }
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 inset;')
      .replace('#include <begin_vertex>', /* glsl */ `#include <begin_vertex>
        #ifdef USE_INSTANCING
          transformed += inset / max(vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz)), vec3(1e-4));
        #endif`);
  };
  material.customProgramCacheKey = () => `${key()}-sliced`;
  return material;
}

/**
 * Every prop of an island but those drawn otherwise, in its shape: one
 * instanced mesh per shape. Window glass is drawn see-through after the rest.
 */
export class Props {
  readonly group = new THREE.Group();
  private readonly meshes = new Map<Shape, THREE.InstancedMesh>();
  /** Each prop's mesh and its instance there, or undefined if it isn't drawn here. */
  private readonly mesh: (THREE.InstancedMesh | undefined)[];
  private readonly at: Int32Array;
  /** Each window glass's frame's instance, or -1. */
  private readonly frameOf: Int32Array;
  /** Each prop's matrix where it stands, its length along its own x. */
  private readonly rest: THREE.Matrix4[];
  private readonly depth = sliced(new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking }));
  /** How each prop is drawn, or null if it isn't drawn here. */
  private readonly shapes: (Shape | null)[];

  /** Drawn for `world` in the flat colours `colour` gives, leaving out the props in `hidden`. */
  constructor(world: World, colour: (prop: number) => number, hidden: Set<number>) {
    const shapes = world.props.map((_, i) => (hidden.has(i) ? null : shapeOf(world, i)));
    this.shapes = shapes;
    const count = new Map<Shape, number>();
    this.at = Int32Array.from(shapes, (s) => {
      if (!s) return -1;
      const n = count.get(s) ?? 0;
      count.set(s, n + 1);
      return n;
    });
    count.set('frame', count.get('glass') ?? 0);
    const flat = sliced(onTiles(new THREE.MeshStandardMaterial({ roughness: 0.85, shadowSide: PROP_SHADOW_SIDE, vertexColors: true }), world));
    for (const [shape, n] of count) {
      const glass = shape === 'glass';
      const mesh = new THREE.InstancedMesh(GEOMETRY[shape](), glass ? glassMaterial(world) : flat, n);
      if (glass) {
        // Drawn after the solid world, so what's behind it shows through.
        mesh.renderOrder = 1;
        mesh.receiveShadow = true;
      } else {
        mesh.castShadow = mesh.receiveShadow = true;
        mesh.customDepthMaterial = this.depth;
      }
      this.meshes.set(shape, mesh);
      this.group.add(mesh);
    }
    this.mesh = shapes.map((s) => (s ? this.meshes.get(s) : undefined));
    let frames = 0;
    this.frameOf = Int32Array.from(shapes, (s) => (s === 'glass' ? frames++ : -1));

    const c = new THREE.Color();
    this.rest = world.props.map(({ box }, i) => {
      const w = box.maxX - box.minX;
      const d = box.maxZ - box.minZ;
      const m = new THREE.Matrix4();
      // Shapes run along their own x: one longer across z is turned.
      if (shapes[i] !== 'box' && d > w) m.makeScale(d, box.maxY - box.minY, w).premultiply(TURN);
      else m.makeScale(w, box.maxY - box.minY, d);
      m.setPosition((box.minX + box.maxX) / 2, (box.minY + box.maxY) / 2, (box.minZ + box.maxZ) / 2);
      if (shapes[i]) {
        this.place(i, box.gone ? null : m);
        // The glass takes its colour from its material.
        if (this.frameOf[i] >= 0) this.meshes.get('frame')!.setColorAt(this.frameOf[i], c.setHex(FRAME_COLOR));
        else this.mesh[i]!.setColorAt(this.at[i], c.setHex(colour(i)));
      }
      return m;
    });
  }

  /** Show prop `i` where it stands, or not at all. */
  show(i: number, standing: boolean): void {
    this.place(i, standing ? this.rest[i] : null);
  }

  /** Draw prop `i` by `m` (its middle, turned and scaled as its box), or not at all. */
  place(i: number, m: THREE.Matrix4 | null): void {
    const mesh = this.mesh[i];
    if (!mesh) return;
    mesh.setMatrixAt(this.at[i], m ?? GONE);
    if (this.frameOf[i] >= 0) this.meshes.get('frame')!.setMatrixAt(this.frameOf[i], m ?? GONE);
  }

  /** Prop `i`'s matrix as it stands, to place it by. */
  restOf(i: number, out: THREE.Matrix4): THREE.Matrix4 {
    return out.copy(this.rest[i]);
  }

  colorAt(i: number, out: THREE.Color): THREE.Color {
    this.mesh[i]?.getColorAt(this.at[i], out);
    return out;
  }

  /**
   * Round the props' edges (see rounding.ts), for a material that does:
   * walls, floors, steps and sills where they stand in the open, the
   * smaller things made of parts all over.
   */
  round(world: World): void {
    const codes = new Map<THREE.InstancedMesh, Float32Array>();
    for (const mesh of this.meshes.values()) codes.set(mesh, new Float32Array(mesh.count));
    const frames = this.meshes.get('frame');
    this.mesh.forEach((mesh, i) => {
      const shape = this.shapes[i];
      if (!mesh || !shape || shape === 'glass') {
        if (frames && this.frameOf[i] >= 0) codes.get(frames)![this.frameOf[i]] = roundCode(ALL_EDGES, 0.006);
        return;
      }
      const code = shape === 'box' ? roundCode(openEdges(world, this.rest[i]), 0.03)
        : shape === 'step' || shape === 'sill' ? roundCode(openEdges(world, this.rest[i]), 0.02)
        : roundCode(ALL_EDGES, 0.01);
      codes.get(mesh)![this.at[i]] = code;
    });
    for (const [mesh, a] of codes) mesh.geometry.setAttribute('round', new THREE.InstancedBufferAttribute(a, 1));
  }

  /** Send the matrices changed since to the GPU. */
  moved(): void {
    for (const mesh of this.meshes.values()) mesh.instanceMatrix.needsUpdate = true;
  }

  /**
   * Draw the solid props with `material`, each prop in its texture `layer`
   * and tinted `tint`. The frames take the boards layer given.
   */
  texture(material: THREE.Material, layer: (i: number) => number, tint: (i: number, out: THREE.Color) => THREE.Color, boards: number): void {
    const c = new THREE.Color();
    const layers = new Map<THREE.InstancedMesh, Float32Array>();
    for (const mesh of this.meshes.values()) {
      layers.set(mesh, new Float32Array(mesh.count));
    }
    const frames = this.meshes.get('frame');
    this.mesh.forEach((mesh, i) => {
      if (!mesh) return;
      if (frames && this.frameOf[i] >= 0) {
        layers.get(frames)![this.frameOf[i]] = boards;
        frames.setColorAt(this.frameOf[i], c.setHex(FRAME_TINT));
        return;
      }
      layers.get(mesh)![this.at[i]] = layer(i);
      mesh.setColorAt(this.at[i], tint(i, c));
    });
    const solid = sliced(material);
    const old = new Set<THREE.Material>();
    for (const [shape, mesh] of this.meshes) {
      mesh.geometry.setAttribute('layer', new THREE.InstancedBufferAttribute(layers.get(mesh)!, 1));
      if (shape === 'glass') continue;
      mesh.instanceColor!.needsUpdate = true;
      old.add(mesh.material as THREE.Material);
      mesh.material = solid;
    }
    for (const m of old) m.dispose();
  }
}

/**
 * Props cast shadows from both sides of their boxes, not only the faces turned
 * from the sun as three.js has it. A building's walls meet its corner posts
 * box to box, and where a wall's inner face is lit, a shadow-map texel on the
 * inside corner could hold the far side of the post behind it and read as lit:
 * a line of sun down the corner. The shadows' bias keeps the lit faces clear.
 */
export const PROP_SHADOW_SIDE = THREE.DoubleSide;

/**
 * Pale and mostly see-through, but mirroring the sky as glass does: what it
 * reflects isn't thinned out with what it lets through, and toward a glancing
 * angle it lets less through and mirrors more (Schlick's Fresnel). Seen from
 * indoors it mirrors the room's dimmer light rather than the sky. It casts no
 * shadow, so sunlight falls through a window.
 */
function glassMaterial(world: World): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({
    color: GLASS_COLOR, roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.22, depthWrite: false,
  });
  material.onBeforeCompile = (shader) => {
    if (!shader.fragmentShader.includes('#include <opaque_fragment>')) throw new Error('Shader anchor #include <opaque_fragment> is missing');
    shader.fragmentShader = shader.fragmentShader.replace('#include <opaque_fragment>', /* glsl */ `
      {
        // Blended by alpha, the colour is thinned out by it: what's let
        // through is, what's mirrored is divided back up.
        float glassMirror = pow(1.0 - saturate(dot(geometryNormal, geometryViewDir)), 5.0);
        float glassAlpha = mix(diffuseColor.a, 1.0, glassMirror);
        outgoingLight = ((totalDiffuse + totalEmissiveRadiance) * diffuseColor.a * (1.0 - glassMirror) + totalSpecular) / glassAlpha;
        diffuseColor.a = glassAlpha;
      }
      #include <opaque_fragment>`);
  };
  material.customProgramCacheKey = () => 'glass';
  dimIndoors(material);
  return onTiles(material, world);
}

const GLASS_COLOR = 0xa8c4c8;
