// Packing plain numbers into bytes and back, for replay files: whole numbers
// as variable-length integers (small ones take a byte), and fractions as
// 64-bit floats, so they come back exactly.

/** Appends numbers and text to a growing buffer. */
export class ByteWriter {
  private buf = new Uint8Array(1024);
  private view = new DataView(this.buf.buffer);
  private n = 0;

  private room(bytes: number): void {
    if (this.n + bytes <= this.buf.length) return;
    let size = this.buf.length * 2;
    while (size < this.n + bytes) size *= 2;
    const next = new Uint8Array(size);
    next.set(this.buf.subarray(0, this.n));
    this.buf = next;
    this.view = new DataView(next.buffer);
  }

  /** A whole number, zero or more, of up to 2^53. */
  uint(v: number): void {
    if (!Number.isSafeInteger(v) || v < 0) throw new RangeError(`Not a whole number: ${v}`);
    this.room(8);
    while (v >= 0x80) {
      this.buf[this.n++] = (v % 0x80) | 0x80;
      v = Math.floor(v / 0x80);
    }
    this.buf[this.n++] = v;
  }

  /** A whole number of either sign, small ones of either sign taking a byte. */
  int(v: number): void {
    this.uint(v < 0 ? -2 * v - 1 : 2 * v);
  }

  float(v: number): void {
    this.room(8);
    this.view.setFloat64(this.n, v, true);
    this.n += 8;
  }

  ints(values: readonly number[]): void {
    this.uint(values.length);
    for (const v of values) this.int(v);
  }

  floats(values: readonly number[]): void {
    this.uint(values.length);
    for (const v of values) this.float(v);
  }

  text(s: string): void {
    const bytes = new TextEncoder().encode(s);
    this.uint(bytes.length);
    this.bytes(bytes);
  }

  bytes(b: Uint8Array): void {
    this.room(b.length);
    this.buf.set(b, this.n);
    this.n += b.length;
  }

  data(): Uint8Array<ArrayBuffer> {
    return this.buf.slice(0, this.n);
  }
}

/** Reads back what a ByteWriter wrote, in the same order; throws past the end. */
export class ByteReader {
  private readonly buf: Uint8Array;
  private readonly view: DataView;
  private at = 0;

  constructor(buf: Uint8Array) {
    this.buf = buf;
    this.view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  }

  get done(): boolean {
    return this.at >= this.buf.length;
  }

  uint(): number {
    let v = 0;
    let scale = 1;
    for (;;) {
      if (this.at >= this.buf.length) throw new RangeError('Past the end');
      const b = this.buf[this.at++];
      v += (b & 0x7f) * scale;
      if (b < 0x80) return v;
      scale *= 0x80;
    }
  }

  int(): number {
    const u = this.uint();
    return u % 2 ? -(u + 1) / 2 : u / 2;
  }

  float(): number {
    if (this.at + 8 > this.buf.length) throw new RangeError('Past the end');
    const v = this.view.getFloat64(this.at, true);
    this.at += 8;
    return v;
  }

  ints(): number[] {
    const n = this.uint();
    const out = new Array<number>(n);
    for (let i = 0; i < n; i++) out[i] = this.int();
    return out;
  }

  floats(): number[] {
    const n = this.uint();
    const out = new Array<number>(n);
    for (let i = 0; i < n; i++) out[i] = this.float();
    return out;
  }

  text(): string {
    return new TextDecoder().decode(this.bytes(this.uint()));
  }

  bytes(n: number): Uint8Array {
    if (this.at + n > this.buf.length) throw new RangeError('Past the end');
    const out = this.buf.subarray(this.at, this.at + n);
    this.at += n;
    return out;
  }
}
