/**
 * The camera recorded next to the screen, into a file of its
 * own, paused and stopped with it. `offset` is where the file starts on the
 * screen recording's clock (the device's permission prompt comes after the
 * screen's), so the file's time t is the screen's offset + t.
 */

export type SideKind = "camera";

/** A side file and where it starts on the screen recording's clock, in seconds. */
export interface SideTake {
  blob: Blob;
  offset: number;
}

const CONSTRAINTS: Record<SideKind, MediaStreamConstraints> = {
  camera: {
    video: { width: { ideal: 640 }, height: { ideal: 640 }, facingMode: "user" },
    audio: false,
  },
};

const MIMES: Record<SideKind, string[]> = {
  camera: ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm", "video/mp4"],
};

function pickMime(kind: SideKind): string {
  return MIMES[kind].find((t) => MediaRecorder.isTypeSupported(t)) ?? "";
}

export class SideRecorder {
  private readonly chunks: Blob[] = [];
  private constructor(
    readonly kind: SideKind,
    readonly stream: MediaStream,
    private readonly recorder: MediaRecorder,
    readonly offset: number,
  ) {
    recorder.addEventListener("dataavailable", (e) => {
      if (e.data.size > 0) this.chunks.push(e.data);
    });
  }

  /** Asks for the device and starts recording; `offset` is the screen recording's time now. */
  static async start(kind: SideKind, offset: () => number): Promise<SideRecorder> {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined")
      throw new Error(`This browser cannot record the ${kind}.`);
    const stream = await navigator.mediaDevices.getUserMedia(CONSTRAINTS[kind]);
    const mimeType = pickMime(kind);
    const recorder = new MediaRecorder(stream, {
      ...(mimeType ? { mimeType } : {}),
      ...(kind === "camera" ? { videoBitsPerSecond: 1_000_000 } : { audioBitsPerSecond: 32_000 }),
    });
    const side = new SideRecorder(kind, stream, recorder, offset());
    recorder.start(1000);
    return side;
  }

  pause(): void {
    if (this.recorder.state === "recording") this.recorder.pause();
  }

  resume(): void {
    if (this.recorder.state === "paused") this.recorder.resume();
  }

  /** Stops the device; resolves with the file, or null when nothing was recorded. */
  stop(): Promise<SideTake | null> {
    const rec = this.recorder;
    const done = new Promise<SideTake | null>((resolve) => {
      const finish = () =>
        resolve(
          this.chunks.length
            ? {
                blob: new Blob(this.chunks, {
                  type: rec.mimeType || (this.kind === "camera" ? "video/webm" : "audio/webm"),
                }),
                offset: this.offset,
              }
            : null,
        );
      if (rec.state === "inactive") return finish();
      rec.addEventListener("stop", finish, { once: true });
      rec.stop();
    });
    for (const t of this.stream.getTracks()) t.stop();
    return done;
  }
}
