import { useSignal } from "@preact/signals";
import { languageName, RESPONSE_LANGUAGES, toLanguageCode } from "llm-connect";
import { useEffect, useRef } from "preact/hooks";
import { clock } from "../../ai/prompts";
import { frameOf, seek, videoDuration } from "../../capture/import";
import { ACTIONS, newId, newStep, PLACEMENTS, REDACTION_STYLES, type Step } from "../../model/demo";
import { getBlob } from "../../model/store";
import { Player } from "../../player/Player";
import { AiPanel, brief } from "../AiPanel";
import { navigate } from "../router";
import { SharePanel } from "../SharePanel";
import {
  addFrames,
  assetUrl,
  currentStep,
  flushSave,
  historySize,
  openProject,
  playableDemo,
  project,
  redo,
  saveError,
  selectedStep,
  undo,
  updateDemo,
  updateStep,
} from "../state";
import { Button, errorText, Field, Icon, IconButton, Modal, toast } from "../ui";
import { layersOf, removeLayer, Stage, selectedLayer, TOOLS, tool } from "./Stage";

function StepList({ onAdd }: { onAdd: () => void }) {
  const steps = project.value?.demo.steps ?? [];
  const dragFrom = useSignal<number | null>(null);
  const move = (from: number, to: number) =>
    updateDemo((d) => {
      const s = [...d.steps];
      const [it] = s.splice(from, 1);
      if (it) s.splice(Math.max(0, Math.min(s.length, to)), 0, it);
      return { ...d, steps: s };
    });
  return (
    <aside class="steps" aria-label="Steps">
      <div class="panel-head">
        <h2>Steps</h2>
        <IconButton icon="plus" label="Add steps from screenshots" onClick={onAdd} />
      </div>
      {steps.length === 0 && (
        <p class="muted small pad">No steps yet. Use AI, or add screenshots by hand.</p>
      )}
      <ol class="step-list">
        {steps.map((s, i) => (
          <li
            key={s.id}
            class={`step-item ${s.id === currentStep.value?.id ? "is-active" : ""}`}
            draggable
            onDragStart={() => (dragFrom.value = i)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => {
              if (dragFrom.value !== null && dragFrom.value !== i) move(dragFrom.value, i);
              dragFrom.value = null;
            }}
          >
            <button type="button" class="step-select" onClick={() => (selectedStep.value = s.id)}>
              <span class="step-num">{i + 1}</span>
              <span class="step-thumb">
                <img src={assetUrl(s.image)} alt="" />
              </span>
              <span class="step-title">{s.title || <em>Untitled step</em>}</span>
            </button>
            <span class="step-tools">
              <IconButton
                icon="up"
                label="Move up"
                disabled={i === 0}
                onClick={() => move(i, i - 1)}
              />
              <IconButton
                icon="down"
                label="Move down"
                disabled={i === steps.length - 1}
                onClick={() => move(i, i + 1)}
              />
              <IconButton
                icon="copy"
                label="Duplicate"
                onClick={() =>
                  updateDemo((d) => {
                    const copy = { ...s, id: newId() };
                    const st = [...d.steps];
                    st.splice(i + 1, 0, copy);
                    selectedStep.value = copy.id;
                    return { ...d, steps: st };
                  })
                }
              />
              <IconButton
                icon="trash"
                label="Delete step"
                onClick={() => {
                  updateDemo((d) => ({ ...d, steps: d.steps.filter((x) => x.id !== s.id) }));
                  const next = steps[i + 1] ?? steps[i - 1];
                  selectedStep.value = next?.id ?? null;
                }}
              />
            </span>
          </li>
        ))}
      </ol>
    </aside>
  );
}

function LayerList({ step }: { step: Step }) {
  const layers = layersOf(step);
  if (layers.length === 0)
    return <p class="muted small">Draw on the screenshot with the tools above it.</p>;
  const sel = selectedLayer.value;
  return (
    <ul class="layer-list">
      {layers.map(({ ref, label }) => {
        const on = sel?.kind === ref.kind && sel.index === ref.index;
        return (
          <li key={`${ref.kind}:${ref.index}`} class={on ? "is-on" : ""}>
            <button type="button" class="layer-pick" onClick={() => (selectedLayer.value = ref)}>
              <span class={`swatch swatch-${ref.kind}`} /> {label}
            </button>
            <IconButton
              icon="trash"
              label={`Remove ${label}`}
              onClick={() => {
                updateStep(step.id, (s) => removeLayer(s, ref));
                selectedLayer.value = null;
              }}
            />
          </li>
        );
      })}
    </ul>
  );
}

