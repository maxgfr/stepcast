/**
 * The step canvas: the screenshot with every layer as a box you can draw, move
 * and resize. Boxes are kept normalized (0–1), so the stage can be any size.
 */
import { signal } from "@preact/signals";
import { useEffect, useRef, useState } from "preact/hooks";
import { type Box, clampBox, type Step } from "../../model/demo";
import { matchEditColors } from "../../render/image";
import { StepImage } from "../../render/StepImage";
import { assetUrl, updateStep } from "../state";
import type { IconName } from "../ui";

export type LayerKind = "hotspot" | "zoom" | "highlight" | "redaction" | "text";
export type Tool = "select" | LayerKind;
export interface LayerRef {
  kind: LayerKind;
  index: number;
}

export const tool = signal<Tool>("select");
export const selectedLayer = signal<LayerRef | null>(null);

export const TOOLS: { id: Tool; label: string; icon: IconName; key: string }[] = [
  { id: "select", label: "Select", icon: "cursor", key: "v" },
  { id: "hotspot", label: "Hotspot", icon: "hotspot", key: "h" },
  { id: "zoom", label: "Zoom", icon: "zoom", key: "z" },
  { id: "highlight", label: "Highlight", icon: "highlight", key: "l" },
  { id: "redaction", label: "Blur", icon: "blur", key: "b" },
  { id: "text", label: "Replace text", icon: "text", key: "t" },
];

export function layersOf(step: Step): { ref: LayerRef; box: Box; label: string }[] {
  const out: { ref: LayerRef; box: Box; label: string }[] = [];
  if (step.zoom) out.push({ ref: { kind: "zoom", index: 0 }, box: step.zoom, label: "Zoom" });
  for (const [i, b] of step.highlights.entries()) {
    out.push({ ref: { kind: "highlight", index: i }, box: b, label: "Highlight" });
  }
  for (const [i, b] of step.redactions.entries()) {
    const label = b.style === "solid" ? "Hide" : "Blur";
    out.push({ ref: { kind: "redaction", index: i }, box: b, label });
  }
  for (const [i, b] of step.textEdits.entries()) {
    out.push({ ref: { kind: "text", index: i }, box: b, label: `“${b.text}”` });
  }
  if (step.hotspot)
    out.push({ ref: { kind: "hotspot", index: 0 }, box: step.hotspot, label: "Hotspot" });
  return out;
}

export function setLayerBox(step: Step, ref: LayerRef, box: Box): Step {
  const b = clampBox(box, 0.005);
  switch (ref.kind) {
    case "hotspot":
      return { ...step, hotspot: b };
    case "zoom":
      return { ...step, zoom: clampBox(box, 0.05) };
    case "highlight":
      return { ...step, highlights: step.highlights.map((x, i) => (i === ref.index ? b : x)) };
    case "redaction":
      return {
        ...step,
        redactions: step.redactions.map((x, i) => (i === ref.index ? { ...x, ...b } : x)),
      };
    case "text":
      return {
        ...step,
        textEdits: step.textEdits.map((x, i) => (i === ref.index ? { ...x, ...b } : x)),
      };
  }
}

export function removeLayer(step: Step, ref: LayerRef): Step {
  switch (ref.kind) {
    case "hotspot":
      return { ...step, hotspot: null };
    case "zoom":
      return { ...step, zoom: null };
    case "highlight":
      return { ...step, highlights: step.highlights.filter((_, i) => i !== ref.index) };
    case "redaction":
      return { ...step, redactions: step.redactions.filter((_, i) => i !== ref.index) };
    case "text":
      return { ...step, textEdits: step.textEdits.filter((_, i) => i !== ref.index) };
  }
}

function addLayer(step: Step, kind: LayerKind, box: Box): { step: Step; ref: LayerRef } {
  const b = clampBox(box, 0.005);
  switch (kind) {
    case "hotspot":
      return { step: { ...step, hotspot: b }, ref: { kind, index: 0 } };
    case "zoom":
      return { step: { ...step, zoom: clampBox(box, 0.05) }, ref: { kind, index: 0 } };
    case "highlight":
      return {
        step: { ...step, highlights: [...step.highlights, b] },
        ref: { kind, index: step.highlights.length },
      };
    case "redaction":
      return {
        step: { ...step, redactions: [...step.redactions, { ...b, style: "blur" }] },
        ref: { kind, index: step.redactions.length },
      };
    case "text":
      return {
        step: {
          ...step,
          textEdits: [
            ...step.textEdits,
            { ...b, text: "New text", bg: "#ffffff", color: "#111111" },
          ],
        },
        ref: { kind, index: step.textEdits.length },
      };
  }
}

const same = (a: LayerRef | null, b: LayerRef | null) =>
  !!a && !!b && a.kind === b.kind && a.index === b.index;

type Drag =
  | { mode: "draw"; kind: LayerKind; x0: number; y0: number; box: Box }
  | { mode: "move"; ref: LayerRef; x0: number; y0: number; start: Box }
  | { mode: "resize"; ref: LayerRef; corner: "nw" | "ne" | "sw" | "se"; start: Box };

