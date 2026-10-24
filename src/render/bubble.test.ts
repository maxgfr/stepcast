import { describe, expect, it } from "bun:test";
import { parseDemo } from "../model/demo";
import { cameraTime } from "./bubble";
import { type Tour, timeline } from "./tour";

function tourOf(input: unknown): Tour {
  const res = parseDemo(input);
  if (!res.ok) throw new Error(res.error);
  const demo = res.demo;
  return {
    demo,
    ...timeline(demo),
    images: [],
    width: 0,
    height: 0,
    framed: null,
    text: "tooltips",
  };
}

describe("cameraTime", () => {
  const tour = tourOf({
    intro: { title: "Hi" },
    steps: [
      { image: "a", time: 10 },
      { image: "a", time: 30 },
    ],
  });
  const [intro, first, second, outro] = tour.shots;

  it("follows each step's moment in the recording, minus the camera's late start", () => {
    expect(cameraTime(tour, (first?.start ?? 0) + 1, 2)).toBeCloseTo(9);
    expect(cameraTime(tour, (second?.start ?? 0) + 0.5, 2)).toBeCloseTo(28.5);
  });

  it("leads up to the first step during the intro, and goes on after the last one", () => {
    expect(cameraTime(tour, (intro?.duration ?? 0) - 1, 0)).toBeCloseTo(9);
    expect(cameraTime(tour, (outro?.start ?? 0) + 1, 0)).toBeCloseTo(
      30 + (second?.duration ?? 0) + 1,
    );
  });

  it("never asks before the file's start, and follows the film without step times", () => {
    expect(cameraTime(tour, 0, 50)).toBe(0);
    const untimed = tourOf({ steps: [{ image: "a" }] });
    expect(cameraTime(untimed, 2, 0.5)).toBeCloseTo(1.5);
  });
});
