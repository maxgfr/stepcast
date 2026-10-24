/**
 * Keyframe detection on small grayscale copies of the screen. Two kinds of
 * keyframes, so a demo has every screen it could need:
 *
 * - after a change: the screen differs from the last keyframe and has held
 *   still for a moment (a page loaded, a menu opened, text typed);
 * - before a change: the screen as it was just before it started to move,
 *   usually with the cursor resting on what is about to be clicked.
 *
 * Scrolling and video keep the screen moving, so nothing is taken until they
 * stop; any small change left alone is taken after a couple of seconds.
 */
import type { Box } from "../model/demo";

/** Width of the sampled copy; its height follows the screen's aspect ratio. */
export const SAMPLE_WIDTH = 128;

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
  /** How long the screen must stay still before a new screen is taken, in ms. */
  stableMs?: number;
  /** How long the screen must have held before a change for the "before" frame to count, in ms. */
  beforeMs?: number;
  /** Minimum time between two keyframes, in ms. */
  minGapMs?: number;
  /** Any visible change at all is taken after this long, in ms (slow typing, a moved cursor). */
  heartbeatMs?: number;
  /**
   * While the screen keeps moving (scrolling, an animation, fast typing), a
   * frame that differs from the last keyframe is taken this often, in ms; 0 waits
   * for the screen to settle.
   */
  periodicMs?: number;
  /**
   * A keyframe this close to any keyframe already taken (share of changed
   * pixels) is a duplicate and is not taken again.
   */
  duplicate?: number;
}

export interface Keyframe {
  /** Region that changed since the previous keyframe, normalized. */
  box: Box | null;
  /**
   * The keyframe is the previous sample, not this one: the screen as it was just
   * before it started to change, usually with the cursor on what was clicked.
   */
  before: boolean;
}

export class KeyframeDetector {
  private last: Uint8Array | null = null;
  private prev: Uint8Array | null = null;
  private lastTime = Number.NEGATIVE_INFINITY;
  private stableSince: number | null = null;
  private readonly opts: Required<DetectorOptions>;

  constructor(opts: DetectorOptions = {}) {
    this.opts = {
      threshold: 0.002,
      still: 0.001,
      stableMs: 200,
      beforeMs: 300,
      minGapMs: 250,
      heartbeatMs: 2000,
      periodicMs: 1000,
      duplicate: 0.0006,
      ...opts,
    };
  }

  /** Every keyframe taken so far, to refuse duplicates (a few KB each). */
  private readonly taken: Uint8Array[] = [];
  private w = 0;
  private h = 0;
  /** Keyframes refused because an identical screen was already taken. */
  skipped = 0;

  private isDuplicate(gray: Uint8Array): boolean {
    return this.taken.some(
      (t) =>
        t.length === gray.length &&
        diffFrames(t, gray, this.w, this.h).ratio <= this.opts.duplicate,
    );
  }

  private take(
    gray: Uint8Array,
    timeMs: number,
    box: Box | null,
    before: boolean,
  ): Keyframe | null {
    this.last = gray;
    this.lastTime = timeMs;
    if (this.isDuplicate(gray)) {
      this.skipped++;
      return null;
    }
    this.taken.push(gray);
    return { box, before };
  }

  /** Feeds one sample; returns a keyframe when this sample (or the previous one) is one. */
  push(gray: Uint8Array, w: number, h: number, timeMs: number): Keyframe | null {
    const prev = this.prev;
    this.prev = gray;
    this.w = w;
    this.h = h;
    if (!this.last || this.last.length !== gray.length) return this.take(gray, timeMs, null, false);
    const comparable = prev !== null && prev.length === gray.length;
    const still = comparable && diffFrames(prev, gray, w, h).ratio <= this.opts.still;
    const o = this.opts;

    if (!still) {
      // The screen starts to change: keep how it looked just before, if it held a
      // moment and differs from the last keyframe at all (often only the cursor moved).
      const held = this.stableSince !== null && timeMs - this.stableSince >= o.beforeMs;
      this.stableSince = null;
      if (held && comparable && timeMs - this.lastTime >= o.minGapMs) {
        const d = diffFrames(this.last, prev, w, h);
        if (d.ratio > 0) return this.take(prev, timeMs, d.box, true);
      }
      if (o.periodicMs > 0 && timeMs - this.lastTime >= o.periodicMs) {
        const d = diffFrames(this.last, gray, w, h);
        if (d.ratio >= o.threshold) return this.take(gray, timeMs, d.box, false);
      }
      return null;
    }

    this.stableSince ??= timeMs;
    if (timeMs - this.stableSince < o.stableMs || timeMs - this.lastTime < o.minGapMs) return null;
    const d = diffFrames(this.last, gray, w, h);
    if (d.ratio >= o.threshold || (d.ratio > 0 && timeMs - this.lastTime >= o.heartbeatMs)) {
      return this.take(gray, timeMs, d.box, false);
    }
    return null;
  }

  /** Makes the given sample the reference, after a manual snapshot. */
  mark(gray: Uint8Array, timeMs: number): void {
    this.last = gray;
    this.lastTime = timeMs;
    if (!this.isDuplicate(gray)) this.taken.push(gray);
  }
}
