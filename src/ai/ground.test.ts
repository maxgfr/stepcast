import { describe, expect, it } from "bun:test";
import { applyGrounding, groundPrompt, targetsOf, zoomAround } from "./ground";
import type { RefineAnswer } from "./schema";

const step: RefineAnswer = {
  title: "Filter active tasks",
  body: "See what is left.",
  action: "click",
  target: "the 'Active' filter link under the list",
  hotspot: { x: 460, y: 410, w: 40, h: 20 }, // loosely placed by the demo pass
  placement: "auto",
  zoom: { x: 300, y: 300, w: 400, h: 400 },
  highlights: [],
  redactions: [{ x: 0, y: 0, w: 100, h: 20, what: "the email in the header" }],
  textEdits: [],
};

describe("placement", () => {
  it("asks for the hotspot, the blurs and every text to replace", () => {
    const t = targetsOf(step, [{ from: "Order the swag", to: "Order the t-shirts" }]);
    expect(t.map((x) => x.kind)).toEqual(["hotspot", "zoom", "redaction", "text"]);
    const p = groundPrompt(t);
    expect(p.text).toContain("1. the 'Active' filter link");
    expect(p.text).toContain('4. the text "Order the swag"');
  });

  it("uses the placed boxes, rebuilds the zoom and adds every text occurrence", () => {
    const t = targetsOf(step, [{ from: "Order the swag", to: "Order the t-shirts" }]);
    const out = applyGrounding(step, t, {
      items: [
        { id: 1, boxes: [{ x: 468, y: 482, w: 26, h: 22 }] },
        { id: 2, boxes: [{ x: 300, y: 300, w: 400, h: 250 }] },
        { id: 3, boxes: [] },
        {
          id: 4,
          boxes: [
            { x: 350, y: 250, w: 120, h: 30 },
            { x: 350, y: 600, w: 120, h: 30 },
          ],
        },
      ],
    });
    expect(out.hotspot).toEqual({ x: 468, y: 482, w: 26, h: 22 });
    expect(out.zoom).toEqual({ x: 300, y: 300, w: 400, h: 250 }); // the list that holds the link
    expect(out.redactions).toEqual(step.redactions); // not found: kept as the demo pass gave it
    expect(out.textEdits).toHaveLength(2);
    expect(out.textEdits[0]?.text).toBe("Order the t-shirts");
  });

  it("drops the zoom when the target is large", () => {
    const t = targetsOf(step, []);
    const out = applyGrounding(step, t, {
      items: [{ id: 1, boxes: [{ x: 100, y: 100, w: 600, h: 300 }] }],
    });
    expect(out.zoom).toBeNull();
  });

  it("zooms around the hotspot when its area is not found", () => {
    const t = targetsOf(step, []);
    const out = applyGrounding(step, t, {
      items: [{ id: 1, boxes: [{ x: 468, y: 482, w: 26, h: 22 }] }],
    });
    const z = out.zoom;
    expect(z && z.x + z.w / 2).toBeCloseTo(481);
  });

  it("keeps zoom boxes inside the image", () => {
    const z = zoomAround({ x: 980, y: 5, w: 15, h: 10 });
    expect(z.x + z.w).toBeLessThanOrEqual(1000);
    expect(z.y).toBeGreaterThanOrEqual(0);
  });
});
