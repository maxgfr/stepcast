import { describe, expect, it } from "bun:test";
import { newStep } from "../model/demo";
import { DEFAULT_BRIEF, demoInstructions, pastePrompt, pickPrompt } from "./prompts";
import { sampleFrames } from "./run";
import {
  applyFields,
  extractJson,
  fromGrid,
  parseDemoAnswer,
  stepsFromAnswer,
  stepToAnswer,
  toGrid,
} from "./schema";

const answer = {
  title: "Create an invoice",
  description: "From draft to sent.",
  intro: { title: "Invoices in a minute", body: "See how." },
  outro: { title: "Done", body: "That's it.", ctaLabel: "Try it" },
  steps: [
    {
      image: 2,
      title: "Open invoices",
      body: "Everything starts here.",
      action: "click",
      hotspot: { x: 100, y: 50, w: 80, h: 40 },
      placement: "auto",
      zoom: { x: 0, y: 0, w: 1000, h: 1000 },
      highlights: [],
      redactions: [{ x: 700, y: 20, w: 200, h: 30, what: "email" }],
      textEdits: [{ x: 10, y: 10, w: 100, h: 20, text: "Acme" }],
    },
    {
      image: 9,
      title: "Ghost",
      body: "",
      action: "look",
      hotspot: null,
      placement: "auto",
      zoom: null,
      highlights: [],
      redactions: [],
      textEdits: [],
    },
  ],
};

describe("answers", () => {
  it("maps grid boxes to normalized boxes and back", () => {
    expect(fromGrid({ x: 100, y: 200, w: 300, h: 400 })).toEqual({
      x: 0.1,
      y: 0.2,
      w: 0.3,
      h: 0.4,
    });
    expect(toGrid({ x: 0.1, y: 0.2, w: 0.3, h: 0.4 })).toEqual({ x: 100, y: 200, w: 300, h: 400 });
  });

  it("turns an answer into steps on the right screenshots", () => {
    const steps = stepsFromAnswer(answer as never, [
      { asset: "a1", time: 1 },
      { asset: "a2", time: 2 },
    ]);
    expect(steps).toHaveLength(1); // image 9 does not exist
    const s = steps[0];
    expect(s?.image).toBe("a2");
    expect(s?.hotspot).toEqual({ x: 0.1, y: 0.05, w: 0.08, h: 0.04 });
    expect(s?.zoom).toBeNull(); // a full-screen zoom is no zoom
    expect(s?.redactions[0]?.style).toBe("blur");
    expect(s?.textEdits[0]?.text).toBe("Acme");
  });

  it("round-trips a step through the refine format", () => {
    const step = applyFields(
      newStep("x"),
      stepToAnswer(applyFields(newStep("x"), answer.steps[0] as never)),
    );
    expect(step.title).toBe("Open invoices");
    expect(step.hotspot).toEqual({ x: 0.1, y: 0.05, w: 0.08, h: 0.04 });
  });

  it("reads JSON pasted from a chat app, fences and missing fields included", () => {
    const pasted = `Sure! Here it is:\n\`\`\`json\n${JSON.stringify({ title: "T", steps: [{ image: 1, title: "Go" }] })}\n\`\`\`\nEnjoy.`;
    const a = parseDemoAnswer(pasted);
    expect(a.title).toBe("T");
    expect(a.steps[0]?.redactions).toEqual([]);
    expect(a.steps[0]?.hotspot).toBeNull();
    expect(() => parseDemoAnswer("no json here")).toThrow("No JSON");
    expect(() => extractJson("{ broken")).toThrow();
  });
});

describe("prompts", () => {
  it("carries the brief and the rules", () => {
    const b = {
      ...DEFAULT_BRIEF,
      goal: "Show billing",
      language: "French",
      edits: "Globex → Acme",
    };
    const text = demoInstructions(b);
    expect(text).toContain("0–1000 grid");
    expect(text).toContain("Globex → Acme");
    expect(pickPrompt(b, 20, [{ time: 1, pinned: true, diff: null }]).text).toContain(
      "pinned frames 1",
    );
    const paste = pastePrompt(b, [
      { time: 3, pinned: false, diff: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 } },
    ]);
    expect(paste).toContain("Write every title and text in French");
    expect(paste).toContain('"steps"');
  });

  it("samples frames evenly and keeps pinned ones", () => {
    const frames = Array.from({ length: 100 }, (_, i) => ({ i, pinned: i === 97 }));
    const s = sampleFrames(frames, 10);
    expect(s).toHaveLength(10);
    expect(s.some((f) => f.i === 97)).toBe(true);
    expect(s.map((f) => f.i)).toEqual([...s.map((f) => f.i)].sort((a, b) => a - b));
  });
});
