import { readFile } from "node:fs/promises";
import { expect, type Page, test } from "@playwright/test";

const SHOTS = process.env.SHOTS;
async function shot(page: Page, name: string) {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` });
}

/** What the mocked model answers: two steps on the two screenshots it is shown. */
const ANSWER = {
  title: "Tour of the green screen",
  description: "A short walk through the test pattern.",
  intro: { title: "Meet the green screen", body: "Two steps, one minute." },
  outro: { title: "You made it", body: "That is the whole tour.", ctaLabel: "Start now" },
  steps: [
    {
      image: 1,
      title: "Click the shape",
      body: "This is where everything starts.",
      action: "click",
      target: "the green shape in the middle",
      hotspot: { x: 400, y: 400, w: 200, h: 200 },
      placement: "auto",
      zoom: null,
      highlights: [],
      redactions: [{ x: 0, y: 0, w: 300, h: 80, what: "timestamp" }],
      textEdits: [],
    },
    {
      image: 2,
      title: "See the result",
      body: "The screen changed.",
      action: "look",
      target: null,
      hotspot: null,
      placement: "auto",
      zoom: { x: 300, y: 300, w: 400, h: 400 },
      highlights: [{ x: 400, y: 400, w: 200, h: 200, what: "the shape" }],
      redactions: [],
      textEdits: [],
    },
  ],
};

async function mockNetwork(page: Page, requests: unknown[]) {
  // The live catalog is not needed: the bundled models.json is the fallback.
  await page.route(/models\.dev|openrouter\.ai/, (r) => r.abort());
  await page.route("http://localhost:9999/**", async (route) => {
    const req = route.request();
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
    if (req.url().endsWith("/models"))
      return route.fulfill({ json: { data: [{ id: "mock-vision" }] }, headers: cors });
    const body = req.postDataJSON();
    requests.push(body);
    // The placement pass: one small request per step, answered with exact boxes.
    const content = JSON.stringify(ANSWER);
    const placing = JSON.stringify(body).includes("You locate elements");
    const answer = placing
      ? JSON.stringify({
          items: [
            { id: 1, boxes: [{ x: 420, y: 420, w: 160, h: 160 }] },
            { id: 2, boxes: [] },
          ],
        })
      : content;
    await route.fulfill({
      headers: cors,
      json: {
        id: "chatcmpl-1",
        object: "chat.completion",
        created: 1,
        model: "mock-vision",
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: answer },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
      },
    });
  });
}
const cors = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
};

async function record(page: Page, snaps = 2, opts: { camera?: boolean; pause?: number } = {}) {
  await page.goto("./#/record");
  if (opts.camera) await page.getByLabel(/Record my camera too/).check();
  await page.getByRole("button", { name: "Start recording" }).click();
  await expect(page.getByText(/Recording ·/)).toBeVisible();
  if (opts.camera) await expect(page.getByLabel("Camera preview")).toBeVisible();
  for (let i = 0; i < snaps; i++) {
    await page.getByRole("button", { name: "Snap step" }).first().click();
    await page.waitForTimeout(opts.pause ?? 500);
  }
  await page.getByRole("button", { name: /Stop/ }).click();
  await expect(page.getByText(/How do you want to build the demo/)).toBeVisible();
}

test("home renders without errors", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("./");
  await expect(page.getByRole("heading", { name: /Record your screen/ })).toBeVisible();
  await shot(page, "home");
  expect(errors).toEqual([]);
});

test("AI mode: record, generate with a model, share a link, export HTML", async ({
  page,
  context,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const requests: unknown[] = [];
  await mockNetwork(page, requests);
  await record(page);
  await shot(page, "chooser");
  await page.getByRole("button", { name: /AI mode/ }).click();

  // Set up a model: a custom OpenAI-compatible endpoint.
  await page.getByRole("button", { name: "Set up", exact: true }).click();
  await page.getByRole("button", { name: "Custom endpoint" }).click();
  await page.getByLabel("Endpoint").fill("http://localhost:9999/v1");
  await page.getByLabel("Model name").fill("mock-vision");
  await page.getByRole("button", { name: "Test connection" }).click();
  await expect(page.getByText("Connection works.")).toBeVisible();
  await page.getByRole("button", { name: "Save" }).click();

  await page.getByLabel("What should the demo show?").fill("Show the green screen");
  await page.getByLabel("Language").selectOption("fr");
  await page.getByLabel("Text to replace 1").fill("Globex");
  await page.getByLabel("Replacement 1").fill("Acme");
  await shot(page, "ai-brief");
  await page.getByRole("button", { name: "Generate demo" }).click();
  await expect(page.locator(".step-item")).toHaveCount(2, { timeout: 20_000 });
  await expect(page.getByLabel("Demo title")).toHaveValue("Tour of the green screen");

  // The demo request (the brief and every screenshot), then one placement request per step.
  const bodies = requests.map((r) => JSON.stringify(r));
  const demo = bodies.find((b) => b.includes("Show the green screen")) ?? "";
  expect(demo.match(/data:image\/jpeg;base64/g)?.length).toBeGreaterThanOrEqual(3);
  const placing = bodies.filter((b) => b.includes("You locate elements"));
  expect(placing).toHaveLength(2);
  expect(placing.join()).toContain('the text \\"Globex\\"');

  await expect(page.locator(".layer-hotspot")).toBeVisible();
  await expect(page.locator(".layer-redaction")).toBeVisible();
  await shot(page, "ai-result");

  // Share as a link and play it.
  await page.getByRole("button", { name: "Share" }).click();
  await page.getByRole("button", { name: "Create link" }).click();
  const link = await page.getByLabel("Share link").inputValue();
  expect(link).toContain("#/play/");
  const embed = await page.getByLabel("Embed code").inputValue();
  expect(embed).toContain("#/embed/");

  const player = await context.newPage();
  await player.goto(link);
  await expect(player.getByRole("heading", { name: "Meet the green screen" })).toBeVisible();
  // A French demo: the player speaks French.
  await expect(player.locator(".sc-player")).toHaveAttribute("lang", "fr");
  await player.getByRole("button", { name: "Commencer" }).click();
  await expect(player.getByText("Click the shape")).toBeVisible();
  await shot(player, "player-step1");
  await player.getByRole("button", { name: "Suivant: Click the shape" }).click();
  await expect(player.getByText("See the result")).toBeVisible();
  await player.getByRole("button", { name: "Terminer" }).click();
  await expect(player.getByRole("link", { name: "Start now" })).toHaveCount(0); // no URL set
  await expect(player.getByRole("heading", { name: "You made it" })).toBeVisible();

  // The standalone HTML export plays without the app.
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "HTML player" }).click();
  const file = await (await download).path();
  const html = await readFile(file, "utf8");
  expect(html).toContain('id="stepcast-data"');
  const offline = await context.newPage();
  await offline.setContent(html);
  await expect(offline.getByRole("heading", { name: "Meet the green screen" })).toBeVisible();
  expect(html).toContain('<html lang="fr">');
  await offline.getByRole("button", { name: "Commencer" }).click();
  await expect(offline.getByText("Click the shape")).toBeVisible();

  // Subtitles, timed like the video
  const vtt = page.waitForEvent("download");
  await page.getByRole("button", { name: "Subtitles (.vtt)" }).click();
  const cues = await readFile(await (await vtt).path(), "utf8");
  expect(cues.startsWith("WEBVTT")).toBe(true);
  expect(cues).toContain("Click the shape");
  expect(errors).toEqual([]);
});

test("copy-paste mode builds the demo from a pasted answer", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await record(page);
  await page.getByRole("button", { name: /AI mode/ }).click();
  await page.getByLabel("What should the demo show?").fill("Show the green screen");
  await page.getByRole("button", { name: /copy-paste/ }).click();
  await page.getByRole("button", { name: "Copy prompt" }).click();
  const prompt = await page.evaluate(() => navigator.clipboard.readText());
  expect(prompt).toContain("Show the green screen");
  expect(prompt).toContain("JSON Schema");
  await expect(page.locator(".paste-preview")).toBeVisible();
  await page
    .getByPlaceholder(/"title"/)
    .fill(`Here you go:\n\`\`\`json\n${JSON.stringify(ANSWER)}\n\`\`\``);
  await page.getByRole("button", { name: "Build the demo" }).click();
  await expect(page.locator(".step-item")).toHaveCount(2);
});