function SelectedLayerFields({ step }: { step: Step }) {
  const sel = selectedLayer.value;
  if (sel?.kind === "text") {
    const t = step.textEdits[sel.index];
    if (!t) return null;
    const set = (patch: Partial<typeof t>) =>
      updateStep(
        step.id,
        (s) => ({
          ...s,
          textEdits: s.textEdits.map((x, i) => (i === sel.index ? { ...x, ...patch } : x)),
        }),
        "text",
      );
    return (
      <div class="layer-fields">
        <Field label="Replacement text">
          <input
            class="input"
            value={t.text}
            onInput={(e) => set({ text: e.currentTarget.value })}
          />
        </Field>
        <div class="row">
          <label class="color">
            <input type="color" value={t.bg} onInput={(e) => set({ bg: e.currentTarget.value })} />{" "}
            Background
          </label>
          <label class="color">
            <input
              type="color"
              value={t.color}
              onInput={(e) => set({ color: e.currentTarget.value })}
            />{" "}
            Text
          </label>
        </div>
      </div>
    );
  }
  if (sel?.kind === "redaction") {
    const r = step.redactions[sel.index];
    if (!r) return null;
    return (
      <div class="layer-fields">
        <Field label="Style">
          <select
            class="input"
            value={r.style}
            onChange={(e) =>
              updateStep(step.id, (s) => ({
                ...s,
                redactions: s.redactions.map((x, i) =>
                  i === sel.index
                    ? { ...x, style: e.currentTarget.value as (typeof REDACTION_STYLES)[number] }
                    : x,
                ),
              }))
            }
          >
            {REDACTION_STYLES.map((st) => (
              <option key={st} value={st}>
                {st === "blur" ? "Blur" : st === "pixelate" ? "Pixelate" : "Solid block"}
              </option>
            ))}
          </select>
        </Field>
      </div>
    );
  }
  return null;
}

function Refine({ step }: { step: Step }) {
  const text = useSignal("");
  const busy = useSignal(false);
  const run = async () => {
    const { savedSettings, loadLlmSettings } = await import("../../ai/settings");
    await loadLlmSettings();
    const settings = savedSettings();
    if (!settings) {
      toast("Set up a model first (AI button, top right).", "error");
      return;
    }
    busy.value = true;
    try {
      const { refineStep } = await import("../../ai/run");
      const { matchEditColors } = await import("../../render/image");
      const next = await refineStep(settings, brief.value, step, assetUrl(step.image), text.value);
      const colored = await matchEditColors(next, assetUrl(step.image));
      updateStep(step.id, () => colored);
      text.value = "";
      toast("Step updated.", "success");
    } catch (err) {
      toast(errorText(err), "error", 7000);
    } finally {
      busy.value = false;
    }
  };
  return (
    <div class="refine">
      <Field label="Refine with AI">
        <textarea
          class="input"
          rows={2}
          placeholder="e.g. Point at the Export button, shorter text, blur the email"
          value={text.value}
          onInput={(e) => (text.value = e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && text.value.trim()) void run();
          }}
        />
      </Field>
      <Button
        size="sm"
        icon="sparkles"
        disabled={!text.value.trim() || busy.value}
        onClick={() => void run()}
      >
        {busy.value ? "Thinking…" : "Apply"}
      </Button>
    </div>
  );
}

