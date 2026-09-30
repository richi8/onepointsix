import * as THREE from 'three';

// Pictures drawn on a canvas for alpha-tested cards: leaves, needles and blades.

/**
 * The canvas as a texture whose see-through pixels carry the leaves' average
 * colour instead of black. A canvas can't keep a colour where it's fully
 * transparent, and smaller mips averaged that black into the leaves, which
 * turned distant bushes a dark, sky-lit blue-grey.
 */
export function filled(canvas: HTMLCanvasElement): THREE.Texture {
  const { width: w, height: h } = canvas;
  const src = canvas.getContext('2d')!.getImageData(0, 0, w, h).data;
  const sum = [0, 0, 0];
  let n = 0;
  for (let i = 0; i < src.length; i += 4) {
    if (src[i + 3] < 128) continue;
    for (let k = 0; k < 3; k++) sum[k] += src[i + k];
    n++;
  }
  const data = new Uint8Array(w * h * 4);
  // Rows bottom to top, as a canvas texture would be flipped.
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = ((h - 1 - y) * w + x) * 4;
      const o = (y * w + x) * 4;
      const clear = src[i + 3] === 0;
      for (let k = 0; k < 3; k++) data[o + k] = clear ? Math.round(sum[k] / Math.max(n, 1)) : src[i + k];
      data[o + 3] = src[i + 3];
    }
  }
  const tex = new THREE.DataTexture(data, w, h);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}
