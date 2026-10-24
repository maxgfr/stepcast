/**
 * The demo as a timed film, for the MP4 and GIF exports: the camera glides to
 * each step's zoom, a cursor travels to the hotspot and clicks, the tooltip
 * pops in. `frameAt` paints any instant onto a canvas, so encoders just sample
 * it at their frame rate.
 */
import type { Box, Demo, Step } from "../model/demo";
import { playerLabels } from "../player/i18n";
import { autoPlacement } from "../player/Player";
import { FULL_VIEW, lerpView, mapBox, type View, viewFor } from "./camera";
import { drawFramed, type FrameMetrics, frameMetrics, innerRect } from "./frame";
import { bakeToCanvas, blobToImage, makeCanvas } from "./image";

export interface Shot {
  kind: "intro" | "step" | "outro";
  start: number;
  duration: number;
  index: number;
}

export interface Tour {
  demo: Demo;
  shots: Shot[];
  duration: number;
  /** Baked screenshot per step, drawn at the scene's size. */
  images: HTMLCanvasElement[];
  /** The film's size: the scene's, or the frame's around it. */
  width: number;
  height: number;
  /** With a frame: its sizes, and the canvas the scene is drawn on before going into it. */
  framed: { metrics: FrameMetrics; scene: HTMLCanvasElement } | null;
}

const MOVE = 0.8;

function words(s: string): number {
  return s.trim() ? s.trim().split(/\s+/).length : 0;
}

export function timeline(demo: Demo): { shots: Shot[]; duration: number } {
  const shots: Shot[] = [];
  let t = 0;
  if (demo.intro) {
    shots.push({ kind: "intro", start: t, duration: 2.6, index: 0 });
    t += 2.6;
  }
  demo.steps.forEach((s, i) => {
    const read = (words(s.title) + words(s.body)) / 3.2;
    const d = MOVE + Math.min(7, Math.max(2.4, read)) + (s.hotspot ? 0.6 : 0);
    shots.push({ kind: "step", start: t, duration: d, index: i });
    t += d;
  });
  shots.push({ kind: "outro", start: t, duration: 3, index: Math.max(0, demo.steps.length - 1) });
  t += 3;
  return { shots, duration: t };
}

export async function prepareTour(
  demo: Demo,
  source: (key: string) => Promise<Blob | null>,
  maxWidth: number,
): Promise<Tour> {
  const images: HTMLCanvasElement[] = [];
  let width = 0;
  let height = 0;
  for (const step of demo.steps) {
    const blob = await source(step.image);
    if (!blob) throw new Error("A screenshot is missing.");
    const img = await blobToImage(blob);
    if (!width) {
      width = Math.min(maxWidth, img.naturalWidth) & ~1;
      height = Math.round((img.naturalHeight / img.naturalWidth) * width) & ~1;
    }
    const baked = bakeToCanvas(img, step, Math.max(width, height) * 2);
    const c = makeCanvas(width, height);
    c.getContext("2d")?.drawImage(baked, 0, 0, width, height);
    images.push(c);
  }
  if (!width) throw new Error("This demo has no steps.");
  const frame = demo.theme.frame;
  if (!frame) return { demo, ...timeline(demo), images, width, height, framed: null };
  // The film is the frame: the scene keeps its size, the padding and the bar go around it.
  const metrics = frameMetrics(frame, width / height);
  const W = Math.round(width / (1 - 2 * metrics.pad)) & ~1;
  const inner = innerRect(metrics, W);
  const H = (inner.y + Math.round((height / width) * inner.w) + inner.x + 1) & ~1;
  return {
    demo,
    ...timeline(demo),
    images,
    width: W,
    height: H,
    framed: { metrics, scene: makeCanvas(width, height) },
  };
}

const center = (b: Box | null) =>
  b ? { x: b.x + b.w / 2, y: b.y + b.h / 2 } : { x: 0.5, y: 0.62 };
const ease = (t: number) => 1 - (1 - Math.min(1, Math.max(0, t))) ** 3;