test("manual mode: draw a hotspot, undo, preview", async ({ page }) => {
  await record(page, 1);
  await page.getByRole("button", { name: /Manual mode/ }).click();
  await expect(page.locator(".step-item")).toHaveCount(1);
  await page.getByLabel("Title", { exact: true }).fill("Press the shape");
  await page.getByRole("button", { name: "Hotspot" }).click();
  const stage = page.locator(".stage");
  const box = await stage.boundingBox();
  if (!box) throw new Error("no stage");
  await page.mouse.move(box.x + box.width * 0.4, box.y + box.height * 0.4);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.6, { steps: 5 });
  await page.mouse.up();
  await expect(page.locator(".layer-hotspot")).toBeVisible();
  await page.keyboard.press("Escape");
  await page.locator("body").press("Meta+z");
  await expect(page.locator(".layer-hotspot")).toHaveCount(0);
  await page.locator("body").press("Meta+Shift+z");
  await expect(page.locator(".layer-hotspot")).toBeVisible();
  await shot(page, "manual");
  await page.getByRole("button", { name: "Preview" }).click();
  await expect(page.locator("dialog .sc-hotspot")).toBeVisible();
  await expect(page.locator("dialog").getByText("Press the shape")).toBeVisible();
  await page.keyboard.press("Escape");

  // A frame goes around the stage in the player
  await page.getByRole("tab", { name: "Demo" }).click();
  await page.getByRole("button", { name: "Ocean" }).click();
  await page.getByLabel("Window bar").check();
  await page.getByRole("button", { name: "Preview" }).click();
  await expect(page.locator("dialog .sc-backdrop .sc-winbar")).toBeVisible();
  await expect(page.locator("dialog .sc-backdrop .sc-hotspot")).toBeVisible();
});

