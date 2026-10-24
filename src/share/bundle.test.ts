import { describe, expect, it } from "bun:test";
import { emptyDemo, newStep } from "../model/demo";
import { decodeBundle, encodeBundle, fromBase64Url, toBase64Url } from "./bundle";

describe("bundle", () => {
  it("round-trips a demo and its images", async () => {
    const demo = {
      ...emptyDemo("Round trip"),
      steps: [newStep("i0", { title: "One" }), newStep("i1")],
    };
    const bytes0 = new Uint8Array([1, 2, 3, 250, 0, 7]);
    const bytes1 = new Uint8Array(5000).map((_, i) => i % 251);
    const text = await encodeBundle(demo, {
      i0: new Blob([bytes0], { type: "image/webp" }),
      i1: new Blob([bytes1], { type: "image/jpeg" }),
    });
    expect(text).toMatch(/^[A-Za-z0-9_-]+$/);
    const out = await decodeBundle(text);
    expect(out.demo.title).toBe("Round trip");
    expect(out.demo.steps.map((s) => s.title)).toEqual(["One", ""]);
    expect(new Uint8Array(await (out.blobs.i0 as Blob).arrayBuffer())).toEqual(bytes0);
    expect(new Uint8Array(await (out.blobs.i1 as Blob).arrayBuffer())).toEqual(bytes1);
    expect(out.blobs.i1?.type).toBe("image/jpeg");
  });

  it("refuses damaged input", async () => {
    await expect(decodeBundle("not-a-bundle")).rejects.toThrow();
    const good = await encodeBundle(emptyDemo(), {});
    await expect(decodeBundle(good.slice(0, Math.floor(good.length / 2)))).rejects.toThrow();
  });

  it("encodes base64url both ways", () => {
    const bytes = new Uint8Array(70_000).map((_, i) => (i * 31) % 256);
    expect(fromBase64Url(toBase64Url(bytes))).toEqual(bytes);
  });
});

describe("bundle hardening", () => {
  it("keeps only image types for the blobs it hands out", async () => {
    const text = await encodeBundle(emptyDemo(), {
      x: new Blob(["<script>"], { type: "text/html" }),
    });
    const out = await decodeBundle(text);
    expect(out.blobs.x?.type).toBe("application/octet-stream");
  });
});
