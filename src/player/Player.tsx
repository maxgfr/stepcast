/**
 * The interactive demo: one screenshot per step, the camera zoomed on what
 * matters, a pulsing hotspot to click and a tooltip that explains it. Used in
 * the editor's preview, on share links, in embeds and in exported HTML files.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";
import type { Box, Demo, Placement, Step } from "../model/demo";
import { cssTransform, mapBox, type View, viewFor } from "../render/camera";
import { StepImage } from "../render/StepImage";

export interface PlayerProps {
  demo: Demo;
  /** "full" fills the page and listens to the keyboard globally; "embed" hides the footer. */
  mode?: "inline" | "full" | "embed";
  startAt?: number;
  onStepChange?: (index: number) => void;
  /** Link back to stepcast in the footer. */
  branding?: boolean;
}

type Phase = "intro" | "step" | "end";

const BRAND_URL = "https://maxgfr.github.io/stepcast/";

/** Where the tooltip goes when the step says "auto". */
export function autoPlacement(b: Box | null): Exclude<Placement, "auto"> {
  if (!b) return "bottom";
  const cy = b.y + b.h / 2;
  if (b.h > 0.55) return b.x + b.w / 2 < 0.5 ? "right" : "left";
  return cy < 0.55 ? "bottom" : "top";
}

function tooltipStyle(
  b: Box | null,
  placement: Exclude<Placement, "auto">,
): Record<string, string> {
  if (!b) return { left: "50%", bottom: "6%", transform: "translateX(-50%)" };
  const cx = Math.min(0.8, Math.max(0.2, b.x + b.w / 2));
  const cy = Math.min(0.85, Math.max(0.15, b.y + b.h / 2));
  const gap = "14px";
  switch (placement) {
    case "top":
      return {
        left: `${cx * 100}%`,
        bottom: `calc(${(1 - b.y) * 100}% + ${gap})`,
        transform: "translateX(-50%)",
      };
    case "left":
      return {
        right: `calc(${(1 - b.x) * 100}% + ${gap})`,
        top: `${cy * 100}%`,
        transform: "translateY(-50%)",
      };
    case "right":
      return {
        left: `calc(${(b.x + b.w) * 100}% + ${gap})`,
        top: `${cy * 100}%`,
        transform: "translateY(-50%)",
      };
    default:
      return {
        left: `${cx * 100}%`,
        top: `calc(${(b.y + b.h) * 100}% + ${gap})`,
        transform: "translateX(-50%)",
      };
  }
}

function inView(b: Box): Box {
  const x = Math.max(0, Math.min(1, b.x));
  const y = Math.max(0, Math.min(1, b.y));
  return {
    x,
    y,
    w: Math.max(0, Math.min(1, b.x + b.w) - x),
    h: Math.max(0, Math.min(1, b.y + b.h) - y),
  };
}

function Spotlight({ boxes }: { boxes: Box[] }) {
  const id = useMemo(() => `m${Math.random().toString(36).slice(2, 8)}`, []);
  if (boxes.length === 0) return null;
  return (
    <svg class="sc-spot" viewBox="0 0 1 1" preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <mask id={id}>
          <rect width="1" height="1" fill="white" />
          {boxes.map((b) => (
            <rect
              key={`${b.x},${b.y},${b.w},${b.h}`}
              x={b.x - 0.006}
              y={b.y - 0.01}
              width={b.w + 0.012}
              height={b.h + 0.02}
              rx="0.008"
              fill="black"
            />
          ))}
        </mask>
      </defs>
      <rect width="1" height="1" fill="rgba(10,8,20,0.5)" mask={`url(#${id})`} />
    </svg>
  );
}

export function StepScene({
  step,
  src,
  view,
  onAspect,
  children,
}: {
  step: Step;
  src: string;
  view: View;
  onAspect?: (a: number) => void;
  children?: preact.ComponentChildren;
}) {
  return (
    <div class="sc-viewport">
      <div class="sc-layer" style={{ transform: cssTransform(view) }}>
        <StepImage src={src} step={step} onSize={(w, h) => onAspect?.(w / h)} />
        <Spotlight boxes={step.highlights} />
      </div>
      {children}
    </div>
  );
}

