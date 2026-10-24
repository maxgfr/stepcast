/**
 * Builds the demo on the home page, a stepcast tour of stepcast: Playwright
 * drives the built app (fake screen capture, a mocked model), screenshots each
 * screen, places hotspots on the real elements' boxes, and writes the bundle to
 * public/examples/sample.txt. Also saves a GIF of it for the README through the
 * app's own GIF export.
 *
 *   bun run build && bun scripts/make-sample.ts
 */
import { writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { chromium, type Locator, type Page } from "@playwright/test";
import { type Box, parseDemo } from "../src/model/demo";
import { encodeBundle } from "../src/share/bundle";
import { serveApp } from "./serve";

const ROOT = resolve(import.meta.dir, "..");
const W = 1280;
const H = 800;
const server = serveApp({ port: 4174, dir: join(ROOT, "dist") });
const BASE = `http://localhost:${server.port}/stepcast/`;

const browser = await chromium.launch({
  args: [
    "--use-fake-ui-for-media-stream",
    "--use-fake-device-for-media-stream",
    "--auto-accept-this-tab-capture",
    "--auto-select-desktop-capture-source=Entire screen",
  ],
});
const context = await browser.newContext({
  viewport: { width: W, height: H },
  deviceScaleFactor: 1.5,
});
const page = await context.newPage();
await page.route(/models\.dev|openrouter\.ai/, (r) => r.abort());

const ANSWER = {
  title: "Onboarding: create your first project",
  description: "From an empty workspace to a shared project in four clicks.",
  intro: { title: "Your first project", body: "Four clicks." },
  outro: { title: "Done", body: "", ctaLabel: "Try it" },
  steps: [1, 2, 3].map((image) => ({
    image,
    title: ["Open the workspace", "Create a project", "Invite your team"][image - 1],
    body: "The AI wrote this tooltip from your screenshot.",
    action: "click",
    target: "the main button",
    hotspot: { x: 380, y: 420, w: 240, h: 120 },
    placement: "auto",
    zoom: null,
    highlights: [],
    redactions: image === 1 ? [{ x: 20, y: 20, w: 260, h: 50, what: "email" }] : [],
    textEdits: [],
  })),
};
await page.route("http://localhost:9999/**", async (route) => {
  const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "*" };
  if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
  if (route.request().url().endsWith("/models"))
    return route.fulfill({ headers: cors, json: { data: [] } });
  await new Promise((r) => setTimeout(r, 400));
  await route.fulfill({
    headers: cors,
    json: {
      id: "x",
      object: "chat.completion",
      created: 1,
      model: "m",
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: JSON.stringify(ANSWER) },
          finish_reason: "stop",
        },
      ],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    },
  });
});

interface Shot {
  png: Buffer;
  hotspot: Box | null;
}

async function boxOf(el: Locator, pad = 6): Promise<Box> {
  const b = await el.boundingBox();
  if (!b) throw new Error("element not visible");
  return {
    x: (b.x - pad) / W,
    y: (b.y - pad) / H,
    w: (b.width + pad * 2) / W,
    h: (b.height + pad * 2) / H,
  };
}

async function capture(p: Page, target: Locator | null): Promise<Shot> {
  await p.waitForTimeout(700);
  return { png: await p.screenshot(), hotspot: target ? await boxOf(target) : null };
}

const shots: Shot[] = [];
await page.goto(BASE);
await page.evaluate(() => document.querySelector(".hero-demo")?.remove());
shots.push(await capture(page, page.getByRole("button", { name: "Record a demo" })));

await page.goto(`${BASE}#/record`);
await page.getByLabel("Name").fill("Onboarding tour");
shots.push(await capture(page, page.getByRole("button", { name: "Start recording" })));

await page.getByRole("button", { name: "Start recording" }).click();
for (let i = 0; i < 3; i++) {
  await page.waitForTimeout(900);
  await page.getByRole("button", { name: "Snap step" }).first().click();
}
await page.waitForTimeout(600);
shots.push(await capture(page, page.getByRole("button", { name: "Snap step" }).first()));

await page.getByRole("button", { name: /Stop/ }).click();
shots.push(await capture(page, page.getByRole("button", { name: /AI mode/ })));

