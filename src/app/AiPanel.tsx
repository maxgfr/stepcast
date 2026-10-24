/**
 * The AI mode's dialog: pick a model (llm-connect), write the brief, generate.
 * Without a key, the same prompt and pictures go through any chat app and the
 * answer is pasted back.
 */
import { signal, useSignal } from "@preact/signals";
import { RESPONSE_LANGUAGES, toLanguageCode } from "llm-connect";
import { useEffect, useRef } from "preact/hooks";
import { type Brief, DEFAULT_BRIEF, type FrameNote, pastePrompt } from "../ai/prompts";
import { parseDemoAnswer, stepsFromAnswer } from "../ai/schema";
import { llm, llmState, loadLlmSettings, modelLabel, savedSettings } from "../ai/settings";
import { pasteSheet } from "../ai/sheets";
import type { Demo, Step } from "../model/demo";
import type { Frame } from "../model/store";
import { matchEditColors } from "../render/image";
import { assetUrl, project, selectedStep, updateDemo } from "./state";
import { Button, copyText, errorText, Field, Icon, Modal, toast } from "./ui";

const BRIEF_KEY = "stepcast-brief";
/** Older briefs stored the language's name ("French"): keep its code. */
function migrate(b: Brief): Brief {
  return { ...b, language: toLanguageCode(b.language) };
}
function loadBrief(): Brief {
  try {
    const raw = localStorage.getItem(BRIEF_KEY);
    return raw
      ? migrate({
          ...DEFAULT_BRIEF,
          ...(JSON.parse(raw) as Partial<Brief>),
          goal: "",
          replacements: [],
        })
      : DEFAULT_BRIEF;
  } catch {
    return DEFAULT_BRIEF;
  }
}
export const brief = signal<Brief>(loadBrief());
function saveBrief(b: Brief) {
  brief.value = b;
  try {
    // The goal and the replacements belong to one recording: not remembered.
    localStorage.setItem(BRIEF_KEY, JSON.stringify({ ...b, goal: "", replacements: [] }));
  } catch {
    // Storage may be unavailable; the brief still works for this session.
  }
}

const TONES = [
  "friendly and concise",
  "professional",
  "playful",
  "technical and precise",
  "enthusiastic, marketing",
];

/** The screenshots the AI works from: every captured frame, or the steps' images. */
export function aiFrames(): (FrameNote & { asset: string; url: string })[] {
  const p = project.value;
  if (!p) return [];
  const frames: Frame[] = p.frames.length
    ? p.frames
    : p.demo.steps.map((s) => ({
        id: s.id,
        asset: s.image,
        time: s.time ?? 0,
        diff: null,
        pinned: true,
        width: 0,
        height: 0,
      }));
  return frames
    .slice()
    .sort((a, b) => a.time - b.time)
    .map((f) => ({
      asset: f.asset,
      url: assetUrl(f.asset),
      time: f.time,
      pinned: f.pinned,
      diff: f.diff,
    }));
}

async function applyResult(
  steps: Step[],
  meta: {
    title: string;
    description: string;
    intro: { title: string; body: string };
    outro: { title: string; body: string; ctaLabel: string };
  },
  keep: boolean,
) {
  const colored = await Promise.all(steps.map((s) => matchEditColors(s, assetUrl(s.image))));
  updateDemo((d): Demo => {
    const untitled = !d.title || d.title === "Untitled demo";
    return {
      ...d,
      title: untitled && meta.title ? meta.title : d.title,
      description: d.description || meta.description,
      // The texts are now in the brief's language: so are the player's buttons.
      language: toLanguageCode(brief.value.language),
      intro: meta.intro.title
        ? { title: meta.intro.title, body: meta.intro.body, button: d.intro?.button ?? "" }
        : d.intro,
      outro: meta.outro.title
        ? {
            title: meta.outro.title,
            body: meta.outro.body,
            ctaLabel: meta.outro.ctaLabel,
            ctaUrl: d.outro?.ctaUrl ?? "",
          }
        : d.outro,
      steps: keep ? [...d.steps, ...colored] : colored,
    };
  });
  selectedStep.value = colored[0]?.id ?? null;
}