function StepInspector({ step }: { step: Step }) {
  const set = (patch: Partial<Step>, tag = "") =>
    updateStep(step.id, (s) => ({ ...s, ...patch }), tag);
  return (
    <div class="inspector-body">
      <Field label="Title">
        <input
          class="input"
          value={step.title}
          placeholder="Open the billing page"
          onInput={(e) => set({ title: e.currentTarget.value }, "title")}
        />
      </Field>
      <Field label="Text">
        <textarea
          class="input"
          rows={3}
          value={step.body}
          placeholder="What the viewer should notice, and why it matters."
          onInput={(e) => set({ body: e.currentTarget.value }, "body")}
        />
      </Field>
      <div class="grid-2">
        <Field label="Action">
          <select
            class="input"
            value={step.action}
            onChange={(e) => set({ action: e.currentTarget.value as Step["action"] })}
          >
            {ACTIONS.map((a) => (
              <option key={a} value={a}>
                {a === "click" ? "Click" : a === "type" ? "Type" : "Look"}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Tooltip">
          <select
            class="input"
            value={step.placement}
            onChange={(e) => set({ placement: e.currentTarget.value as Step["placement"] })}
          >
            {PLACEMENTS.map((p) => (
              <option key={p} value={p}>
                {p === "auto" ? "Auto" : p[0]?.toUpperCase() + p.slice(1)}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <h3 class="sub">Layers</h3>
      <LayerList step={step} />
      <SelectedLayerFields step={step} />
      <Refine step={step} />
    </div>
  );
}

function DemoLanguage() {
  const d = project.value?.demo;
  const busy = useSignal(false);
  if (!d) return null;
  const translate = async () => {
    const { savedSettings, loadLlmSettings } = await import("../../ai/settings");
    await loadLlmSettings();
    const settings = savedSettings();
    if (!settings) {
      toast("Set up a model first (AI button, top right).", "error");
      return;
    }
    busy.value = true;
    try {
      const { translateDemo } = await import("../../ai/run");
      const current = project.value?.demo;
      if (!current) return;
      const next = await translateDemo(settings, current, current.language);
      updateDemo(() => next);
      toast(`Translated into ${languageName(current.language)}.`, "success");
    } catch (err) {
      toast(errorText(err), "error", 7000);
    } finally {
      busy.value = false;
    }
  };
  return (
    <Field
      label="Language"
      hint="The player's buttons follow it. Translate rewrites every title and text with AI; the screenshots stay as they are."
    >
      <div class="row">
        <select
          class="input lang-select"
          value={toLanguageCode(d.language)}
          onChange={(e) => updateDemo((x) => ({ ...x, language: e.currentTarget.value }))}
        >
          {RESPONSE_LANGUAGES.map((l) => (
            <option key={l.code} value={l.code}>
              {l.label}
            </option>
          ))}
        </select>
        <Button
          size="sm"
          icon="sparkles"
          disabled={busy.value || d.steps.length === 0}
          onClick={() => void translate()}
        >
          {busy.value ? "Translating…" : "Translate"}
        </Button>
      </div>
    </Field>
  );
}

function DemoInspector() {
  const d = project.value?.demo;
  if (!d) return null;
  const set = (patch: Partial<typeof d>, tag = "") => updateDemo((x) => ({ ...x, ...patch }), tag);
  return (
    <div class="inspector-body">
      <Field label="Title">
        <input
          class="input"
          value={d.title}
          onInput={(e) => set({ title: e.currentTarget.value }, "dtitle")}
        />
      </Field>
      <Field label="Description">
        <textarea
          class="input"
          rows={2}
          value={d.description}
          onInput={(e) => set({ description: e.currentTarget.value }, "ddesc")}
        />
      </Field>
      <DemoLanguage />
      <label class="color">
        <input
          type="color"
          value={d.theme.accent}
          onInput={(e) => set({ theme: { accent: e.currentTarget.value } }, "accent")}
        />{" "}
        Accent color
      </label>
      <h3 class="sub">
        <label class="check">
          <input
            type="checkbox"
            checked={!!d.intro}
            onChange={(e) =>
              set({
                intro: e.currentTarget.checked
                  ? { title: d.title, body: d.description, button: "" }
                  : null,
              })
            }
          />
          Intro card
        </label>
      </h3>
      {d.intro && (
        <>
          <Field label="Intro title">
            <input
              class="input"
              value={d.intro.title}
              onInput={(e) =>
                set(
                  {
                    intro: {
                      ...(d.intro as NonNullable<typeof d.intro>),
                      title: e.currentTarget.value,
                    },
                  },
                  "ititle",
                )
              }
            />
          </Field>
          <Field label="Intro text">
            <textarea
              class="input"
              rows={2}
              value={d.intro.body}
              onInput={(e) =>
                set(
                  {
                    intro: {
                      ...(d.intro as NonNullable<typeof d.intro>),
                      body: e.currentTarget.value,
                    },
                  },
                  "ibody",
                )
              }
            />
          </Field>
          <Field label="Button">
            <input
              class="input"
              placeholder="Start, in the demo's language"
              value={d.intro.button}
              onInput={(e) =>
                set(
                  {
                    intro: {
                      ...(d.intro as NonNullable<typeof d.intro>),
                      button: e.currentTarget.value,
                    },
                  },
                  "ibtn",
                )
              }
            />
          </Field>
        </>
      )}
      <h3 class="sub">
        <label class="check">
          <input
            type="checkbox"
            checked={!!d.outro}
            onChange={(e) =>
              set({
                outro: e.currentTarget.checked
                  ? { title: "Ready to try it?", body: "", ctaLabel: "Get started", ctaUrl: "" }
                  : null,
              })
            }
          />
          End card with a call to action
        </label>
      </h3>
      {d.outro && (
        <>
          <Field label="End title">
            <input
              class="input"
              value={d.outro.title}
              onInput={(e) =>
                set(
                  {
                    outro: {
                      ...(d.outro as NonNullable<typeof d.outro>),
                      title: e.currentTarget.value,
                    },
                  },
                  "otitle",
                )
              }
            />
          </Field>
          <Field label="End text">
            <textarea
              class="input"
              rows={2}
              value={d.outro.body}
              onInput={(e) =>
                set(
                  {
                    outro: {
                      ...(d.outro as NonNullable<typeof d.outro>),
                      body: e.currentTarget.value,
                    },
                  },
                  "obody",
                )
              }
            />
          </Field>
          <div class="grid-2">
            <Field label="Button label">
              <input
                class="input"
                value={d.outro.ctaLabel}
                onInput={(e) =>
                  set(
                    {
                      outro: {
                        ...(d.outro as NonNullable<typeof d.outro>),
                        ctaLabel: e.currentTarget.value,
                      },
                    },
                    "olabel",
                  )
                }
              />
            </Field>
            <Field label="Button link">
              <input
                class="input"
                type="url"
                placeholder="https://"
                value={d.outro.ctaUrl}
                onInput={(e) =>
                  set(
                    {
                      outro: {
                        ...(d.outro as NonNullable<typeof d.outro>),
                        ctaUrl: e.currentTarget.value,
                      },
                    },
                    "ourl",
                  )
                }
              />
            </Field>
          </div>
        </>
      )}
    </div>
  );
}

function FramesPicker({ onClose }: { onClose: () => void }) {
  const p = project.value;
  const scrub = useRef<HTMLVideoElement>(null);
  const videoUrl = useSignal("");
  const t = useSignal(0);
  const duration = useSignal(0);
  useEffect(() => {
    if (!p?.recording) return;
    let url = "";
    void getBlob(p.id, p.recording).then((b) => {
      if (b) videoUrl.value = url = URL.createObjectURL(b);
    });
    return () => url && URL.revokeObjectURL(url);
  }, [p?.id]);
  if (!p) return null;

  const addStep = (asset: string, time: number) => {
    const s = newStep(asset, { time });
    updateDemo((d) => {
      const idx = d.steps.findIndex((x) => x.id === currentStep.value?.id);
      const steps = [...d.steps];
      steps.splice(idx < 0 ? steps.length : idx + 1, 0, s);
      return { ...d, steps };
    });
    selectedStep.value = s.id;
    toast("Step added.", "success", 1800);
  };

  const used = new Set(p.demo.steps.map((s) => s.image));
  const frames = p.frames.slice().sort((a, b) => a.time - b.time);

  return (
    <Modal title="Add steps from your screenshots" onClose={onClose} wide>
      {videoUrl.value && (
        <div class="scrub">
          <video
            ref={scrub}
            src={videoUrl.value}
            class="scrub-video"
            muted
            playsInline
            preload="auto"
            onLoadedData={(e) =>
              void videoDuration(e.currentTarget).then((d) => (duration.value = d))
            }
          />
          <div class="scrub-bar">
            <input
              type="range"
              class="range"
              min={0}
              max={duration.value || 1}
              step={0.05}
              value={t.value}
              aria-label="Position in the recording"
              onInput={(e) => {
                t.value = Number(e.currentTarget.value);
                if (scrub.current) void seek(scrub.current, t.value).catch(() => undefined);
              }}
            />
            <span class="mono small">{clock(t.value)}</span>
            <Button
              size="sm"
              icon="camera"
              onClick={async () => {
                if (!scrub.current) return;
                try {
                  const f = await frameOf(scrub.current, t.value, true);
                  const [added] = await addFrames([f]);
                  if (added) addStep(added.asset, added.time);
                } catch (err) {
                  toast(errorText(err), "error");
                }
              }}
            >
              Use this frame
            </Button>
          </div>
        </div>
      )}
      {frames.length === 0 ? (
        <p class="muted">No screenshots in this project.</p>
      ) : (
        <ul class="frame-grid">
          {frames.map((f) => (
            <li key={f.id} class={`frame ${used.has(f.asset) ? "is-used" : ""}`}>
              <button
                type="button"
                onClick={() => addStep(f.asset, f.time)}
                aria-label={`Add the screenshot at ${clock(f.time)}`}
              >
                <img src={assetUrl(f.asset)} alt="" loading="lazy" />
                <span class="frame-meta">
                  {f.pinned && <Icon name="camera" size={12} />} {clock(f.time)}
                  {used.has(f.asset) && <Icon name="check" size={12} />}
                </span>
                <span class="frame-add">
                  <Icon name="plus" size={16} /> Add
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}

function ModeChooser({
  onAi,
  onManual,
  onClose,
}: {
  onAi: () => void;
  onManual: () => void;
  onClose: () => void;
}) {
  const n = project.value?.frames.length ?? 0;
  return (
    <Modal
      title={`${n} screenshot${n === 1 ? "" : "s"} captured. How do you want to build the demo?`}
      onClose={onClose}
      wide
    >
      <div class="modes">
        <button type="button" class="mode mode-ai" onClick={onAi}>
          <span class="mode-badge">Recommended</span>
          <Icon name="sparkles" size={26} />
          <strong>AI mode</strong>
          <span>
            Say what the demo should show. AI picks the key screens and writes hotspots, tooltips,
            zooms and blurs. You review.
          </span>
        </button>
        <button type="button" class="mode" onClick={onManual}>
          <Icon name="cursor" size={26} />
          <strong>Manual mode</strong>
          <span>Pick the screenshots yourself, then draw hotspots and write the tooltips.</span>
        </button>
      </div>
    </Modal>
  );
}

export function Editor({ id, start }: { id: string; start: boolean }) {
  const loading = useSignal(true);
  const panel = useSignal<"ai" | "share" | "frames" | "preview" | "choose" | null>(null);
  const tab = useSignal<"step" | "demo">("step");

  useEffect(() => {
    loading.value = true;
    void openProject(id).then((ok) => {
      loading.value = false;
      if (!ok) {
        toast("This demo is not in this browser.", "error");
        navigate("#/");
      } else if (start) {
        panel.value = "choose";
        history.replaceState(null, "", `#/edit/${id}`);
      }
    });
    return () => void flushSave();
  }, [id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      const typing = el.closest("input, textarea, select, [contenteditable]") !== null;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "z" && !typing) {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if (typing || panel.value) return;
      const step = currentStep.value;
      if ((e.key === "Delete" || e.key === "Backspace") && step && selectedLayer.value) {
        e.preventDefault();
        const ref = selectedLayer.value;
        updateStep(step.id, (s) => removeLayer(s, ref));
        selectedLayer.value = null;
        return;
      }
      if (e.key === "Escape") {
        tool.value = "select";
        selectedLayer.value = null;
        return;
      }
      if (!mod) {
        const t = TOOLS.find((x) => x.key === e.key.toLowerCase());
        if (t) tool.value = t.id;
      }
      const steps = project.value?.demo.steps ?? [];
      const i = steps.findIndex((s) => s.id === step?.id);
      if (e.key === "ArrowDown" && !selectedLayer.value && steps[i + 1])
        selectedStep.value = (steps[i + 1] as Step).id;
      if (e.key === "ArrowUp" && !selectedLayer.value && steps[i - 1])
        selectedStep.value = (steps[i - 1] as Step).id;
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const p = project.value;
  if (loading.value || !p || p.id !== id) return <main class="editor-loading muted">Opening…</main>;
  const step = currentStep.value;
  const demo = playableDemo.value;

  const manual = () => {
    panel.value = "frames";
    if (p.demo.steps.length === 0) {
      const pinned = p.frames.filter((f) => f.pinned);
      const pick = pinned.length ? pinned : p.frames.length <= 12 ? p.frames : [];
      if (pick.length) {
        updateDemo((d) => ({ ...d, steps: pick.map((f) => newStep(f.asset, { time: f.time })) }));
        selectedStep.value = null;
        panel.value = null;
        toast(
          `${pick.length} screenshot${pick.length === 1 ? "" : "s"} added as steps. Draw a hotspot on each.`,
          "success",
          6000,
        );
      }
    }
  };

  return (
    <div class="editor">
      <header class="editor-bar">
        <IconButton icon="back" label="All demos" onClick={() => navigate("#/")} />
        <input
          class="title-input"
          value={p.demo.title}
          aria-label="Demo title"
          onInput={(e) => updateDemo((d) => ({ ...d, title: e.currentTarget.value }), "dtitle")}
        />
        {saveError.value && <span class="error small">Not saved: {saveError.value}</span>}
        <div class="bar-spacer" />
        <IconButton
          icon="undo"
          label="Undo (⌘Z)"
          disabled={historySize.value.undo === 0}
          onClick={undo}
        />
        <IconButton
          icon="redo"
          label="Redo (⇧⌘Z)"
          disabled={historySize.value.redo === 0}
          onClick={redo}
        />
        <Button icon="sparkles" class="btn-ai" onClick={() => (panel.value = "ai")}>
          AI
        </Button>
        <Button
          icon="play"
          disabled={!p.demo.steps.length}
          onClick={() => (panel.value = "preview")}
        >
          Preview
        </Button>
        <Button variant="primary" icon="share" onClick={() => (panel.value = "share")}>
          Share
        </Button>
      </header>

      <div class="editor-main">
        <StepList onAdd={() => (panel.value = "frames")} />

        <section class="canvas-area" aria-label="Step editor">
          {step ? (
            <>
              <div class="toolbar" role="toolbar" aria-label="Tools">
                {TOOLS.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    class={`tool ${tool.value === t.id ? "is-on" : ""}`}
                    aria-pressed={tool.value === t.id}
                    title={`${t.label} (${t.key.toUpperCase()})`}
                    onClick={() => (tool.value = t.id)}
                  >
                    <Icon name={t.icon} size={17} />
                    <span>{t.label}</span>
                  </button>
                ))}
              </div>
              <Stage step={step} />
              <p class="muted small center">
                {tool.value === "select"
                  ? "Click a box to select it, drag to move, corners to resize. Delete removes it."
                  : `Drag on the screenshot to draw a ${TOOLS.find((t) => t.id === tool.value)?.label.toLowerCase()} box.`}
              </p>
            </>
          ) : (
            <div class="empty-canvas">
              <Icon name="sparkles" size={32} />
              <h2>Build your demo</h2>
              <p class="muted">
                Let AI turn your {p.frames.length} screenshots into steps, or pick them yourself.
              </p>
              <div class="row">
                <Button variant="primary" icon="sparkles" onClick={() => (panel.value = "ai")}>
                  Generate with AI
                </Button>
                <Button icon="plus" onClick={manual}>
                  Pick screenshots
                </Button>
              </div>
            </div>
          )}
        </section>

        <aside class="inspector" aria-label="Properties">
          <div class="tabs" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={tab.value === "step"}
              class={tab.value === "step" ? "is-on" : ""}
              onClick={() => (tab.value = "step")}
            >
              Step
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab.value === "demo"}
              class={tab.value === "demo" ? "is-on" : ""}
              onClick={() => (tab.value = "demo")}
            >
              Demo
            </button>
          </div>
          {tab.value === "step" ? (
            step ? (
              <StepInspector step={step} />
            ) : (
              <p class="muted small pad">Select a step.</p>
            )
          ) : (
            <DemoInspector />
          )}
        </aside>
      </div>

      {panel.value === "choose" && (
        <ModeChooser
          onAi={() => (panel.value = "ai")}
          onManual={manual}
          onClose={() => (panel.value = null)}
        />
      )}
      {panel.value === "ai" && <AiPanel onClose={() => (panel.value = null)} />}
      {panel.value === "share" && <SharePanel onClose={() => (panel.value = null)} />}
      {panel.value === "frames" && <FramesPicker onClose={() => (panel.value = null)} />}
      {panel.value === "preview" && demo && (
        <Modal title="Preview" onClose={() => (panel.value = null)} wide>
          <Player
            demo={demo}
            startAt={Math.max(
              0,
              p.demo.steps.findIndex((s) => s.id === step?.id),
            )}
            branding={false}
          />
        </Modal>
      )}
    </div>
  );
}