function wrap(ctx: CanvasRenderingContext2D, text: string, max: number): string[] {
  const lines: string[] = [];
  for (const para of text.split("\n")) {
    let line = "";
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (ctx.measureText(next).width > max && line) {
        lines.push(line);
        line = word;
      } else line = next;
    }
    if (line) lines.push(line);
  }
  return lines;
}

function drawImage(
  ctx: CanvasRenderingContext2D,
  img: HTMLCanvasElement,
  v: View,
  W: number,
  H: number,
  alpha = 1,
) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.setTransform(v.s, 0, 0, v.s, -(v.cx - 0.5 / v.s) * W * v.s, -(v.cy - 0.5 / v.s) * H * v.s);
  ctx.drawImage(img, 0, 0, W, H);
  ctx.restore();
}

function spotlight(
  ctx: CanvasRenderingContext2D,
  boxes: Box[],
  v: View,
  W: number,
  H: number,
  k: number,
) {
  if (!boxes.length || k <= 0) return;
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, W, H);
  for (const b of boxes) {
    const m = mapBox(b, v);
    ctx.roundRect(m.x * W - 6, m.y * H - 6, m.w * W + 12, m.h * H + 12, 8);
  }
  ctx.fillStyle = `rgba(10,8,20,${0.5 * k})`;
  ctx.fill("evenodd");
  ctx.restore();
}

function card(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  title: string,
  body: string,
  button: string,
  accent: string,
  k: number,
) {
  ctx.save();
  ctx.fillStyle = `rgba(14,12,24,${0.55 * k})`;
  ctx.fillRect(0, 0, W, H);
  ctx.globalAlpha = k;
  const cw = Math.min(W * 0.6, 760);
  const pad = cw * 0.07;
  ctx.font = `700 ${cw * 0.06}px system-ui, sans-serif`;
  const tl = wrap(ctx, title, cw - pad * 2);
  ctx.font = `400 ${cw * 0.036}px system-ui, sans-serif`;
  const bl = wrap(ctx, body, cw - pad * 2);
  const ch = pad * 2 + tl.length * cw * 0.075 + bl.length * cw * 0.052 + (button ? cw * 0.13 : 0);
  const x = (W - cw) / 2;
  const y = (H - ch) / 2 + (1 - k) * 20;
  ctx.fillStyle = "#fff";
  ctx.beginPath();
  ctx.roundRect(x, y, cw, ch, 22);
  ctx.fill();
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  let ty = y + pad;
  ctx.fillStyle = "#17151f";
  ctx.font = `700 ${cw * 0.06}px system-ui, sans-serif`;
  for (const l of tl) {
    ctx.fillText(l, W / 2, ty);
    ty += cw * 0.075;
  }
  ctx.fillStyle = "#4a4756";
  ctx.font = `400 ${cw * 0.036}px system-ui, sans-serif`;
  for (const l of bl) {
    ctx.fillText(l, W / 2, ty);
    ty += cw * 0.052;
  }
  if (button) {
    ctx.font = `600 ${cw * 0.036}px system-ui, sans-serif`;
    const bw = ctx.measureText(button).width + cw * 0.08;
    const bh = cw * 0.08;
    ctx.fillStyle = accent;
    ctx.beginPath();
    ctx.roundRect(W / 2 - bw / 2, ty + cw * 0.03, bw, bh, 10);
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.textBaseline = "middle";
    ctx.fillText(button, W / 2, ty + cw * 0.03 + bh / 2);
  }
  ctx.restore();
}

