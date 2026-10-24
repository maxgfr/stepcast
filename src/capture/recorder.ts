/**
 * Screen recording with screenshots taken along the way. The stream goes to a
 * MediaRecorder (the video kept with the project) and, four times a second, a
 * tiny grayscale copy goes to the keyframe detector. A keyframe, or a press of
 * "Snap step", saves a full-resolution screenshot.
 *
 * The page doing this is usually in the background while you demo another tab
 * or app, so ticks come from a worker (background timers are throttled) and
 * frames come from ImageCapture where available (a hidden <video> may stop
 * painting).
 */
import type { Box } from "../model/demo";
import { canvasToBlob, makeCanvas } from "../render/image";
import { KeyframeDetector, SAMPLE_WIDTH, toGray } from "./keyframes";

declare const __CLOCK_WORKER_URL__: string;

export interface CapturedFrame {
  blob: Blob;
  /** Seconds into the recording. */
  time: number;
  diff: Box | null;
  pinned: boolean;
  width: number;
  height: number;
}

export interface RecorderEvents {
  onFrame(frame: CapturedFrame): void;
  /** The stream ended on its own (the browser's "Stop sharing" button). */
  onEnded(): void;
}

type Grabbed = CanvasImageSource & { width: number; height: number };

function release(src: Grabbed): void {
  if ("close" in src && typeof src.close === "function") src.close();
}

interface ImageCaptureLike {
  grabFrame(): Promise<ImageBitmap>;
}
type ImageCaptureCtor = new (track: MediaStreamTrack) => ImageCaptureLike;

/** Detected screenshots stop after this many; Snap step always works. */
export const MAX_AUTO_FRAMES = 400;
const TICK_MS = 200;

function pickMime(): string {
  for (const t of ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm", "video/mp4"]) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(t)) return t;
  }
  return "";
}

function clockWorker(): Worker | null {
  try {
    return new Worker(
      typeof __CLOCK_WORKER_URL__ === "string" ? __CLOCK_WORKER_URL__ : "./clock.js",
      {
        type: "module",
      },
    );
  } catch {
    return null;
  }
}

export class ScreenRecorder {
  private readonly chunks: Blob[] = [];
  private readonly recorder: MediaRecorder | null;
  private readonly detector: KeyframeDetector;
  private readonly video = document.createElement("video");
  private readonly capture: ImageCaptureLike | null;
  private readonly small = makeCanvas(SAMPLE_WIDTH, 54);
  private worker: Worker | null = null;
  private interval: ReturnType<typeof setInterval> | null = null;
  private startedAt = performance.now();
  private pausedTotal = 0;
  private pausedAt: number | null = null;
  private autoCount = 0;
  private busy = false;
  private stopped = false;
  private lastGray: Uint8Array | null = null;
  /** The previous tick's frame, kept for a "before the change" keyframe. */
  private prevSrc: { src: Grabbed; time: number } | null = null;

  private constructor(
    readonly stream: MediaStream,
    private readonly events: RecorderEvents,
    dense: boolean,
  ) {
    this.detector = new KeyframeDetector(dense ? {} : { periodicMs: 0 });
    const mimeType = pickMime();
    this.recorder =
      typeof MediaRecorder === "undefined"
        ? null
        : new MediaRecorder(stream, {
            ...(mimeType ? { mimeType } : {}),
            videoBitsPerSecond: 4_000_000,
          });
    this.recorder?.addEventListener("dataavailable", (e) => {
      if (e.data.size > 0) this.chunks.push(e.data);
    });
    const track = stream.getVideoTracks()[0];
    const IC = (globalThis as { ImageCapture?: ImageCaptureCtor }).ImageCapture;
    this.capture = track && IC ? new IC(track) : null;
    track?.addEventListener("ended", () => {
      if (!this.stopped) this.events.onEnded();
    });
    this.video.muted = true;
    this.video.playsInline = true;
    this.video.srcObject = stream;
  }

