import * as THREE from 'three';
import type { Weather } from '../shared/weather.ts';
import type { ExtractView } from '../shared/protocol.ts';
import { mulberry32 } from '../shared/rng.ts';
import { ROCK_SQUASH } from '../shared/rock.ts';
import { leafRect, type Box, type PropStyle, type World } from '../shared/world.ts';
import type { Assets } from './assets.ts';
import { Sun } from './cascades.ts';
import type { GroundCover } from './groundcover.ts';
import { Layer } from '../shared/layers.ts';
import { patchFog, setMistAhead, setMistGround } from './fogbanks.ts';
import { lightingOf, type Lighting } from './lighting.ts';
import { outlookMoved, settledOutlook, type Outlook } from './outlook.ts';
import { Rain, type Shelter } from './rain.ts';
import { IndoorLight } from './indoorlight.ts';
import { TownLight } from './townlight.ts';
import { IslandMap } from './islandmap.ts';
import { surfaceMaterial } from './surfaces.ts';
import { groundEye, onTiles, Terrain } from './terrain.ts';
import { Trees } from './trees.ts';
import { REFLECTED, Water } from './water.ts';
import { PROP_SHADOW_SIDE, Props } from './props.ts';
import { plasterColor, Structures } from './structures.ts';
import { townLayer, townPaint, townTint } from './townlook.ts';
import { Dressing } from './dressing.ts';
import { replacedProps } from './features.ts';
import { wind, windStrength } from './wind.ts';

