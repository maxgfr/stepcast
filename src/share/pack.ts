/**
 * A demo ready to leave the app: each screenshot resized, its redactions and
 * text edits painted into the pixels (a shared file never holds what was
 * blurred), re-encoded to WebP, and steps that share a picture share its bytes.
 */
import type { Demo } from "../model/demo";
import { bakeToCanvas, blobToImage, canvasToBlob } from "../render/image";
import { encodeBundle } from "./bundle";

export interface Packed {
  demo: Demo;
  blobs: Record<string, Blob>;
}

export type BlobSource = (key: string) => Promise<Blob | null>;

async function encodeImage(c: HTMLCanvasElement, quality: number): Promise<Blob> {
  const webp = await canvasToBlob(c, "image/webp", quality);
  // Safari encodes PNG when asked for WebP; JPEG is far smaller then.
  return webp.type === "image/webp" ? webp : canvasToBlob(c, "image/jpeg", quality);
}

export async function packDemo(
  demo: Demo,
  source: BlobSource,
  maxSide = 1600,
  quality = 0.82,
): Promise<Packed> {
  const blobs: Record<string, Blob> = {};
  const keys = new Map<string, string>();
  const steps = [];
  for (const step of demo.steps) {
    const sig = JSON.stringify([step.image, step.redactions, step.textEdits]);
    let key = keys.get(sig);
    if (!key) {
      const blob = await source(step.image);
      if (!blob) throw new Error(`A screenshot is missing (step "${step.title || step.id}").`);
      const img = await blobToImage(blob);
      key = `i${keys.size}`;
      blobs[key] = await encodeImage(bakeToCanvas(img, step, maxSide), quality);
      keys.set(sig, key);
    }
    steps.push({ ...step, image: key, redactions: [], textEdits: [] });
  }
  return { demo: { ...demo, steps, images: {} }, blobs };
}

/** Longest bundle a share link carries; browsers accept 2 MB URLs, chat apps far less. */
export const LINK_LIMIT = 1_900_000;

const LADDER: [number, number][] = [
  [1600, 0.8],
  [1280, 0.7],
  [1024, 0.6],
  [800, 0.5],
];

/** The smallest-loss bundle under `limit` characters, trying lower resolutions in turn. */
export async function bundleForLink(
  demo: Demo,
  source: BlobSource,
  limit = LINK_LIMIT,
): Promise<{ bundle: string; fits: boolean; side: number }> {
  let last = { bundle: "", fits: false, side: 0 };
  for (const [side, q] of LADDER) {
    const packed = await packDemo(demo, source, side, q);
    const bundle = await encodeBundle(packed.demo, packed.blobs);
    last = { bundle, fits: bundle.length <= limit, side };
    if (last.fits) return last;
  }
  return last;
}

/** The app's own URL, where share links point. */
export function appUrl(): string {
  if (
    typeof location === "undefined" ||
    location.protocol === "blob:" ||
    location.protocol === "file:"
  ) {
    return "https://maxgfr.github.io/stepcast/";
  }
  return `${location.origin}${location.pathname}`;
}
