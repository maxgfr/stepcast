/**
 * What the model answers, and how an answer becomes demo steps. Models place
 * boxes on a 0–1000 grid drawn over each image (more reliable than fractions,
 * and independent of the screenshot's resolution); `fromGrid` turns them into
 * the demo's 0–1 boxes. Every field is required and nullable rather than
 * optional, which strict structured-output modes ask for.
 */
import { z } from "zod";
import { ACTIONS, type Box, clampBox, newStep, PLACEMENTS, type Step } from "../model/demo";

export const GRID = 1000;

const gridBox = z.object({
  x: z.number().describe("Left edge on the 0–1000 grid"),
  y: z.number().describe("Top edge on the 0–1000 grid"),
  w: z.number().describe("Width on the 0–1000 grid"),
  h: z.number().describe("Height on the 0–1000 grid"),
});
export type GridBox = z.infer<typeof gridBox>;

export const pickSchema = z.object({
  frames: z
    .array(
      z.object({
        frame: z.number().int().describe("The number shown on the tile"),
        reason: z.string().describe("Why this screen matters, in a few words"),
      }),
    )
    .describe("Chosen frames, in the order the story is told"),
});
export type PickAnswer = z.infer<typeof pickSchema>;

const stepFields = {
  title: z.string().describe("At most 6 words, imperative"),
  body: z.string().describe("One or two sentences, at most 30 words"),
  action: z.enum(ACTIONS),
  target: z
    .string()
    .nullable()
    .describe(
      "The element to interact with, precisely, e.g. 'the Active filter link below the list'; null to just look",
    ),
  hotspot: gridBox.nullable().describe("Tight box around that element; null to just look"),
  placement: z.enum(PLACEMENTS),
  zoom: gridBox
    .nullable()
    .describe("Region to zoom into when the hotspot is small; null otherwise"),
  highlights: z
    .array(gridBox.extend({ what: z.string().describe("What the region shows") }))
    .describe("0–2 regions worth spotlighting"),
  redactions: z
    .array(gridBox.extend({ what: z.string().describe("What is hidden, e.g. 'email address'") }))
    .describe("Personal or secret data to blur"),
  textEdits: z
    .array(
      gridBox.extend({
        original: z.string().describe("The exact text shown on screen now"),
        text: z.string().describe("Replacement text"),
      }),
    )
    .describe("Text to replace on screen, only when the brief asks for it"),
};

export const refineSchema = z.object(stepFields);
export type RefineAnswer = z.infer<typeof refineSchema>;

export const aiStepSchema = z.object({
  image: z.number().int().describe("The image number this step shows (Image N)"),
  ...stepFields,
});
export type AiStep = z.infer<typeof aiStepSchema>;

export const demoAnswerSchema = z.object({
  title: z.string().describe("Title of the demo"),
  description: z.string().describe("One sentence on what the demo shows"),
  intro: z.object({ title: z.string(), body: z.string() }),
  outro: z.object({ title: z.string(), body: z.string(), ctaLabel: z.string() }),
  steps: z.array(aiStepSchema),
});
export type DemoAnswer = z.infer<typeof demoAnswerSchema>;

export function fromGrid(b: GridBox): Box {
  return clampBox({ x: b.x / GRID, y: b.y / GRID, w: b.w / GRID, h: b.h / GRID });
}

export function toGrid(b: Box): GridBox {
  return {
    x: Math.round(b.x * GRID),
    y: Math.round(b.y * GRID),
    w: Math.round(b.w * GRID),
    h: Math.round(b.h * GRID),
  };
}

/** A box that is mostly the whole screen is no zoom at all. */
function usefulZoom(b: Box | null): Box | null {
  return b && b.w * b.h < 0.7 ? clampBox(b, 0.05) : null;
}

/** Applies an answer's fields to a step (new or existing). */
export function applyFields(step: Step, a: RefineAnswer): Step {
  return {
    ...step,
    title: a.title.trim(),
    body: a.body.trim(),
    action: a.action,
    placement: a.placement,
    hotspot: a.hotspot ? fromGrid(a.hotspot) : null,
    zoom: usefulZoom(a.zoom ? fromGrid(a.zoom) : null),
    highlights: a.highlights.slice(0, 3).map((b) => fromGrid(b)),
    redactions: a.redactions.map((r) => ({ ...fromGrid(r), style: "blur" as const })),
    textEdits: a.textEdits.map((t) => ({
      ...fromGrid(t),
      text: t.text,
      bg: "#ffffff",
      color: "#111111",
    })),
  };
}

/**
 * Steps from a demo answer. `images[n - 1]` is what "Image n" was; steps that
 * point at an image the model was not shown are dropped.
 */
export function stepsFromAnswer(
  answer: Pick<DemoAnswer, "steps">,
  images: { asset: string; time: number | null }[],
): Step[] {
  const out: Step[] = [];
  for (const s of answer.steps) {
    const img = images[s.image - 1];
    if (!img) continue;
    out.push(applyFields(newStep(img.asset, { time: img.time }), s));
  }
  return out;
}

/** The step as the model sees it when asked to refine it. */
export function stepToAnswer(step: Step): RefineAnswer {
  return {
    title: step.title,
    body: step.body,
    action: step.action,
    placement: step.placement,
    target: step.hotspot ? step.title || "the highlighted element" : null,
    hotspot: step.hotspot ? toGrid(step.hotspot) : null,
    zoom: step.zoom ? toGrid(step.zoom) : null,
    highlights: step.highlights.map((b) => ({ ...toGrid(b), what: "highlighted region" })),
    redactions: step.redactions.map((r) => ({ ...toGrid(r), what: "hidden" })),
    textEdits: step.textEdits.map((t) => ({ ...toGrid(t), original: "", text: t.text })),
  };
}

/** Finds the JSON object in a pasted answer (code fences, prose around it). */
export function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = (fenced?.[1] ?? text).trim();
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("No JSON object found in the answer.");
  return JSON.parse(body.slice(start, end + 1));
}

/** Pasted answers from a chat app often leave out empty fields; fill them before validating. */
function fillDefaults(raw: unknown): unknown {
  if (!raw || typeof raw !== "object") return raw;
  const r = raw as Record<string, unknown>;
  const steps = Array.isArray(r.steps) ? r.steps : [];
  return {
    title: "Untitled demo",
    description: "",
    ...r,
    intro: { title: "", body: "", ...(r.intro as object) },
    outro: { title: "", body: "", ctaLabel: "", ...(r.outro as object) },
    steps: steps.map((s: Record<string, unknown>) => ({
      title: "",
      body: "",
      action: "click",
      placement: "auto",
      target: null,
      hotspot: null,
      zoom: null,
      highlights: [],
      redactions: [],
      textEdits: [],
      ...s,
    })),
  };
}

export function parseDemoAnswer(text: string): DemoAnswer {
  let raw: unknown;
  try {
    raw = extractJson(text);
  } catch (err) {
    throw new Error(
      err instanceof SyntaxError
        ? `The answer is not valid JSON: ${err.message}`
        : (err as Error).message,
    );
  }
  const res = demoAnswerSchema.safeParse(fillDefaults(raw));
  if (!res.success) {
    const issue = res.error.issues[0];
    throw new Error(
      `The answer does not match the format (${issue?.path.join(".") || "root"}: ${issue?.message}).`,
    );
  }
  return res.data;
}
