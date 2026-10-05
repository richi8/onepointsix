import { Layer } from '../shared/layers.ts';

// A map's town weathered in its shaders, with no textures of its own: the
// years drawn from noise over where each surface stands. Walls are each a
// shade and hue of their own, their paint faded and uneven, damp risen up
// them from the ground with a tide line, splashed with dirt at the foot and
// streaked under every ledge, the plaster fallen away here and there to the
// stone beneath; stone, roofs and doors stained, bleached and grown with
// lichen; the paving's repeat broken up, varied over the town and worn
// darker and smoother along the ways people walk, and its joints holding
// the rain. The island is left as it was.

/** The cut stone's tint, as the trim's (see townparts.ts), for the stone where plaster has fallen. */
const STONE_TINT = 'vec3(0.92, 0.89, 0.83)';

/** GLSL every aged material has: hashes and noise. */
export const AGE_GLSL = /* glsl */ `
  // Dave Hoskins's hash without sine: cheap, and steady over the town's coordinates.
  float ageHash(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }
  float ageNoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(ageHash(i), ageHash(i + vec2(1.0, 0.0)), f.x), mix(ageHash(i + vec2(0.0, 1.0)), ageHash(i + vec2(1.0, 1.0)), f.x), f.y);
  }
  float ageFbm(vec2 p) {
    return ageNoise(p) * 0.62 + ageNoise(p * 2.37 + 17.1) * 0.38;
  }
  float ageLum(vec3 c) {
    return dot(c, vec3(0.2126, 0.7152, 0.0722));
  }
`;

/**
 * GLSL for the buildings, their trim and their roofs, after the colour is
 * known: \`ageBuilt(layer, p, n, below, open, color, normal, rough, streaks)\`
 * weathers the surface of texture layer \`layer\` at world point \`p\` facing \`n\`,
 * \`below\` metres under the top of its box, \`open\` 1 out of doors and 0
 * under a roof; it sets how much rougher it is than its material says and
 * how streaked, for the rain to run down. Needs \`groundLevel\` (terrain.ts),
 * \`triplanar\` (surfaces.ts) and AGE_GLSL.
 */
