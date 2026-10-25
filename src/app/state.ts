/**
 * The open project: one signal for the project, object URLs for its blobs,
 * edits saved to IndexedDB shortly after they happen, and an undo history.
 */
import { batch, computed, signal } from "@preact/signals";
import type { CapturedFrame } from "../capture/recorder";
import type { SideTake } from "../capture/side";
import { type Demo, emptyDemo, newId, newStep, type Step } from "../model/demo";
import {
  type Frame,
  getBlob,
  getProject,
  type Project,
  putBlob,
  type SideFile,
  saveProject,
} from "../model/store";

export const project = signal<Project | null>(null);
export const selectedStep = signal<string | null>(null);
export const saveError = signal<string | null>(null);

const urls = new Map<string, string>();
export const assetVersion = signal(0);

/** Object URL of one of the open project's blobs ("" until it has loaded). */
export function assetUrl(key: string): string {
  void assetVersion.value;
  return urls.get(key) ?? "";
}

async function loadAssets(p: Project): Promise<void> {
  const keys = new Set([...p.frames.map((f) => f.asset), ...p.demo.steps.map((s) => s.image)]);
  for (const key of keys) {
    if (urls.has(key)) continue;
    const blob = await getBlob(p.id, key);
    if (blob) urls.set(key, URL.createObjectURL(blob));
  }
  assetVersion.value++;
}

function releaseAssets(): void {
  for (const u of urls.values()) URL.revokeObjectURL(u);
  urls.clear();
}

export async function addAsset(projectId: string, blob: Blob, key = newId("a")): Promise<string> {
  await putBlob(projectId, key, blob);
  urls.set(key, URL.createObjectURL(blob));
  assetVersion.value++;
  return key;
}

export async function getAssetBlob(key: string): Promise<Blob | null> {
  const p = project.value;
  return p ? getBlob(p.id, key) : null;
}

export async function openProject(id: string): Promise<boolean> {
  if (project.value?.id === id) return true;
  const p = await getProject(id);
  releaseAssets();
  undoStack.length = 0;
  redoStack.length = 0;
  historySize.value = { undo: 0, redo: 0 };
  project.value = p;
  selectedStep.value = p?.demo.steps[0]?.id ?? null;
  if (p) await loadAssets(p);
  return p !== null;
}

export function closeProject(): void {
  project.value = null;
  releaseAssets();
}

export async function createProject(
  title: string,
  frames: CapturedFrame[],
  recording: Blob | null,
  asSteps = false,
  sides: { camera?: SideTake | null } = {},
): Promise<string> {
  const id = newId("p");
  const stored: Frame[] = [];
  for (const f of frames) {
    const asset = newId("a");
    await putBlob(id, asset, f.blob);
    stored.push({
      id: newId("f"),
      asset,
      time: f.time,
      diff: f.diff,
      pinned: f.pinned,
      width: f.width,
      height: f.height,
    });
  }
  let rec: string | null = null;
  if (recording) {
    rec = "recording";
    await putBlob(id, rec, recording);
  }
  let camera: SideFile | null = null;
  if (sides.camera) {
    camera = { key: "camera", offset: sides.camera.offset };
    await putBlob(id, camera.key, sides.camera.blob);
  }
  const demo = emptyDemo(title);
  if (asSteps) demo.steps = stored.map((f) => newStep(f.asset, { time: f.time }));
  const now = Date.now();
  await saveProject({
    id,
    demo,
    frames: stored,
    recording: rec,
    camera,
    createdAt: now,
    updatedAt: now,
  });
  return id;
}

/** Adds captured frames to the open project (after a video import, for instance). */
export async function addFrames(frames: CapturedFrame[]): Promise<Frame[]> {
  const p = project.value;
  if (!p) return [];
  const added: Frame[] = [];
  for (const f of frames) {
    const asset = await addAsset(p.id, f.blob);
    added.push({
      id: newId("f"),
      asset,
      time: f.time,
      diff: f.diff,
      pinned: f.pinned,
      width: f.width,
      height: f.height,
    });
  }
  project.value = { ...p, frames: [...p.frames, ...added] };
  scheduleSave();
  return added;
}

// --- Saving ---------------------------------------------------------------

let saveTimer: ReturnType<typeof setTimeout> | undefined;
function scheduleSave(): void {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => void flushSave(), 400);
}