  static async start(
    events: RecorderEvents,
    opts: { audio?: boolean; dense?: boolean } = {},
  ): Promise<ScreenRecorder> {
    if (!navigator.mediaDevices?.getDisplayMedia) {
      throw new Error(
        "This browser cannot record the screen. Try a desktop version of Chrome, Edge or Firefox.",
      );
    }
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: 30, cursor: "always" } as MediaTrackConstraints,
      audio: opts.audio ?? false,
    });
    const rec = new ScreenRecorder(stream, events, opts.dense ?? true);
    await rec.video.play().catch(() => undefined);
    rec.recorder?.start(1000);
    rec.startedAt = performance.now();
    rec.worker = clockWorker();
    if (rec.worker) {
      rec.worker.onmessage = () => void rec.tick();
      rec.worker.postMessage({ interval: TICK_MS });
    } else {
      rec.interval = setInterval(() => void rec.tick(), TICK_MS);
    }
    return rec;
  }

  /** Seconds recorded, pauses left out. */
  elapsed(): number {
    const now = this.pausedAt ?? performance.now();
    return Math.max(0, (now - this.startedAt - this.pausedTotal) / 1000);
  }

  /** Screens not saved because an identical one was already taken. */
  get duplicates(): number {
    return this.detector.skipped;
  }

  get paused(): boolean {
    return this.pausedAt !== null;
  }

  pause(): void {
    if (this.pausedAt !== null || this.stopped) return;
    this.pausedAt = performance.now();
    if (this.recorder?.state === "recording") this.recorder.pause();
  }

  resume(): void {
    if (this.pausedAt === null || this.stopped) return;
    this.pausedTotal += performance.now() - this.pausedAt;
    this.pausedAt = null;
    if (this.recorder?.state === "paused") this.recorder.resume();
  }

  private async grab(): Promise<CanvasImageSource & { width: number; height: number }> {
    if (this.capture) {
      try {
        return await this.capture.grabFrame();
      } catch {
        // Fall through to the video element (a frame may not be ready yet).
      }
    }
    const v = this.video;
    if (v.readyState < 2 || !v.videoWidth) throw new Error("no frame yet");
    const c = makeCanvas(v.videoWidth, v.videoHeight);
    c.getContext("2d")?.drawImage(v, 0, 0);
    return c;
  }

  private sample(src: CanvasImageSource & { width: number; height: number }): {
    gray: Uint8Array;
    w: number;
    h: number;
  } {
    const w = SAMPLE_WIDTH;
    const h = Math.max(1, Math.round((src.height / src.width) * w));
    if (this.small.height !== h) this.small.height = h;
    const ctx = this.small.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("Canvas 2D is not available");
    ctx.drawImage(src, 0, 0, w, h);
    return { gray: toGray(ctx.getImageData(0, 0, w, h).data, w, h), w, h };
  }

  private async save(src: Grabbed, diff: Box | null, pinned: boolean, time = this.elapsed()) {
    const c = makeCanvas(src.width, src.height);
    c.getContext("2d")?.drawImage(src, 0, 0);
    const blob = await canvasToBlob(c, "image/webp", 0.92);
    this.events.onFrame({
      blob,
      time,
      diff,
      pinned,
      width: c.width,
      height: c.height,
    });
  }

  private async tick(): Promise<void> {
    if (this.busy || this.stopped || this.paused) return;
    this.busy = true;
    try {
      const src = await this.grab();
      const time = this.elapsed();
      const { gray, w, h } = this.sample(src);
      this.lastGray = gray;
      const hit = this.detector.push(gray, w, h, time * 1000);
      if (hit && this.autoCount < MAX_AUTO_FRAMES) {
        this.autoCount++;
        const shot = hit.before ? this.prevSrc : { src, time };
        if (shot) await this.save(shot.src, hit.box, false, shot.time);
      }
      if (this.prevSrc) release(this.prevSrc.src);
      this.prevSrc = { src, time };
    } catch {
      // No frame this tick.
    } finally {
      this.busy = false;
    }
  }

  /** Takes a screenshot now, marked as chosen by hand. */
  async snap(): Promise<void> {
    if (this.stopped) return;
    const src = await this.grab();
    if (this.lastGray) this.detector.mark(this.lastGray, this.elapsed() * 1000);
    await this.save(src, null, true);
    if ("close" in src && typeof src.close === "function") src.close();
  }

  /** Stops everything; resolves with the recording (null when MediaRecorder is missing). */
  async stop(): Promise<Blob | null> {
    if (this.stopped) return null;
    this.stopped = true;
    this.worker?.terminate();
    if (this.prevSrc) release(this.prevSrc.src);
    this.prevSrc = null;
    if (this.interval) clearInterval(this.interval);
    const rec = this.recorder;
    const result = new Promise<Blob | null>((resolve) => {
      if (!rec || rec.state === "inactive")
        return resolve(this.chunks.length ? new Blob(this.chunks) : null);
      rec.addEventListener(
        "stop",
        () =>
          resolve(
            this.chunks.length
              ? new Blob(this.chunks, { type: rec.mimeType || "video/webm" })
              : null,
          ),
        { once: true },
      );
      rec.stop();
    });
    for (const t of this.stream.getTracks()) t.stop();
    this.video.srcObject = null;
    return result;
  }
}