export function Stage({ step }: { step: Step }) {
  const ref = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [aspect, setAspect] = useState(16 / 10);
  const src = assetUrl(step.image);

  useEffect(() => {
    selectedLayer.value = null;
  }, [step.id]);

  const point = (e: PointerEvent) => {
    const r = (ref.current as HTMLDivElement).getBoundingClientRect();
    return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
  };

  const onDown = (e: PointerEvent) => {
    if (e.button !== 0 || !ref.current) return;
    const t = tool.value;
    const p = point(e);
    const target = e.target as HTMLElement;
    const handle = target.dataset.corner as "nw" | "ne" | "sw" | "se" | undefined;
    const layerEl = target.closest<HTMLElement>("[data-layer]");
    if (handle && layerEl && selectedLayer.value) {
      const l = layersOf(step).find((x) => same(x.ref, selectedLayer.value));
      if (l) setDrag({ mode: "resize", ref: l.ref, corner: handle, start: l.box });
    } else if (layerEl && t === "select") {
      const [kind, index] = (layerEl.dataset.layer as string).split(":");
      const lref = { kind: kind as LayerKind, index: Number(index) };
      const l = layersOf(step).find((x) => same(x.ref, lref));
      selectedLayer.value = lref;
      if (l) setDrag({ mode: "move", ref: lref, x0: p.x, y0: p.y, start: l.box });
    } else if (t !== "select") {
      setDrag({ mode: "draw", kind: t, x0: p.x, y0: p.y, box: { x: p.x, y: p.y, w: 0, h: 0 } });
    } else {
      selectedLayer.value = null;
      return;
    }
    ref.current.setPointerCapture(e.pointerId);
    e.preventDefault();
  };

  const onMove = (e: PointerEvent) => {
    if (!drag) return;
    const p = point(e);
    if (drag.mode === "draw") {
      const x = Math.min(p.x, drag.x0);
      const y = Math.min(p.y, drag.y0);
      setDrag({ ...drag, box: { x, y, w: Math.abs(p.x - drag.x0), h: Math.abs(p.y - drag.y0) } });
    } else if (drag.mode === "move") {
      const b = { ...drag.start, x: drag.start.x + p.x - drag.x0, y: drag.start.y + p.y - drag.y0 };
      updateStep(step.id, (s) => setLayerBox(s, drag.ref, b), "drag");
    } else {
      const s0 = drag.start;
      let x1 = s0.x;
      let y1 = s0.y;
      let x2 = s0.x + s0.w;
      let y2 = s0.y + s0.h;
      if (drag.corner.includes("w")) x1 = Math.min(p.x, x2 - 0.01);
      if (drag.corner.includes("e")) x2 = Math.max(p.x, x1 + 0.01);
      if (drag.corner.includes("n")) y1 = Math.min(p.y, y2 - 0.01);
      if (drag.corner.includes("s")) y2 = Math.max(p.y, y1 + 0.01);
      updateStep(
        step.id,
        (s) => setLayerBox(s, drag.ref, { x: x1, y: y1, w: x2 - x1, h: y2 - y1 }),
        "drag",
      );
    }
  };

  const onUp = () => {
    if (drag?.mode === "draw") {
      let box = drag.box;
      if (box.w < 0.01 || box.h < 0.01) {
        // A click instead of a drag: a sensible default size around the point.
        const w = drag.kind === "zoom" ? 0.4 : drag.kind === "text" ? 0.16 : 0.08;
        const h = drag.kind === "zoom" ? 0.4 : drag.kind === "text" ? 0.045 : 0.06;
        box = { x: drag.x0 - w / 2, y: drag.y0 - h / 2, w, h };
      }
      const kind = drag.kind;
      let created: LayerRef | null = null;
      updateStep(step.id, (s) => {
        const res = addLayer(s, kind, box);
        created = res.ref;
        return res.step;
      });
      selectedLayer.value = created;
      if (kind === "text") {
        // Pick up the colors under the new box.
        void matchEditColors(
          { textEdits: [{ ...clampBox(box), text: "", bg: "#fff", color: "#111" }] },
          assetUrl(step.image),
        ).then((m) => {
          const c = m.textEdits[0];
          const idx = (created as LayerRef | null)?.index ?? 0;
          if (c)
            updateStep(step.id, (s) => ({
              ...s,
              textEdits: s.textEdits.map((t, i) =>
                i === idx ? { ...t, bg: c.bg, color: c.color } : t,
              ),
            }));
        });
      }
      tool.value = "select";
    }
    setDrag(null);
  };

  const layers = layersOf(step);
  const sel = selectedLayer.value;

  return (
    <div class="stage-wrap">
      <div
        class={`stage tool-${tool.value}`}
        ref={ref}
        style={{ aspectRatio: String(aspect) }}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={() => setDrag(null)}
      >
        <StepImage src={src} step={step} onSize={(w, h) => setAspect(w / h)} />
        {layers.map(({ ref: l, box, label }) => {
          const isSel = same(l, sel);
          return (
            <div
              key={`${l.kind}:${l.index}`}
              data-layer={`${l.kind}:${l.index}`}
              class={`layer layer-${l.kind} ${isSel ? "is-selected" : ""}`}
              style={{
                left: `${box.x * 100}%`,
                top: `${box.y * 100}%`,
                width: `${box.w * 100}%`,
                height: `${box.h * 100}%`,
              }}
            >
              <span class="layer-label">{label}</span>
              {l.kind === "hotspot" && <span class="sc-beacon" />}
              {isSel &&
                (["nw", "ne", "sw", "se"] as const).map((c) => (
                  <span key={c} class={`handle handle-${c}`} data-corner={c} />
                ))}
            </div>
          );
        })}
        {drag?.mode === "draw" && (
          <div
            class={`layer layer-${drag.kind} is-drawing`}
            style={{
              left: `${drag.box.x * 100}%`,
              top: `${drag.box.y * 100}%`,
              width: `${drag.box.w * 100}%`,
              height: `${drag.box.h * 100}%`,
            }}
          />
        )}
      </div>
    </div>
  );
}
