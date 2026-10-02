// One wind for everything that sways: tree crowns, grass and bushes. Its
// shaders share the `windTime` uniform, advanced once a frame, and
// `windStrength`, which the weather sets.

/** Seconds of wind so far, as a shader uniform. */
export const wind = { value: 0 };
/** How hard it blows, as a multiple of a clear day's, as a shader uniform. */
export const windStrength = { value: 1 };

/** How far the wind pushes something at full sway, at world position `base`, in metres per metre of give. */
export const WIND_GLSL = /* glsl */ `
  uniform float windTime;
  uniform float windStrength;
  vec3 windPush(vec3 base, float t) {
    // Gusts roll across the island from the south-west, with a quicker flutter on top.
    float phase = dot(base.xz, vec2(0.045, 0.03));
    float gust = sin(t * 0.9 - phase) * 0.5 + 0.5;
    float flutter = sin(t * 2.7 - phase * 3.1 + base.x * 0.2) * 0.3;
    return vec3(0.8, 0.0, 0.6) * (0.35 + gust * 0.65 + flutter) * windStrength;
  }
`;
