import * as THREE from 'three';
import type { Conditions } from '../shared/conditions.ts';
import type { ExtractView } from '../shared/protocol.ts';
import { mulberry32 } from '../shared/rng.ts';
import { leafRect, type PropStyle, type World } from '../shared/world.ts';
import type { Assets } from './assets.ts';
import { Sun } from './cascades.ts';
import type { GroundCover } from './groundcover.ts';
import { Layer } from '../shared/layers.ts';
import { patchFog } from './fogbanks.ts';
import { lightingOf, type Lighting } from './lighting.ts';
import { Rain, type Shelter } from './rain.ts';
import { IndoorLight } from './indoorlight.ts';
import { IslandMap, LEVEL_GATHER } from './islandmap.ts';
import { Lamps } from './lamps.ts';
import { surfaceMaterial } from './surfaces.ts';
import { groundEye, onTiles, Terrain } from './terrain.ts';
import { Trees } from './trees.ts';
import { REFLECTED, Water } from './water.ts';
import { Structures } from './structures.ts';
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
  door: [0x5a4a36],
  glass: [0xa8c4c8],
  lamp: [0x3a3d40],
};
/** With textures, props are tinted rather than coloured. */
const PROP_TINTS: Record<PropStyle, number[]> = {
  crate: [0xe8e8e0, 0xe0dccc, 0xd4ccbc],
  wall: [0xe0dcd4],
  wood: [0xb0a292],
  metal: [0xc0584a, 0x5d8aad, 0x7d9a5e, 0xc8ae62, 0xa4a8ac],
  fence: [0xffffff, 0xe0d4c0],
  roof: [0xa09a90],
  door: [0x8a7560],
  glass: [0xffffff],
  lamp: [0x6a6e72],
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
  door: Layer.boards,
  glass: Layer.concrete,
  lamp: Layer.metal,
};
/** How far our own sky is greyed as it's baked to light by. */
const SKY_GREYING = 0.7;
const GREY = new THREE.Color();
function luminance(c: THREE.Color): number {
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
}
/** The colour lightning lights the sky, and how much flat light it adds at its brightest. */
const FLASH_SKY = new THREE.Color(0xc8d2ff);
const FLASH_HEMI = 1.2;
const GONE = new THREE.Matrix4().makeScale(0, 0, 0);
const V_SCALE = new THREE.Vector3();

/** The rendered island: terrain, water, sky, props, vegetation and lighting. */
export class WorldView {
  readonly scene: THREE.Scene;
  private readonly sun: Sun;
  private readonly sky: THREE.Mesh;
  /** Each extraction point's flag, coloured by whether it's open. */
  private readonly flags: THREE.MeshStandardMaterial[];
  private readonly extractGroup: THREE.Group;
  /** Set once another island has taken this one's place. */
  private disposed = false;
  private readonly world: World;
  private readonly props: THREE.InstancedMesh;
  /** Each prop's matrix while it stands. */
  private readonly propMatrices: THREE.Matrix4[];
  /** Window glass, see-through and drawn apart from the other props; `glassOf` maps a prop to its instance here, or -1. */
  private readonly glass: THREE.InstancedMesh;
  private readonly glassOf: Int32Array;
  /** How far each door leaf had swung when last drawn, from 0 shut to 1 open. */
  private readonly drawn: Float32Array;
  private readonly terrain: Terrain;
  private readonly trees: Trees;
  private readonly rocks: THREE.InstancedMesh;
  /** The watchtowers and containers, drawn from their parts. */
  private readonly structures: Structures;
  private readonly water: Water;
  /** The outposts' lamps, lit after dark. */
  private readonly lamps: Lamps;
  private dark: boolean;
  /** Grass, bushes and pebbles near the camera, once their code has loaded. */
  private cover: GroundCover | null = null;
  private assets: Assets | null = null;
  private readonly hemi = new THREE.HemisphereLight(0xcfdcea, 0x5a5440, 1.1);
  private readonly fog = new THREE.Fog(0xffffff);
  private readonly background = new THREE.Color();
  private readonly rain: Rain;
  private lighting: Lighting;
  private raining: boolean;
  private textured = false;
  /** How much of the sky reaches inside each building. */
  readonly light3d: IndoorLight;
  /** The island's roofs, puddles and buildings, for the rain and the light inside. */
  private readonly island: IslandMap;
  private previewing = true;
  /** Whether something casting shadows has broken since the island's still shadow map was drawn, and when it was. */
  private castersChanged = false;
  private redrawnAt = -Infinity;
  /** How bright the last lightning flash shown was. */
  private flashed = 0;
  /** For baking our own sky into a picture to light and reflect by, and the last one baked. */
  private renderer: THREE.WebGLRenderer | null = null;
  private skyPicture: { key: string; target: THREE.WebGLRenderTarget } | null = null;

