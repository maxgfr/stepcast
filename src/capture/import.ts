/**
 * Screenshots from a file instead of a live recording: a video goes through the
 * same keyframe detector (seeking every 250 ms), images are taken as they are.
 */
import { blobToImage, canvasToBlob, makeCanvas } from "../render/image";
import { KeyframeDetector, SAMPLE_WIDTH, toGray } from "./keyframes";
import type { CapturedFrame } from "./recorder";

const STEP_S = 0.2;
const MAX_SECONDS = 20 * 60;

function once(target: EventTarget, type: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const ok = () => {
      target.removeEventListener("error", ko);
      resolve();
    };
    const ko = () => {
      target.removeEventListener(type, ok);
      reject(new Error("This video cannot be read by the browser."));
    };
    target.addEventListener(type, ok, { once: true });
    target.addEventListener("error", ko, { once: true });
  });
}

/** Duration of a video, including MediaRecorder files that report Infinity until scanned. */
export async function videoDuration(v: HTMLVideoElement): Promise<number> {
  if (Number.isFinite(v.duration)) return v.duration;
  v.currentTime = 1e101;
  await once(v, "seeked").catch(() => undefined);
  const d = v.duration;
  v.currentTime = 0;
  await once(v, "seeked").catch(() => undefined);
  return Number.isFinite(d) ? d : 0;
}

export async function seek(v: HTMLVideoElement, t: number): Promise<void> {
  if (Math.abs(v.currentTime - t) < 0.001 && v.readyState >= 2) return;
  const p = once(v, "seeked");
  v.currentTime = t;
  await p;
}

export async function openVideo(
  src: Blob,
): Promise<{ video: HTMLVideoElement; url: string; duration: number }> {
  const url = URL.createObjectURL(src);
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  const loaded = once(video, "loadeddata");
  video.src = url;
  await loaded;
  return { video, url, duration: await videoDuration(video) };
}

/** The frame a video shows now, as a full-resolution screenshot. */
export async function frameOf(
  v: HTMLVideoElement,
  time: number,
  pinned: boolean,
): Promise<CapturedFrame> {
  const c = makeCanvas(v.videoWidth, v.videoHeight);
  c.getContext("2d")?.drawImage(v, 0, 0);
  const blob = await canvasToBlob(c, "image/webp", 0.92);
  return { blob, time, diff: null, pinned, width: c.width, height: c.height };
}

export async function framesFromVideo(
  file: Blob,
  onFrame: (f: CapturedFrame) => void,
  onProgress: (ratio: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  const { video, url, duration } = await openVideo(file);
  try {
    if (!video.videoWidth || duration <= 0)
      throw new Error("This video has no picture or no duration.");
    const w = SAMPLE_WIDTH;
    const h = Math.max(1, Math.round((video.videoHeight / video.videoWidth) * w));
    const small = makeCanvas(w, h);
    const ctx = small.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("Canvas 2D is not available");
    const detector = new KeyframeDetector();
    const end = Math.min(duration, MAX_SECONDS);
    const at = (t: number) => Math.min(t, Math.max(0, duration - 0.05));
    for (let t = 0; t <= end; t += STEP_S) {
      if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
      await seek(video, at(t));
      ctx.drawImage(video, 0, 0, w, h);
      const hit = detector.push(toGray(ctx.getImageData(0, 0, w, h).data, w, h), w, h, t * 1000);
      if (hit?.before) {
        // The screen just before it changed: step back one sample.
        const prev = Math.max(0, t - STEP_S);
        await seek(video, at(prev));
        onFrame({ ...(await frameOf(video, prev, false)), diff: hit.box });
        await seek(video, at(t));
      } else if (hit) onFrame({ ...(await frameOf(video, t, false)), diff: hit.box });
      onProgress(Math.min(1, t / end));
    }
    onProgress(1);
  } finally {
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(url);
  }
}

export async function framesFromImages(files: File[]): Promise<CapturedFrame[]> {
  const out: CapturedFrame[] = [];
  for (const [i, file] of files.entries()) {
    const img = await blobToImage(file);
    out.push({
      blob: file,
      time: i,
      diff: null,
      pinned: true,
      width: img.naturalWidth,
      height: img.naturalHeight,
    });
  }
  return out;
}
