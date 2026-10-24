import { describe, expect, it } from "bun:test";
import { toTranscript } from "llm-connect";
import type { Narration } from "../model/store";
import { gatherSaid, saidPerFrame } from "./narration";

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
