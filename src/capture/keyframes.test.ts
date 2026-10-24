import { describe, expect, it } from "bun:test";
import { diffFrames, KeyframeDetector, toGray } from "./keyframes";

const W = 128;
const H = 72;
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
  const a = frame(200);
  const b = frame(200, { x: 0, y: 0, w: W / 2, h: H, v: 30 });

  it("takes the first frame, then a new screen once it holds still", () => {
    const d = new KeyframeDetector();
    expect(d.push(a, W, H, 0)).toEqual({ box: null, before: false });
    expect(d.push(a, W, H, 200)).toBeNull();
    // The screen changes: nothing until it has been still for a moment.
    expect(d.push(b, W, H, 400)).toBeNull();
    expect(d.push(b, W, H, 600)).toBeNull();
    const hit = d.push(b, W, H, 800);
    expect(hit?.before).toBe(false);
    expect(hit?.box?.w).toBeCloseTo(0.5);
    // Same screen again: no new keyframe.
    expect(d.push(b, W, H, 1000)).toBeNull();
    expect(d.push(b, W, H, 5000)).toBeNull();
  });

  it("keeps the screen as it was just before a change (the cursor on the target)", () => {
    const d = new KeyframeDetector();
    const cursor = frame(200, { x: 30, y: 20, w: 2, h: 3, v: 0 }); // a cursor moved in: tiny change
    d.push(a, W, H, 0);
    d.push(cursor, W, H, 200);
    expect(d.push(cursor, W, H, 400)).toBeNull(); // too small for a new screen
    expect(d.push(cursor, W, H, 600)).toBeNull();
    const before = d.push(b, W, H, 800); // the click: the screen starts to change
    expect(before?.before).toBe(true);
    expect(before?.box?.x).toBeCloseTo(30 / W);
    // Then the new screen once it settles.
    d.push(b, W, H, 1000);
    expect(d.push(b, W, H, 1200)?.before).toBe(false);
  });

  it("takes small changes left alone after a while (slow typing)", () => {
    const d = new KeyframeDetector();
    const typed = frame(200, { x: 10, y: 10, w: 3, h: 2, v: 0 });
    d.push(a, W, H, 0);
    let hit = null;
    for (let t = 200; t <= 2400 && !hit; t += 200) hit = d.push(typed, W, H, t);
    expect(hit?.before).toBe(false);
  });

  it("waits while the screen keeps moving (scrolling, video), when periodic frames are off", () => {
    const d = new KeyframeDetector({ periodicMs: 0 });
    d.push(frame(0), W, H, 0);
    for (let t = 1; t < 20; t++) {
      expect(d.push(frame(t % 2 ? 200 : 100), W, H, t * 200)).toBeNull();
    }
  });
});

describe("KeyframeDetector, periodic", () => {
  it("takes a frame every second while the screen keeps moving, unless turned off", () => {
    // A page scrolling: a dark band moving down, every sample different.
    const moving = (t: number) => frame(200, { x: 0, y: (t * 3) % (H - 8), w: W, h: 8, v: 20 });
    const on = new KeyframeDetector();
    const off = new KeyframeDetector({ periodicMs: 0 });
    let hitsOn = 0;
    let hitsOff = 0;
    for (let t = 0; t <= 5000; t += 200) {
      if (on.push(moving(t / 200), W, H, t)) hitsOn++;
      if (off.push(moving(t / 200), W, H, t)) hitsOff++;
    }
    expect(hitsOff).toBe(1); // only the first frame
    expect(hitsOn).toBeGreaterThanOrEqual(5);
  });
});

describe("KeyframeDetector, duplicates", () => {
  it("never takes the same screen twice, even after going back to it", () => {
    const d = new KeyframeDetector({ periodicMs: 0 });
    const home = frame(200);
    const page = frame(200, { x: 0, y: 0, w: W / 2, h: H, v: 30 });
    const shots: number[] = [];
    const seq = [
      home,
      home,
      home,
      page,
      page,
      page,
      page,
      home,
      home,
      home,
      home,
      page,
      page,
      page,
      page,
    ];
    seq.forEach((f, i) => {
      if (d.push(f, W, H, i * 400)) shots.push(i);
    });
    expect(shots).toHaveLength(2); // home, then page; going back and forth adds nothing
    expect(d.skipped).toBeGreaterThanOrEqual(2);
  });
});
