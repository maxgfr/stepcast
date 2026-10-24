/**
 * Canvas helpers shared by the recorder, the AI pipeline, the editor and every
 * export. Redactions and text edits are painted into the pixels here ("baked"),
 * so a shared demo never carries what was blurred out.
 */
import type { Box, Step } from "../model/demo";

export type Canvas2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

export function ctx2d(c: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = c.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D is not available");
  return ctx;
}

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = "async";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not load an image"));
    img.src = src;
  });
}

export async function blobToImage(blob: Blob): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(blob);
  try {
    const img = await loadImage(url);
    await img.decode().catch(() => undefined);
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function canvasToBlob(
  c: HTMLCanvasElement,
  type = "image/webp",
  quality = 0.9,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    c.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("Could not encode an image"))),
      type,
      quality,
    );
  });
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

/** Size that fits inside `max` on its longest side, never upscaled. */
export function fitSize(w: number, h: number, max: number): { w: number; h: number } {
  const s = Math.min(1, max / Math.max(w, h));
  return { w: Math.max(1, Math.round(w * s)), h: Math.max(1, Math.round(h * s)) };
}

function px(b: Box, w: number, h: number) {
  return { x: b.x * w, y: b.y * h, w: b.w * w, h: b.h * h };
}

let filterSupport: boolean | null = null;
function supportsFilter(ctx: Canvas2D): boolean {
  if (filterSupport === null) {
    const before = ctx.filter;
    ctx.filter = "blur(2px)";
    filterSupport = ctx.filter === "blur(2px)";
    ctx.filter = before;
  }
  return filterSupport;
}

function pixelate(
  ctx: Canvas2D,
  img: CanvasImageSource,
  r: ReturnType<typeof px>,
  w: number,
  h: number,
) {
  const block = Math.max(6, Math.round(Math.min(r.h, r.w) / 4));
  const tw = Math.max(1, Math.ceil(r.w / block));
  const th = Math.max(1, Math.ceil(r.h / block));
  const tiny = new OffscreenCanvas(tw, th);
  const t = tiny.getContext("2d");
  if (!t) return;
  // Source region in image pixels: the image is drawn stretched to w×h.
  const iw = (img as HTMLImageElement).naturalWidth || (img as HTMLCanvasElement).width || w;
  const ih = (img as HTMLImageElement).naturalHeight || (img as HTMLCanvasElement).height || h;
  t.drawImage(img, (r.x / w) * iw, (r.y / h) * ih, (r.w / w) * iw, (r.h / h) * ih, 0, 0, tw, th);
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(tiny, r.x, r.y, r.w, r.h);
  ctx.restore();
}

/** Single-line text fitted to a box: as large as its height allows, shrunk to its width. */
export function fitText(ctx: Canvas2D, text: string, r: { w: number; h: number }, weight = 500) {
  let size = Math.max(8, r.h * 0.62);
  const pad = Math.min(r.h * 0.25, 12);
  for (let i = 0; i < 12; i++) {
    ctx.font = `${weight} ${size}px system-ui, -apple-system, "Segoe UI", sans-serif`;
    if (ctx.measureText(text).width <= r.w - pad * 2 || size <= 8) break;
    size *= 0.9;
  }
  return { size, pad };
}

/** Draws the screenshot with its redactions and text edits painted in, at w×h. */
export function drawBaked(
  ctx: Canvas2D,
  img: CanvasImageSource,
  w: number,
  h: number,
  step: Pick<Step, "redactions" | "textEdits">,
): void {
  ctx.drawImage(img, 0, 0, w, h);
  for (const red of step.redactions) {
    const r = px(red, w, h);
    if (red.style === "solid") {
      ctx.fillStyle = "#1d1b26";
      ctx.fillRect(r.x, r.y, r.w, r.h);
    } else if (red.style === "blur" && supportsFilter(ctx)) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(r.x, r.y, r.w, r.h);
      ctx.clip();
      ctx.filter = `blur(${Math.max(8, Math.round(Math.min(r.h, r.w) * 0.35))}px)`;
      // Draw twice: one blur pass still lets large text show through.
      ctx.drawImage(img, 0, 0, w, h);
      ctx.drawImage(ctx.canvas as CanvasImageSource, 0, 0);
      ctx.restore();
    } else {
      pixelate(ctx, img, r, w, h);
    }
  }
  for (const edit of step.textEdits) {
    const r = px(edit, w, h);
    ctx.fillStyle = edit.bg;
    ctx.fillRect(r.x, r.y, r.w, r.h);
    const { pad } = fitText(ctx, edit.text, r);
    ctx.fillStyle = edit.color;
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    ctx.fillText(edit.text, r.x + pad, r.y + r.h / 2, Math.max(1, r.w - pad * 2));
  }
}

/** The baked screenshot as a canvas, at most `max` pixels on its longest side. */
export function bakeToCanvas(
  img: HTMLImageElement,
  step: Pick<Step, "redactions" | "textEdits">,
  max = 4096,
): HTMLCanvasElement {
  const { w, h } = fitSize(img.naturalWidth, img.naturalHeight, max);
  const c = makeCanvas(w, h);
  drawBaked(ctx2d(c), img, w, h, step);
  return c;
}

/** Average color along a box's edge: the background a text replacement should sit on. */
export function edgeColor(img: HTMLImageElement, b: Box): { bg: string; color: string } {
  const w = 200;
  const h = Math.max(1, Math.round((img.naturalHeight / img.naturalWidth) * w));
  const c = makeCanvas(w, h);
  const ctx = c.getContext("2d", { willReadFrequently: true });
  if (!ctx) return { bg: "#ffffff", color: "#111111" };
  ctx.drawImage(img, 0, 0, w, h);
  const x0 = Math.max(0, Math.floor(b.x * w));
  const y0 = Math.max(0, Math.floor(b.y * h));
  const x1 = Math.min(w - 1, Math.ceil((b.x + b.w) * w));
  const y1 = Math.min(h - 1, Math.ceil((b.y + b.h) * h));
  const data = ctx.getImageData(0, 0, w, h).data;
  let r = 0;
  let g = 0;
  let bl = 0;
  let n = 0;
  const add = (x: number, y: number) => {
    const i = (y * w + x) * 4;
    r += data[i] as number;
    g += data[i + 1] as number;
    bl += data[i + 2] as number;
    n++;
  };
  for (let x = x0; x <= x1; x++) {
    add(x, y0);
    add(x, y1);
  }
  for (let y = y0; y <= y1; y++) {
    add(x0, y);
    add(x1, y);
  }
  if (n === 0) return { bg: "#ffffff", color: "#111111" };
  const hex = (v: number) =>
    Math.round(v / n)
      .toString(16)
      .padStart(2, "0");
  const lum = (0.2126 * r + 0.7152 * g + 0.0722 * bl) / n / 255;
  return { bg: `#${hex(r)}${hex(g)}${hex(bl)}`, color: lum > 0.55 ? "#111111" : "#ffffff" };
}

/** Text edits get the colors of what they cover, so the replacement blends in. */
export async function matchEditColors<T extends Pick<Step, "textEdits">>(
  step: T,
  url: string,
): Promise<T> {
  if (step.textEdits.length === 0 || !url) return step;
  const img = await loadImage(url);
  return { ...step, textEdits: step.textEdits.map((t) => ({ ...t, ...edgeColor(img, t) })) };
}
