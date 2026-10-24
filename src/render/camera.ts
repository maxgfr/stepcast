/**
 * The camera: which part of a screenshot is on screen. A step's zoom box gives
 * a scale and a center; the center is clamped so the view never leaves the
 * image. Everything is in normalized image coordinates.
 */
import type { Box } from "../model/demo";

export interface View {
  cx: number;
  cy: number;
  s: number;
}

export const FULL_VIEW: View = { cx: 0.5, cy: 0.5, s: 1 };

const clampCenter = (c: number, s: number) => Math.min(1 - 0.5 / s, Math.max(0.5 / s, c));

export function viewFor(zoom: Box | null | undefined, maxScale = 4): View {
  if (!zoom) return FULL_VIEW;
  const s = Math.max(1, Math.min(maxScale, 1 / Math.max(zoom.w, 0.01), 1 / Math.max(zoom.h, 0.01)));
  return { s, cx: clampCenter(zoom.x + zoom.w / 2, s), cy: clampCenter(zoom.y + zoom.h / 2, s) };
}

/** Where an image point lands in the viewport (0–1 of the viewport). */
export function mapPoint(p: { x: number; y: number }, v: View): { x: number; y: number } {
  return { x: (p.x - v.cx) * v.s + 0.5, y: (p.y - v.cy) * v.s + 0.5 };
}

export function mapBox(b: Box, v: View): Box {
  const p = mapPoint(b, v);
  return { x: p.x, y: p.y, w: b.w * v.s, h: b.h * v.s };
}

/** CSS transform for a layer sized like the viewport, with `transform-origin: 0 0`. */
export function cssTransform(v: View): string {
  const tx = -(v.cx - 0.5 / v.s) * 100;
  const ty = -(v.cy - 0.5 / v.s) * 100;
  return `scale(${v.s}) translate(${tx}%, ${ty}%)`;
}

export const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

export function lerpView(a: View, b: View, t: number): View {
  const k = easeInOut(Math.min(1, Math.max(0, t)));
  // Interpolate the visible width (1/s), not the scale, so the motion feels even.
  const wa = 1 / a.s;
  const wb = 1 / b.s;
  const s = 1 / (wa + (wb - wa) * k);
  return { s, cx: a.cx + (b.cx - a.cx) * k, cy: a.cy + (b.cy - a.cy) * k };
}