// The island starts out in flat colours and takes on its textures once the
// assets have loaded: blended ground layers, props in wood, concrete and
// metal, rocks and bark, all lit by a real sky. Near the camera it's dressed
// in grass, bushes and pebbles; the terrain and trees get simpler farther off.
// The weather sets the sky, the sun and the fog.

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
};
/** The colour lightning lights the sky, and how much flat light it adds at its brightest. */
const FLASH_SKY = new THREE.Color(0xc8d2ff);
const FLASH_HEMI = 1.2;
const DOOR_MATRIX = new THREE.Matrix4();
const SUN_LIGHT = new THREE.Color();
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
  /** The props, each drawn in its shape. */
  private readonly props: Props;
  /** How far each door leaf had swung when last drawn, from 0 shut to 1 open. */
  private readonly drawn: Float32Array;
  private readonly terrain: Terrain;
  private readonly trees: Trees;
  private readonly rocks: THREE.InstancedMesh;
  /** The watchtowers and containers, drawn from their parts. */
  private readonly structures: Structures;
  /** A map town's trim over its walls and its features, drawn only. */
  private readonly dressing: THREE.Group = new THREE.Group();
  private readonly trim: Dressing | null;
  private readonly water: Water;
  /** Grass, bushes and pebbles near the camera, once their code has loaded. */
  private cover: GroundCover | null = null;
  private assets: Assets | null = null;
  private readonly hemi = new THREE.HemisphereLight(0xcfdcea, 0x5a5440, 1.1);
  private readonly fog = new THREE.Fog(0xffffff);
  private readonly background = new THREE.Color();
  private readonly rain: Rain;
  private lighting: Lighting;
  /** The weather as it's seen, how wet the ground is and how full the puddles, 0 to 1. */
  private outlook: Outlook;
  private wet: number;
  private puddles: number;
  /** The colour the rain's streaks catch from the sky. */
  private readonly rainColor = new THREE.Color();
  private textured = false;
  /** How much of the sky reaches inside each building. */
  readonly light3d: IndoorLight;
  /** A map town's baked light, indoors and out, in place of the buildings' grids. */
  readonly townLight: TownLight | null;
  /** The island's roofs, puddles and buildings, for the rain and the light inside. */
  private readonly island: IslandMap;
  private previewing = true;
  /** Whether something casting shadows has broken since the island's still shadow map was drawn, and when it was. */
  private castersChanged = false;
  private redrawnAt = -Infinity;
  /** How bright the last lightning flash shown was. */
  private flashed = 0;

  /** Drawn into `scene`, which may have been another island's; see dispose(). */
  constructor(world: World, weather: Weather, scene = new THREE.Scene()) {
    this.scene = scene;
    patchFog();
    setMistGround(world);
    this.outlook = settledOutlook(weather);
    this.lighting = lightingOf(this.outlook.clouds, this.outlook.air, world.map);
    this.wet = this.puddles = this.outlook.rainfall;
    windStrength.value = this.outlook.wind;
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
    // Light bounces off each prop in its own colour, as it's drawn untextured.
    const colours = new Map(world.props.map((_, i) => [world.props[i].box, flatColour(world, i)]));
    const colourOf = (box: Box) => colours.get(box) ?? PROP_COLORS.wall[0];
    this.townLight = TownLight.build(world, colourOf, this.lighting.sunDir);
    this.light3d = new IndoorLight(world, this.island, colourOf, () => !this.townLight);
    this.townLight?.start();
    this.light3d.setSun(this.lighting.sunDir, SUN_LIGHT.copy(this.lighting.sunColor).multiplyScalar(this.lighting.sunIntensity));
    const extracts = makeExtracts(world);
    this.flags = extracts.flags;
    this.extractGroup = extracts.group;
    // Towers and containers are drawn from their parts, not as their boxes.
    this.structures = new Structures(world);
    this.props = new Props(world, (i) => flatColour(world, i), new Set([...Structures.replaces(world), ...replacedProps(world)]));
    this.trim = Dressing.build(world);
    if (this.trim) this.dressing.add(this.trim.group);
    this.drawn = Float32Array.from(world.doors, (d) => d.swing);
    this.drawn.forEach((_, i) => this.placeDoor(i));
    this.terrain = new Terrain(world);
    this.trees = new Trees(world);
    this.rocks = makeRocks(world);
    this.water = new Water(world);
    scene.add(this.terrain.group, this.water.group, this.props.group, this.structures.group, this.dressing, this.trees.group, this.rocks, extracts.group, this.rain.group);
    for (const o of [this.sky, this.terrain.group, this.props.group, this.structures.group, this.dressing, this.trees.group, this.rocks, extracts.group]) reflected(o);
  }

  /**
   * The parts that load lazily, the ground cover and the far trees'
   * impostors, whose picture needs the renderer to bake.
   */
  async prepare(renderer: THREE.WebGLRenderer): Promise<void> {
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
    const parts = [this.sky, this.hemi, this.terrain.group, this.water.group, this.props.group, this.structures.group, this.dressing, this.trees.group, this.rocks, this.extractGroup, this.rain.group];
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
    this.townLight?.dispose();
  }

  /** How the island is lit now. */
  get lit(): Readonly<Lighting> {
    return this.lighting;
  }

  /**
   * Show the weather as `o` has it, the ground `wet` and the puddles as full
   * as `puddles`, 0 to 1. Returns whether the island was lit anew.
   */
  setOutlook(o: Outlook, wet: number, puddles: number): boolean {
    const moved = outlookMoved(this.outlook, o);
    this.outlook = o;
    this.wet = wet;
    this.puddles = puddles;
    windStrength.value = o.wind;
    if (moved) {
      this.lighting = lightingOf(o.clouds, o.air, this.world.map);
      this.light();
    } else this.rain.set(o.rainfall, o.storm, this.rainColor, wet, puddles);
    return moved;
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
    // Built after the first lighting.
    this.light3d?.setSun(l.sunDir, SUN_LIGHT.copy(l.sunColor).multiplyScalar(l.sunIntensity));
    this.hemi.intensity = this.textured ? l.hemiTextured : l.hemi;
    this.hemi.color.copy(l.hemiSky);
    this.hemi.groundColor.copy(l.hemiGround);
    this.scene.environmentIntensity = l.environment;
    this.fog.color.copy(l.horizon);
    this.background.copy(l.horizon);
    this.fog.near = this.previewing ? l.previewFogNear : l.fogNear;
    setMistAhead(this.outlook.mist);
    this.fog.far = this.previewing ? l.previewFogFar : l.fogFar;
    const u = (this.sky.material as THREE.ShaderMaterial).uniforms;
    u.horizon.value.copy(l.horizon);
    u.zenith.value.copy(l.zenith);
    u.sunDir.value.copy(l.sunDir);
    u.sunColor.value.copy(l.sunColor).multiplyScalar(l.disc);
    u.photoMix.value = this.assets ? l.photo : 0;
    u.turn.value = l.skyTurn;
    this.scene.environmentRotation.y = l.skyTurn;
    if (this.assets) {
      this.scene.environment = this.assets.environment;
      u.photo.value = this.assets.skyPhoto;
    }
    // The streaks catch the light of the sky around them.
    this.rainColor.copy(l.horizon).multiplyScalar(1.25);
    this.rain.set(this.outlook.rainfall, this.outlook.storm, this.rainColor, this.wet, this.puddles);
    // Built after the first lighting.
    this.water?.relit(this.scene);
  }

  /** Swap the flat colours for textures and light everything from the sky. */
  applyAssets(assets: Assets): void {
    this.assets = assets;
    this.textured = true;
    this.light();

    this.terrain.applyMaterial(surfaceMaterial(assets, { kind: 'terrain' }, { vertexColors: true, roughness: 0.95 }, 1, { indoor: true, wet: 'puddles', town: townPaint(this.world) }));

    const world = this.world;
    const props = world.props;
    this.props.texture(
      onTiles(surfaceMaterial(assets, { kind: 'instanced' }, { roughness: 0.8, metalness: 0, shadowSide: PROP_SHADOW_SIDE, vertexColors: true }, 1, { indoor: true, wet: true }), world),
      // Roofs are corrugated metal only on top: underneath, a plain ceiling. A map's town is its own (see townlook.ts).
      (i) => townLayer(world, i) ?? (props[i].style === 'roof' ? -1 - PROP_LAYERS.roof : PROP_LAYERS[props[i].style]),
      (i, c) => townTint(world, i, true, c)
        ?? (props[i].colour !== undefined ? plasterColor(props[i].colour, true, c) : c.setHex(pick(PROP_TINTS[props[i].style], props[i].tint)).multiplyScalar(GAIN[props[i].style] ?? 1)),
      Layer.boards,
    );

    const c = new THREE.Color();

    this.trees.applyAssets(assets);
    this.structures.applyAssets(assets);
    this.trim?.applyAssets(assets, this.world);
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

  /** How wet the island is, how hard it's raining, and where it's sheltered from it. */
  get shelter(): Shelter {
    return this.rain;
  }

  /** Show panels standing or broken and doors open or shut as the world has them, at once. */
  syncPanels(): void {
    this.world.panels.forEach((_, i) => this.showPanel(i));
    this.props.moved();
    this.light3d.changed();
    this.sun.redraw();
  }

  /** Show one panel as the world has it. */
  updatePanel(id: number): void {
    if (!this.world.panels[id]) return;
    this.showPanel(id);
    this.props.moved();
    this.light3d.changed();
    this.castersChanged = true;
  }

  /** A door leaf was opened or shut: it swings there, and the light through its doorway changes. */
  updateDoor(id: number): void {
    if (this.world.doors[id]) this.light3d.changed();
  }

  private showPanel(id: number): void {
    const p = this.world.panels[id];
    if (p.box.door !== undefined) this.placeDoor(p.box.door);
    else this.props.show(p.prop, !p.box.gone);
  }

  /** Set a door leaf's matrix from how far it has swung. */
  private placeDoor(id: number): void {
    const d = this.world.doors[id];
    const p = this.world.panels[d.panel];
    if (p.box.gone) {
      this.props.place(p.prop, null);
      return;
    }
    this.drawn[id] = d.swing;
    const a = (d.swing * Math.PI) / 2;
    const dx = d.shutX * Math.cos(a) + d.openX * Math.sin(a);
    const dz = d.shutZ * Math.cos(a) + d.openZ * Math.sin(a);
    const [x0, z0, x1, z1] = leafRect(d, false);
    const thick = Math.min(x1 - x0, z1 - z0);
    const m = DOOR_MATRIX;
    m.makeRotationY(Math.atan2(-dz, dx));
    m.scale(V_SCALE.set(d.length, d.y1 - d.y0, thick));
    m.setPosition(d.x + (dx * d.length) / 2, (d.y0 + d.y1) / 2, d.z + (dz * d.length) / 2);
    this.props.place(p.prop, m);
  }

  /** A panel's colour, for its debris: flat, or a tint over its texture once textured. */
  panelColor(id: number, out: THREE.Color): THREE.Color {
    const p = this.world.panels[id];
    if (p) this.props.colorAt(p.prop, out);
    return out;
  }

  /** A panel's texture layer, for its debris. */
  panelLayer(id: number): number {
    const p = this.world.panels[id];
    return p ? PROP_LAYERS[this.world.props[p.prop].style] : Layer.concrete;
  }

  /** Whether the extraction points' poles and flags stand on the island: not in Deathmatch, which has none. */
  set showExtracts(on: boolean) {
    this.extractGroup.visible = on;
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
    // Broken cover and swung doors reach the island's shadow map now and then, not every time one changes.
    if (this.castersChanged && (time - this.redrawnAt > 2 || time < this.redrawnAt)) {
      this.castersChanged = false;
      this.redrawnAt = time;
      this.sun.redraw();
    }
    wind.value = time;
    this.water.update(camera, time, this.scene, this.sky);
    this.trees.update(camera.position);
    this.cover?.update(camera.position);
    this.rain.update(camera.position, time);
    this.lightning(this.rain.flash);
    this.swingDoors();
    this.light3d.focus(camera.position);
    this.light3d.update();
    this.townLight?.update(time);
  }

  /** Work out all the light inside at once, as a still picture needs. */
  finishLight(): void {
    this.light3d.finishAll();
    this.townLight?.finish();
  }

  /**
   * The sky's light at a point in red, green and blue, as a share of the
   * open's, into `sky`; and the sun's light bounced there, as a share of the
   * sun's, into `sun`.
   */
  lightAt(x: number, y: number, z: number, sky: THREE.Color, sun: THREE.Color): void {
    if (this.townLight?.at(x, y, z, sky, sun)) return;
    this.light3d.at(x, y, z, sky);
    this.light3d.sunAt(x, y, z, sun);
  }

  /** Whether the last frame drew the sea's reflection. */
  get reflecting(): boolean {
    return this.water.reflecting;
  }

  /** Draw what the sea reflects, before drawing the scene from `camera`; if `force`, even with no sea in view. */
  reflect(renderer: THREE.WebGLRenderer, camera: THREE.PerspectiveCamera, force = false): void {
    // Its pass reuses the shadow maps, so it waits for a frame to have drawn
    // every one.
    if (this.scene.children.every(drawnShadow)) this.water.reflect(renderer, this.scene, camera, force);
  }

  /** Straight after drawing the scene from `camera`, have the GPU count whether any sea showed, for the reflections to come. */
  lookForSea(renderer: THREE.WebGLRenderer, camera: THREE.Camera): void {
    this.water.lookForSea(renderer, camera, this.fog.far);
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
    if (moved) this.props.moved();
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

/** Radians of the sky the photograph spans, from the zenith to 8° below the horizon (see scripts/fetch-assets.mjs). */
const SKY_SPAN = THREE.MathUtils.degToRad(98);

function makeSky(): THREE.Mesh {
  const material = new THREE.ShaderMaterial({
    uniforms: {
      horizon: { value: new THREE.Color() },
      zenith: { value: new THREE.Color() },
      sunDir: { value: new THREE.Vector3(0, 1, 0) },
      sunColor: { value: new THREE.Color() },
      photo: { value: null as THREE.Texture | null },
      photoMix: { value: 0 },
      turn: { value: 0 },
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
      uniform sampler2D photo;
      uniform float photoMix;
      uniform float turn;
      varying vec3 vDir;
      void main() {
        vec3 dir = normalize(vDir);
        vec3 col = mix(horizon, zenith, pow(max(dir.y, 0.0), 0.6));
        // By day, the sky's photograph, turned so its sun lies the sun's way,
        // melting into the horizon's colour, the fog's, as it nears it.
        if (photoMix > 0.0) {
          float height = asin(clamp(dir.y, -1.0, 1.0));
          vec2 uv = vec2((atan(dir.z, dir.x) + turn) / 6.2831853 + 0.5, 1.0 - (1.5707963 - height) / (${SKY_SPAN.toFixed(4)}));
          vec3 seen = mix(horizon, texture2D(photo, uv).rgb, smoothstep(0.0, 0.07, height));
          col = mix(col, seen, photoMix);
        }
        float s = max(dot(dir, sunDir), 0.0);
        col += sunColor * (pow(s, 1500.0) * 6.0 + pow(s, 12.0) * 0.18);
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

/** Prop `i`'s flat colour: its style's, or its building's plaster. */
function flatColour(world: World, i: number): number {
  const p = world.props[i];
  const town = townTint(world, i, false, FLAT);
  if (town) return town.getHex();
  return p.colour !== undefined ? plasterColor(p.colour, false, FLAT).getHex() : pick(PROP_COLORS[p.style], p.tint);
}
const FLAT = new THREE.Color();

function pick(palette: number[], t: number): number {
  return palette[Math.min(palette.length - 1, Math.floor(t * palette.length))];
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
  // The world's one lumpy unit rock, which rounds and sight meet too, shared by all instances.
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(world.rockShape, 3));
  geo.computeVertexNormals();
  const rand = mulberry32(world.seed + 29);

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
    m.compose(new THREE.Vector3(r.x, r.y, r.z), q, new THREE.Vector3(r.r, r.h * ROCK_SQUASH, r.r));
    mesh.setMatrixAt(i, m);
    const v = 0.36 + rand() * 0.12;
    mesh.setColorAt(i, c.setRGB(v, v * 0.97, v * 0.92, THREE.SRGBColorSpace));
  });
  mesh.castShadow = mesh.receiveShadow = true;
  return mesh;
}
