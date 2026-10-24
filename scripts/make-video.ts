/**
 * Films the product video: a real session (record a real web app, AI mode with
 * a real model, review, share, play), each tab recorded by Playwright with a
 * visible cursor, then cut together with ffmpeg between two title cards.
 *
 *   bun run build && STEPCAST_KEY=sk-ant-… bun scripts/make-video.ts
 *
 * Writes public/media/stepcast-demo.mp4 (needs ffmpeg). The key is only read
 * from the environment and typed into the app; it is never written anywhere.
 */
import { spawnSync } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { type BrowserContext, chromium, type Page } from "@playwright/test";
import { serveApp } from "./serve";

const ROOT = resolve(import.meta.dir, "..");
const KEY = process.env.STEPCAST_KEY ?? "";
if (!KEY) throw new Error("Set STEPCAST_KEY to an Anthropic key.");
const W = 1280;
const H = 800;
const TMP = join(ROOT, "test-results/video");
const OUT = join(ROOT, "public/media/stepcast-demo.mp4");
await rm(TMP, { recursive: true, force: true });
await mkdir(TMP, { recursive: true });
await mkdir(join(ROOT, "public/media"), { recursive: true });

const server = serveApp({ port: 4176, dir: join(ROOT, "dist") });
const APP = `http://localhost:${server.port}/stepcast/`;

/** A visible cursor and click ripple, drawn in every page (videos have no cursor). */
const CURSOR = `(() => {
  const mount = () => {
    if (document.getElementById("__cursor")) return;
    const c = document.createElement("div");
    c.id = "__cursor";
    c.innerHTML = '<svg width="22" height="26" viewBox="0 0 22 26"><path d="M2 2 L2 21 L7 16.5 L10.5 24 L14 22.5 L10.6 15.2 L17 15.2 Z" fill="#111" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>';
    Object.assign(c.style, { position: "fixed", left: "0", top: "0", zIndex: "2147483647", pointerEvents: "none", transform: "translate(-100px,-100px)", filter: "drop-shadow(0 1px 2px rgba(0,0,0,.35))" });
    document.documentElement.appendChild(c);
    addEventListener("mousemove", (e) => { c.style.transform = "translate(" + (e.clientX - 2) + "px," + (e.clientY - 2) + "px)"; }, true);
    addEventListener("mousedown", (e) => {
      const r = document.createElement("div");
      Object.assign(r.style, { position: "fixed", left: e.clientX - 18 + "px", top: e.clientY - 18 + "px", width: "36px", height: "36px", borderRadius: "50%", border: "3px solid #6d5efc", zIndex: "2147483646", pointerEvents: "none", transition: "transform .45s ease-out, opacity .45s ease-out", opacity: "0.9" });
      document.documentElement.appendChild(r);
      requestAnimationFrame(() => { r.style.transform = "scale(1.8)"; r.style.opacity = "0"; });
      setTimeout(() => r.remove(), 600);
    }, true);
  };
  if (document.documentElement) mount(); else addEventListener("DOMContentLoaded", mount);
})();`;

const t0 = Date.now();
const now = () => (Date.now() - t0) / 1000;
interface Cut {
  page: string;
  from: number;
  to: number;
  speed?: number;
}
const cuts: Cut[] = [];
const opened = new Map<string, number>();
let segStart = 0;
let segPage = "";
function begin(page: string) {
  segPage = page;
  segStart = now();
}
function end(speed = 1) {
  const o = opened.get(segPage) ?? 0;
  cuts.push({ page: segPage, from: segStart - o, to: now() - o, speed });
}

async function track(ctx: BrowserContext, name: string): Promise<Page> {
  const p = await ctx.newPage();
  opened.set(name, now());
  pages.set(name, p);
  return p;
}
const pages = new Map<string, Page>();

/** Moves the mouse to an element like a person would, then clicks it. */
async function click(p: Page, locator: ReturnType<Page["locator"]>, pause = 350) {
  const b = await locator.boundingBox();
  if (b) await p.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 18 });
  await p.waitForTimeout(pause);
  await locator.click();
}
async function type(p: Page, locator: ReturnType<Page["locator"]>, text: string) {
  await click(p, locator, 200);
  await locator.pressSequentially(text, { delay: 35 });
}

const browser = await chromium.launch({
  headless: false,
  args: ["--auto-select-tab-capture-source-by-title=TodoMVC"],
});
const context = await browser.newContext({
  viewport: { width: W, height: H },
  recordVideo: { dir: TMP, size: { width: W, height: H } },
  acceptDownloads: true,
});
await context.addInitScript(CURSOR);
await context.grantPermissions(["clipboard-read", "clipboard-write"], {
  origin: `http://localhost:4176`,
});
await context.route(/models\.dev|openrouter\.ai/, (r) => r.abort());