export const AGE_BUILT_GLSL = /* glsl */ `
  void ageBuilt(float layer, vec3 p, vec3 n, float below, float open, inout vec3 color, inout vec3 normal, out float rough, out float streaks) {
    rough = 1.0;
    streaks = 0.0;
    bool plaster = abs(layer - ${Layer.plaster}.0) < 0.5;
    bool stone = abs(layer - ${Layer.ashlar}.0) < 0.5;
    bool tiles = abs(layer - ${Layer.rooftiles}.0) < 0.5 || abs(layer - ${Layer.cotto}.0) < 0.5;
    bool boards = abs(layer - ${Layer.boards}.0) < 0.5;
    if (!(plaster || stone || tiles || boards)) return;
    bool wall = abs(n.y) < 0.5;
    bool alongZ = abs(n.x) > abs(n.z);
    // Along the surface and up it (or across it, on a flat face), metres.
    vec2 q = wall ? vec2(alongZ ? p.z : p.x, p.y) : p.xz;
    // Every piece of one face of a building lies in one plane, so takes one seed.
    float plane = wall ? (alongZ ? p.x * sign(n.x) : p.z * sign(n.z)) : p.y * sign(n.y);
    float seed = ageHash(vec2(floor(plane * 2.0 + 0.5), wall ? (alongZ ? 2.0 + sign(n.x) : 5.0 + sign(n.z)) : 8.0 + sign(n.y)));
    float blotch = ageFbm(q * 0.4 + seed * 31.0);
    float fine = ageNoise(q * 3.3 + seed * 7.0);
    rough = 0.88 + 0.24 * fine;

    // Each face a shade and a hue of its own.
    float hue = fract(seed * 7.13) - 0.5;
    color *= (0.92 + 0.14 * seed) * vec3(1.0 + hue * 0.07, 1.0, 1.0 - hue * 0.1);

    if (plaster || boards) {
      // Paint bleached paler and greyer by the sun in broad patches, darker where it's newer.
      float lum = ageLum(color);
      float fade = smoothstep(0.4, 0.75, blotch) * mix(0.4, 1.0, open);
      color = mix(color, vec3(lum) * 1.1 + 0.03, fade * (boards ? 0.45 : 0.4));
      color *= 1.0 - 0.09 * smoothstep(0.45, 0.2, blotch) - 0.05 * fine;
    } else {
      // Stone and tiles stained darker in patches and bleached in others.
      color *= 0.8 + 0.3 * blotch + 0.08 * fine;
    }
    if (tiles && n.y > 0.3) {
      // Lichen on the roofs: grey-green and yellow spots, where the sun and rain reach.
      float lichen = smoothstep(0.6, 0.8, ageFbm(q * 1.7 + seed * 5.0)) * open;
      color = mix(color, vec3(ageLum(color)) * vec3(1.0, 1.0, 0.82) * (0.8 + 0.3 * fine), lichen * 0.6);
      float soot = smoothstep(0.55, 0.85, ageNoise(q * 0.25 + 3.3));
      color *= 1.0 - 0.18 * soot;
      return;
    }
    if (!wall) return;

    // Rising damp: darker and browner up to a ragged line, a tide mark at it.
    float h = p.y - groundLevel(p.xz + n.xz * 0.4, 1);
    // It climbs past the plinth's top, as high as 1.8 m in places.
    float rise = (0.5 + 1.3 * smoothstep(0.2, 0.8, ageNoise(vec2(q.x * 0.35, seed * 9.0)))) * (stone ? 0.6 : 1.0);
    // Its edge ragged.
    rise += 0.3 * (fine - 0.5);
    float damp = (1.0 - smoothstep(rise - 0.4, rise, h)) * step(-0.3, h) * mix(0.5, 1.0, open);
    float tide = exp(-pow((h - rise + 0.06) / 0.09, 2.0)) * mix(0.5, 1.0, open) * (0.5 + 0.5 * fine);
    color *= mix(vec3(1.0), vec3(0.64, 0.62, 0.52), damp * (0.6 + 0.4 * fine));
    color *= 1.0 - 0.14 * tide;
    // Dirt splashed up from the street.
    float splash = (1.0 - smoothstep(0.02, 0.2 + 0.2 * fine, h)) * step(-0.3, h) * open;
    color *= mix(vec3(1.0), vec3(0.62, 0.58, 0.52), splash * 0.75);
    // And grime over the lower storey, thinning upward.
    color *= mix(0.86 + 0.08 * blotch, 1.0, smoothstep(0.0, 3.5, h) * 0.6 + 0.4 * (1.0 - open));
    rough *= 1.0 + 0.1 * damp;

    // Streaks run down from the top of the wall's piece: under its sill,
    // its cornice or the floor above, longest where most rain runs off.
    float column = ageNoise(vec2(q.x * 6.5 + seed * 5.0, q.y * 0.2)) * 0.8 + fine * 0.2;
    float drip = smoothstep(0.5, 0.72, column) * exp(-below / (0.6 + 2.6 * ageNoise(vec2(q.x * 1.3, seed * 3.0 + 1.7))));
    streaks = (drip + 0.5 * exp(-below / 0.15)) * open;
    // Dirt, greyer than the paint it runs over.
    color = mix(color, vec3(ageLum(color)) * vec3(0.66, 0.64, 0.6), min(streaks, 1.0) * (stone ? 0.3 : 0.55));

    if (plaster) {
      // Plaster fallen away to the stone beneath, likelier low down where it's damp.
      float spalled = ageFbm(q * 0.7 + seed * 21.0) + 0.1 * ageNoise(q * 6.0) + 0.04 * fine;
      float t = 0.93 - 0.12 * damp + 0.12 * (1.0 - open);
      float bare = smoothstep(t, t + 0.012, spalled);
      vec4 under = vec4(0.0);
      vec3 underN = vec3(0.0);
      // Rubble stone, smaller than the cut stone's blocks.
      triplanar(${Layer.ashlar}.0, 1.0, p * 2.2, n, under, underN);
      // A lighter broken edge round each patch, and a shadow just inside it.
      color *= 1.0 + 0.06 * smoothstep(t - 0.03, t, spalled) * (1.0 - bare);
      color = mix(color, mix(under.rgb, vec3(ageLum(under.rgb)), 0.35) * ${STONE_TINT} * (0.88 - 0.2 * damp) * (1.0 - 0.3 * (1.0 - smoothstep(t + 0.012, t + 0.04, spalled))), bare);
      normal = mix(normal, underN, bare);
      rough = mix(rough, 1.1, bare);
    }
  }
`;