test("an agent-written JSON demo opens, and travels through a Gist", async ({ page, context }) => {
  await page.goto("./");
  const png = await page.evaluate(() => {
    const c = document.createElement("canvas");
    c.width = 320;
    c.height = 200;
    const ctx = c.getContext("2d") as CanvasRenderingContext2D;
    ctx.fillStyle = "#e8e6f5";
    ctx.fillRect(0, 0, 320, 200);
    ctx.fillStyle = "#6d5efc";
    ctx.fillRect(120, 80, 80, 30);
    return c.toDataURL("image/png");
  });
  const demo = {
    title: "Written by an agent",
    steps: [
      { image: "s1", title: "Press the button", hotspot: { x: 0.37, y: 0.4, w: 0.25, h: 0.15 } },
    ],
    images: { s1: png },
  };
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Open a stepcast file" }).click();
  await (await chooser).setFiles({
    name: "demo.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(demo)),
  });
  await expect(page.getByLabel("Demo title")).toHaveValue("Written by an agent");
  await expect(page.locator(".layer-hotspot")).toBeVisible();

  // Publish to a (mocked) Gist, then open the short link.
  let stored = "";
  await context.route("https://api.github.com/gists**", async (route) => {
    const req = route.request();
    if (req.method() === "POST") {
      expect(req.headers().authorization).toBe("Bearer ghp_test");
      stored =
        (req.postDataJSON() as { files: Record<string, { content: string }> }).files[
          "stepcast-demo.txt"
        ]?.content ?? "";
      return route.fulfill({ status: 201, json: { id: "0123456789abcdef0123" } });
    }
    return route.fulfill({
      json: { files: { "stepcast-demo.txt": { content: stored, truncated: false } } },
    });
  });
  await page.getByRole("button", { name: "Share" }).click();
  await page.getByLabel("GitHub token").fill("ghp_test");
  await page.getByRole("button", { name: "Publish" }).click();
  const link = await page.getByLabel("Gist link").inputValue();
  expect(link).toContain("#/gist/0123456789abcdef0123");
  const viewer = await context.newPage();
  await viewer.goto(link);
  await expect(viewer.getByText("Press the button")).toBeVisible();
});

