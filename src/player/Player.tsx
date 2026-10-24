/**
 * The interactive demo: one screenshot per step, the camera zoomed on what
 * matters, a pulsing hotspot to click and a tooltip that explains it. Used in
 * the editor's preview, on share links, in embeds and in exported HTML files.
 */
import type { ComponentChildren } from "preact";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";
import type { Box, Demo, Frame, Placement, Step } from "../model/demo";
import { cssTransform, mapBox, type View, viewFor } from "../render/camera";
import { backgroundCss, frameMetrics, isLightBackground } from "../render/frame";
import { StepImage } from "../render/StepImage";
import { isRtl, playerLabels } from "./i18n";

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

/**
 * The demo's frame around the stage: the background with its padding, then a
 * window (rounded, shadowed, with an optional bar). Sizes are in units of the
 * frame's width (`cqw` inside, % for the padding), as the videos draw them.
 * `fit`: the embed's box, to fill as large as the frame's shape allows.
 */
function Framed({
  frame,
  aspect,
  fit,
  children,
}: {
  frame: Frame | null;
  aspect: number;
  fit: { w: number; h: number } | null;
  children: ComponentChildren;
}) {
  if (!frame) return <>{children}</>;
  const m = frameMetrics(frame, aspect);
  const width = fit?.w && fit.h ? Math.floor(Math.min(fit.w, fit.h * m.aspect)) : null;
  const inner = 1 - 2 * m.pad;
  return (
    <div
      class="sc-backdrop"
      style={{
        background: backgroundCss(frame.background),
        padding: width ? `${m.pad * width}px` : `${m.pad * 100}%`,
        ...(width ? { width: `${width}px` } : {}),
      }}
    >
      <div
        class={`sc-window${frame.shadow ? " sc-window-shadow" : ""}${isLightBackground(frame.background) ? " sc-window-light" : ""}`}
        style={{ borderRadius: `${(m.radius / inner) * 100}cqw` }}
      >
        {frame.window === "macos" && (
          <div class="sc-winbar" aria-hidden="true">
            <i />
            <i />
            <i />
          </div>
        )}
        {children}
      </div>
    </div>
  );
}

const BRAND_URL = "https://maxgfr.github.io/stepcast/";

/** Where the tooltip goes when the step says "auto". */
const overlap = (a: Box, b: Box) =>
  Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) *
  Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));

/**
 * Where the tooltip goes when the step says "auto": the side of the hotspot
 * where a tooltip (about `tip` of the frame) stays inside the frame and covers
 * the least of what matters (the highlights). Below wins ties, then above.
 */
