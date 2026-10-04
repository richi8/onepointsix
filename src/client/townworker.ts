import { bake, type BakeInput } from './townbake.ts';

// Bakes a map town's light off the main thread (see townlight.ts).

self.onmessage = (e: MessageEvent<BakeInput>) => {
  const baked = bake(e.data);
  const buffers = Object.values(baked).map((a: Uint8Array) => a.buffer);
  (self as unknown as Worker).postMessage(baked, buffers);
};
