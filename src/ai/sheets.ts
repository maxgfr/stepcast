/**
 * Images prepared for a vision model: a labeled 0–1000 grid drawn over each
 * screenshot (models place boxes much better with marks to read), and contact
 * sheets of numbered thumbnails so dozens of frames fit in one cheap request.
 */
import { canvasToBlob, ctx2d, fitSize, loadImage, makeCanvas } from "../render/image";
import { GRID } from "./schema";

export interface SheetInput {
  url: string;
  label: string;
}

export interface ModelImage {
  data: Uint8Array;
  mediaType: string;
}

function badge(ctx: CanvasRenderingContext2D, x: number, y: number, text: string, size: number) {
  ctx.font = `700 ${size}px system-ui, sans-serif`;
  const w = ctx.measureText(text).width + size * 0.8;
  const h = size * 1.5;
  ctx.fillStyle = "rgba(17, 12, 40, 0.88)";
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, size * 0.35);
  ctx.fill();
  ctx.fillStyle = "#ffffff";
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  ctx.fillText(text, x + size * 0.4, y + h / 2);
}

/** Grid lines every 100 units with their values on the top and left edges. */
export function drawGrid(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
) {
  const font = Math.max(9, Math.round(Math.min(w, h) / 60));
  ctx.save();
  for (let i = 1; i < 10; i++) {
    const gx = x + (w * i) / 10;
    const gy = y + (h * i) / 10;
    for (const [color, width] of [
      ["rgba(255,255,255,0.45)", 3],
      ["rgba(236,0,140,0.55)", 1],
    ] as const) {
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.beginPath();
      ctx.moveTo(gx, y);
      ctx.lineTo(gx, y + h);
      ctx.moveTo(x, gy);
      ctx.lineTo(x + w, gy);
      ctx.stroke();
    }
  }
  ctx.font = `600 ${font}px system-ui, sans-serif`;
  ctx.textBaseline = "top";
  for (let i = 1; i < 10; i++) {
    const v = String((GRID * i) / 10);
    const tw = ctx.measureText(v).width;
    const gx = x + (w * i) / 10;
    const gy = y + (h * i) / 10;
    ctx.fillStyle = "rgba(236,0,140,0.9)";
    ctx.fillRect(gx - tw / 2 - 2, y, tw + 4, font + 3);
    ctx.fillRect(x, gy - font / 2 - 1, tw + 4, font + 3);
    ctx.fillStyle = "#fff";
    ctx.textAlign = "center";
    ctx.fillText(v, gx, y + 2);
    ctx.textAlign = "left";
    ctx.fillText(v, x + 2, gy - font / 2 + 1);
  }
  ctx.restore();
}

async function encode(c: HTMLCanvasElement): Promise<ModelImage> {
  const blob = await canvasToBlob(c, "image/jpeg", 0.85);
  return { data: new Uint8Array(await blob.arrayBuffer()), mediaType: "image/jpeg" };
}

/** One screenshot at most `max` px wide, with the grid and an optional label. */
export async function gridImage(url: string, max = 1280, label?: string): Promise<ModelImage> {
  const img = await loadImage(url);
  const { w, h } = fitSize(img.naturalWidth, img.naturalHeight, max);
  const c = makeCanvas(w, h);
  const ctx = ctx2d(c);
  ctx.drawImage(img, 0, 0, w, h);
  drawGrid(ctx, 0, 0, w, h);
  if (label)
    badge(ctx, w - Math.max(90, w / 9), h - Math.max(30, h / 22), label, Math.max(12, w / 70));
  return encode(c);
}

async function sheetCanvas(
  frames: SheetInput[],
  cols: number,
  tileW: number,
  grid: boolean,
): Promise<HTMLCanvasElement> {
  const imgs = await Promise.all(frames.map((f) => loadImage(f.url)));
  const first = imgs[0];
  const aspect = first ? first.naturalHeight / first.naturalWidth : 10 / 16;
  const tileH = Math.round(tileW * aspect);
  const gap = 12;
  const rows = Math.ceil(frames.length / cols);
  const c = makeCanvas(cols * tileW + (cols + 1) * gap, rows * tileH + (rows + 1) * gap);
  const ctx = ctx2d(c);
  ctx.fillStyle = "#e9e7f0";
  ctx.fillRect(0, 0, c.width, c.height);
  imgs.forEach((img, i) => {
    const x = gap + (i % cols) * (tileW + gap);
    const y = gap + Math.floor(i / cols) * (tileH + gap);
    ctx.drawImage(img, x, y, tileW, tileH);
    if (grid) drawGrid(ctx, x, y, tileW, tileH);
    badge(ctx, x + 6, y + 6, frames[i]?.label ?? String(i + 1), Math.max(14, tileW / 16));
  });
  return c;
}

/** Numbered thumbnails, `perSheet` per image. */
export async function contactSheets(
  frames: SheetInput[],
  perSheet = 16,
  cols = 4,
  tileW = 384,
): Promise<ModelImage[]> {
  const out: ModelImage[] = [];
  for (let i = 0; i < frames.length; i += perSheet) {
    out.push(await encode(await sheetCanvas(frames.slice(i, i + perSheet), cols, tileW, false)));
  }
  return out;
}

/** All frames on one PNG with a grid on each tile, for pasting into a chat app. */
export async function pasteSheet(frames: SheetInput[]): Promise<Blob> {
  const cols = frames.length <= 3 ? 1 : 2;
  return canvasToBlob(await sheetCanvas(frames, cols, cols === 1 ? 1100 : 820, true), "image/png");
}