export async function flushSave(): Promise<void> {
  clearTimeout(saveTimer);
  const p = project.value;
  if (!p) return;
  try {
    await saveProject(p);
    saveError.value = null;
  } catch (err) {
    saveError.value = err instanceof Error ? err.message : "Could not save";
  }
}

// --- Editing with undo ------------------------------------------------------

const undoStack: Demo[] = [];
const redoStack: Demo[] = [];
export const historySize = signal({ undo: 0, redo: 0 });
let lastPushAt = 0;
let lastPushTag = "";

/**
 * Replaces the demo. Edits with the same `tag` within a second merge into one
 * undo entry, so typing a title or dragging a box is undone in one step.
 */
export function updateDemo(fn: (d: Demo) => Demo, tag = ""): void {
  const p = project.value;
  if (!p) return;
  const now = Date.now();
  if (!tag || tag !== lastPushTag || now - lastPushAt > 1000) {
    undoStack.push(p.demo);
    if (undoStack.length > 100) undoStack.shift();
  }
  lastPushAt = now;
  lastPushTag = tag;
  redoStack.length = 0;
  historySize.value = { undo: undoStack.length, redo: 0 };
  project.value = { ...p, demo: fn(p.demo) };
  scheduleSave();
}

export function updateStep(id: string, fn: (s: Step) => Step, tag = ""): void {
  updateDemo(
    (d) => ({ ...d, steps: d.steps.map((s) => (s.id === id ? fn(s) : s)) }),
    tag ? `${id}:${tag}` : "",
  );
}

export function undo(): void {
  const p = project.value;
  const prev = undoStack.pop();
  if (!p || !prev) return;
  redoStack.push(p.demo);
  lastPushTag = "";
  batch(() => {
    historySize.value = { undo: undoStack.length, redo: redoStack.length };
    project.value = { ...p, demo: prev };
  });
  scheduleSave();
}

export function redo(): void {
  const p = project.value;
  const next = redoStack.pop();
  if (!p || !next) return;
  undoStack.push(p.demo);
  lastPushTag = "";
  batch(() => {
    historySize.value = { undo: undoStack.length, redo: redoStack.length };
    project.value = { ...p, demo: next };
  });
  scheduleSave();
}

export const currentStep = computed<Step | null>(() => {
  const p = project.value;
  if (!p) return null;
  return p.demo.steps.find((s) => s.id === selectedStep.value) ?? p.demo.steps[0] ?? null;
});

/** The open demo with `images` resolved to object URLs, ready for the player. */
export const playableDemo = computed<Demo | null>(() => {
  const p = project.value;
  if (!p) return null;
  void assetVersion.value;
  const images: Record<string, string> = {};
  for (const s of p.demo.steps) images[s.image] = urls.get(s.image) ?? "";
  return { ...p.demo, images };
});

/** A new project from a demo and its images (an imported JSON, HTML export or share link). */
export async function createProjectFromDemo(
  demo: Demo,
  blobs: Record<string, Blob>,
): Promise<string> {
  const id = newId("p");
  const frames: Frame[] = [];
  const keyMap = new Map<string, string>();
  for (const [key, blob] of Object.entries(blobs)) {
    // Only screenshots (older files may also carry a recorded voice).
    if (!blob.type.startsWith("image/")) continue;
    const asset = newId("a");
    keyMap.set(key, asset);
    await putBlob(id, asset, blob);
    const step = demo.steps.find((s) => s.image === key);
    frames.push({
      id: newId("f"),
      asset,
      time: step?.time ?? 0,
      diff: null,
      pinned: true,
      width: 0,
      height: 0,
    });
  }
  const steps = demo.steps
    .filter((s) => keyMap.has(s.image))
    .map((s) => ({ ...s, id: newId(), image: keyMap.get(s.image) as string }));
  const now = Date.now();
  await saveProject({
    id,
    demo: { ...demo, steps, images: {} },
    frames,
    recording: null,
    createdAt: now,
    updatedAt: now,
  });
  return id;
}

/** Images of a demo whose `images` are data: or blob: URLs, as blobs. */
export async function blobsFromUrls(images: Record<string, string>): Promise<Record<string, Blob>> {
  const out: Record<string, Blob> = {};
  for (const [k, url] of Object.entries(images)) {
    if (!/^(data:image\/|blob:)/.test(url)) continue;
    out[k] = await (await fetch(url)).blob();
  }
  return out;
}
