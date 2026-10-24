/**
 * Keyframe detection on tiny grayscale copies of the screen. A keyframe is a
 * screen that differs enough from the last keyframe and has then held still for
 * a moment: a page that finished loading, a menu that opened, a dialog. Cursor
 * moves are too small to count at this resolution; scrolling and video keep the
 * screen moving, so nothing is taken until they stop.
 */
import type { Box } from "../model/demo";

/** Width of the sampled copy; its height follows the screen's aspect ratio. */
export const SAMPLE_WIDTH = 96;

export function toGray(rgba: Uint8ClampedArray, w: number, h: number): Uint8Array {
  const out = new Uint8Array(w * h);
  for (let i = 0, j = 0; j < out.length; i += 4, j++) {
    out[j] =
      ((rgba[i] as number) * 77 + (rgba[i + 1] as number) * 150 + (rgba[i + 2] as number) * 29) >>
      8;
  }
  return out;
}

export interface FrameDiff {
  /** Share of pixels that changed by more than `level`. */
  ratio: number;
  /** Bounding box of the changed pixels, normalized; null when nothing changed. */
  box: Box | null;
}

export function diffFrames(
  a: Uint8Array,
  b: Uint8Array,
  w: number,
  h: number,
  level = 28,
): FrameDiff {
  let changed = 0;
  let x0 = w;
  let y0 = h;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (Math.abs((a[i] as number) - (b[i] as number)) > level) {
        changed++;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (changed === 0) return { ratio: 0, box: null };
  return {
    ratio: changed / (w * h),
    box: { x: x0 / w, y: y0 / h, w: (x1 - x0 + 1) / w, h: (y1 - y0 + 1) / h },
  };
}

export interface DetectorOptions {
  /** Share of changed pixels, against the last keyframe, that makes a new screen. */
  threshold?: number;
  /** Share of changed pixels between two samples under which the screen is still. */
  still?: number;
  /** How long the screen must stay still, in ms. */
  stableMs?: number;
  /** Minimum time between two keyframes, in ms. */
  minGapMs?: number;
}

export class KeyframeDetector {
  private last: Uint8Array | null = null;
  private prev: Uint8Array | null = null;
  private lastTime = Number.NEGATIVE_INFINITY;
  private stableSince: number | null = null;
  private readonly opts: Required<DetectorOptions>;

  constructor(opts: DetectorOptions = {}) {
    this.opts = { threshold: 0.004, still: 0.0015, stableMs: 350, minGapMs: 600, ...opts };
  }

  /** Feeds one sample; returns the changed region when this sample is a new keyframe. */
  push(gray: Uint8Array, w: number, h: number, timeMs: number): { box: Box | null } | null {
    const prev = this.prev;
    this.prev = gray;
    if (!this.last || this.last.length !== gray.length) {
      this.last = gray;
      this.lastTime = timeMs;
      return { box: null };
    }
    const still =
      prev && prev.length === gray.length
        ? diffFrames(prev, gray, w, h).ratio <= this.opts.still
        : false;
    if (!still) {
      this.stableSince = null;
      return null;
    }
    this.stableSince ??= timeMs;
    if (
      timeMs - this.stableSince < this.opts.stableMs ||
      timeMs - this.lastTime < this.opts.minGapMs
    )
      return null;
    const d = diffFrames(this.last, gray, w, h);
    if (d.ratio < this.opts.threshold) return null;
    this.last = gray;
    this.lastTime = timeMs;
    return { box: d.box };
  }

  /** Makes the given sample the reference, after a manual snapshot. */
  mark(gray: Uint8Array, timeMs: number): void {
    this.last = gray;
    this.lastTime = timeMs;
  }
}
