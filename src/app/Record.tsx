import { signal, useSignal } from "@preact/signals";
import { render } from "preact";
import { useEffect } from "preact/hooks";
import { clock } from "../ai/prompts";
import { type CapturedFrame, ScreenRecorder } from "../capture/recorder";
import { SideRecorder } from "../capture/side";
import { navigate } from "./router";
import { createProject } from "./state";
import { Button, errorText, Icon, toast } from "./ui";

interface Shot extends CapturedFrame {
  url: string;
}

type Status = "idle" | "recording" | "saving";

const status = signal<Status>("idle");
const paused = signal(false);
const elapsed = signal(0);
const shots = signal<Shot[]>([]);
const duplicates = signal(0);
let recorder: ScreenRecorder | null = null;
/** The camera, recorded into its own file for the video exports' bubble. */
const camera = signal<SideRecorder | null>(null);
let pipWindow: Window | null = null;
let ticker: ReturnType<typeof setInterval> | undefined;

interface DocumentPip {
  requestWindow(opts: { width: number; height: number }): Promise<Window>;
}
const docPip = (): DocumentPip | undefined =>
  (globalThis as unknown as { documentPictureInPicture?: DocumentPip }).documentPictureInPicture;

async function snap(): Promise<void> {
  try {
    await recorder?.snap();
  } catch {
    toast("No picture to snap yet.", "error");
  }
}

function togglePause(): void {
  if (!recorder) return;
  if (recorder.paused) {
    recorder.resume();
    camera.value?.resume();
  } else {
    recorder.pause();
    camera.value?.pause();
  }
  paused.value = recorder.paused;
}

async function stop(title: string): Promise<void> {
  if (!recorder || status.value !== "recording") return;
  status.value = "saving";
  clearInterval(ticker);
  pipWindow?.close();
  pipWindow = null;
  try {
    const rec = recorder;
    recorder = null;
    const cam = camera.value;
    camera.value = null;
    const [video, cameraTake] = await Promise.all([rec.stop(), cam?.stop() ?? null]);
    const frames = shots.value;
    if (frames.length === 0) {
      toast("Nothing was captured. Try again, and click through a few screens.", "error");
      status.value = "idle";
      return;
    }
    const id = await createProject(title, frames, video, false, { camera: cameraTake });
    for (const s of frames) URL.revokeObjectURL(s.url);
    shots.value = [];
    status.value = "idle";
    navigate(`#/edit/${id}?start=1`);
  } catch (err) {
    toast(errorText(err), "error");
    status.value = "idle";
  }
}

function PipControls({ onStop }: { onStop: () => void }) {
  return (
    <div class="pip">
      <div class="pip-row">
        <span class={`rec-dot ${paused.value ? "is-paused" : ""}`} />
        <span class="pip-time">{clock(elapsed.value)}</span>
        <span class="pip-count">{shots.value.length} shots</span>
      </div>
      <div class="pip-row">
        <button type="button" class="btn btn-primary btn-sm" onClick={() => void snap()}>
          <Icon name="camera" size={15} /> Snap step
        </button>
        <button type="button" class="btn btn-secondary btn-sm" onClick={togglePause}>
          <Icon name={paused.value ? "play" : "pause"} size={15} />
        </button>
        <button type="button" class="btn btn-danger btn-sm" onClick={onStop} aria-label="Stop">
          <Icon name="stop" size={15} />
        </button>
      </div>
    </div>
  );
}

async function openPip(onStop: () => void): Promise<boolean> {
  const api = docPip();
  if (!api || pipWindow) return false;
  try {
    const win = await api.requestWindow({ width: 300, height: 116 });
    for (const link of document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')) {
      const l = win.document.createElement("link");
      l.rel = "stylesheet";
      l.href = link.href;
      win.document.head.append(l);
    }
    win.document.body.className = "pip-body";
    pipWindow = win;
    render(<PipControls onStop={onStop} />, win.document.body);
    win.addEventListener("pagehide", () => {
      pipWindow = null;
    });
    return true;
  } catch {
    return false;
  }
}

