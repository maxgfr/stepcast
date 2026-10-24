import { describe, expect, it } from "bun:test";
import { FULL_VIEW, lerpView, mapBox, mapPoint, viewFor } from "./camera";

describe("camera", () => {
  it("shows the whole image without a zoom", () => {
    expect(viewFor(null)).toEqual(FULL_VIEW);
    expect(mapPoint({ x: 0.3, y: 0.7 }, FULL_VIEW)).toEqual({ x: 0.3, y: 0.7 });
  });

  it("fits the zoom box and centers it", () => {
    const v = viewFor({ x: 0.4, y: 0.4, w: 0.2, h: 0.1 });
    expect(v.s).toBe(4); // capped
    const m = mapBox({ x: 0.45, y: 0.425, w: 0.1, h: 0.05 }, v);
    expect(m.x + m.w / 2).toBeCloseTo(0.5);
    expect(m.y + m.h / 2).toBeCloseTo(0.5);
  });

  it("never leaves the image near an edge", () => {
    const v = viewFor({ x: 0.9, y: 0.9, w: 0.1, h: 0.1 }, 2);
    expect(v.cx).toBeCloseTo(0.75);
    expect(mapPoint({ x: 1, y: 1 }, v)).toEqual({ x: 1, y: 1 });
  });

  it("interpolates from one view to another", () => {
    const b = viewFor({ x: 0, y: 0, w: 0.5, h: 0.5 });
    expect(lerpView(FULL_VIEW, b, 0)).toEqual(FULL_VIEW);
    expect(lerpView(FULL_VIEW, b, 1).s).toBeCloseTo(2);
  });
});
