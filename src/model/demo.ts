/**
 * The demo format: one JSON document a person, the editor or an AI can write.
 * Every box is normalized to the image (0–1, top-left origin), so a demo stays
 * valid whatever the screenshot's resolution. `parseDemo` is the only way in:
 * it validates, fills defaults and clamps every box.
 */
import { z } from "zod";

export const DEMO_VERSION = 1;

export const boxSchema = z.object({
  x: z.number().describe("Left edge, 0–1 of the image width"),
  y: z.number().describe("Top edge, 0–1 of the image height"),
  w: z.number().describe("Width, 0–1 of the image width"),
  h: z.number().describe("Height, 0–1 of the image height"),
});
export type Box = z.infer<typeof boxSchema>;

export const REDACTION_STYLES = ["blur", "pixelate", "solid"] as const;
export const ACTIONS = ["click", "type", "look"] as const;
export const PLACEMENTS = ["auto", "top", "bottom", "left", "right"] as const;

const redactionSchema = boxSchema.extend({
  style: z.enum(REDACTION_STYLES).default("blur"),
});
const textEditSchema = boxSchema.extend({
  text: z.string().describe("Text painted over the box, replacing what the screenshot shows"),
  bg: z.string().default("#ffffff"),
  color: z.string().default("#111111"),
});

export const stepSchema = z.object({
  id: z.string().default(""),
  image: z.string().describe("Key of `images` holding this step's screenshot"),
  title: z.string().default(""),
  body: z.string().default(""),
  action: z.enum(ACTIONS).default("click"),
  hotspot: boxSchema.nullable().default(null).describe("What the viewer clicks to go on"),
  placement: z.enum(PLACEMENTS).default("auto"),
  zoom: boxSchema.nullable().default(null).describe("Region the camera zooms into"),
  redactions: z.array(redactionSchema).default([]),
  highlights: z.array(boxSchema).default([]),
  textEdits: z.array(textEditSchema).default([]),
  time: z.number().nullable().default(null).describe("Seconds into the recording"),
});

export const demoSchema = z.object({
  version: z.literal(DEMO_VERSION).default(DEMO_VERSION),
  title: z.string().default("Untitled demo"),
  description: z.string().default(""),
  language: z
    .string()
    .default("en")
    .describe("ISO 639-1 code of the demo's language: its texts and the player's buttons"),
  theme: z.object({ accent: z.string().default("#6d5efc") }).default({ accent: "#6d5efc" }),
  intro: z
    .object({
      title: z.string(),
      body: z.string().default(""),
      button: z.string().default("Start"),
    })
    .nullable()
    .default(null),
  outro: z
    .object({
      title: z.string(),
      body: z.string().default(""),
      ctaLabel: z.string().default(""),
      ctaUrl: z.string().default(""),
    })
    .nullable()
    .default(null),
  steps: z.array(stepSchema).default([]),
  /** Image key → URL: a data: URL in a shared file, a blob: URL inside the app. */
  images: z.record(z.string(), z.string()).default({}),
});

export type Demo = z.infer<typeof demoSchema>;
export type Step = z.infer<typeof stepSchema>;
export type Redaction = Step["redactions"][number];
export type TextEdit = Step["textEdits"][number];
export type Action = (typeof ACTIONS)[number];
export type Placement = (typeof PLACEMENTS)[number];

const clamp01 = (v: number): number => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);

/** A box kept inside the image, with a minimum size so it stays visible and clickable. */
export function clampBox<T extends Box>(b: T, min = 0.01): T {
  const x = clamp01(b.x);
  const y = clamp01(b.y);
  const w = Math.max(min, Math.min(clamp01(b.w), 1 - x));
  const h = Math.max(min, Math.min(clamp01(b.h), 1 - y));
  return { ...b, x: Math.min(x, 1 - w), y: Math.min(y, 1 - h), w, h };
}

let counter = 0;
export function newId(prefix = "s"): string {
  counter = (counter + 1) % 1_000_000;
  return `${prefix}${Date.now().toString(36)}${counter.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

function normalizeStep(step: Step): Step {
  return {
    ...step,
    id: step.id || newId(),
    hotspot: step.hotspot ? clampBox(step.hotspot) : null,
    zoom: step.zoom ? clampBox(step.zoom, 0.05) : null,
    redactions: step.redactions.map((r) => clampBox(r)),
    highlights: step.highlights.map((b) => clampBox(b)),
    textEdits: step.textEdits.map((t) => clampBox(t)),
  };
}

export type ParseResult = { ok: true; demo: Demo } | { ok: false; error: string };

/** Validates any input (a parsed JSON value) as a demo, with defaults filled and boxes clamped. */
export function parseDemo(input: unknown): ParseResult {
  const res = demoSchema.safeParse(input);
  if (!res.success) {
    const issue = res.error.issues[0];
    const where = issue?.path.length ? `${issue.path.join(".")}: ` : "";
    return { ok: false, error: `${where}${issue?.message ?? "invalid demo"}` };
  }
  const demo = res.data;
  return { ok: true, demo: { ...demo, steps: demo.steps.map(normalizeStep) } };
}

export function emptyDemo(title = "Untitled demo"): Demo {
  const res = parseDemo({ title });
  if (!res.ok) throw new Error(res.error);
  return res.demo;
}

export function newStep(image: string, extra: Partial<Step> = {}): Step {
  const res = stepSchema.safeParse({ image, ...extra });
  if (!res.success) throw new Error(res.error.message);
  return normalizeStep(res.data);
}

/** The JSON Schema of the format, published as schema.json for people and agents. */
export function demoJsonSchema(): Record<string, unknown> {
  return z.toJSONSchema(demoSchema, { io: "input", target: "draft-2020-12" }) as Record<
    string,
    unknown
  >;
}
