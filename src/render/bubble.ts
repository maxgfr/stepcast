/**
 * The camera bubble of the video exports: the camera file recorded next to the
 * screen, read with mediabunny, drawn as a round bubble in a corner. Each film
 * frame shows the camera at the moment its step was recorded, so the face goes
 * with what was on screen.
 */
import { type Shot, shotAt, type Tour } from "./tour";

export const BUBBLE_CORNERS = ["bottom-right", "bottom-left", "top-right", "top-left"] as const;
export type BubbleCorner = (typeof BUBBLE_CORNERS)[number];

export interface BubbleOptions {
  /** The camera file. */
  blob: Blob;
  /** Where the camera file starts on the screen recording's clock, in seconds. */
  offset: number;
  corner?: BubbleCorner;
  /** Diameter, a fraction of the film's shorter side. */
  size?: number;
}

type Source = CanvasImageSource & { width: number; height: number };

export interface CameraFile {
  /** One frame per timestamp, in order (null past the end of the file). */
  frames(times: number[]): AsyncGenerator<Source | null, void, unknown>;
  /** The frame at one timestamp. */
  at(time: number): Promise<Source | null>;
  dispose(): void;
}

/** Opens the camera file; frames come out square, cropped to the middle. */
export async function openCamera(blob: Blob, side = 360): Promise<CameraFile> {
  const { ALL_FORMATS, BlobSource, CanvasSink, Input } = await import("mediabunny");
  const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
  const track = await input.getPrimaryVideoTrack();
  if (!track) throw new Error("The camera recording has no video.");
  const sink = new CanvasSink(track, { width: side, height: side, fit: "cover" });
  return {
    async *frames(times) {
      for await (const c of sink.canvasesAtTimestamps(times)) yield c ? (c.canvas as Source) : null;
    },
    async at(time) {
      return ((await sink.getCanvas(time))?.canvas as Source | undefined) ?? null;
    },
    dispose() {
      input.dispose();
    },
  };
}

/**
 * Where the camera file is at film time `t`: the step's moment in the recording, plus the time
 * spent on the shot. The intro leads up to the first step, the outro follows the last one; steps
 * without a time (screenshots added by hand) follow the film.
 */
export function cameraTime(tour: Tour, t: number, offset: number): number {
  const steps = tour.demo.steps;
  const shot: Shot = shotAt(tour, t);
  const local = t - shot.start;
  const at = steps[shot.index]?.time;
  let rec: number;
  if (at == null) rec = t;
  else if (shot.kind === "intro") rec = at - (shot.duration - local);
  else if (shot.kind === "outro") {
    const last = tour.shots.find((s) => s.kind === "step" && s.index === shot.index);
    rec = at + (last?.duration ?? 0) + local;
  } else rec = at + local;
  return Math.max(0, rec - offset);
}

/** Draws the bubble on the film (W × H). */
export function drawBubble(
  ctx: CanvasRenderingContext2D,
  src: Source,
  W: number,
  H: number,
  corner: BubbleCorner = "bottom-right",
  size = 0.24,
): void {
  const d = Math.round(Math.min(W, H) * size);
  const m = Math.round(Math.min(W, H) * 0.035);
  const x = corner.endsWith("left") ? m : W - m - d;
  const y = corner.startsWith("top") ? m : H - m - d;
  const r = d / 2;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.shadowColor = "rgba(10, 8, 24, 0.45)";
  ctx.shadowBlur = d * 0.12;
  ctx.shadowOffsetY = d * 0.04;
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.arc(x + r, y + r, r + Math.max(2, d * 0.025), 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowColor = "transparent";
  ctx.beginPath();
  ctx.arc(x + r, y + r, r, 0, Math.PI * 2);
  ctx.clip();
  const s = Math.min(src.width, src.height);
  ctx.drawImage(src, (src.width - s) / 2, (src.height - s) / 2, s, s, x, y, d, d);
  ctx.restore();
}
