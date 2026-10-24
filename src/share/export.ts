/**
 * Files to take away: a single self-contained HTML player, the project JSON,
 * an MP4 (WebCodecs through mediabunny, WebM when H.264 cannot be encoded) and
 * a GIF (gifenc), plus the embed snippet.
 */
import type { Demo } from "../model/demo";
import { frameAt, prepareTour } from "../render/tour";
import { encodeBundle } from "./bundle";
import { appUrl, type BlobSource, packDemo } from "./pack";

export function download(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.rel = "noopener";
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export function fileName(title: string, ext: string): string {
  const slug = title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/[\s_-]+/g, "-")
    .slice(0, 60);
  return `${slug || "stepcast-demo"}.${ext}`;
}

const escapeHtml = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string,
  );

async function playerAssets(): Promise<{ js: string; css: string }> {
  const [js, css] = await Promise.all(
    ["./player/player.js", "./player/player.css"].map(async (u) => {
      const res = await fetch(u);
      if (!res.ok) throw new Error("The player could not be loaded. Are you offline?");
      return res.text();
    }),
  );
  return { js: js as string, css: css as string };
}

export function standaloneHtml(title: string, bundle: string, js: string, css: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="generator" content="stepcast" />
<title>${escapeHtml(title)}</title>
<style>
html,body{margin:0;min-height:100%;background:#f3f2f7}
.stepcast-page{box-sizing:border-box;max-width:1240px;margin:0 auto;padding:clamp(12px,4vw,40px)}
@media (prefers-color-scheme:dark){html,body{background:#121118}.sc-foot{color:#a09cb0}}
${css}
</style>
</head>
<body>
<main class="stepcast-page"><div id="stepcast"></div></main>
<script type="text/plain" id="stepcast-data">${bundle}</script>
<script type="module">${js.replace(/<\/script/gi, "<\\/script")}</script>
</body>
</html>
`;
}

export async function exportHtml(demo: Demo, source: BlobSource): Promise<Blob> {
  const packed = await packDemo(demo, source);
  const [bundle, assets] = await Promise.all([
    encodeBundle(packed.demo, packed.blobs),
    playerAssets(),
  ]);
  return new Blob([standaloneHtml(demo.title, bundle, assets.js, assets.css)], {
    type: "text/html",
  });
}

/** The project as JSON, screenshots inlined as data: URLs (not baked: it stays editable). */
export async function exportJson(demo: Demo, source: BlobSource): Promise<Blob> {
  const images: Record<string, string> = {};
  for (const s of demo.steps) {
    if (images[s.image]) continue;
    const blob = await source(s.image);
    if (blob) {
      images[s.image] = await new Promise<string>((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result));
        r.onerror = () => reject(r.error);
        r.readAsDataURL(blob);
      });
    }
  }
  return new Blob([JSON.stringify({ ...demo, images }, null, 2)], { type: "application/json" });
}

export function embedSnippet(link: string, title: string): string {
  const src = link.replace("#/play/", "#/embed/").replace("#/gist/", "#/embed/gist/");
  return `<iframe src="${escapeHtml(src)}" title="${escapeHtml(title)}" style="width:100%;aspect-ratio:16/10;border:0;border-radius:12px" allow="fullscreen" loading="lazy"></iframe>`;
}

export function playLink(bundle: string): string {
  return `${appUrl()}#/play/${bundle}`;
}

export function gistLink(id: string): string {
  return `${appUrl()}#/gist/${id}`;
}

export type Progress = (ratio: number) => void;

export async function exportVideo(
  demo: Demo,
  source: BlobSource,
  onProgress: Progress,
  signal?: AbortSignal,
): Promise<Blob> {
  const {
    BufferTarget,
    CanvasSource,
    Mp4OutputFormat,
    Output,
    QUALITY_HIGH,
    WebMOutputFormat,
    canEncodeVideo,
  } = await import("mediabunny");
  if (typeof VideoEncoder === "undefined")
    throw new Error("This browser cannot encode video (no WebCodecs).");
  const tour = await prepareTour(demo, source, 1920);
  const canvas = document.createElement("canvas");
  canvas.width = tour.width;
  canvas.height = tour.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D is not available");
  const size = { width: tour.width, height: tour.height };
  const mp4 = await canEncodeVideo("avc", size);
  const codec = mp4 ? "avc" : (await canEncodeVideo("vp9", size)) ? "vp9" : "vp8";
  const output = new Output({
    format: mp4 ? new Mp4OutputFormat({ fastStart: "in-memory" }) : new WebMOutputFormat(),
    target: new BufferTarget(),
  });
  const video = new CanvasSource(canvas, { codec, quality: QUALITY_HIGH });
  output.addVideoTrack(video, { frameRate: 30 });
  await output.start();
  const fps = 30;
  const total = Math.ceil(tour.duration * fps);
  for (let f = 0; f < total; f++) {
    if (signal?.aborted) {
      await output.cancel();
      throw new DOMException("Cancelled", "AbortError");
    }
    frameAt(ctx, tour, f / fps);
    await video.add(f / fps, 1 / fps);
    if (f % 10 === 0) onProgress(f / total);
  }
  await output.finalize();
  onProgress(1);
  const buffer = output.target.buffer;
  if (!buffer) throw new Error("The video could not be written.");
  return new Blob([buffer], { type: mp4 ? "video/mp4" : "video/webm" });
}

function sameFrame(a: Uint8ClampedArray, b: Uint8ClampedArray): boolean {
  if (a.length !== b.length) return false;
  const x = new Uint32Array(a.buffer, a.byteOffset, a.length / 4);
  const y = new Uint32Array(b.buffer, b.byteOffset, b.length / 4);
  for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return false;
  return true;
}

export async function exportGif(
  demo: Demo,
  source: BlobSource,
  onProgress: Progress,
  signal?: AbortSignal,
): Promise<Blob> {
  const { GIFEncoder, applyPalette, quantize } = await import("gifenc");
  const tour = await prepareTour(demo, source, 880);
  const canvas = document.createElement("canvas");
  canvas.width = tour.width;
  canvas.height = tour.height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Canvas 2D is not available");
  const gif = GIFEncoder();
  const fps = 10;
  const total = Math.ceil(tour.duration * fps);

  // One palette for the whole film, from a sample of every shot: unchanged
  // pixels then keep the same index from frame to frame.
  const sample: number[] = [];
  for (const shot of tour.shots) {
    frameAt(ctx, tour, shot.start + shot.duration * 0.8, true);
    const { data } = ctx.getImageData(0, 0, tour.width, tour.height);
    for (let i = 0; i < data.length; i += 4 * 7)
      sample.push(data[i] as number, data[i + 1] as number, data[i + 2] as number, 255);
  }
  const palette = quantize(new Uint8ClampedArray(sample), 255);
  while (palette.length < 256) palette.push([0, 0, 0]);
  const TRANSPARENT = 255;

  // Identical frames (a step holding still) become one frame with a longer
  // delay. After the first frame, pixels whose color index did not change are
  // transparent over the previous frame, which LZW packs into almost nothing.
  let pending: { data: Uint8ClampedArray; frames: number } | null = null;
  let shown: Uint8Array | null = null;
  const flush = () => {
    if (!pending) return;
    const index = applyPalette(pending.data, palette.slice(0, TRANSPARENT));
    const delay = (1000 / fps) * pending.frames;
    if (!shown) {
      gif.writeFrame(index, tour.width, tour.height, { palette, delay });
      shown = index;
      return;
    }
    const delta = index.slice();
    for (let i = 0; i < delta.length; i++) if (delta[i] === shown[i]) delta[i] = TRANSPARENT;
    gif.writeFrame(delta, tour.width, tour.height, {
      delay,
      transparent: true,
      transparentIndex: TRANSPARENT,
      dispose: 1,
    });
    shown = index;
  };
  for (let f = 0; f < total; f++) {
    if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
    frameAt(ctx, tour, f / fps, true);
    const { data } = ctx.getImageData(0, 0, tour.width, tour.height);
    if (pending && sameFrame(pending.data, data)) pending.frames++;
    else {
      flush();
      pending = { data, frames: 1 };
    }
    if (f % 5 === 0) {
      onProgress(f / total);
      await new Promise((r) => setTimeout(r, 0));
    }
  }
  flush();
  gif.finish();
  onProgress(1);
  return new Blob([gif.bytes() as BlobPart], { type: "image/gif" });
}
