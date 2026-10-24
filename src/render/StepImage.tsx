/**
 * A step's screenshot. With no redaction or text edit it is a plain <img>;
 * otherwise a canvas with them painted in, so what you see in the editor is
 * exactly what an export will bake.
 */
import { useEffect, useRef } from "preact/hooks";
import type { Step } from "../model/demo";
import { drawBaked, fitSize, loadImage } from "./image";

interface Props {
  src: string;
  step: Pick<Step, "redactions" | "textEdits">;
  onSize?: (w: number, h: number) => void;
  class?: string;
}

export function StepImage({ src, step, onSize, class: cls }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const plain = step.redactions.length === 0 && step.textEdits.length === 0;

  useEffect(() => {
    if (plain || !src) return;
    let live = true;
    loadImage(src)
      .then((img) => {
        const c = canvas.current;
        if (!live || !c) return;
        const { w, h } = fitSize(img.naturalWidth, img.naturalHeight, 2400);
        c.width = w;
        c.height = h;
        const ctx = c.getContext("2d");
        if (ctx) drawBaked(ctx, img, w, h, step);
        onSize?.(img.naturalWidth, img.naturalHeight);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [src, plain, step.redactions, step.textEdits]);

  if (!src) return <div class={`sc-img sc-img-empty ${cls ?? ""}`} />;
  if (plain) {
    return (
      <img
        class={`sc-img ${cls ?? ""}`}
        src={src}
        alt=""
        draggable={false}
        onLoad={(e) => onSize?.(e.currentTarget.naturalWidth, e.currentTarget.naturalHeight)}
      />
    );
  }
  return <canvas ref={canvas} class={`sc-img ${cls ?? ""}`} />;
}