  /** Drawn into `scene`, which may have been another island's; see dispose(). */
  constructor(world: World, conditions: Conditions, scene = new THREE.Scene()) {
    this.scene = scene;
    patchFog();
    this.lighting = lightingOf(conditions);
    this.raining = conditions.weather === 'rain';
    this.dark = conditions.time !== 'day';
    this.rain = new Rain(world);
    scene.fog = this.fog;
    scene.background = this.background;

    this.sky = makeSky();
    scene.add(this.sky);

    scene.add(this.hemi);
    this.sun = new Sun(0xffffff, 1, this.lighting.sunDir, world.half);
    this.sun.addTo(scene);
    this.light();

    this.world = world;
    this.island = new IslandMap(world);
    this.light3d = new IndoorLight(world, this.island);
    const extracts = makeExtracts(world);
    this.flags = extracts.flags;
    this.extractGroup = extracts.group;
    const props = makeProps(world);
    this.props = props.mesh;
    this.propMatrices = props.matrices;
    // Towers and containers are drawn from their parts, not as their boxes.
    this.structures = new Structures(world);
    for (const i of Structures.replaces(world)) props.mesh.setMatrixAt(i, GONE);
    const glass = makeGlass(world, props.mesh);
    this.glass = glass.mesh;
    this.glassOf = glass.of;
    this.drawn = Float32Array.from(world.doors, (d) => d.swing);
    this.drawn.forEach((_, i) => this.placeDoor(i));
    this.terrain = new Terrain(world);
    this.trees = new Trees(world);
    this.rocks = makeRocks(world);
    this.water = new Water(world);
    this.lamps = new Lamps(world);
    this.lamps.setConditions(this.dark, this.fog.near, this.fog.far);
    scene.add(this.lamps.group, this.terrain.group, this.water.group, this.props, this.glass, this.structures.group, this.trees.group, this.rocks, extracts.group, this.rain.group);
    for (const o of [this.sky, this.terrain.group, this.props, this.structures.group, this.trees.group, this.rocks, extracts.group, this.lamps.group]) reflected(o);
  }

  /**
   * The parts that load lazily, the ground cover and the far trees'
   * impostors, whose picture needs the renderer to bake.
   */
  async prepare(renderer: THREE.WebGLRenderer): Promise<void> {
    this.renderer = renderer;
    this.light();
    await Promise.all([
      this.trees.bake(renderer).then(() => {
        reflected(this.trees.group);
        this.sun.redraw();
      }),
      import('./groundcover.ts').then(({ GroundCover }) => {
        if (this.disposed) return;
        this.cover = new GroundCover(this.world);
        if (this.assets) this.cover.applyAssets(this.assets);
        this.scene.add(this.cover.group);
      }),
    ]);
  }

