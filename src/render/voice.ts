/**
 * The narration in the video exports: each step's part of the recorded voice,
 * laid on the film's timeline as the camera settles on its screen, rendered
 * into one AudioBuffer for the encoder.
 */
import { type Tour, VOICE_AT } from "./tour";

const RATE = 48_000;

type OfflineCtx = typeof OfflineAudioContext;

/** The film's soundtrack, or null when no step plays a part of the narration. */
export async function voiceTrack(tour: Tour, narration: Blob): Promise<AudioBuffer | null> {
  const parts = tour.shots.flatMap((shot) => {
    const voice = shot.kind === "step" ? tour.demo.steps[shot.index]?.voice : null;
    return voice ? [{ at: shot.start + VOICE_AT, voice, room: shot.duration - VOICE_AT }] : [];
  });
  const Ctx = (globalThis as { OfflineAudioContext?: OfflineCtx }).OfflineAudioContext;
  if (!parts.length || !Ctx) return null;
  const decoded = await new Ctx(1, 1, RATE).decodeAudioData(await narration.arrayBuffer());
  const ctx = new Ctx(1, Math.max(1, Math.ceil(tour.duration * RATE)), RATE);
  for (const { at, voice, room } of parts) {
    const src = ctx.createBufferSource();
    src.buffer = decoded;
    src.connect(ctx.destination);
    // A part never runs into the next shot.
    src.start(at, voice.start, Math.max(0, Math.min(voice.end - voice.start, room)));
  }
  return ctx.startRendering();
}
