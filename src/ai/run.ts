/**
 * The AI mode. Two passes:
 *
 * 1. choose: when there are more frames than a demo needs, numbered contact
 *    sheets go out in one cheap request and the model picks the screens that
 *    tell the story (frames pinned while recording are hinted);
 * 2. annotate: the chosen screenshots, each with a 0–1000 grid, go out in one
 *    request that returns the whole demo: hotspots, tooltips, zooms, blurs and
 *    text replacements.
 *
 * Every call goes through llm-connect: the model from the saved settings, the
 * provider options for it, a check of what it accepts before any request, and
 * errors described without the key.
 */
import { generateText, type ModelMessage, Output } from "ai";
import {
  callOptions,
  callProblem,
  describeError,
  effortLevels,
  type LlmSettings,
  loadModel,
  providerKindOf,
  usableEffort,
} from "llm-connect";
import type { z } from "zod";
import type { Step } from "../model/demo";
import { applyGrounding, groundPrompt, groundSchema, targetsOf } from "./ground";
import {
  activeReplacements,
  type Brief,
  demoInstructions,
  demoText,
  type FrameNote,
  pickPrompt,
  refineInstructions,
  refineText,
} from "./prompts";
import {
  applyFields,
  type DemoAnswer,
  demoAnswerSchema,
  pickSchema,
  type RefineAnswer,
  refineSchema,
  stepsFromAnswer,
  stepToAnswer,
} from "./schema";
import { capabilitiesOf } from "./settings";
import { contactSheets, type ModelImage, plainImage } from "./sheets";

export interface AiFrame extends FrameNote {
  asset: string;
  url: string;
}

export interface Progress {
  phase: "prepare" | "choose" | "annotate" | "place" | "done";
  message: string;
}

export interface DemoResult {
  answer: DemoAnswer;
  steps: Step[];
  /** Frames the model was shown in the second pass. */
  used: AiFrame[];
}

/** More frames than this and the first pass runs. */
const DIRECT_LIMIT = 12;
/** Frames sent to the first pass at most (sampled evenly, pinned ones kept). */
const PICK_LIMIT = 64;
/** Placement requests running at once. */
const PLACE_CONCURRENCY = 4;

/** `fn` over `items`, at most `limit` at a time, results in order. */
export async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, i: number) => Promise<R>,
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i] as T, i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

export class AiError extends Error {
  constructor(
    message: string,
    readonly retryable = false,
  ) {
    super(message);
  }
}

function imagePart(img: ModelImage) {
  return {
    type: "file" as const,
    mediaType: img.mediaType,
    data: { type: "data" as const, data: img.data },
  };
}

/** Evenly spread subset of `frames` of size `n`, always keeping pinned frames. */
export function sampleFrames<T extends { pinned: boolean }>(frames: T[], n: number): T[] {
  if (frames.length <= n) return frames;
  const pinned = new Set(frames.filter((f) => f.pinned));
  const rest = frames.filter((f) => !f.pinned);
  const room = Math.max(0, n - pinned.size);
  const keep = new Set<T>(pinned);
  for (let i = 0; i < room; i++) {
    const f = rest[Math.floor(((i + 0.5) * rest.length) / room)];
    if (f) keep.add(f);
  }
  return frames.filter((f) => keep.has(f)).slice(0, n);
}

async function call<S extends z.ZodType>(
  settings: LlmSettings,
  schema: S,
  instructions: string,
  messages: ModelMessage[],
  effort: "low" | "medium",
  signal?: AbortSignal,
): Promise<z.infer<S>> {
  const capabilities = capabilitiesOf(settings);
  if (!capabilities.vision) {
    throw new AiError(
      "This model does not accept images. Pick a vision model in AI settings (Claude, GPT-5, Gemini…).",
    );
  }
  const levels = effortLevels(providerKindOf(settings), settings.model);
  const chosen = usableEffort(effort, levels) ?? null;
  const problem = callProblem(settings, { messages, effort: chosen }, capabilities);
  if (problem) throw new AiError(problem.message);
  try {
    const model = await loadModel(settings);
    const res = await generateText({
      model,
      instructions,
      messages,
      output: Output.object({ schema, name: "stepcast" }),
      maxRetries: 1,
      ...(signal ? { abortSignal: signal } : {}),
      ...callOptions(settings, { effort: chosen, capabilities }),
    });
    return res.output as z.infer<S>;
  } catch (err) {
    if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
    const e = describeError(err, settings.apiKey);
    const hint =
      e.code === "auth"
        ? " Check the key in AI settings."
        : e.code === "auth-or-network"
          ? " The key was refused, or the network or the provider's CORS policy blocked the request."
          : "";
    throw new AiError(`${e.message}${hint}`, e.retryable);
  }
}