  /**
   * Take the island out of its scene and free what it was drawn with, as
   * another island takes its place in the same scene. The textures shared
   * with the next are kept; see Known Issues for what isn't freed.
   */
  dispose(): void {
    this.disposed = true;
    const scene = this.scene;
    const parts = [this.sky, this.hemi, this.lamps.group, this.terrain.group, this.water.group, this.props, this.glass, this.structures.group, this.trees.group, this.rocks, this.extractGroup, this.rain.group];
    if (this.cover) parts.push(this.cover.group);
    const materials = new Set<THREE.Material>();
    for (const part of parts) {
      scene.remove(part);
      part.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        mesh.geometry.dispose();
        for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) materials.add(m);
      });
    }
    for (const m of materials) {
      // Data textures (heights, roofs) are the island's own, and could be sent again if shared.
      const uniforms = (m as THREE.ShaderMaterial).uniforms ?? {};
      for (const v of [...Object.values(m), ...Object.values(uniforms).map((u) => u?.value)]) {
        if (v instanceof THREE.DataTexture) v.dispose();
      }
      m.dispose();
    }
    this.sun.removeFrom(scene);
    this.water.dispose();
    this.skyPicture?.target.dispose();
    this.skyPicture = null;
  }

  /** How the island is lit now. */
  get lit(): Readonly<Lighting> {
    return this.lighting;
  }

  /** Light the island for another time of day or weather. */
  setConditions(conditions: Conditions): void {
    this.lighting = lightingOf(conditions);
    this.raining = conditions.weather === 'rain';
    this.dark = conditions.time !== 'day';
    this.light();
  }

  /**
   * Bake a night sky once and throw it away, if this light doesn't bake its
   * own: compiling the shaders that do it stalls the first dusk or night
   * for most of a second on a cold shader cache, better done while loading.
   */
  warmSky(): void {
    if (this.lighting.ownSky || !this.renderer || !this.assets) return;
    const was = this.lighting;
    this.lighting = lightingOf({ time: 'night', weather: 'clear' });
    this.light();
    this.lighting = was;
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
    this.flashed = 0;
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
    // Baked from the sky just set.
    if (this.assets) this.scene.environment = l.ownSky ? (this.bakeSky() ?? this.assets.environment) : this.assets.environment;
    // The streaks catch the light of the sky around them.
    this.rain.set(this.raining, l.horizon.clone().multiplyScalar(1.25));
    // Built after the first lighting.
    this.water?.relit(this.scene);
    this.lamps?.setConditions(this.dark, this.fog.near, this.fog.far);
  }

  /** Swap the flat colours for textures and light everything from the sky. */
  applyAssets(assets: Assets): void {
    this.assets = assets;
    this.textured = true;
    this.light();

    this.terrain.applyMaterial(surfaceMaterial(assets, { kind: 'terrain' }, { vertexColors: true, roughness: 0.95 }, 1, { indoor: true, wet: 'puddles' }));

    const props = this.props;
    const layers = new Float32Array(this.world.props.length);
    const pools = new Float32Array(this.world.props.length);
    const c = new THREE.Color();
    this.world.props.forEach(({ style, tint, panel }, i) => {
      // Roofs are corrugated metal only on top: underneath, a plain ceiling.
      layers[i] = style === 'roof' ? -1 - PROP_LAYERS[style] : PROP_LAYERS[style];
      // A concrete floor the rain reaches, once the roof over it is down, gathers puddles as level ground does.
      pools[i] = panel >= 0 && this.world.panels[panel].kind === 'floor' ? LEVEL_GATHER : 0;
      props.setColorAt(i, c.setHex(pick(PROP_TINTS[style], tint)).multiplyScalar(GAIN[style] ?? 1));
    });
    props.geometry.setAttribute('layer', new THREE.InstancedBufferAttribute(layers, 1));
    props.geometry.setAttribute('pool', new THREE.InstancedBufferAttribute(pools, 1));
    props.instanceColor!.needsUpdate = true;
    const old = props.material as THREE.Material;
    props.material = onTiles(surfaceMaterial(assets, { kind: 'instanced' }, { roughness: 0.8, metalness: 0, shadowSide: PROP_SHADOW_SIDE }, 1, { indoor: true, wet: 'puddles' }), this.world);
    old.dispose();

    this.trees.applyAssets(assets);
    this.structures.applyAssets(assets);
    this.cover?.applyAssets(assets);
    this.rocks.material = onTiles(surfaceMaterial(assets, { kind: 'fixed', layer: Layer.rock }, { roughness: 0.9 }, 1, { wet: true }), this.world);
    const rand = mulberry32(this.world.seed + 29);
    for (let i = 0; i < this.rocks.count; i++) {
      const v = 0.75 + rand() * 0.25;
      this.rocks.setColorAt(i, c.setRGB(v, v, v * 0.96));
    }
    this.rocks.instanceColor!.needsUpdate = true;
    this.sun.redraw();
  }

  /** Whether it's raining, and where it's sheltered from it. */
  get shelter(): Shelter {
    return this.rain;
  }

  /** Show panels standing or broken and doors open or shut as the world has them, at once. */
  syncPanels(): void {
    this.world.panels.forEach((_, i) => this.showPanel(i));
    this.lamps.show();
    this.props.instanceMatrix.needsUpdate = true;
    this.glass.instanceMatrix.needsUpdate = true;
    this.light3d.changed();
    this.rain.roofChanged();
    this.island.roofs();
    this.sun.redraw();
  }

  /** Show one panel as the world has it. */
  updatePanel(id: number): void {
    if (!this.world.panels[id]) return;
    const kind = this.world.panels[id].kind;
    if (kind === 'roof' || kind === 'floor') {
      this.rain.roofChanged();
      this.island.roofs(this.world.panels[id].box);
    }
    if (this.world.panels[id].kind === 'lamp') this.lamps.show();
    this.showPanel(id);
    this.props.instanceMatrix.needsUpdate = true;
    this.glass.instanceMatrix.needsUpdate = true;
    this.light3d.changed();
    this.castersChanged = true;
  }

  /** A door leaf was opened or shut: it swings there, and the light through its doorway changes. */
  updateDoor(id: number): void {
    if (this.world.doors[id]) this.light3d.changed();
  }

  private showPanel(id: number): void {
    const p = this.world.panels[id];
    const g = this.glassOf[p.prop];
    if (g >= 0) this.glass.setMatrixAt(g, p.box.gone ? GONE : this.propMatrices[p.prop]);
    else if (p.box.door !== undefined) this.placeDoor(p.box.door);
    else this.props.setMatrixAt(p.prop, p.box.gone ? GONE : this.propMatrices[p.prop]);
  }

  /** Set a door leaf's matrix from how far it has swung. */
  private placeDoor(id: number): void {
    const d = this.world.doors[id];
    const p = this.world.panels[d.panel];
    if (p.box.gone) {
      this.props.setMatrixAt(p.prop, GONE);
      return;
    }
    this.drawn[id] = d.swing;
    const a = (d.swing * Math.PI) / 2;
    const dx = d.shutX * Math.cos(a) + d.openX * Math.sin(a);
    const dz = d.shutZ * Math.cos(a) + d.openZ * Math.sin(a);
    const [x0, z0, x1, z1] = leafRect(d, false);
    const thick = Math.min(x1 - x0, z1 - z0);
    const m = this.propMatrices[p.prop];
    m.makeRotationY(Math.atan2(-dz, dx));
    m.scale(V_SCALE.set(d.length, d.y1 - d.y0, thick));
    m.setPosition(d.x + (dx * d.length) / 2, (d.y0 + d.y1) / 2, d.z + (dz * d.length) / 2);
    this.props.setMatrixAt(p.prop, m);
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
    groundEye.value.copy(camera.position);
    this.sun.update(focus, near, far);
    // Broken walls and swung doors reach the island's shadow map now and then, not every time one changes.
    if (this.castersChanged && (time - this.redrawnAt > 2 || time < this.redrawnAt)) {
      this.castersChanged = false;
      this.redrawnAt = time;
      this.sun.redraw();
    }
    wind.value = time;
    this.water.update(camera, time, this.scene, this.sky);
    this.trees.update(camera.position);
    this.lamps.update(camera.position);
    this.cover?.update(camera.position);
    this.rain.update(camera.position, time);
    this.lightning(this.rain.flash);
    this.swingDoors();
    this.light3d.focus(camera.position);
    this.light3d.update();
  }

  /** Whether the last frame drew the sea's reflection. */
  get reflecting(): boolean {
    return this.water.reflecting;
  }

  /** Draw what the sea reflects, before drawing the scene from `camera`; if `force`, even with no sea in view. */
  reflect(renderer: THREE.WebGLRenderer, camera: THREE.PerspectiveCamera, force = false): void {
    // Its pass reuses the shadow maps, so it waits for a frame to have drawn
    // every one, your own flashlight's included.
    if (this.scene.children.every(drawnShadow)) this.water.reflect(renderer, this.scene, camera, force);
  }

  /**
   * Our own sky as it is now, baked into a picture for image-based light and
   * reflections, so at night shiny things and puddles show the moon and a
   * dark sky rather than a dimmed day; null until there's a renderer to bake with.
   */
  private bakeSky(): THREE.Texture | null {
    const renderer = this.renderer;
    if (!renderer) return null;
    const l = this.lighting;
    const key = [l.horizon, l.zenith, l.sunColor, l.sunDir].map((v) => v.toArray().map((n) => n.toFixed(4)).join()).join('|') + l.disc + l.stars;
    if (this.skyPicture?.key === key) return this.skyPicture.target.texture;
    this.skyPicture?.target.dispose();
    const scene = new THREE.Scene();
    scene.add(new THREE.Mesh(this.sky.geometry, this.sky.material));
    // Baked a good deal greyer than it looks, or everything it lights turns the night sky's blue.
    const u = (this.sky.material as THREE.ShaderMaterial).uniforms;
    const colors: THREE.Color[] = [u.horizon.value, u.zenith.value, u.sunColor.value];
    const seen = colors.map((c) => c.clone());
    for (const c of colors) c.lerp(GREY.setScalar(luminance(c)), SKY_GREYING);
    const pmrem = new THREE.PMREMGenerator(renderer);
    const target = pmrem.fromScene(scene, 0, 1, 3000);
    pmrem.dispose();
    colors.forEach((c, i) => c.copy(seen[i]));
    this.skyPicture = { key, target };
    return target.texture;
  }

  /** Called with how far off lightning struck, metres, as it lights the sky. */
  set onThunder(f: ((distance: number) => void) | null) {
    this.rain.onStrike = f;
  }

  /** Brighten the sky, the fog and the flat light by a lightning flash, `f` from 0 to 1. */
  private lightning(f: number): void {
    if (f === this.flashed) return;
    this.flashed = f;
    const l = this.lighting;
    const u = (this.sky.material as THREE.ShaderMaterial).uniforms;
    u.horizon.value.copy(l.horizon).lerp(FLASH_SKY, f * 0.5);
    u.zenith.value.copy(l.zenith).lerp(FLASH_SKY, f * 0.4);
    // Under the sea the fog is the water's.
    if (!this.water.under) {
      this.fog.color.copy(u.horizon.value);
      this.background.copy(u.horizon.value);
    }
    const hemi = this.textured ? l.hemiTextured : l.hemi;
    this.hemi.intensity = hemi + f * FLASH_HEMI * (1 - 0.8 * l.ambient);
    this.hemi.color.copy(l.hemiSky).lerp(FLASH_SKY, f);
  }

  /** The lit flashlights nearest the camera, yours first if it's on: the rain in their beams glints. */
  torches(lit: readonly { at: THREE.Vector3; dir: THREE.Vector3 }[]): void {
    this.rain.torches(lit);
  }

  /** Whether the camera is under the sea. */
  get underwater(): boolean {
    return this.water.under;
  }

  /** Draw each door leaf that has swung since, where the world has it; the world swings them. */
  private swingDoors(): void {
    let moved = false;
    this.world.doors.forEach((d, i) => {
      if (this.drawn[i] === d.swing) return;
      this.placeDoor(i);
      moved = true;
      // Come to rest, the leaf's shadow moves in the island's map too.
      if (d.swing === 0 || d.swing === 1) this.castersChanged = true;
    });
    if (moved) this.props.instanceMatrix.needsUpdate = true;
  }
}

