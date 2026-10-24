/**
 * The narration: what you said while recording, in a file of its own. It is
 * only there to help the AI write: it is transcribed (on this device by NVIDIA
 * Parakeet or Canary, Whisper for other languages, or by your provider's
 * speech-to-text model) and what was said around each screenshot goes to the
 * AI with it. It is never played back.
 *
 * Speech about a screen comes mostly before the screenshot (taken just before
 * the click) and a little after: a frame gets what was said from just after
 * the previous frame to just after its own.
 */
import { joinWords, type LlmSettings, type Transcript, transcriptionProblem } from "llm-connect";
import { nemoSupports, spokenLanguage } from "llm-connect/nemo";
import type { Narration } from "../model/store";
import type { DeviceEngine, SpeechReply, SpeechRequest } from "../workers/speech";
import type { FrameNote } from "./prompts";

declare const __SPEECH_WORKER_URL__: string;

/** Seconds of speech after a screenshot that still belong to it. */
const LAG = 1.5;

/** Words of the transcript between two moments of the recording's clock, as text. */
export function saidBetween(n: Narration, from: number, to: number): string {
  const words = (n.transcript?.words ?? []).filter((w) => {
    const t = w.start + n.offset;
    return t > from && t <= to;
  });
  return joinWords(words.map((w) => w.text));
}

/** For frames in time order: what was said since the previous one, up to just after this one. */
export function saidPerFrame(n: Narration, times: (number | null)[]): string[] {
  let prev = Number.NEGATIVE_INFINITY;
  return times.map((t, i) => {
    if (t === null) return "";
    const last = i === times.length - 1;
    const said = saidBetween(n, prev, last ? Number.POSITIVE_INFINITY : t + LAG);
    prev = t + LAG;
    return said;
  });
}

/**
 * Chosen frames carry what was said over the frames left out before them, and the last one what
 * was said after it too: nothing the user said is lost when screens are skipped.
 */
export function gatherSaid<T extends FrameNote>(all: T[], chosen: T[]): T[] {
  if (!all.some((f) => f.said)) return chosen;
  const at = new Map(all.map((f, i) => [f, i]));
  const order = [...chosen].sort((a, b) => (at.get(a) ?? 0) - (at.get(b) ?? 0));
  const said = new Map<T, string>();
  let from = 0;
  order.forEach((f, k) => {
    const i = at.get(f) ?? 0;
    const to = k === order.length - 1 ? all.length - 1 : i;
    const parts = all.slice(from, to + 1).flatMap((x) => (x.said ? [x.said] : []));
    said.set(f, parts.join(" "));
    from = i + 1;
  });
  return chosen.map((frame) => {
    const { said: _, ...f } = frame;
    const s = said.get(frame);
    return (s ? { ...f, said: s } : f) as T;
  });
}

export type TranscribeEngine = "provider" | DeviceEngine;

/**
 * On this device: Parakeet when it knows the browser's language (it finds the spoken one by
 * itself), else Whisper.
 */
export function defaultEngine(language = spokenLanguage()): DeviceEngine {
  return nemoSupports("parakeet", language) ? "parakeet" : "whisper";
}

/** The provider can transcribe (a custom endpoint would need a model name). */
export function providerCanTranscribe(settings: LlmSettings | null): boolean {
  return !!settings && !settings.customEndpoint && !transcriptionProblem(settings);
}

const NAMES: Record<DeviceEngine, string> = {
  parakeet: "NVIDIA Parakeet",
  canary: "NVIDIA Canary",
  whisper: "Whisper",
};

export interface TranscribeProgress {
  message: string;
  ratio?: number;
}

/** A model on this device, in a worker: resolves with the transcript, rejects on an error or an abort. */
function inWorker(
  samples: Float32Array,
  engine: DeviceEngine,
  onProgress: (p: TranscribeProgress) => void,
  signal?: AbortSignal,
): Promise<Transcript> {
  const url = typeof __SPEECH_WORKER_URL__ === "string" ? __SPEECH_WORKER_URL__ : "./speech.js";
  const worker = new Worker(url, { type: "module" });
  const name = NAMES[engine];
  return new Promise<Transcript>((resolve, reject) => {
    const end = () => worker.terminate();
    signal?.addEventListener("abort", () => {
      end();
      reject(new DOMException("Cancelled", "AbortError"));
    });
    worker.onerror = (e) => {
      end();
      reject(new Error(e.message || `${name} could not start in this browser.`));
    };
    worker.onmessage = (e: MessageEvent<SpeechReply>) => {
      const r = e.data;
      if (r.kind === "progress")
        onProgress({ message: `Downloading ${name} (once, then cached)…`, ratio: r.ratio });
      else if (r.kind === "loaded")
        onProgress({ message: `Transcribing your narration on this device with ${name}…` });
      else if (r.kind === "working")
        onProgress({ message: `Transcribing your narration with ${name}…`, ratio: r.ratio });
      else if (r.kind === "done") {
        end();
        resolve(r.transcript);
      } else {
        end();
        reject(new Error(r.message));
      }
    };
    const request: SpeechRequest = { samples, engine, language: spokenLanguage() };
    worker.postMessage(request, [samples.buffer]);
  });
}

/** Transcribes the narration's file on this device, or with the provider. */
export async function transcribeNarration(
  blob: Blob,
  engine: TranscribeEngine,
  settings: LlmSettings | null,
  onProgress: (p: TranscribeProgress) => void,
  signal?: AbortSignal,
): Promise<Transcript> {
  if (engine === "provider") {
    if (!settings) throw new Error("Set up a model first, or transcribe on this device.");
    onProgress({ message: "Transcribing your narration…" });
    const { transcribe } = await import("llm-connect");
    return transcribe(settings, blob, signal ? { abortSignal: signal } : {});
  }
  onProgress({ message: "Reading your narration…" });
  const { decodeAudio } = await import("llm-connect/nemo");
  return inWorker(await decodeAudio(blob), engine, onProgress, signal);
}