export function autoPlacement(
  b: Box | null,
  avoid: Box[] = [],
  tip = { w: 0.3, h: 0.22 },
): Exclude<Placement, "auto"> {
  if (!b) return "bottom";
  const gap = 0.02;
  const cx = b.x + b.w / 2;
  const cy = b.y + b.h / 2;
  const at: Record<Exclude<Placement, "auto">, Box> = {
    bottom: { x: cx - tip.w / 2, y: b.y + b.h + gap, ...tip },
    top: { x: cx - tip.w / 2, y: b.y - gap - tip.h, ...tip },
    right: { x: b.x + b.w + gap, y: cy - tip.h / 2, ...tip },
    left: { x: b.x - gap - tip.w, y: cy - tip.h / 2, ...tip },
  };
  const frame: Box = { x: 0, y: 0, w: 1, h: 1 };
  const order = ["bottom", "top", "right", "left"] as const;
  let best: (typeof order)[number] = "bottom";
  let bestScore = Number.POSITIVE_INFINITY;
  order.forEach((side, i) => {
    const r = at[side];
    // Off-frame parts are nudged back in by the player, over the hotspot: costly.
    const outside = tip.w * tip.h - overlap(r, frame);
    const covered = avoid.reduce((sum, a) => sum + overlap(r, a), 0);
    const score = outside * 4 + covered * 2 + i * 0.002;
    if (score < bestScore) {
      bestScore = score;
      best = side;
    }
  });
  return best;
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
  const [size, setSize] = useState({ w: 0, h: 0 });
  const step = steps[index];

  useEffect(() => {
    setIndex((i) => Math.min(i, Math.max(0, steps.length - 1)));
  }, [steps.length]);

  useEffect(() => {
    if (phase === "step") onStepChange?.(index);
  }, [index, phase]);

  // The narration: each step plays its part of the recorded voice, while the voice is on.
  const voiceUrl = demo.narration ? (demo.images[demo.narration] ?? "") : "";
  const hasVoice = !!voiceUrl && steps.some((s) => s.voice);
  const [voiceOn, setVoiceOn] = useState(true);
  const audio = useRef<HTMLAudioElement | null>(null);
  useEffect(() => {
    if (!hasVoice) return;
    const a = new Audio(voiceUrl);
    a.preload = "auto";
    audio.current = a;
    return () => {
      a.pause();
      audio.current = null;
    };
  }, [voiceUrl, hasVoice]);
  useEffect(() => {
    const a = audio.current;
    if (!a) return;
    a.pause();
    const voice = phase === "step" ? step?.voice : null;
    if (!voiceOn || !voice) return;
    const stopAtEnd = () => {
      if (a.currentTime >= voice.end) a.pause();
    };
    a.addEventListener("timeupdate", stopAtEnd);
    a.currentTime = voice.start;
    // Browsers refuse sound before the viewer's first click; the next step will play.
    void a.play().catch(() => undefined);
    return () => {
      a.removeEventListener("timeupdate", stopAtEnd);
      a.pause();
    };
  }, [index, phase, voiceOn, step?.voice, hasVoice]);

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
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
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
  const placement =
    step.placement === "auto"
      ? autoPlacement(
          hot,
          step.highlights.map((h) => inView(mapBox(h, view))),
          size.w
            ? { w: Math.min(340, size.w * 0.62) / size.w, h: 150 / (size.w / aspect) }
            : undefined,
        )
      : step.placement;
  const accent = demo.theme.accent || "#6d5efc";
  const t = playerLabels(demo.language);
  const last = index === steps.length - 1;

  return (
    <section
      class={`sc-player sc-${mode}`}
      ref={root}
      tabIndex={mode === "full" ? -1 : 0}
      style={{ "--sc-accent": accent }}
      aria-roledescription="interactive demo"
      aria-label={demo.title}
      lang={demo.language || "en"}
      dir={isRtl(demo.language) ? "rtl" : "ltr"}
    >
      <Framed frame={demo.theme.frame} aspect={aspect} fit={mode === "embed" ? size : null}>
        <div
          class="sc-frame"
          style={{
            aspectRatio: String(aspect),
            // An embed fills its iframe: as large as fits, whatever the iframe's shape.
            ...(mode === "embed" && size.w && size.h && !demo.theme.frame
              ? { width: `${Math.floor(Math.min(size.w, size.h * aspect))}px` }
              : {}),
          }}
        >
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
                aria-label={step.title ? `${t.next}: ${step.title}` : t.nextStep}
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
                      {t.back}
                    </button>
                  )}
                  <button type="button" class="sc-btn" onClick={() => go(1)}>
                    {last ? t.finish : t.next}
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
                  {demo.intro.button || t.start}
                </button>
              </div>
            </div>
          )}
          {phase === "end" && (
            <div class="sc-cover">
              <div class="sc-card">
                <h2>{demo.outro?.title || t.end}</h2>
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
                    {t.replay}
                  </button>
                </div>
              </div>
            </div>
          )}

          {hasVoice && (
            <button
              type="button"
              class={`sc-voice${voiceOn ? " is-on" : ""}`}
              aria-pressed={voiceOn}
              aria-label={voiceOn ? t.voiceOff : t.voiceOn}
              title={voiceOn ? t.voiceOff : t.voiceOn}
              onClick={() => setVoiceOn((v) => !v)}
            >
              <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                <path d="M4 9h4l5-4v14l-5-4H4z" />
                {voiceOn ? (
                  <path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12" />
                ) : (
                  <path d="M17 9l5 6M22 9l-5 6" />
                )}
              </svg>
            </button>
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
      </Framed>
      {mode !== "embed" && branding && (
        <div class="sc-foot">
          <span class="sc-foot-title">{demo.title}</span>
          <a href={BRAND_URL} target="_blank" rel="noopener noreferrer">
            {t.made}
          </a>
        </div>
      )}
    </section>
  );
}