/** Whether `o` isn't a light casting a shadow, or its shadow map has been drawn; drawing with one missing binds the wrong kind of texture. */
function drawnShadow(o: THREE.Object3D): boolean {
  const light = o as THREE.DirectionalLight | THREE.SpotLight;
  return !light.isLight || !light.visible || !light.castShadow || !!light.shadow.map;
}

/**
 * Show `object` and everything in it in the sea's reflection. LODs are left
 * out: they'd pick their level for the mirrored camera, and what stands on the
 * ground expects the level picked for the real one.
 */
function reflected(object: THREE.Object3D): void {
  object.traverse((o) => {
    if (!(o as THREE.LOD).isLOD) o.layers.enable(REFLECTED);
  });
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

/**
 * The window glass: pale, shiny and mostly see-through. It casts no shadow,
 * so sunlight falls through a window. Its props are hidden from `props`.
 */
function makeGlass(world: World, props: THREE.InstancedMesh): { mesh: THREE.InstancedMesh; of: Int32Array } {
  const of = new Int32Array(world.props.length).fill(-1);
  let n = 0;
  world.props.forEach((p, i) => p.style === 'glass' && (of[i] = n++));
  const mesh = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1, 1, 1),
    onTiles(new THREE.MeshStandardMaterial({
      color: PROP_COLORS.glass[0], roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.22, depthWrite: false,
    }), world),
    n,
  );
  const m = new THREE.Matrix4();
  world.props.forEach((_, i) => {
    if (of[i] < 0) return;
    props.getMatrixAt(i, m);
    mesh.setMatrixAt(of[i], m);
    props.setMatrixAt(i, GONE);
  });
  mesh.receiveShadow = true;
  // Drawn after the solid world, so what's behind it shows through.
  mesh.renderOrder = 1;
  return { mesh, of };
}

/**
 * Props cast shadows from both sides of their boxes, not only the faces turned
 * from the sun as three.js has it. A building's walls meet its corner posts
 * box to box, and where a wall's inner face is lit, a shadow-map texel on the
 * inside corner could hold the far side of the post behind it and read as lit:
 * a line of sun down the corner. The shadows' bias keeps the lit faces clear.
 */
const PROP_SHADOW_SIDE = THREE.DoubleSide;

function makeProps(world: World): { mesh: THREE.InstancedMesh; matrices: THREE.Matrix4[] } {
  const props = world.props;
  const mesh = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1, 1, 1),
    onTiles(new THREE.MeshStandardMaterial({ roughness: 0.85, shadowSide: PROP_SHADOW_SIDE }), world),
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
    onTiles(new THREE.MeshStandardMaterial({ roughness: 0.95, flatShading: true }), world),
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
