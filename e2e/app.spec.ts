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

async function record(page: Page, snaps = 2) {
  await page.goto("./#/record");
  await page.getByRole("button", { name: "Start recording" }).click();
  await expect(page.getByText(/Recording ·/)).toBeVisible();
  for (let i = 0; i < snaps; i++) {
    await page.getByRole("button", { name: "Snap step" }).first().click();
    await page.waitForTimeout(500);
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