test("the camera recorded next to the screen becomes a bubble in the MP4", async ({ page }) => {
  await page.context().grantPermissions(["camera"]);
  await record(page, 2, { camera: true });
  await page.getByRole("button", { name: /Manual mode/ }).click();
  await expect(page.locator(".step-item")).toHaveCount(2);
  await page.getByRole("button", { name: "Share" }).click();
  await expect(page.getByLabel("Camera bubble")).toBeChecked();
  await page.getByLabel("Bubble corner").selectOption("top-left");
  const download = page.waitForEvent("download", { timeout: 60_000 });
  await page.getByRole("button", { name: "MP4 video" }).click();
  const file = await (await download).path();
  // The top-left corner holds the bubble: the fake camera is not the screen's colors.
  const corner = await page.evaluate(
    async (bytes) => {
      const blob = new Blob([new Uint8Array(bytes)], { type: "video/mp4" });
      const video = document.createElement("video");
      video.muted = true;
      video.src = URL.createObjectURL(blob);
      await new Promise((r) => (video.onloadeddata = r));
      video.currentTime = 1.5;
      await new Promise((r) => (video.onseeked = r));
      const c = document.createElement("canvas");
      c.width = video.videoWidth;
      c.height = video.videoHeight;
      const ctx = c.getContext("2d") as CanvasRenderingContext2D;
      ctx.drawImage(video, 0, 0);
      const d = Math.min(c.width, c.height);
      const at = (x: number, y: number) =>
        Array.from(ctx.getImageData(x, y, 1, 1).data.slice(0, 3));
      // The bubble's ring is white, just outside its circle
      return {
        ring: at(Math.round(d * 0.035 + d * 0.12), Math.round(d * 0.035) - 1),
        size: [c.width, c.height],
      };
    },
    Array.from(await readFile(file)),
  );
  expect(corner.size[0]).toBeGreaterThan(0);
  expect(Math.min(...corner.ring)).toBeGreaterThan(200);
});

test("when the shared storage is full, an import says so and leaves nothing behind", async ({
  page,
}) => {
  // maxgfr.github.io is one origin for every project page: they share one quota.
  await page.goto("./");
  const png = await page.evaluate(() => {
    const c = document.createElement("canvas");
    c.width = 32;
    c.height = 20;
    return c.toDataURL("image/png");
  });
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put;
    let blobs = 0;
    IDBObjectStore.prototype.put = function (
      this: IDBObjectStore,
      ...args: [unknown, IDBValidKey?]
    ) {
      if (this.name === "blobs" && ++blobs > 1)
        throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
      return put.apply(this, args);
    };
  });
  const demo = {
    title: "Too big",
    steps: [
      { image: "s1", title: "One" },
      { image: "s2", title: "Two" },
    ],
    images: { s1: png, s2: png },
  };
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Open a stepcast file" }).click();
  await (await chooser).setFiles({
    name: "demo.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(demo)),
  });
  await expect(page.getByText("Storage for this site is full")).toBeVisible();
  const left = await page.evaluate(
    () =>
      new Promise<number>((resolve, reject) => {
        const req = indexedDB.open("stepcast");
        req.onerror = () => reject(req.error);
        req.onsuccess = () => {
          const count = req.result.transaction("blobs").objectStore("blobs").count();
          count.onsuccess = () => resolve(count.result);
        };
      }),
  );
  expect(left).toBe(0);
});

/** Opens a one-step demo written as JSON, ready to share. */
async function openJsonDemo(page: Page) {
  await page.goto("./");
  const png = await page.evaluate(() => {
    const c = document.createElement("canvas");
    c.width = 32;
    c.height = 20;
    return c.toDataURL("image/png");
  });
  const demo = { title: "Token test", steps: [{ image: "s1", title: "One" }], images: { s1: png } };
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Open a stepcast file" }).click();
  await (await chooser).setFiles({
    name: "demo.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(demo)),
  });
  await expect(page.getByLabel("Demo title")).toHaveValue("Token test");
}

/** A Gist API that accepts any upload; the tokens it was sent go into `seen`. */
async function mockGists(page: Page, seen: string[] = []) {
  await page.route("https://api.github.com/gists**", (route) => {
    seen.push(route.request().headers().authorization ?? "");
    return route.fulfill({ status: 201, json: { id: "0123456789abcdef0123" } });
  });
  return seen;
}

/** Every value of a database as text, ArrayBuffers decoded, to look for a secret in clear. */
async function dump(page: Page, name: string): Promise<string> {
  return page.evaluate(
    (dbName) =>
      new Promise<string>((resolve, reject) => {
        const req = indexedDB.open(dbName);
        req.onerror = () => reject(req.error);
        req.onsuccess = () => {
          const db = req.result;
          const stores = [...db.objectStoreNames];
          if (stores.length === 0) {
            db.close();
            return resolve("");
          }
          const tx = db.transaction(stores);
          const out: string[] = [];
          const text = (v: unknown): string => {
            if (v instanceof ArrayBuffer || ArrayBuffer.isView(v)) {
              const bytes =
                v instanceof ArrayBuffer
                  ? new Uint8Array(v)
                  : new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
              return new TextDecoder().decode(bytes);
            }
            if (v && typeof v === "object") return Object.values(v).map(text).join(" ");
            return String(v);
          };
          for (const s of stores) {
            const all = tx.objectStore(s).getAll();
            all.onsuccess = () => out.push(...all.result.map(text));
          }
          tx.oncomplete = () => {
            db.close();
            resolve(out.join("\n"));
          };
          tx.onerror = () => reject(tx.error);
        };
      }),
    name,
  );
}

