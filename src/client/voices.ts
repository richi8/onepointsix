// A fixed set of voices that sounds out in the world take turns on, so a
// heavy fight reuses the same few audio nodes instead of making new ones.

export class VoicePool<V> {
  private readonly voices: V[];
  /** When each voice falls silent, in the audio clock's seconds. */
  private readonly until: number[];
  /** How loud each voice's sound is, to cut off the quietest when all are busy. */
  private readonly level: number[];

  constructor(voices: V[]) {
    this.voices = voices;
    this.until = voices.map(() => -Infinity);
    this.level = voices.map(() => 0);
  }

  /**
   * A voice for a sound at `level` from `now` until `end`: a free one if there
   * is one, otherwise the quietest, cutting off what it was playing. Null
   * when every voice is playing something louder.
   */
  take(now: number, end: number, level: number): { voice: V; stolen: boolean } | null {
    let pick = -1;
    for (let i = 0; i < this.voices.length; i++) {
      if (this.until[i] <= now) {
        pick = i;
        break;
      }
      if (pick < 0 || this.level[i] < this.level[pick]) pick = i;
    }
    const stolen = this.until[pick] > now;
    if (stolen && this.level[pick] >= level) return null;
    this.until[pick] = end;
    this.level[pick] = level;
    return { voice: this.voices[pick], stolen };
  }

  /** How many voices are still sounding at `now`. */
  busy(now: number): number {
    return this.until.filter((t) => t > now).length;
  }
}
