/**
 * A demo with its images in one compact string, used by share links, Gists,
 * exported HTML and embeds. Layout before compression:
 *
 *   "SCB1" | u32 LE manifest length | manifest JSON | image bytes, back to back
 *
 * The manifest is `{ demo, assets: [{ key, type, size }] }` with `demo.images`
 * left empty. The whole buffer goes through deflate-raw and then base64url,
 * so images are base64-encoded once (not inside JSON, then again in the URL).
 */
import { type Demo, parseDemo } from "../model/demo";

const MAGIC = [0x53, 0x43, 0x42, 0x31]; // "SCB1"
const MEDIA_TYPES = new Set([
  "image/webp",
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/avif",
  "audio/webm",
  "audio/ogg",
  "audio/mp4",
  "audio/mpeg",
  "audio/wav",
]);

interface Manifest {
  demo: Demo;
  assets: { key: string; type: string; size: number }[];
}

async function pipe(
  data: Uint8Array,
  stream: CompressionStream | DecompressionStream,
): Promise<Uint8Array> {
  const out = new Blob([data as BlobPart]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(out).arrayBuffer());
}

type B64Uint8 = Uint8Array & {
  toBase64?: (o: { alphabet: string; omitPadding: boolean }) => string;
};
type B64Ctor = typeof Uint8Array & {
  fromBase64?: (s: string, o: { alphabet: string }) => Uint8Array;
};

export function toBase64Url(bytes: Uint8Array): string {
  const native = (bytes as B64Uint8).toBase64;
  if (native) return native.call(bytes, { alphabet: "base64url", omitPadding: true });
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromBase64Url(text: string): Uint8Array {
  const clean = text.trim().replace(/[^A-Za-z0-9_-]/g, "");
  const native = (Uint8Array as B64Ctor).fromBase64;
  if (native) return native(clean, { alphabet: "base64url" });
  const b64 = clean.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function encodeBundle(demo: Demo, blobs: Record<string, Blob>): Promise<string> {
  const keys = Object.keys(blobs);
  const parts = await Promise.all(
    keys.map(async (k) => new Uint8Array(await (blobs[k] as Blob).arrayBuffer())),
  );
  const manifest: Manifest = {
    demo: { ...demo, images: {} },
    assets: keys.map((key, i) => ({
      key,
      type: (blobs[key] as Blob).type || "image/webp",
      size: (parts[i] as Uint8Array).length,
    })),
  };
  const json = new TextEncoder().encode(JSON.stringify(manifest));
  const total = 8 + json.length + parts.reduce((n, p) => n + p.length, 0);
  const buf = new Uint8Array(total);
  buf.set(MAGIC, 0);
  new DataView(buf.buffer).setUint32(4, json.length, true);
  buf.set(json, 8);
  let off = 8 + json.length;
  for (const p of parts) {
    buf.set(p, off);
    off += p.length;
  }
  return toBase64Url(await pipe(buf, new CompressionStream("deflate-raw")));
}

export interface DecodedBundle {
  demo: Demo;
  blobs: Record<string, Blob>;
}

export async function decodeBundle(text: string): Promise<DecodedBundle> {
  let buf: Uint8Array;
  try {
    buf = await pipe(fromBase64Url(text), new DecompressionStream("deflate-raw"));
  } catch {
    throw new Error("This link is damaged or incomplete.");
  }
  if (buf.length < 8 || MAGIC.some((b, i) => buf[i] !== b))
    throw new Error("This is not a stepcast demo.");
  const len = new DataView(buf.buffer, buf.byteOffset).getUint32(4, true);
  if (8 + len > buf.length) throw new Error("This link is damaged or incomplete.");
  const manifest = JSON.parse(new TextDecoder().decode(buf.subarray(8, 8 + len))) as Manifest;
  const parsed = parseDemo(manifest.demo);
  if (!parsed.ok) throw new Error(`Invalid demo: ${parsed.error}`);
  const blobs: Record<string, Blob> = {};
  let off = 8 + len;
  for (const a of manifest.assets ?? []) {
    if (off + a.size > buf.length) throw new Error("This link is damaged or incomplete.");
    // Only image and audio types: these blobs become object URLs on this origin.
    const type = MEDIA_TYPES.has(a.type.split(";")[0] ?? "") ? a.type : "application/octet-stream";
    blobs[a.key] = new Blob([buf.slice(off, off + a.size)], { type });
    off += a.size;
  }
  return { demo: parsed.demo, blobs };
}

/** The demo with `images` pointing at object URLs of its blobs. */
export function withObjectUrls(decoded: DecodedBundle): Demo {
  const images: Record<string, string> = {};
  for (const [k, b] of Object.entries(decoded.blobs)) images[k] = URL.createObjectURL(b);
  return { ...decoded.demo, images };
}
