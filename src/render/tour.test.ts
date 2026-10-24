import { describe, expect, it } from "bun:test";
import { toWebVtt } from "llm-connect";
import { parseDemo } from "../model/demo";
import { subtitleCues, timeline } from "./tour";

function demo(input: unknown) {
  const res = parseDemo(input);
  if (!res.ok) throw new Error(res.error);
  return res.demo;
}

describe("subtitleCues", () => {
  it("times each step's text from the camera's arrival to the cut", () => {
    const d = demo({
      intro: { title: "Hi" },
      steps: [
        { image: "a", title: "Open settings", body: "Everything lives here." },
        { image: "a" },
        { image: "a", body: "Save." },
      ],
    });
    const shots = timeline(d).shots;
    const cues = subtitleCues(d);
    expect(cues.map((c) => c.text)).toEqual(["Open settings\nEverything lives here.", "Save."]);
    const first = shots[1];
    expect(cues[0]?.start).toBeCloseTo((first?.start ?? 0) + 0.8);
    expect(cues[0]?.end).toBeCloseTo((first?.start ?? 0) + (first?.duration ?? 0));
    expect(toWebVtt({ segments: cues })).toStartWith("WEBVTT\n\n00:00:03.400 --> ");
  });
});
