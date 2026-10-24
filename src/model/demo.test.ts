import { describe, expect, it } from "bun:test";
import { clampBox, demoJsonSchema, emptyDemo, newStep, parseDemo } from "./demo";

describe("parseDemo", () => {
  it("fills every default from an almost empty object", () => {
    const res = parseDemo({ steps: [{ image: "a" }] });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.demo.title).toBe("Untitled demo");
    expect(res.demo.theme.accent).toBe("#6d5efc");
    expect(res.demo.theme.frame).toBeNull();
    const step = res.demo.steps[0];
    expect(step?.id).not.toBe("");
    expect(step?.action).toBe("click");
    expect(step?.hotspot).toBeNull();
    expect(step?.redactions).toEqual([]);
  });

  it("clamps boxes into the image", () => {
    const res = parseDemo({
      steps: [
        {
          image: "a",
          hotspot: { x: 0.95, y: -0.2, w: 0.3, h: 0.1 },
          zoom: { x: 0, y: 0, w: 0, h: 0 },
        },
      ],
    });
    if (!res.ok) throw new Error(res.error);
    const h = res.demo.steps[0]?.hotspot;
    expect(h?.x).toBeLessThanOrEqual(1 - (h?.w ?? 0));
    expect(h?.y).toBe(0);
    expect(res.demo.steps[0]?.zoom?.w).toBeGreaterThanOrEqual(0.05);
  });

  it("keeps an older theme and fills a frame's defaults", () => {
    const old = parseDemo({ theme: { accent: "#ff0000" } });
    if (!old.ok) throw new Error(old.error);
    expect(old.demo.theme).toEqual({ accent: "#ff0000", frame: null });
    const framed = parseDemo({ theme: { frame: { background: "ocean" } } });
    if (!framed.ok) throw new Error(framed.error);
    expect(framed.demo.theme.frame).toEqual({
      background: "ocean",
      padding: 0.06,
      radius: 0.012,
      shadow: true,
      window: "none",
    });
  });

  it("says where an invalid demo is wrong", () => {
    const res = parseDemo({ steps: [{ image: 3 }] });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("steps.0.image");
  });
});

describe("helpers", () => {
  it("clampBox keeps a minimum size and stays inside", () => {
    expect(clampBox({ x: 2, y: 2, w: 0, h: 0 })).toEqual({ x: 0.99, y: 0.99, w: 0.01, h: 0.01 });
  });

  it("builds empty demos and steps", () => {
    expect(emptyDemo("Hello").title).toBe("Hello");
    const s = newStep("img", { title: "Open" });
    expect(s.image).toBe("img");
    expect(s.title).toBe("Open");
  });

  it("publishes a JSON Schema of the format", () => {
    const schema = demoJsonSchema() as { properties: Record<string, unknown> };
    expect(Object.keys(schema.properties)).toEqual(
      expect.arrayContaining(["title", "steps", "images", "intro", "outro", "theme"]),
    );
  });
});
