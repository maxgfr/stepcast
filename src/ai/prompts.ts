/**
 * The words sent to the model. Kept apart from the plumbing so they can be read,
 * tested and tuned on their own. The copy-paste mode sends the same rules.
 */
import { z } from "zod";
import type { Box } from "../model/demo";
import { demoAnswerSchema, type RefineAnswer, toGrid } from "./schema";

export interface Replacement {
  /** Text as shown on screen. */
  from: string;
  /** What the demo shows instead. */
  to: string;
}

export interface Brief {
  /** What the demo should show: the one field that matters most. */
  goal: string;
  audience: string;
  tone: string;
  maxSteps: number;
  /** English name of the language the demo is written in. */
  language: string;
  /** Blur personal and secret data. */
  redact: boolean;
  /** Zoom on small targets. */
  zoom: boolean;
  /** Text to change on screen, wherever it appears. */
  replacements: Replacement[];
}

export const DEFAULT_BRIEF: Brief = {
  goal: "",
  audience: "people discovering the product",
  tone: "friendly and concise",
  maxSteps: 8,
  language: "English",
  redact: true,
  zoom: true,
  replacements: [],
};

export interface FrameNote {
  time: number | null;
  pinned: boolean;
  diff: Box | null;
}

export function clock(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) return "";
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** The replacements the user filled in completely. */
export function activeReplacements(b: Brief): Replacement[] {
  return (b.replacements ?? [])
    .filter((r) => r.from.trim() && r.to.trim())
    .map((r) => ({ from: r.from.trim(), to: r.to.trim() }));
}

function briefBlock(b: Brief): string {
  return [
    `GOAL OF THE DEMO: ${b.goal.trim() || "Walk a new user through what the recording shows."}`,
    `Audience: ${b.audience || DEFAULT_BRIEF.audience}.`,
    `Tone: ${b.tone || DEFAULT_BRIEF.tone}.`,
    `Write every title and text in ${b.language || "English"}.`,
    `At most ${b.maxSteps} steps.`,
    ...activeReplacements(b).map(
      (r) =>
        `On screen, "${r.from}" will be replaced by "${r.to}": always write "${r.to}" in titles and texts.`,
    ),
  ].join("\n");
}

function coordRules(grid: boolean): string {
  return grid
    ? "COORDINATES: every box is {x, y, w, h} on a 0–1000 grid laid over the image it belongs to: (0,0) is the top-left corner, (1000,1000) the bottom-right, whatever the image's aspect ratio. x and y are the box's top-left corner. Pink grid lines with their values are drawn every 100 units to help you measure; they are not part of the product and will not be shown. Boxes must be tight around the element."
    : "COORDINATES: every box is {x, y, w, h} on a 0–1000 scale of the image it belongs to: (0,0) is the top-left corner, (1000,1000) the bottom-right, whatever the image's aspect ratio. x and y are the box's top-left corner. Boxes must be tight around the element.";
}

export function pickPrompt(
  b: Brief,
  count: number,
  notes: FrameNote[],
): { instructions: string; text: string } {
  const pinned = notes.flatMap((n, i) => (n.pinned ? [i + 1] : []));
  return {
    instructions: `You are the director of an interactive product demo (like Storylane or Arcade). You receive the screenshots a screen recording produced, as numbered tiles on contact sheets, and you choose the screens that tell the story best. Answer with the JSON the schema describes.`,
    text: [
      briefBlock(b),
      "",
      `There are ${count} frames, numbered 1 to ${count} on their tiles, in recording order.`,
      pinned.length
        ? `The user pinned frames ${pinned.join(", ")} while recording: keep them unless they are duplicates.`
        : "",
      "",
      `Choose at most ${b.maxSteps} frames, in the order the story is told (usually recording order). Each chosen frame becomes one step where the viewer clicks something to go on.`,
      "- Keep the screens that show a meaningful state: the starting point, each screen where an action is taken, the final result.",
      "- Skip duplicates, transitions, half-loaded pages, spinners, blurred or partly painted frames and frames unrelated to the goal.",
      "- Prefer the frame just before an action (where the button to click is visible) over the frame right after it.",
    ]
      .filter((l) => l !== "")
      .join("\n"),
  };
}