await page.getByRole("button", { name: /AI mode/ }).click();
await page.getByRole("button", { name: "Set up", exact: true }).click();
await page.getByRole("button", { name: "Custom endpoint" }).click();
await page.getByLabel("Endpoint").fill("http://localhost:9999/v1");
await page.getByLabel("Model name").fill("claude-sonnet-5");
await page.getByRole("button", { name: "Save" }).click();
await page
  .getByLabel("What should the demo show?")
  .fill("How a new user creates their first project and invites the team");
const goal = await boxOf(page.getByLabel("What should the demo show?"), 4);
const brief = await capture(page, page.getByRole("button", { name: "Generate demo" }));
shots.push(brief);

await page.getByRole("button", { name: "Generate demo" }).click();
await page.locator(".step-item").nth(2).waitFor();
await page.waitForTimeout(600);
shots.push(await capture(page, page.getByRole("button", { name: "Share" })));

await page.getByRole("button", { name: "Share" }).click();
const createLink = page.getByRole("button", { name: "Create link" });
const shareShot = await capture(page, createLink);
shots.push(shareShot);

// Screenshots → WebP, through the browser's encoder.
const webps: Blob[] = [];
for (const s of shots) {
  const b64 = await page.evaluate(async (png) => {
    const img = new Image();
    img.src = `data:image/png;base64,${png}`;
    await img.decode();
    const c = document.createElement("canvas");
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    c.getContext("2d")?.drawImage(img, 0, 0);
    const url = c.toDataURL("image/webp", 0.82);
    return url.slice(url.indexOf(",") + 1);
  }, s.png.toString("base64"));
  webps.push(new Blob([Buffer.from(b64, "base64")], { type: "image/webp" }));
}

const text: [string, string][] = [
  [
    "Start a recording",
    "Everything happens in your browser: no account, no upload. Hit Record to begin.",
  ],
  ["Pick what to share", "A tab gives the sharpest screenshots. Name the demo, then start."],
  [
    "Click through your product",
    "Each new screen is captured on its own. Snap step marks the ones you want for sure.",
  ],
  [
    "Let AI direct",
    "AI mode is the fast path: it picks the key screens and writes every step for you.",
  ],
  [
    "Say what to show",
    "Describe the story in one sentence. Bring your own key, or use copy-paste with any chat app.",
  ],
  [
    "Review, then share",
    "Hotspots, tooltips, zooms and blurs are in place. Adjust anything by hand.",
  ],
  [
    "One link, no server",
    "The whole demo fits in the link. Or embed it, or export HTML, MP4 or GIF.",
  ],
];

const res = parseDemo({
  title: "How stepcast works",
  description: "Record your screen, let AI write the demo, share a link.",
  theme: { accent: "#6d5efc" },
  intro: null,
  outro: {
    title: "Make your first demo",
    body: "It takes a minute, and nothing leaves your browser.",
    ctaLabel: "Record a demo",
    ctaUrl: "https://maxgfr.github.io/stepcast/#/record",
  },
  steps: shots.map((s, i) => ({
    image: `i${i}`,
    title: text[i]?.[0] ?? "",
    body: text[i]?.[1] ?? "",
    hotspot: s.hotspot,
    zoom:
      i === 4
        ? { x: 0.18, y: 0.1, w: 0.66, h: 0.86 }
        : i === 6
          ? { x: 0.16, y: 0.06, w: 0.68, h: 0.6 }
          : null,
    highlights: i === 4 ? [goal] : [],
  })),
});
if (!res.ok) throw new Error(res.error);
const blobs = Object.fromEntries(webps.map((b, i) => [`i${i}`, b]));
const bundle = await encodeBundle(res.demo, blobs);
await writeFile(join(ROOT, "public/examples/sample.txt"), bundle);
console.log(`sample: ${shots.length} steps, ${(bundle.length / 1024).toFixed(0)} KiB`);

// A GIF of the tour for the README, made by the app's own export.
if (process.argv.includes("--gif")) {
  await page.goto(BASE);
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Open a stepcast file" }).click();
  await (await chooser).setFiles({
    name: "sample.txt",
    mimeType: "text/plain",
    buffer: Buffer.from(bundle),
  });
  await page.getByRole("button", { name: "Share", exact: true }).click();
  const dl = page.waitForEvent("download", { timeout: 300_000 });
  await page.getByRole("button", { name: "GIF" }).click();
  await (await dl).saveAs(join(ROOT, "docs/demo.gif"));
  console.log("docs/demo.gif written");
}

await browser.close();
server.stop();