export function Record() {
  const title = useSignal("Untitled demo");
  const audio = useSignal(false);
  const withCamera = useSignal(false);
  const dense = useSignal(true);
  const pipOpen = useSignal(false);
  const canPip = Boolean(docPip());

  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (status.value === "recording") e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);

  const finish = () => void stop(title.value.trim() || "Untitled demo");

  const start = async () => {
    try {
      shots.value = [];
      recorder = await ScreenRecorder.start(
        {
          onFrame(f) {
            shots.value = [...shots.value, { ...f, url: URL.createObjectURL(f.blob) }];
          },
          onEnded: finish,
        },
        { audio: audio.value, dense: dense.value },
      );
      status.value = "recording";
      paused.value = false;
      if (withCamera.value) {
        const screen = recorder;
        void SideRecorder.start("camera", () => screen.elapsed())
          .then((side) => {
            if (recorder === screen) camera.value = side;
            else void side.stop();
          })
          .catch(() => toast("The camera is not available: recording the screen only.", "error"));
      }
      elapsed.value = 0;
      ticker = setInterval(() => {
        elapsed.value = recorder?.elapsed() ?? 0;
        duplicates.value = recorder?.duplicates ?? 0;
      }, 500);
      // Opening a window needs a user gesture; it is often still valid right after the share dialog.
      pipOpen.value = await openPip(finish);
    } catch (err) {
      const msg = errorText(err);
      toast(msg === "Permission was refused." ? "Screen sharing was cancelled." : msg, "error");
    }
  };

  const removeShot = (i: number) => {
    const s = shots.value[i];
    if (s) URL.revokeObjectURL(s.url);
    shots.value = shots.value.filter((_, j) => j !== i);
  };

  if (status.value === "idle") {
    return (
      <main class="record">
        <div class="record-card">
          <h1>Record a demo</h1>
          <p class="lede">
            Pick a tab, a window or your whole screen in the next dialog, then click through your
            product as you would in a live demo. Each new screen is captured on its own; press{" "}
            <strong>Snap step</strong> for the ones you want for sure.
          </p>
          <label class="field">
            <span class="field-label">Name</span>
            <input
              class="input"
              value={title.value}
              onInput={(e) => (title.value = e.currentTarget.value)}
            />
          </label>
          <label class="check">
            <input
              type="checkbox"
              checked={audio.value}
              onChange={(e) => (audio.value = e.currentTarget.checked)}
            />
            Record the tab's audio too (kept with the video, never sent to the AI)
          </label>
          <label class="check">
            <input
              type="checkbox"
              checked={withCamera.value}
              onChange={(e) => (withCamera.value = e.currentTarget.checked)}
            />
            Record my camera too, for a bubble in the MP4 and GIF (stays on this device)
          </label>
          <label class="check">
            <input
              type="checkbox"
              checked={dense.value}
              onChange={(e) => (dense.value = e.currentTarget.checked)}
            />
            Plenty of screenshots: before and after every change, and every second while the screen
            moves (the AI picks the best ones)
          </label>
          <ul class="tips">
            <li>
              A browser tab gives the sharpest screenshots, and the cursor stays visible for the AI.
            </li>
            <li>Rest the cursor on what you are about to click: that screen is kept too.</li>
            {canPip && <li>Floating controls open over your other windows while you record.</li>}
          </ul>
          <div class="record-actions">
            <Button variant="ghost" icon="back" onClick={() => navigate("#/")}>
              Back
            </Button>
            <Button variant="primary" size="lg" icon="record" onClick={() => void start()}>
              Start recording
            </Button>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main class="record">
      <div class="record-live">
        <div class="record-status">
          <span class={`rec-dot ${paused.value ? "is-paused" : ""}`} />
          <span class="rec-time">{clock(elapsed.value)}</span>
          <span class="muted">
            {status.value === "saving"
              ? "Saving…"
              : paused.value
                ? "Paused"
                : `Recording · ${shots.value.length} screenshot${shots.value.length === 1 ? "" : "s"}${duplicates.value ? ` · ${duplicates.value} duplicate${duplicates.value === 1 ? "" : "s"} skipped` : ""}`}
          </span>
        </div>
        {camera.value && (
          <video
            class="cam-preview"
            autoPlay
            muted
            playsInline
            aria-label="Camera preview"
            ref={(el) => {
              if (el && camera.value && el.srcObject !== camera.value.stream)
                el.srcObject = camera.value.stream;
            }}
          />
        )}
        <div class="record-controls">
          <Button
            variant="primary"
            size="lg"
            icon="camera"
            onClick={() => void snap()}
            disabled={status.value !== "recording"}
          >
            Snap step
          </Button>
          <Button
            size="lg"
            icon={paused.value ? "play" : "pause"}
            onClick={togglePause}
            disabled={status.value !== "recording"}
          >
            {paused.value ? "Resume" : "Pause"}
          </Button>
          <Button
            variant="danger"
            size="lg"
            icon="stop"
            onClick={finish}
            disabled={status.value !== "recording"}
          >
            Stop &amp; edit
          </Button>
          {canPip && !pipOpen.value && status.value === "recording" && (
            <Button
              variant="ghost"
              onClick={() =>
                void openPip(finish).then((ok) => {
                  pipOpen.value = ok;
                })
              }
            >
              Floating controls
            </Button>
          )}
        </div>
        <ol class="shots">
          {shots.value.length === 0 && (
            <li class="shots-empty muted">Screenshots appear here as you go.</li>
          )}
          {shots.value.map((s, i) => (
            <li key={s.url} class={`shot ${s.pinned ? "is-pinned" : ""}`}>
              <img src={s.url} alt={`Screenshot at ${clock(s.time)}`} />
              <span class="shot-time">
                {s.pinned && <Icon name="camera" size={12} />} {clock(s.time)}
              </span>
              <button
                type="button"
                class="shot-remove"
                aria-label="Remove screenshot"
                onClick={() => removeShot(i)}
              >
                <Icon name="close" size={14} />
              </button>
            </li>
          ))}
        </ol>
      </div>
    </main>
  );
}