export function Player({
  demo,
  mode = "inline",
  startAt = 0,
  onStepChange,
  branding = true,
}: PlayerProps) {
  const steps = demo.steps;
  const [phase, setPhase] = useState<Phase>(demo.intro && startAt === 0 ? "intro" : "step");
  const [index, setIndex] = useState(Math.min(startAt, Math.max(0, steps.length - 1)));
  const [aspect, setAspect] = useState(16 / 10);
  const root = useRef<HTMLElement>(null);
  const tip = useRef<HTMLDivElement>(null);
  const [, setWidth] = useState(0);
  const step = steps[index];

  useEffect(() => {
    setIndex((i) => Math.min(i, Math.max(0, steps.length - 1)));
  }, [steps.length]);

  useEffect(() => {
    if (phase === "step") onStepChange?.(index);
  }, [index, phase]);

  // Preload the next screenshot.
  useEffect(() => {
    const next = steps[index + 1];
    const src = next ? demo.images[next.image] : undefined;
    if (src) new Image().src = src;
  }, [index, steps, demo.images]);

  const go = useCallback(
    (delta: number) => {
      if (phase === "intro") {
        if (delta > 0) setPhase("step");
        return;
      }
      if (phase === "end") {
        if (delta < 0) setPhase("step");
        return;
      }
      const n = index + delta;
      if (n >= steps.length) setPhase("end");
      else if (n < 0) {
        if (demo.intro) setPhase("intro");
      } else setIndex(n);
    },
    [phase, index, steps.length, demo.intro],
  );

  const restart = () => {
    setIndex(0);
    setPhase(demo.intro ? "intro" : "step");
  };

  useEffect(() => {
    const target: HTMLElement | Window | null = mode === "full" ? window : root.current;
    if (!target) return;
    const onKey = (e: Event) => {
      const k = (e as KeyboardEvent).key;
      if (k === "ArrowRight" || k === " " || k === "Enter") {
        if ((e.target as HTMLElement)?.tagName === "BUTTON" && k !== "ArrowRight") return;
        e.preventDefault();
        go(1);
      } else if (k === "ArrowLeft") {
        e.preventDefault();
        go(-1);
      }
    };
    target.addEventListener("keydown", onKey);
    return () => target.removeEventListener("keydown", onKey);
  }, [go, mode]);

  useEffect(() => {
    const el = root.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Keep the tooltip inside the frame: positioned from the hotspot, then nudged
  // back in (with `translate`, which leaves the entrance animation's transform alone).
  useLayoutEffect(() => {
    const t = tip.current;
    const frame = t?.closest(".sc-viewport");
    if (!t || !frame) return;
    t.style.translate = "";
    const f = frame.getBoundingClientRect();
    const r = t.getBoundingClientRect();
    const m = 8;
    const dx =
      r.left < f.left + m ? f.left + m - r.left : r.right > f.right - m ? f.right - m - r.right : 0;
    const dy =
      r.top < f.top + m ? f.top + m - r.top : r.bottom > f.bottom - m ? f.bottom - m - r.bottom : 0;
    if (dx || dy) t.style.translate = `${Math.round(dx)}px ${Math.round(dy)}px`;
  });

  if (!step) {
    return (
      <section class={`sc-player sc-${mode}`} ref={root}>
        <div class="sc-empty">This demo has no steps yet.</div>
      </section>
    );
  }

  const view = phase === "step" ? viewFor(step.zoom) : viewFor(null);
  const hot = step.hotspot ? inView(mapBox(step.hotspot, view)) : null;
  const placement = step.placement === "auto" ? autoPlacement(hot) : step.placement;
  const accent = demo.theme.accent || "#6d5efc";
  const last = index === steps.length - 1;

  return (
    <section
      class={`sc-player sc-${mode}`}
      ref={root}
      tabIndex={mode === "full" ? -1 : 0}
      style={{ "--sc-accent": accent }}
      aria-roledescription="interactive demo"
      aria-label={demo.title}
    >
      <div class="sc-frame" style={{ aspectRatio: String(aspect) }}>
        <StepScene
          key={step.id}
          step={step}
          src={demo.images[step.image] ?? ""}
          view={view}
          onAspect={setAspect}
        >
          {phase === "step" && hot && (
            <button
              type="button"
              class="sc-hotspot"
              style={{
                left: `${hot.x * 100}%`,
                top: `${hot.y * 100}%`,
                width: `${hot.w * 100}%`,
                height: `${hot.h * 100}%`,
              }}
              aria-label={step.title ? `Next: ${step.title}` : "Next step"}
              onClick={() => go(1)}
            >
              <span class="sc-beacon" />
            </button>
          )}
          {phase === "step" && (
            <div
              ref={tip}
              class={`sc-tip sc-tip-${hot ? placement : "free"} ${hot && hot.y + hot.h / 2 > 0.5 ? "sc-tip-low" : ""}`}
              style={tooltipStyle(hot, placement)}
              role="dialog"
              aria-live="polite"
            >
              {step.title && <div class="sc-tip-title">{step.title}</div>}
              {step.body && <div class="sc-tip-body">{step.body}</div>}
              <div class="sc-tip-nav">
                <span class="sc-tip-count">
                  {index + 1} / {steps.length}
                </span>
                {(index > 0 || demo.intro) && (
                  <button type="button" class="sc-btn sc-btn-ghost" onClick={() => go(-1)}>
                    Back
                  </button>
                )}
                <button type="button" class="sc-btn" onClick={() => go(1)}>
                  {last ? "Finish" : "Next"}
                </button>
              </div>
            </div>
          )}
        </StepScene>

        {phase === "intro" && demo.intro && (
          <div class="sc-cover">
            <div class="sc-card">
              <h2>{demo.intro.title}</h2>
              {demo.intro.body && <p>{demo.intro.body}</p>}
              <button type="button" class="sc-btn sc-btn-lg" onClick={() => setPhase("step")}>
                {demo.intro.button || "Start"}
              </button>
            </div>
          </div>
        )}
        {phase === "end" && (
          <div class="sc-cover">
            <div class="sc-card">
              <h2>{demo.outro?.title || "That's the tour"}</h2>
              {demo.outro?.body && <p>{demo.outro.body}</p>}
              <div class="sc-card-actions">
                {demo.outro?.ctaLabel &&
                  demo.outro.ctaUrl &&
                  /^https?:\/\//i.test(demo.outro.ctaUrl) && (
                    <a
                      class="sc-btn sc-btn-lg"
                      href={demo.outro.ctaUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {demo.outro.ctaLabel}
                    </a>
                  )}
                <button type="button" class="sc-btn sc-btn-ghost sc-btn-lg" onClick={restart}>
                  Replay
                </button>
              </div>
            </div>
          </div>
        )}

        <div class="sc-progress" aria-hidden="true">
          <div
            class="sc-progress-bar"
            style={{
              width: `${phase === "end" ? 100 : phase === "intro" ? 0 : ((index + 1) / steps.length) * 100}%`,
            }}
          />
        </div>
      </div>
      {mode !== "embed" && branding && (
        <div class="sc-foot">
          <span class="sc-foot-title">{demo.title}</span>
          <a href={BRAND_URL} target="_blank" rel="noopener noreferrer">
            Made with stepcast
          </a>
        </div>
      )}
    </section>
  );
}
