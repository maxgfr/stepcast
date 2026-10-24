/**
 * Precise placement. A model asked to write a whole demo over many images at
 * once places its boxes loosely; asked to find a few named things on one clean
 * screenshot, it is exact. So the demo pass describes every target ("the
 * Active filter link", the text "Order the swag"), and this pass, one small
 * request per step, finds their boxes. The zoom is then rebuilt around the
 * placed hotspot.
 */
import { z } from "zod";
import { GRID, type GridBox, type RefineAnswer } from "./schema";

export interface Target {
  id: number;
  kind: "hotspot" | "zoom" | "highlight" | "redaction" | "text";
  what: string;
  /** For text: the replacement. */
  to?: string;
}

const box = z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() });
export const groundSchema = z.object({
  items: z
    .array(
      z.object({
        id: z.number().int().describe("The item's number"),
        boxes: z.array(box).describe("Every place it appears; empty when it is not visible"),
      }),
    )
    .describe("One entry per item asked for"),
});
export type GroundAnswer = z.infer<typeof groundSchema>;

/** What to look for on this step's screenshot. */
export function targetsOf(a: RefineAnswer, replacements: { from: string; to: string }[]): Target[] {
  const out: Target[] = [];
  const add = (t: Omit<Target, "id">) => out.push({ ...t, id: out.length + 1 });
  if (a.hotspot && a.target) {
    add({ kind: "hotspot", what: a.target });
    if (a.zoom)
      add({ kind: "zoom", what: `the panel, list, form or toolbar that contains ${a.target}` });
  }
  for (const h of a.highlights) if (h.what) add({ kind: "highlight", what: h.what });
  for (const r of a.redactions) if (r.what) add({ kind: "redaction", what: r.what });
  const texts = new Map<string, string>();
  for (const t of a.textEdits) if (t.original.trim()) texts.set(t.original.trim(), t.text);
  for (const r of replacements)
    if (r.from.trim() && !texts.has(r.from.trim())) texts.set(r.from.trim(), r.to);
  for (const [from, to] of texts) add({ kind: "text", what: from, to });
  return out;
}

export function groundPrompt(targets: Target[]): { instructions: string; text: string } {
  const describe = (t: Target) => {
    switch (t.kind) {
      case "hotspot":
        return `${t.id}. ${t.what} (one box: the whole clickable element)`;
      case "zoom":
        return `${t.id}. ${t.what} (one box around that whole area)`;
      case "highlight":
        return `${t.id}. ${t.what} (one box)`;
      case "redaction":
        return `${t.id}. ${t.what} (one box per occurrence, tight around the sensitive text or picture only)`;
      case "text":
        return `${t.id}. the text "${t.what}" (one box per occurrence, tight around those words only, not the whole row)`;
    }
  };
  return {
    instructions:
      "You locate elements on a screenshot of a user interface. Boxes are {x, y, w, h} on a 0–1000 scale of the image's width and height: (0,0) is the top-left corner, (1000,1000) the bottom-right, x and y the box's top-left corner. Boxes are tight. An item that is not visible gets an empty list.",
    text: `Find these items on the screenshot:\n${targets.map(describe).join("\n")}`,
  };
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * The zoom for a hotspot: the area that contains it when that area is found and
 * worth zooming into (not most of the screen), else a box about 3x the hotspot.
 * Always holds the whole hotspot with a margin, and stays inside the image.
 */
export function zoomFor(h: GridBox, area: GridBox | undefined): GridBox | null {
  if (Math.max(h.w, h.h) >= 220) return null;
  if (!area || area.w * area.h > 0.55 * GRID * GRID) return zoomAround(h);
  const m = 30;
  const x0 = Math.max(0, Math.min(area.x, h.x - m));
  const y0 = Math.max(0, Math.min(area.y, h.y - m));
  const x1 = Math.min(GRID, Math.max(area.x + area.w, h.x + h.w + m));
  const y1 = Math.min(GRID, Math.max(area.y + area.h, h.y + h.h + m));
  const box = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  return box.w * box.h > 0.55 * GRID * GRID ? null : box;
}

/** A zoom box centered on the hotspot, about 3x its size, kept inside the image. */
export function zoomAround(h: GridBox): GridBox {
  const size = clamp(Math.max(h.w, h.h) * 3.2, 320, 720);
  const x = clamp(h.x + h.w / 2 - size / 2, 0, GRID - size);
  const y = clamp(h.y + h.h / 2 - size / 2, 0, GRID - size);
  return { x, y, w: size, h: size };
}

/** The answer with every target found replaced by its placed box. */
export function applyGrounding(a: RefineAnswer, targets: Target[], g: GroundAnswer): RefineAnswer {
  const found = new Map<number, GridBox[]>();
  for (const it of g.items) {
    const boxes = it.boxes.filter((b) => b.w > 0 && b.h > 0 && b.w < GRID && b.h < GRID);
    if (boxes.length) found.set(it.id, boxes);
  }
  const of = (kind: Target["kind"]) => targets.filter((t) => t.kind === kind);
  const out: RefineAnswer = { ...a };

  const hot = of("hotspot")[0];
  const hotBox = hot ? found.get(hot.id)?.[0] : undefined;
  if (hotBox) {
    out.hotspot = hotBox;
    // A zoom only helps when the target is small; rebuild it around the real target.
    const area = of("zoom")[0];
    if (a.zoom) out.zoom = zoomFor(hotBox, area ? found.get(area.id)?.[0] : undefined);
  }
  const highs = of("highlight");
  if (highs.length) {
    out.highlights = highs.flatMap((t, i) => {
      const b = found.get(t.id)?.[0];
      const orig = a.highlights[i];
      return b ? [{ ...b, what: t.what }] : orig ? [orig] : [];
    });
  }
  const reds = of("redaction");
  if (reds.length) {
    out.redactions = reds.flatMap((t, i) => {
      const bs = found.get(t.id);
      const orig = a.redactions[i];
      return bs ? bs.map((b) => ({ ...b, what: t.what })) : orig ? [orig] : [];
    });
  }
  // Text replacements apply wherever the text was found, and only there.
  out.textEdits = of("text").flatMap((t) =>
    (found.get(t.id) ?? []).map((b) => ({ ...b, original: t.what, text: t.to ?? "" })),
  );
  return out;
}