export function demoInstructions(b: Brief, grid = false): string {
  return [
    `You are the director of an interactive product demo (like Storylane or Arcade). Each step of the demo shows one screenshot from a screen recording, a hotspot on the element the viewer clicks to go on, and a short tooltip. You receive the screenshots, labeled "Image 1", "Image 2"…, and write the whole demo as the JSON the schema describes.`,
    "",
    coordRules(grid),
    "",
    "RULES FOR EACH STEP",
    "- One step per image you use, in story order; you may leave out an image that adds nothing. Never describe something a screenshot does not show.",
    `- image: the number N of "Image N" the step shows.`,
    "- target: the exact control (button, link, tab, field, menu item) the viewer interacts with on this screen to reach the next step, described precisely enough to find it again: its label or icon and where it is (\"the 'Active' filter link under the list\"). The mouse cursor, when visible, often rests on it. Null on the final step or a step that is only to look at.",
    "- hotspot: the box of that control; null when target is null.",
    `- action: "click", "type" (a field to fill) or "look" (no interaction, hotspot null).`,
    '- title: at most 6 words, an imperative ("Open the billing page"). body: one or two sentences, at most 30 words, saying why it matters to the viewer, not only what to click.',
    `- placement: where the tooltip goes relative to the hotspot: "auto" unless it would cover something important.`,
    b.zoom
      ? "- zoom: when the hotspot is small (under about 15% of the image width), a box around the region of interest, about 2 to 3 times the hotspot with some context, close to the image's aspect ratio. Otherwise null."
      : "- zoom: always null.",
    "- highlights: zero to two regions worth drawing the eye to (a result, a value), each with `what` describing it precisely. Usually empty.",
    b.redact
      ? '- redactions: hide personal or secret data visible on screen: email addresses, people\'s names, phone numbers, postal addresses, API keys, tokens, passwords, account or card numbers, photos of real people. Tight boxes, one per item, each with `what` describing it precisely ("the email address in the account menu, top right"). Empty when there is nothing to hide.'
      : "- redactions: always empty.",
    grid && activeReplacements(b).length
      ? `- textEdits: on EVERY screen where one of these texts appears, one entry per occurrence, the box tight around the original words: ${activeReplacements(
          b,
        )
          .map((r) => `"${r.from}" → "${r.to}"`)
          .join(", ")}. \`original\` is the text shown now, \`text\` the replacement.`
      : "- textEdits: always empty; text replacements are placed separately.",
    "",
    "THE WHOLE DEMO",
    "- title: a short, specific title. description: one sentence.",
    "- intro: a title and one sentence that make the viewer want to start.",
    '- outro: a title, one sentence, and a call-to-action label ("Try it free", "Book a demo").',
  ].join("\n");
}

export function demoText(b: Brief, notes: FrameNote[]): string {
  return [
    briefBlock(b),
    "",
    "The images follow, in recording order:",
    ...notes.map((n, i) => {
      const parts = [`Image ${i + 1}`];
      if (n.time !== null) parts.push(`at ${clock(n.time)}`);
      if (n.pinned) parts.push("pinned by the user");
      if (n.diff)
        parts.push(
          `region that changed since the previous screen: ${JSON.stringify(toGrid(n.diff))}`,
        );
      return `- ${parts.join(", ")}`;
    }),
  ].join("\n");
}

export function refineInstructions(b: Brief): string {
  return [
    "You edit one step of an interactive product demo. You receive the step's screenshot, its current JSON and the user's instruction. Return the full step as the JSON the schema describes, changing only what the instruction asks (and fixing a box that is clearly misplaced).",
    "",
    coordRules(false),
    "",
    "Keep `target` (the element the hotspot points at) precise: its label or icon and where it is.",
    "",
    `Write in ${b.language || "English"}. Titles at most 6 words, body at most 30 words.`,
  ].join("\n");
}

export function refineText(current: RefineAnswer, instruction: string): string {
  return [
    `Current step:\n${JSON.stringify(current, null, 2)}`,
    "",
    `Instruction: ${instruction.trim()}`,
  ].join("\n");
}

/** Everything a chat app needs, in one message, for the copy-paste mode. */
export function pastePrompt(b: Brief, notes: FrameNote[]): string {
  const schema = JSON.stringify(z.toJSONSchema(demoAnswerSchema), null, 1);
  return [
    demoInstructions(b, true),
    "",
    `The attached picture holds ${notes.length} screenshots side by side, each labeled "Image N" in its top-left corner, each with its own pink 0–1000 grid. Coordinates are relative to each screenshot, not to the whole picture.`,
    "",
    demoText(b, notes),
    "",
    "Answer with only the JSON object, in a ```json code block, matching this JSON Schema:",
    schema,
  ].join("\n");
}