function ModelSettings({ onDone }: { onDone: () => void }) {
  const s = llmState.value;
  const d = s.draft;
  useEffect(() => {
    llm.open();
  }, []);
  const all = [...s.providers.recommended, ...s.providers.others];
  return (
    <div class="ai-settings">
      <p class="muted">
        Calls go straight from your browser to the provider with your own key. The key is stored
        encrypted on this device and never leaves it except to that provider.
      </p>
      <fieldset class="segmented" aria-label="Model source">
        <button
          type="button"
          aria-pressed={!d.custom}
          class={!d.custom ? "is-on" : ""}
          onClick={() => llm.toggleCustom(false)}
        >
          Provider
        </button>
        <button
          type="button"
          aria-pressed={d.custom}
          class={d.custom ? "is-on" : ""}
          onClick={() => llm.toggleCustom(true)}
        >
          Custom endpoint
        </button>
      </fieldset>
      {!d.custom ? (
        <>
          {s.catalogStatus === "loading" && <p class="muted">Loading the model catalog…</p>}
          {s.catalogStatus === "error" && (
            <p class="error">
              The model catalog could not be loaded.{" "}
              <button type="button" class="link-btn" onClick={() => llm.retryCatalog()}>
                Retry
              </button>
            </p>
          )}
          <Field label="Provider">
            <select
              class="input"
              value={d.providerId}
              onChange={(e) => llm.selectProvider(e.currentTarget.value)}
            >
              {!d.providerId && <option value="">Choose a provider</option>}
              {s.providers.recommended.length > 0 && (
                <optgroup label="Recommended">
                  {s.providers.recommended.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </optgroup>
              )}
              {s.providers.others.length > 0 && (
                <optgroup label="Others">
                  {s.providers.others.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </optgroup>
              )}
              {all.length === 0 && d.providerId && (
                <option value={d.providerId}>{d.providerId}</option>
              )}
            </select>
          </Field>
          <Field
            label="Model"
            hint="Pick a model that sees images. The recommended one comes first."
          >
            <input
              class="input"
              placeholder="Search models"
              value={s.search}
              onInput={(e) => llm.setSearch(e.currentTarget.value)}
            />
            <select
              class="input"
              value={d.model}
              onChange={(e) => llm.selectModel(e.currentTarget.value)}
            >
              {!s.models.some((m) => m.id === d.model) && d.model && (
                <option value={d.model}>{d.model}</option>
              )}
              {s.models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                  {s.recommendedModel?.id === m.id ? " (recommended)" : ""}
                  {m.input && !m.input.includes("image") ? " · text only" : ""}
                </option>
              ))}
            </select>
          </Field>
        </>
      ) : (
        <>
          <Field
            label="Endpoint"
            hint="An OpenAI-compatible URL: https anywhere, or http on this machine (Ollama, LM Studio)."
          >
            <input
              class="input"
              placeholder="http://localhost:11434/v1"
              value={d.customEndpoint}
              onInput={(e) => llm.setEndpoint(e.currentTarget.value)}
            />
          </Field>
          <Field label="Model name">
            <input
              class="input"
              placeholder="qwen2.5vl"
              value={d.customModel}
              onInput={(e) => llm.setCustomModel(e.currentTarget.value)}
            />
          </Field>
        </>
      )}
      <Field label="API key">
        <input
          class="input"
          type="password"
          autoComplete="off"
          spellcheck={false}
          placeholder={d.custom ? "Optional" : "Paste your key"}
          value={s.apiKey}
          onInput={(e) => llm.setApiKey(e.currentTarget.value)}
        />
      </Field>
      <label class="check">
        <input
          type="checkbox"
          checked={d.rememberKey}
          onChange={(e) => llm.setRememberKey(e.currentTarget.checked)}
        />
        Remember the key on this device (otherwise it is forgotten when the tab closes)
      </label>
      {s.testResult && (
        <p class={s.testResult.ok ? "success" : "error"}>
          {s.testResult.ok
            ? "Connection works."
            : s.testResult.reason === "cors"
              ? "Key refused, or the network blocked the request."
              : `Connection failed (${s.testResult.reason}).`}
        </p>
      )}
      <div class="modal-actions">
        <Button disabled={!s.canTest || s.testing} onClick={() => void llm.test()}>
          {s.testing ? "Testing…" : "Test connection"}
        </Button>
        <Button
          variant="primary"
          disabled={!s.canSave}
          onClick={async () => {
            const res = await llm.save();
            if (res.ok) onDone();
            else
              toast(
                res.reason === "incomplete"
                  ? "Choose a model and enter a key."
                  : "This endpoint cannot be used (it must be https, or http on this machine).",
                "error",
              );
          }}
        >
          Save
        </Button>
      </div>
    </div>
  );
}