const databases = (page: Page) =>
  page.evaluate(async () => (await indexedDB.databases()).map((d) => d.name ?? ""));

async function openShare(page: Page) {
  await page.getByRole("button", { name: "Share" }).click();
  await expect(page.getByLabel("GitHub token")).toBeVisible();
}

test("the Gist token is sealed at rest, and forgotten on request", async ({ page }) => {
  await openJsonDemo(page);
  const seen = await mockGists(page);
  await openShare(page);
  await page.getByLabel("GitHub token").fill("ghp_test");
  await page.getByRole("button", { name: "Publish" }).click();
  await expect(page.getByLabel("Gist link")).toBeVisible();
  expect(seen).toContain("Bearer ghp_test");
  for (const db of await databases(page)) {
    expect(await dump(page, db)).not.toContain("ghp_test");
  }
  expect(await dump(page, "stepcast-sealed")).not.toBe("");

  await page.reload();
  await openShare(page);
  await expect(page.getByLabel("GitHub token")).toHaveValue("ghp_test");
  await page.getByRole("button", { name: "Forget the token" }).click();
  await expect(page.getByLabel("GitHub token")).toHaveValue("");
  await page.reload();
  await openShare(page);
  await expect(page.getByLabel("GitHub token")).toHaveValue("");
  await expect(page.getByRole("button", { name: "Forget the token" })).toHaveCount(0);
});

test("a token sealed by an older version moves to the sealed store", async ({ page }) => {
  await openJsonDemo(page);
  const seen = await mockGists(page);
  // The layout before: the key and the sealed token in "stepcast-vault".
  await page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const req = indexedDB.open("stepcast-vault", 1);
        req.onupgradeneeded = () => req.result.createObjectStore("kv");
        req.onerror = () => reject(req.error);
        req.onsuccess = async () => {
          const db = req.result;
          const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, [
            "encrypt",
            "decrypt",
          ]);
          const iv = crypto.getRandomValues(new Uint8Array(12));
          const data = await crypto.subtle.encrypt(
            { name: "AES-GCM", iv },
            key,
            new TextEncoder().encode("ghp_test"),
          );
          const tx = db.transaction("kv", "readwrite");
          tx.objectStore("kv").put(key, "key");
          tx.objectStore("kv").put({ iv, data }, "token");
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
      }),
  );

  await openShare(page);
  await expect(page.getByLabel("GitHub token")).toHaveValue("ghp_test");
  await expect.poll(() => databases(page)).not.toContain("stepcast-vault");
  expect(await dump(page, "stepcast-sealed")).not.toContain("ghp_test");

  // Still there after a reload, from the sealed store this time, and sent with the upload.
  await page.reload();
  await openShare(page);
  await expect(page.getByLabel("GitHub token")).toHaveValue("ghp_test");
  await page.getByRole("button", { name: "Publish" }).click();
  await expect(page.getByLabel("Gist link")).toBeVisible();
  expect(seen).toContain("Bearer ghp_test");
  expect(await databases(page)).not.toContain("stepcast-vault");
});

test("a token the full storage could not keep: said, and gone after a reload", async ({ page }) => {
  await page.addInitScript(() => {
    for (const method of ["put", "add"] as const) {
      const original = IDBObjectStore.prototype[method];
      IDBObjectStore.prototype[method] = function (this: IDBObjectStore, ...args) {
        if (this.transaction.db.name === "stepcast-sealed") {
          throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
        }
        return original.apply(this, args as Parameters<typeof original>);
      };
    }
  });
  await openJsonDemo(page);
  const seen = await mockGists(page);
  await openShare(page);
  await page.getByLabel("GitHub token").fill("ghp_test");
  await page.getByRole("button", { name: "Publish" }).click();
  await expect(page.getByText(/kept for this page only/)).toBeVisible();
  await expect(page.getByLabel("Gist link")).toBeVisible();
  expect(seen).toContain("Bearer ghp_test");
  for (const db of await databases(page)) {
    expect(await dump(page, db)).not.toContain("ghp_test");
  }

  await page.reload();
  await openShare(page);
  await expect(page.getByLabel("GitHub token")).toHaveValue("");
});