/** Pass 1: the frames worth a step, as indices into `frames`. */
export async function chooseFrames(
  settings: LlmSettings,
  brief: Brief,
  frames: AiFrame[],
  signal?: AbortSignal,
): Promise<AiFrame[]> {
  const sheets = await contactSheets(frames.map((f, i) => ({ url: f.url, label: `#${i + 1}` })));
  const { instructions, text } = pickPrompt(brief, frames.length, frames);
  const answer = await call(
    settings,
    pickSchema,
    instructions,
    [{ role: "user", content: [{ type: "text", text }, ...sheets.map(imagePart)] }],
    "low",
    signal,
  );
  const seen = new Set<number>();
  const chosen: AiFrame[] = [];
  for (const { frame } of answer.frames) {
    const f = frames[frame - 1];
    if (f && !seen.has(frame)) {
      seen.add(frame);
      chosen.push(f);
    }
  }
  if (chosen.length === 0)
    throw new AiError("The model did not choose any frame. Try again or rephrase the goal.", true);
  return chosen.slice(0, brief.maxSteps);
}

/**
 * Places a step's boxes precisely: one small request on the clean screenshot.
 * When it fails, the step keeps the boxes the demo pass gave it.
 */
export async function placeStep<T extends RefineAnswer>(
  settings: LlmSettings,
  answer: T,
  url: string,
  replacements: { from: string; to: string }[],
  signal?: AbortSignal,
): Promise<T> {
  const targets = targetsOf(answer, replacements);
  if (targets.length === 0) return answer;
  const { instructions, text } = groundPrompt(targets);
  try {
    const found = await call(
      settings,
      groundSchema,
      instructions,
      [{ role: "user", content: [{ type: "text", text }, imagePart(await plainImage(url))] }],
      "low",
      signal,
    );
    return { ...answer, ...applyGrounding(answer, targets, found) };
  } catch (err) {
    if (signal?.aborted) throw err;
    console.warn("stepcast: precise placement failed, keeping the first boxes", err);
    return answer;
  }
}

/** Pass 2: the demo for these screenshots, then its boxes placed precisely. */
export async function annotate(
  settings: LlmSettings,
  brief: Brief,
  frames: AiFrame[],
  signal?: AbortSignal,
  onProgress?: (p: Progress) => void,
): Promise<DemoResult> {
  const content: Exclude<ModelMessage["content"], string> = [
    { type: "text", text: demoText(brief, frames) },
  ];
  for (const [i, f] of frames.entries()) {
    content.push({ type: "text", text: `Image ${i + 1}:` });
    content.push(imagePart(await plainImage(f.url)));
  }
  const answer = await call(
    settings,
    demoAnswerSchema,
    demoInstructions(brief),
    [{ role: "user", content } as ModelMessage],
    "medium",
    signal,
  );
  onProgress?.({
    phase: "place",
    message: `Placing hotspots, blurs and text on ${answer.steps.length} screens…`,
  });
  const replacements = activeReplacements(brief);
  const placed = await mapLimit(answer.steps, PLACE_CONCURRENCY, async (st) => {
    const f = frames[st.image - 1];
    return f ? placeStep(settings, st, f.url, replacements, signal) : st;
  });
  const final = { ...answer, steps: placed };
  const steps = stepsFromAnswer(final, frames);
  if (steps.length === 0)
    throw new AiError("The model returned no usable step. Try again or rephrase the goal.", true);
  return { answer: final, steps, used: frames };
}

export async function generateDemo(
  settings: LlmSettings,
  brief: Brief,
  frames: AiFrame[],
  onProgress: (p: Progress) => void,
  signal?: AbortSignal,
): Promise<DemoResult> {
  if (frames.length === 0) throw new AiError("There are no screenshots to work from yet.");
  let chosen = frames;
  if (frames.length > Math.max(DIRECT_LIMIT, brief.maxSteps)) {
    const pool = sampleFrames(frames, PICK_LIMIT);
    onProgress({
      phase: "choose",
      message: `Choosing the key screens among ${pool.length} frames…`,
    });
    chosen = await chooseFrames(settings, brief, pool, signal);
  }
  onProgress({
    phase: "annotate",
    message: `Writing ${chosen.length} steps: hotspots, tooltips, zooms…`,
  });
  const result = await annotate(settings, brief, chosen, signal, onProgress);
  onProgress({ phase: "done", message: `${result.steps.length} steps ready.` });
  return result;
}

/** Rewrites one step following the user's instruction. */
export async function refineStep(
  settings: LlmSettings,
  brief: Brief,
  step: Step,
  url: string,
  instruction: string,
  signal?: AbortSignal,
): Promise<Step> {
  const image = await plainImage(url);
  const answer = await call(
    settings,
    refineSchema,
    refineInstructions(brief),
    [
      {
        role: "user",
        content: [
          { type: "text", text: refineText(stepToAnswer(step), instruction) },
          imagePart(image),
        ],
      },
    ],
    "medium",
    signal,
  );
  return applyFields(step, await placeStep(settings, answer, url, [], signal));
}