function PasteMode({ onDone }: { onDone: () => void }) {
  const answer = useSignal("");
  const picture = useSignal<Blob | null>(null);
  const pictureUrl = useSignal("");
  const b = brief.value;
  const frames = useRef(
    (() => {
      const all = aiFrames();
      const pinned = all.filter((f) => f.pinned);
      const pool = pinned.length >= 2 ? pinned : all;
      const n = Math.min(10, Math.max(b.maxSteps + 2, 4));
      if (pool.length <= n) return pool;
      return Array.from(
        { length: n },
        (_, i) => pool[Math.floor(((i + 0.5) * pool.length) / n)] as (typeof pool)[number],
      );
    })(),
  ).current;
  const prompt = pastePrompt(b, frames);

  useEffect(() => {
    let url = "";
    void pasteSheet(frames.map((f, i) => ({ url: f.url, label: `Image ${i + 1}` }))).then(
      (blob) => {
        picture.value = blob;
        pictureUrl.value = url = URL.createObjectURL(blob);
      },
    );
    return () => url && URL.revokeObjectURL(url);
  }, []);

  const copyPicture = async () => {
    if (!picture.value) return;
    try {
      await navigator.clipboard.write([new ClipboardItem({ "image/png": picture.value })]);
      toast("Picture copied.", "success");
    } catch {
      toast("This browser cannot copy pictures: download it instead.", "error");
    }
  };

  const apply = async () => {
    try {
      const parsed = parseDemoAnswer(answer.value);
      const steps = stepsFromAnswer(parsed, frames);
      if (steps.length === 0) throw new Error("The answer has no step that matches the pictures.");
      await applyResult(steps, parsed, false);
      toast(`${steps.length} steps added.`, "success");
      onDone();
    } catch (err) {
      toast(errorText(err), "error");
    }
  };

  return (
    <div class="paste">
      <p class="muted">
        No API key needed: use ChatGPT, Claude, Gemini or any chat app that reads images.
      </p>
      <ol class="paste-steps">
        <li>
          <strong>Copy the prompt</strong> and paste it into a new chat.
          <Button
            size="sm"
            icon="copy"
            onClick={() =>
              void copyText(prompt).then((ok) =>
                toast(ok ? "Prompt copied." : "Copy failed.", ok ? "success" : "error"),
              )
            }
          >
            Copy prompt
          </Button>
        </li>
        <li>
          <strong>Add the picture</strong> of your {frames.length} screenshots to the same message.
          <span class="row">
            <Button
              size="sm"
              icon="clipboard"
              disabled={!picture.value}
              onClick={() => void copyPicture()}
            >
              Copy picture
            </Button>
            {pictureUrl.value && (
              <a
                class="btn btn-ghost btn-sm"
                href={pictureUrl.value}
                download="stepcast-screens.png"
              >
                <Icon name="download" size={15} /> Download
              </a>
            )}
          </span>
          {pictureUrl.value && (
            <img
              class="paste-preview"
              src={pictureUrl.value}
              alt="Your screenshots side by side, numbered"
            />
          )}
        </li>
        <li>
          <strong>Paste the answer</strong> (the JSON it writes) here:
          <textarea
            class="input mono"
            rows={7}
            placeholder='{ "title": "…", "steps": [ … ] }'
            value={answer.value}
            onInput={(e) => (answer.value = e.currentTarget.value)}
          />
        </li>
      </ol>
      <div class="modal-actions">
        <Button
          variant="primary"
          icon="wand"
          disabled={!answer.value.trim()}
          onClick={() => void apply()}
        >
          Build the demo
        </Button>
      </div>
    </div>
  );
}