function tooltip(
  ctx: CanvasRenderingContext2D,
  step: Step,
  hot: Box | null,
  W: number,
  H: number,
  k: number,
  label: string,
  view: View,
) {
  if (k <= 0 || (!step.title && !step.body)) return;
  const tw = Math.min(W * 0.36, 560);
  const pad = tw * 0.06;
  const ts = tw * 0.055;
  const bs = tw * 0.045;
  ctx.save();
  ctx.font = `650 ${ts}px system-ui, sans-serif`;
  const tl = step.title ? wrap(ctx, step.title, tw - pad * 2) : [];
  ctx.font = `400 ${bs}px system-ui, sans-serif`;
  const bl = step.body ? wrap(ctx, step.body, tw - pad * 2) : [];
  const th = pad * 2 + tl.length * ts * 1.3 + bl.length * bs * 1.45 + bs * 1.8;
  const placement =
    step.placement === "auto"
      ? autoPlacement(
          hot,
          step.highlights.map((h) => mapBox(h, view)),
          { w: tw / W, h: th / H },
        )
      : step.placement;
  let x: number;
  let y: number;
  const gap = 18;
  if (!hot) {
    x = (W - tw) / 2;
    y = H * 0.94 - th;
  } else {
    const r = { x: hot.x * W, y: hot.y * H, w: hot.w * W, h: hot.h * H };
    x = r.x + r.w / 2 - tw / 2;
    y = placement === "top" ? r.y - gap - th : r.y + r.h + gap;
    if (placement === "left") {
      x = r.x - gap - tw;
      y = r.y + r.h / 2 - th / 2;
    } else if (placement === "right") {
      x = r.x + r.w + gap;
      y = r.y + r.h / 2 - th / 2;
    }
  }
  x = Math.min(W - tw - 12, Math.max(12, x));
  y = Math.min(H - th - 12, Math.max(12, y)) + (1 - k) * 10;
  ctx.globalAlpha = k;
  ctx.shadowColor = "rgba(20,16,40,0.35)";
  ctx.shadowBlur = 30;
  ctx.shadowOffsetY = 10;
  ctx.fillStyle = "#fff";
  ctx.beginPath();
  ctx.roundRect(x, y, tw, th, 14);
  ctx.fill();
  ctx.shadowColor = "transparent";
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  let ty = y + pad;
  ctx.fillStyle = "#17151f";
  ctx.font = `650 ${ts}px system-ui, sans-serif`;
  for (const l of tl) {
    ctx.fillText(l, x + pad, ty);
    ty += ts * 1.3;
  }
  ctx.fillStyle = "#3d3a49";
  ctx.font = `400 ${bs}px system-ui, sans-serif`;
  for (const l of bl) {
    ctx.fillText(l, x + pad, ty);
    ty += bs * 1.45;
  }
  ctx.fillStyle = "#6b6878";
  ctx.font = `500 ${bs * 0.85}px system-ui, sans-serif`;
  ctx.fillText(label, x + pad, ty + bs * 0.5);
  ctx.restore();
}

function cursor(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, press: number) {
  ctx.save();
  ctx.translate(x, y);
  const s = size * (1 - press * 0.12);
  ctx.scale(s / 24, s / 24);
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(0, 19);
  ctx.lineTo(4.6, 14.6);
  ctx.lineTo(8, 22);
  ctx.lineTo(11, 20.6);
  ctx.lineTo(7.8, 13.6);
  ctx.lineTo(14, 13.6);
  ctx.closePath();
  ctx.fillStyle = "#111";
  ctx.strokeStyle = "#fff";
  ctx.lineWidth = 1.6;
  ctx.lineJoin = "round";
  ctx.shadowColor = "rgba(0,0,0,0.3)";
  ctx.shadowBlur = 4;
  ctx.fill();
  ctx.shadowColor = "transparent";
  ctx.stroke();
  ctx.restore();
}

function shotAt(tour: Tour, t: number): Shot {
  for (const s of tour.shots) if (t < s.start + s.duration) return s;
  return tour.shots[tour.shots.length - 1] as Shot;
}

/**
 * `still`: no looping animation (beacon pulse, smooth progress bar), so frames
 * repeat exactly between transitions and a GIF can merge them.
 */
export function frameAt(ctx: CanvasRenderingContext2D, tour: Tour, t: number, still = false): void {
  const { framed } = tour;
  const frame = tour.demo.theme.frame;
  if (!framed || !frame) {
    scene(ctx, tour, t, still, tour.width, tour.height);
    return;
  }
  const sc = framed.scene.getContext("2d");
  if (!sc) throw new Error("Canvas 2D is not available");
  scene(sc, tour, t, still, framed.scene.width, framed.scene.height);
  drawFramed(ctx, frame, framed.metrics, framed.scene, tour.width, tour.height);
}

