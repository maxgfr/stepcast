import { describe, expect, it } from "bun:test";
import { toTranscript } from "llm-connect";
import { newStep, parseDemo } from "../model/demo";
import type { Narration } from "../model/store";
import { timeline } from "../render/tour";
import { gatherSaid, saidPerFrame, withVoices } from "./narration";

const w = (text: string, start: number, end: number) => ({ text, start, end });

/** A narration started 2 s into the recording: its file's t is the recording's t + 2. */
const narration: Narration = {
  key: "narration",
  offset: 2,
  duration: 20,
  transcript: toTranscript({
    pieces: [
      w("Open", 0, 0.4),
      w("settings.", 0.4, 1),
      w("Now", 5, 5.3),
      w("save.", 5.3, 6),
      w("Done.", 12, 12.5),
    ],
  }),
};

describe("saidPerFrame", () => {
  it("gives each frame what was said since the previous one, the last one the rest", () => {
    // On the recording's clock the words are at 2, 2.4, 7, 7.3 and 14.
    expect(saidPerFrame(narration, [3, 8, 10])).toEqual(["Open settings.", "Now save.", "Done."]);
    expect(saidPerFrame({ ...narration, transcript: null }, [3])).toEqual([""]);
  });
});

describe("withVoices", () => {
  const steps = [newStep("a", { time: 3 }), newStep("b", { time: 8 }), newStep("c")];

  it("cuts the words spoken over each step, in seconds into the file", () => {
    const [a, b, c] = withVoices(steps, narration);
    expect(a?.voice).toEqual({ start: 0, end: 1.2 });
    expect(b?.voice?.start).toBeCloseTo(4.9);
    expect(b?.voice?.end).toBeCloseTo(12.7);
    expect(c?.voice).toBeNull();
  });

  it("cuts the file by time when there is no transcript", () => {
    const [a, b] = withVoices(steps, { ...narration, transcript: null });
    expect(a?.voice).toEqual({ start: 0, end: 2.5 });
    expect(b?.voice).toEqual({ start: 2.5, end: 20 });
  });

  it("leaves steps alone without a narration", () => {
    expect(withVoices(steps, null)).toBe(steps);
  });
});

describe("gatherSaid", () => {
  it("hands what was said over skipped frames to the next chosen one", () => {
    const f = (said: string) => ({
      asset: said,
      url: "",
      time: 0,
      pinned: false,
      diff: null,
      ...(said ? { said } : {}),
    });
    const all = [f("one"), f("two"), f("three"), f("four")];
    const chosen = gatherSaid(all, [all[2], all[0]] as typeof all);
    expect(chosen.map((x) => x.said)).toEqual(["two three four", "one"]);
  });
});

describe("timeline with a voice", () => {
  it("makes a shot last as long as its part of the narration", () => {
    const res = parseDemo({
      narration: "v",
      steps: [{ image: "a", voice: { start: 0, end: 12 } }, { image: "a" }],
    });
    if (!res.ok) throw new Error(res.error);
    const [voiced, plain] = timeline(res.demo).shots;
    expect(voiced?.duration).toBeGreaterThan(12);
    expect(plain?.duration).toBeLessThan(5);
    expect(timeline(res.demo, false).shots[0]?.duration).toBeLessThan(5);
  });
});