/**
 * GLSL for the town's paving: \`pavedLayer(layer, w, p, n, dx, dy, color, normal)\`
 * adds layer \`layer\` projected down at weight \`w\`, its repeat broken: the
 * ground falls into patches by a noise, each taking the texture shifted and
 * turned its own way, the darker of two winning where they meet. \`dx\` and
 * \`dy\` are how \`p.xz\` changes across the pixel, taken where every pixel runs
 * alike. Needs \`surfAlbedo\`, \`surfNormal\`, \`surfScale\`, \`surfTint\` and
 * \`surfBump\` (surfaces.ts) and AGE_GLSL.
 */
export const AGE_PAVING_GLSL = /* glsl */ `
  void agePatch(float layer, vec2 uv, vec2 gx, vec2 gy, float i, out vec4 color, out vec3 t) {
    vec2 shift = vec2(ageHash(vec2(i, layer)), ageHash(vec2(layer, i + 7.3))) * 8.0;
    float turn = floor(ageHash(vec2(i + 3.1, layer * 1.7)) * 4.0);
    mat2 r = turn < 1.0 ? mat2(1.0, 0.0, 0.0, 1.0) : turn < 2.0 ? mat2(0.0, 1.0, -1.0, 0.0) : turn < 3.0 ? mat2(-1.0, 0.0, 0.0, -1.0) : mat2(0.0, -1.0, 1.0, 0.0);
    vec2 st = r * uv + shift;
    color = textureGrad(surfAlbedo, vec3(st, layer), r * gx, r * gy);
    vec2 xy = textureGrad(surfNormal, vec3(st, layer), r * gx, r * gy).ga * 2.0 - 1.0;
    t = vec3(xy, sqrt(max(1.0 - dot(xy, xy), 0.0)));
    // Turned back to the world's way.
    t.xy = transpose(r) * t.xy * surfBump;
  }
  void pavedLayer(float layer, float w, vec3 p, vec3 n, vec2 dx, vec2 dy, inout vec4 color, inout vec3 normal) {
    if (w < 0.004) return;
    float scale = surfScale[int(layer + 0.5)];
    float k = ageNoise(p.xz * 0.06 + layer * 3.1) * 6.0;
    float i = floor(k);
    vec4 a;
    vec4 b;
    vec3 ta;
    vec3 tb;
    agePatch(layer, p.xz / scale, dx / scale, dy / scale, i, a, ta);
    agePatch(layer, p.xz / scale, dx / scale, dy / scale, i + 1.0, b, tb);
    float m = smoothstep(0.4, 0.6, fract(k) + 1.5 * (ageLum(a.rgb) - ageLum(b.rgb)));
    vec3 t = mix(ta, tb, m);
    color += w * mix(a, b, m) * vec4(surfTint[int(layer + 0.5)], 1.0);
    normal += w * vec3(t.x + n.x, abs(t.z) * n.y, t.y + n.z);
  }
  // The paving's colour varied over the town and worn by \`wear\`, 0 to 1:
  // patches darker or paler, warmer or greyer, the ways people walk darker.
  vec3 agePaving(vec3 color, vec3 p, float wear) {
    float big = ageFbm(p.xz * 0.07);
    float mid = ageNoise(p.xz * 0.6 + 11.0);
    float warm = ageNoise(p.xz * 0.11 + 5.0) - 0.5;
    color *= (0.84 + 0.3 * big) * (0.94 + 0.12 * mid) * vec3(1.0 + warm * 0.1, 1.0, 1.0 - warm * 0.12);
    return color * (1.0 - 0.16 * wear);
  }
`;