/** The demo at `t` on a canvas of the scene's size, W × H. */
function scene(
  ctx: CanvasRenderingContext2D,
  tour: Tour,
  t: number,
  still: boolean,
  W: number,
  H: number,
): void {
  const words = playerLabels(tour.demo.language);
  const { demo, images } = tour;
  const accent = demo.theme.accent || "#6d5efc";
  const shot = shotAt(tour, t);
  const local = t - shot.start;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = "#0e0d14";
  ctx.fillRect(0, 0, W, H);
  const steps = demo.steps;

  if (shot.kind !== "step") {
    const img = images[shot.index];
    if (img) drawImage(ctx, img, FULL_VIEW, W, H);
    const k = ease(local / 0.5);
    if (shot.kind === "intro" && demo.intro) {
      card(
        ctx,
        W,
        H,
        demo.intro.title,
        demo.intro.body,
        demo.intro.button || words.start,
        accent,
        k,
      );
    } else {
      const o = demo.outro;
      card(ctx, W, H, o?.title || words.end, o?.body ?? "", o?.ctaLabel ?? "", accent, k);
    }
  } else {
    const i = shot.index;
    const step = steps[i] as Step;
    const prev = i > 0 ? (steps[i - 1] as Step) : null;
    const from = prev ? viewFor(prev.zoom) : FULL_VIEW;
    const to = viewFor(step.zoom);
    const v = lerpView(from, to, local / MOVE);
    const img = images[i] as HTMLCanvasElement;
    const sameImage = prev && prev.image === step.image;
    if (prev && !sameImage && local < 0.45) {
      drawImage(ctx, images[i - 1] as HTMLCanvasElement, v, W, H);
      drawImage(ctx, img, v, W, H, ease(local / 0.45));
    } else drawImage(ctx, img, v, W, H);

    spotlight(ctx, step.highlights, v, W, H, ease((local - MOVE * 0.6) / 0.4));
    const hot = step.hotspot ? mapBox(step.hotspot, v) : null;
    const appear = ease((local - MOVE) / 0.35);
    if (hot && appear > 0) {
      const r = { x: hot.x * W, y: hot.y * H, w: hot.w * W, h: hot.h * H };
      ctx.save();
      ctx.globalAlpha = appear;
      ctx.strokeStyle = accent;
      ctx.lineWidth = Math.max(2, W / 640);
      ctx.fillStyle = `${accent}22`;
      ctx.beginPath();
      ctx.roundRect(r.x, r.y, r.w, r.h, 8);
      ctx.fill();
      ctx.stroke();
      const pulse = still ? 0.35 : (local * 0.8) % 1;
      ctx.globalAlpha = appear * (1 - pulse);
      ctx.beginPath();
      ctx.arc(r.x + r.w / 2, r.y + r.h / 2, W / 160 + (pulse * W) / 50, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
    tooltip(
      ctx,
      step,
      hot,
      W,
      H,
      ease((local - MOVE - 0.15) / 0.35),
      `${i + 1} / ${steps.length}`,
      v,
    );

    // The cursor travels from the previous hotspot to this one, then clicks.
    if (step.hotspot) {
      const a = center(prev?.hotspot ? mapBox(prev.hotspot, v) : null);
      const b = center(hot);
      const travel = ease((local - 0.2) / (shot.duration * 0.45));
      const x = (a.x + (b.x - a.x) * travel) * W;
      const y = (a.y + (b.y - a.y) * travel) * H;
      const clickAt = shot.duration - 0.45;
      const press = local > clickAt ? Math.sin(Math.min(1, (local - clickAt) / 0.3) * Math.PI) : 0;
      if (press > 0) {
        ctx.save();
        ctx.strokeStyle = accent;
        ctx.globalAlpha = press;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(x, y, (1 - press) * 10 + W / 70, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
      cursor(ctx, x, y, Math.max(18, W / 55), press);
    }
  }

  const progress = still
    ? Math.min(1, (shot.start + shot.duration) / tour.duration)
    : Math.min(1, t / tour.duration);
  ctx.fillStyle = "rgba(255,255,255,0.15)";
  ctx.fillRect(0, H - 4, W, 4);
  ctx.fillStyle = accent;
  ctx.fillRect(0, H - 4, W * progress, 4);
}
