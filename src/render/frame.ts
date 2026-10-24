/**
 * The frame around the screenshots: a background, padding, rounded corners, a
 * shadow and an optional window bar. Every size is a fraction of the frame's
 * width, so the player (CSS) and the MP4/GIF exports (canvas) draw the same
 * picture at any size.
 */
import type { Frame } from "../model/demo";

/** Diagonal gradients by name; any other background is a CSS color. */
export const FRAME_BACKGROUNDS: Record<string, [string, string]> = {
  aurora: ["#6d5efc", "#d16ba5"],
  ocean: ["#2563eb", "#22d3ee"],
  sunset: ["#f97316", "#ec4899"],
  mint: ["#10b981", "#a3e635"],
  dusk: ["#1e1b4b", "#475569"],
  paper: ["#f1f0f5", "#dcd9e6"],
};

export const FRAME_PRESETS: { id: string; label: string; frame: Frame }[] = [
  {
    id: "aurora",
    label: "Aurora",
    frame: { background: "aurora", padding: 0.06, radius: 0.012, shadow: true, window: "macos" },
  },
  {
    id: "ocean",
    label: "Ocean",
    frame: { background: "ocean", padding: 0.06, radius: 0.012, shadow: true, window: "none" },
  },
  {
    id: "sunset",
    label: "Sunset",
    frame: { background: "sunset", padding: 0.07, radius: 0.016, shadow: true, window: "macos" },
  },
  {
    id: "mint",
    label: "Mint",
    frame: { background: "mint", padding: 0.05, radius: 0.012, shadow: true, window: "none" },
  },
  {
    id: "dusk",
    label: "Dusk",
    frame: { background: "dusk", padding: 0.05, radius: 0.01, shadow: true, window: "macos" },
  },
  {
    id: "paper",
    label: "Paper",
    frame: { background: "paper", padding: 0.04, radius: 0.008, shadow: true, window: "macos" },
  },
];

/** The window bar's height, a fraction of the screenshot's width. */
const BAR = 0.034;

export interface FrameMetrics {
  /** Padding, a fraction of the frame's width. */
  pad: number;
  /** Window bar height, a fraction of the frame's width (0 without a bar). */
  bar: number;
  /** Corner radius, a fraction of the frame's width. */
  radius: number;
  /** Width over height of the whole frame. */
  aspect: number;
}

/** Sizes of a frame around a screenshot of the given aspect (width / height). */
export function frameMetrics(frame: Frame, aspect: number): FrameMetrics {
  const pad = Math.min(0.2, Math.max(0, frame.padding));
  const inner = 1 - 2 * pad;
  const bar = frame.window === "macos" ? BAR * inner : 0;
  const radius = Math.max(0, frame.radius) * inner;
  return { pad, bar, radius, aspect: 1 / (2 * pad + inner / aspect + bar) };
}

export function backgroundCss(background: string): string {
  const g = FRAME_BACKGROUNDS[background];
  if (g) return `linear-gradient(135deg, ${g[0]}, ${g[1]})`;
  return background === "none" ? "transparent" : background;
}

/** Whether the bar's dots and title read better dark (light backgrounds). */
export function isLightBackground(background: string): boolean {
  return background === "paper";
}

type Ctx = CanvasRenderingContext2D;

function paintBackground(ctx: Ctx, background: string, W: number, H: number) {
  const g = FRAME_BACKGROUNDS[background];
  if (g) {
    const grad = ctx.createLinearGradient(0, 0, W, H);
    grad.addColorStop(0, g[0]);
    grad.addColorStop(1, g[1]);
    ctx.fillStyle = grad;
  } else ctx.fillStyle = background === "none" ? "#0e0d14" : background;
  ctx.fillRect(0, 0, W, H);
}

/** Where the screenshot goes inside a frame of W × H pixels. */
export function innerRect(m: FrameMetrics, W: number): { x: number; y: number; w: number } {
  const p = Math.round(m.pad * W);
  return { x: p, y: p + Math.round(m.bar * W), w: W - 2 * p };
}

/** Paints the frame onto `ctx` (W × H) with `scene`, the screenshot's canvas, inside it. */
export function drawFramed(
  ctx: Ctx,
  frame: Frame,
  m: FrameMetrics,
  scene: CanvasImageSource & { width: number; height: number },
  W: number,
  H: number,
): void {
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  paintBackground(ctx, frame.background, W, H);
  const { x, y, w } = innerRect(m, W);
  const h = Math.round((scene.height / scene.width) * w);
  const bar = Math.round(m.bar * W);
  const r = m.radius * W;
  const top = y - bar;
  if (frame.shadow) {
    ctx.save();
    ctx.shadowColor = "rgba(10, 8, 24, 0.45)";
    ctx.shadowBlur = W * 0.03;
    ctx.shadowOffsetY = W * 0.012;
    ctx.fillStyle = "#0e0d14";
    ctx.beginPath();
    ctx.roundRect(x, top, w, h + bar, r);
    ctx.fill();
    ctx.restore();
  }
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(x, top, w, h + bar, r);
  ctx.clip();
  if (bar) {
    const light = isLightBackground(frame.background);
    ctx.fillStyle = light ? "#ffffff" : "#24222e";
    ctx.fillRect(x, top, w, bar);
    const dot = bar * 0.26;
    ["#ff5f57", "#febc2e", "#28c840"].forEach((c, i) => {
      ctx.fillStyle = c;
      ctx.beginPath();
      ctx.arc(x + bar * 0.75 + i * dot * 3.2, top + bar / 2, dot, 0, Math.PI * 2);
      ctx.fill();
    });
  }
  ctx.drawImage(scene, x, y, w, h);
  ctx.restore();
  ctx.restore();
}