export function AiPanel({ onClose }: { onClose: () => void }) {
  const view = useSignal<"brief" | "settings" | "paste" | "running">("brief");
  const progress = useSignal("");
  const started = useSignal(0);
  const now = useSignal(Date.now());
  const keep = useSignal(false);
  const abort = useRef<AbortController | null>(null);
  const b = brief.value;
  const frames = aiFrames();
  const steps = project.value?.demo.steps.length ?? 0;

  useEffect(() => {
    void loadLlmSettings();
  }, []);
  useEffect(() => {
    if (view.value !== "running") return;
    const t = setInterval(() => (now.value = Date.now()), 500);
    return () => clearInterval(t);
  }, [view.value]);

  const settings = llmState.value.saved ? savedSettings() : null;

  const run = async () => {
    const s = savedSettings();
    if (!s) {
      view.value = "settings";
      return;
    }
    const ctrl = new AbortController();
    abort.current = ctrl;
    view.value = "running";
    started.value = Date.now();
    progress.value = "Preparing the screenshots…";
    try {
      const { generateDemo } = await import("../ai/run");
      const res = await generateDemo(
        s,
        b,
        frames,
        (p) => (progress.value = p.message),
        ctrl.signal,
      );
      await applyResult(res.steps, res.answer, keep.value);
      toast(`Demo ready: ${res.steps.length} steps. Review them, then share.`, "success", 6000);
      onClose();
    } catch (err) {
      toast(errorText(err), "error", 8000);
      view.value = "brief";
    }
  };

  const title =
    view.value === "settings"
      ? "AI settings"
      : view.value === "paste"
        ? "Copy-paste mode"
        : "Generate the demo with AI";

  return (
    <Modal
      title={title}
      onClose={() => (view.value === "running" ? abort.current?.abort() : onClose())}
      wide
    >
      {view.value === "settings" && <ModelSettings onDone={() => (view.value = "brief")} />}
      {view.value === "paste" && <PasteMode onDone={onClose} />}
      {view.value === "running" && (
        <div class="ai-running">
          <div class="spinner" aria-hidden="true" />
          <p>{progress.value}</p>
          <p class="muted">
            {Math.round((now.value - started.value) / 1000)} s · usually under a minute
          </p>
          <Button onClick={() => abort.current?.abort()}>Cancel</Button>
        </div>
      )}
      {view.value === "brief" && (
        <div class="ai-brief">
          <div class="ai-model">
            <Icon name="sparkles" size={16} />
            <span>{settings ? modelLabel(settings) : "No model set up yet"}</span>
            <button type="button" class="link-btn" onClick={() => (view.value = "settings")}>
              {settings ? "Change" : "Set up"}
            </button>
          </div>
          <Field
            label="What should the demo show?"
            hint={`The AI works from ${frames.length} screenshot${frames.length === 1 ? "" : "s"}.`}
          >
            <textarea
              class="input"
              rows={3}
              placeholder="e.g. How a new user creates a project, invites a teammate and ships the first report"
              value={b.goal}
              onInput={(e) => saveBrief({ ...b, goal: e.currentTarget.value })}
            />
          </Field>
          <div class="grid-2">
            <Field label="Audience">
              <input
                class="input"
                value={b.audience}
                onInput={(e) => saveBrief({ ...b, audience: e.currentTarget.value })}
              />
            </Field>
            <Field label="Tone">
              <select
                class="input"
                value={b.tone}
                onChange={(e) => saveBrief({ ...b, tone: e.currentTarget.value })}
              >
                {[...new Set([b.tone, ...TONES])].map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
            </Field>
            <Field label="Language">
              <select
                class="input"
                value={toLanguageCode(b.language)}
                onChange={(e) => saveBrief({ ...b, language: e.currentTarget.value })}
              >
                {RESPONSE_LANGUAGES.map((l) => (
                  <option key={l.code} value={l.code}>
                    {l.label}
                    {l.label !== l.name ? ` · ${l.name}` : ""}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={`At most ${b.maxSteps} steps`}>
              <input
                class="range"
                type="range"
                min={2}
                max={15}
                value={b.maxSteps}
                onInput={(e) => saveBrief({ ...b, maxSteps: Number(e.currentTarget.value) })}
              />
            </Field>
          </div>
          <fieldset class="replace">
            <legend class="field-label">Change text on screen (optional)</legend>
            {[...b.replacements, { from: "", to: "" }].map((r, i) => {
              const set = (patch: Partial<typeof r>) => {
                const list = [...b.replacements];
                list[i] = { ...r, ...patch };
                saveBrief({ ...b, replacements: list.filter((x) => x.from || x.to) });
              };
              return (
                <div class="replace-row" key={i}>
                  <input
                    class="input"
                    placeholder={i === 0 ? "Text on screen, e.g. Globex Corp" : "Text on screen"}
                    aria-label={`Text to replace ${i + 1}`}
                    value={r.from}
                    onInput={(e) => set({ from: e.currentTarget.value })}
                  />
                  <span class="muted" aria-hidden="true">
                    →
                  </span>
                  <input
                    class="input"
                    placeholder={i === 0 ? "Shown instead, e.g. Acme" : "Shown instead"}
                    aria-label={`Replacement ${i + 1}`}
                    value={r.to}
                    onInput={(e) => set({ to: e.currentTarget.value })}
                  />
                </div>
              );
            })}
            <span class="field-hint">
              Replaced on every screen where it appears, in the pixels of the shared demo.
            </span>
          </fieldset>
          <div class="checks">
            <label class="check">
              <input
                type="checkbox"
                checked={b.redact}
                onChange={(e) => saveBrief({ ...b, redact: e.currentTarget.checked })}
              />
              Blur personal data (emails, names, keys)
            </label>
            <label class="check">
              <input
                type="checkbox"
                checked={b.zoom}
                onChange={(e) => saveBrief({ ...b, zoom: e.currentTarget.checked })}
              />
              Zoom on small targets
            </label>
            {steps > 0 && (
              <label class="check">
                <input
                  type="checkbox"
                  checked={keep.value}
                  onChange={(e) => (keep.value = e.currentTarget.checked)}
                />
                Keep my {steps} current steps (add after them)
              </label>
            )}
          </div>
          <div class="modal-actions">
            <button type="button" class="link-btn" onClick={() => (view.value = "paste")}>
              No API key? Use copy-paste
            </button>
            <Button
              variant="primary"
              size="lg"
              icon="sparkles"
              disabled={frames.length === 0}
              onClick={() => void run()}
            >
              {settings ? "Generate demo" : "Set up a model"}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
