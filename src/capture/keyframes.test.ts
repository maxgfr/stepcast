import { describe, expect, it } from "bun:test";
import { diffFrames, KeyframeDetector, toGray } from "./keyframes";

const W = 96;
const H = 54;
function frame(
  fill: number,
  rect?: { x: number; y: number; w: number; h: number; v: number },
): Uint8Array {
  const f = new Uint8Array(W * H).fill(fill);
  if (rect)
    for (let y = rect.y; y < rect.y + rect.h; y++)
      for (let x = rect.x; x < rect.x + rect.w; x++) f[y * W + x] = rect.v;
  return f;
}

describe("diffFrames", () => {
  it("finds the changed region", () => {
    const d = diffFrames(frame(200), frame(200, { x: 10, y: 5, w: 20, h: 10, v: 20 }), W, H);
    expect(d.ratio).toBeCloseTo(200 / (W * H));
    expect(d.box?.x).toBeCloseTo(10 / W);
    expect(d.box?.w).toBeCloseTo(20 / W);
  });

  it("ignores small brightness noise", () => {
    expect(diffFrames(frame(200), frame(210), W, H).ratio).toBe(0);
  });

  it("converts RGBA to gray", () => {
    expect([...toGray(new Uint8ClampedArray([255, 255, 255, 255, 0, 0, 0, 255]), 2, 1)]).toEqual([
      255, 0,
    ]);
  });
});

describe("KeyframeDetector", () => {
  it("takes the first frame, then a new screen once it holds still", () => {
    const d = new KeyframeDetector();
    const a = frame(200);
    const b = frame(200, { x: 0, y: 0, w: 48, h: 54, v: 30 });
    expect(d.push(a, W, H, 0)).toEqual({ box: null });
    expect(d.push(a, W, H, 250)).toBeNull();
    expect(d.push(a, W, H, 500)).toBeNull();
    // The screen changes: nothing until it has been still for a moment.
    expect(d.push(b, W, H, 1000)).toBeNull();
    expect(d.push(b, W, H, 1250)).toBeNull();
    const hit = d.push(b, W, H, 1750);
    expect(hit?.box?.w).toBeCloseTo(0.5);
    // Same screen again: no new keyframe.
    expect(d.push(b, W, H, 2500)).toBeNull();
  });

  it("waits while the screen keeps moving (scrolling, video)", () => {
    const d = new KeyframeDetector();
    d.push(frame(0), W, H, 0);
    for (let t = 1; t < 20; t++) {
      expect(d.push(frame(t % 2 ? 200 : 100), W, H, t * 250)).toBeNull();
    }
  });
});
