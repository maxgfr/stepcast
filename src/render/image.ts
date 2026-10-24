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
/**
 * Single-line text sized like the words it replaces: a tight box around words is
 * about their height, so the font takes most of it. Longer text may widen the
 * box (up to `maxW`) before it shrinks.
 */
export function fitText(
  ctx: Canvas2D,
  text: string,
  r: { w: number; h: number },
  maxW = r.w,
  weight = 400,
) {
  let size = Math.max(8, r.h * 0.8);
  const pad = Math.min(r.h * 0.06, 4);
  let width = r.w;
  for (let i = 0; i < 14; i++) {
    ctx.font = `${weight} ${size}px system-ui, -apple-system, "Segoe UI", Helvetica, sans-serif`;
    const need = ctx.measureText(text).width + pad * 2;
    if (need <= maxW || size <= 8) {
      width = Math.max(r.w, Math.min(need, maxW));
      break;
    }
    size *= 0.92;
  }
  return { size, pad, width };
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
    const { pad, width } = fitText(ctx, edit.text, r, Math.min(r.w * 1.8, w - r.x));
    ctx.fillStyle = edit.bg;
    ctx.fillRect(r.x, r.y, width, r.h);
    ctx.fillStyle = edit.color;
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    ctx.fillText(edit.text, r.x + pad, r.y + r.h / 2 + r.h * 0.04, Math.max(1, width - pad * 2));
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

/**
 * The colors of a piece of text on screen: the background is the average along
 * the box's edge, the ink the average of the pixels inside that stand out most
 * from it. A replacement painted with both blends in.
 */
export function edgeColor(img: HTMLImageElement, b: Box): { bg: string; color: string } {
  const sx = Math.max(0, Math.floor(b.x * img.naturalWidth));
  const sy = Math.max(0, Math.floor(b.y * img.naturalHeight));
  const sw = Math.max(1, Math.min(img.naturalWidth - sx, Math.ceil(b.w * img.naturalWidth)));
  const sh = Math.max(1, Math.min(img.naturalHeight - sy, Math.ceil(b.h * img.naturalHeight)));
  const scale = Math.min(1, 600 / sw);
  const w = Math.max(1, Math.round(sw * scale));
  const h = Math.max(1, Math.round(sh * scale));
  const c = makeCanvas(w, h);
  const ctx = c.getContext("2d", { willReadFrequently: true });
  if (!ctx) return { bg: "#ffffff", color: "#111111" };
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, w, h);
  const data = ctx.getImageData(0, 0, w, h).data;
  const at = (x: number, y: number) => {
    const i = (y * w + x) * 4;
    return [data[i] as number, data[i + 1] as number, data[i + 2] as number] as const;
  };
  let r = 0;
  let g = 0;
  let bl = 0;
  let n = 0;
  const edge = (x: number, y: number) => {
    const [pr, pg, pb] = at(x, y);
    r += pr;
    g += pg;
    bl += pb;
    n++;
  };
  for (let x = 0; x < w; x++) {
    edge(x, 0);
    edge(x, h - 1);
  }
  for (let y = 1; y < h - 1; y++) {
    edge(0, y);
    edge(w - 1, y);
  }
  const bg = [r / n, g / n, bl / n] as const;
  const ink: { d: number; c: readonly [number, number, number] }[] = [];
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const p = at(x, y);
      const d = Math.abs(p[0] - bg[0]) + Math.abs(p[1] - bg[1]) + Math.abs(p[2] - bg[2]);
      if (d > 90) ink.push({ d, c: p });
    }
  }
  const hex = (v: number) => Math.round(v).toString(16).padStart(2, "0");
  const toHex = (c: readonly number[]) =>
    `#${hex(c[0] as number)}${hex(c[1] as number)}${hex(c[2] as number)}`;
  if (ink.length < 6) {
    const lum = (0.2126 * bg[0] + 0.7152 * bg[1] + 0.0722 * bg[2]) / 255;
    return { bg: toHex(bg), color: lum > 0.55 ? "#111111" : "#ffffff" };
  }
  // The core of the strokes, not their anti-aliased edges.
  ink.sort((p, q) => q.d - p.d);
  const core = ink.slice(0, Math.max(3, Math.ceil(ink.length * 0.3)));
  const avg = [0, 1, 2].map(
    (k) => core.reduce((sum, p) => sum + (p.c[k] as number), 0) / core.length,
  );
  return { bg: toHex(bg), color: toHex(avg) };
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