try {
  const app = await track(context, "app");
  const todo = await track(context, "todo");
  await todo.goto("https://demo.playwright.dev/todomvc/");
  await app.bringToFront();
  await app.goto(APP);
  await app.locator(".hero-demo .sc-tip").waitFor();
  await app.mouse.move(W * 0.6, H * 0.7);

  // 1. Home, then record.
  begin("app");
  await app.waitForTimeout(2500);
  await click(app, app.getByRole("button", { name: "Record a demo" }));
  await app.getByLabel("Name").waitFor();
  await app.waitForTimeout(600);
  await app.getByLabel("Name").fill("");
  await type(app, app.getByLabel("Name"), "To-do app tour");
  await app.waitForTimeout(500);
  await click(app, app.getByRole("button", { name: "Start recording" }));
  await app.getByText(/Recording ·/).waitFor();
  await app.waitForTimeout(1200);
  end();

  // 2. The product being demoed.
  await todo.bringToFront();
  await todo.waitForTimeout(800);
  begin("todo");
  await todo.mouse.move(W * 0.5, H * 0.35);
  await todo.waitForTimeout(800);
  const input = todo.getByPlaceholder("What needs to be done?");
  for (const t of [
    "Email jane.doe@acme-events.com about the launch",
    "Book the venue",
    "Order the swag",
  ]) {
    await type(todo, input, t);
    await todo.waitForTimeout(300);
    await input.press("Enter");
    await todo.waitForTimeout(900);
  }
  await click(todo, todo.getByTestId("todo-item").nth(1).getByRole("checkbox"), 600);
  await todo.waitForTimeout(900);
  for (const name of ["Active", "Completed"]) {
    await click(todo, todo.getByRole("link", { name }), 600);
    await todo.waitForTimeout(900);
  }
  end();

  // 3. Back in stepcast: stop, AI mode.
  await app.bringToFront();
  await app.waitForTimeout(400);
  begin("app");
  await app.waitForTimeout(1800);
  await click(app, app.getByRole("button", { name: /Stop/ }));
  await app.getByText(/How do you want to build the demo/).waitFor();
  await app.waitForTimeout(1500);
  end();
  // Model setup is not part of the story: done off camera.
  await app.getByRole("button", { name: /AI mode/ }).click();
  await app.getByRole("button", { name: "Set up", exact: true }).click();
  await app.getByLabel("Provider").selectOption({ label: "Anthropic" });
  await app.getByLabel("API key").fill(KEY);
  await app.getByRole("button", { name: "Save" }).click();
  await app.getByLabel("What should the demo show?").waitFor();
  begin("app");
  await app.waitForTimeout(700);
  await type(
    app,
    app.getByLabel("What should the demo show?"),
    "How to add tasks, tick one off, and filter what is left and what is done",
  );
  await app.waitForTimeout(400);
  await type(app, app.getByLabel("Text to replace 1"), "Order the swag");
  await type(app, app.getByLabel("Replacement 1"), "Order the t-shirts");
  await app.waitForTimeout(700);
  await click(app, app.getByRole("button", { name: "Generate demo" }));
  await app.waitForTimeout(1500);
  end();
  begin("app");
  await app.locator(".step-item").first().waitFor({ timeout: 300_000 });
  end(8); // the model at work, sped up
  begin("app");
  await app.waitForTimeout(2200);

  // 4. The result: walk through a few steps.
  for (const i of [1, 2, 4]) {
    await click(app, app.locator(".step-select").nth(i), 250);
    await app.waitForTimeout(1600);
  }
  await click(app, app.getByRole("button", { name: "Preview" }));
  await app.locator("dialog .sc-tip").waitFor();
  await app.waitForTimeout(1800);
  for (let i = 0; i < 3; i++) {
    const hot = app.locator("dialog .sc-hotspot");
    if (await hot.count()) await click(app, hot, 400);
    else await click(app, app.locator("dialog").getByRole("button", { name: /Next|Finish/ }), 400);
    await app.waitForTimeout(1700);
  }
  await app.keyboard.press("Escape");
  await app.waitForTimeout(500);

  // 5. Share.
  await click(app, app.getByRole("button", { name: "Share", exact: true }));
  await app.waitForTimeout(900);
  await click(app, app.getByRole("button", { name: "Create link" }));
  await app.getByLabel("Share link").waitFor();
  await app.waitForTimeout(800);
  await click(app, app.getByRole("button", { name: "Copy" }).first());
  await app.waitForTimeout(1500);
  const link = await app.getByLabel("Share link").inputValue();
  end();

  // 6. Someone opens the link.
  const viewer = await track(context, "viewer");
  await viewer.goto(link);
  await viewer.mouse.move(W * 0.5, H * 0.8);
  await viewer.locator(".sc-player").waitFor();
  await viewer.waitForTimeout(1000); // the recording starts before the first paint
  begin("viewer");
  await viewer.waitForTimeout(1500);
  const start = viewer.getByRole("button", { name: "Start" });
  if (await start.count()) await click(viewer, start);
  for (let i = 0; i < 4; i++) {
    await viewer.waitForTimeout(1900);
    const hot = viewer.locator(".sc-hotspot");
    if (await hot.count()) await click(viewer, hot, 300);
    else await viewer.keyboard.press("ArrowRight");
  }
  await viewer.waitForTimeout(2000);
  end();
} finally {
  const paths = new Map<string, string>();
  for (const [name, p] of pages) {
    await p.close();
    const path = await p.video()?.path();
    if (path) paths.set(name, path);
  }
  await context.close();
  await browser.close();
  server.stop();

  // Title cards, rendered by the browser.
  const cards = await chromium.launch();
  const cp = await cards.newPage({ viewport: { width: W, height: H } });
  const card = async (file: string, title: string, sub: string) => {
    await cp.setContent(`<body style="margin:0;height:100vh;display:grid;place-items:center;background:#f6f5fa;font-family:system-ui,-apple-system,sans-serif">
      <div style="text-align:center">
        <div style="display:inline-flex;align-items:center;gap:14px;font-weight:750;font-size:34px;letter-spacing:-.03em;color:#17151f">
          <svg width="48" height="48" viewBox="0 0 32 32"><rect width="32" height="32" rx="9" fill="#6d5efc"/><path d="M9 21.5h5v-5h5v-5h5" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/><circle cx="24" cy="11.5" r="2.4" fill="#fff"/></svg>stepcast</div>
        <h1 style="margin:36px 0 12px;font-size:54px;letter-spacing:-.035em;color:#17151f;line-height:1.05">${title}</h1>
        <p style="margin:0;font-size:22px;color:#4a4756">${sub}</p>
      </div></body>`);
    await cp.screenshot({ path: join(TMP, file) });
  };
  await card(
    "intro.png",
    "Record your screen.<br>Get a click-through demo.",
    "AI picks the key screens and writes every step.",
  );
  await card(
    "outro.png",
    "Make yours in a minute",
    "maxgfr.github.io/stepcast · free, open source, nothing uploaded",
  );
  await cards.close();

  // Cut and join: every part re-encoded to the same size and frame rate.
  const parts: string[] = [];
  const ff = (args: string[]) => {
    const r = spawnSync("ffmpeg", ["-loglevel", "error", "-y", ...args], { stdio: "inherit" });
    if (r.status !== 0) throw new Error(`ffmpeg failed: ${args.join(" ")}`);
  };
  const enc = [
    "-r",
    "30",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-preset",
    "slow",
    "-crf",
    "22",
    "-an",
  ];
  const still = (img: string, secs: number) => {
    const out = join(TMP, `part-${parts.length}.mp4`);
    ff([
      "-loop",
      "1",
      "-t",
      String(secs),
      "-i",
      join(TMP, img),
      "-vf",
      `scale=${W}:${H},fade=in:0:12,fade=out:st=${secs - 0.4}:d=0.4`,
      ...enc,
      out,
    ]);
    parts.push(out);
  };
  still("intro.png", 3.2);
  for (const c of cuts) {
    const src = paths.get(c.page);
    if (!src || c.to <= c.from) continue;
    const out = join(TMP, `part-${parts.length}.mp4`);
    const speed = c.speed ?? 1;
    ff([
      "-ss",
      c.from.toFixed(2),
      "-to",
      c.to.toFixed(2),
      "-i",
      src,
      "-vf",
      `setpts=PTS/${speed},scale=${W}:${H}`,
      ...enc,
      out,
    ]);
    parts.push(out);
  }
  still("outro.png", 3.5);
  const list = join(TMP, "list.txt");
  await writeFile(list, parts.map((p) => `file '${p}'`).join("\n"));
  ff([
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    list,
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-crf",
    "23",
    "-preset",
    "slow",
    "-movflags",
    "+faststart",
    OUT,
  ]);
  console.log(`wrote ${OUT}`);
  console.log(JSON.stringify(cuts));
}
