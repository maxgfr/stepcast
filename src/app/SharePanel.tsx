import { useSignal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import type { VideoText } from "../render/tour";
import { encodeBundle } from "../share/bundle";
import {
  download,
  embedSnippet,
  exportGif,
  exportHtml,
  exportJson,
  exportVideo,
  exportVtt,
  fileName,
  gistLink,
  playLink,
} from "../share/export";
import { loadGithubToken, publishGist, saveGithubToken } from "../share/gist";
import { bundleForLink, LINK_LIMIT, packDemo } from "../share/pack";
import { flushSave, getAssetBlob, project } from "./state";
import { Button, copyText, errorText, Field, Icon, Modal, toast } from "./ui";

function kb(n: number): string {
  return n > 1_000_000
    ? `${(n / 1_000_000).toFixed(1)} MB`
    : `${Math.max(1, Math.round(n / 1000))} KB`;
}

function CopyRow({ value, label }: { value: string; label: string }) {
  return (
    <div class="copy-row">
      <input
        class="input mono"
        readOnly
        value={value}
        aria-label={label}
        onFocus={(e) => e.currentTarget.select()}
      />
      <Button
        icon="copy"
        onClick={() =>
          void copyText(value).then((ok) =>
            toast(
              ok ? "Copied." : "Copy failed: select and copy by hand.",
              ok ? "success" : "error",
            ),
          )
        }
      >
        Copy
      </Button>
    </div>
  );
}

export function SharePanel({ onClose }: { onClose: () => void }) {
  const link = useSignal<{ url: string; size: number; fits: boolean } | null>(null);
  const gist = useSignal("");
  const token = useSignal("");
  const busy = useSignal<string | null>(null);
  const ratio = useSignal(0);
  const videoText = useSignal<VideoText>("tooltips");
  const abort = useRef<AbortController | null>(null);
  const p = project.value;

  useEffect(() => {
    void loadGithubToken().then((t) => (token.value = t));
  }, []);

  if (!p) return null;
  const demo = p.demo;
  const empty = demo.steps.length === 0;

  const task = async (label: string, fn: (signal: AbortSignal) => Promise<void>) => {
    const ctrl = new AbortController();
    abort.current = ctrl;
    busy.value = label;
    ratio.value = 0;
    try {
      await flushSave();
      await fn(ctrl.signal);
    } catch (err) {
      toast(errorText(err), "error", 7000);
    } finally {
      busy.value = null;
    }
  };

  const makeLink = () =>
    task("Packing the demo into a link…", async () => {
      const res = await bundleForLink(demo, getAssetBlob);
      link.value = { url: playLink(res.bundle), size: res.bundle.length, fits: res.fits };
    });

  const makeGist = () =>
    task("Publishing to a secret Gist…", async () => {
      if (!token.value.trim()) throw new Error("Paste a GitHub token with the gist scope first.");
      await saveGithubToken(token.value.trim());
      const packed = await packDemo(demo, getAssetBlob);
      const bundle = await encodeBundle(packed.demo, packed.blobs);
      const id = await publishGist(token.value.trim(), bundle, demo.title);
      gist.value = gistLink(id);
    });

  const best = gist.value || (link.value?.fits ? link.value.url : "");

  return (
    <Modal
      title="Share & export"
      onClose={() => (busy.value ? abort.current?.abort() : onClose())}
      wide
    >
      {empty ? (
        <p class="muted">Add at least one step before sharing.</p>
      ) : (
        <div class="share">
          <section>
            <h3>
              <Icon name="link" size={16} /> Share link
            </h3>
            <p class="muted">
              The whole demo is packed into the link itself: no server, no account. Blurred areas
              are painted into the pictures first, so the link never holds what you hid.
            </p>
            {link.value ? (
              <>
                <CopyRow value={link.value.url} label="Share link" />
                <p class={link.value.fits ? "muted" : "error"}>
                  {kb(link.value.size)}.{" "}
                  {link.value.fits
                    ? link.value.size > 60_000
                      ? "Works pasted into a browser; some chat apps cut long links. A Gist link is short."
                      : "Short enough for anywhere."
                    : `Too big for a link (over ${kb(LINK_LIMIT)}). Use a Gist link or an HTML export.`}
                </p>
                {link.value.fits && (
                  <a
                    class="btn btn-ghost btn-sm"
                    href={link.value.url}
                    target="_blank"
                    rel="noopener"
                  >
                    <Icon name="play" size={14} /> Open
                  </a>
                )}
              </>
            ) : (
              <Button
                variant="primary"
                icon="link"
                onClick={() => void makeLink()}
                disabled={!!busy.value}
              >
                Create link
              </Button>
            )}
          </section>

          <section>
            <h3>
              <Icon name="github" size={16} /> Short link through a Gist
            </h3>
            <p class="muted">
              Stores the demo in a secret Gist on your GitHub account and gives a short link. Needs
              a token with the <code>gist</code> scope (
              <a
                href="https://github.com/settings/tokens/new?scopes=gist&description=stepcast"
                target="_blank"
                rel="noopener noreferrer"
              >
                create one
              </a>
              ), kept encrypted on this device.
            </p>
            {gist.value ? (
              <CopyRow value={gist.value} label="Gist link" />
            ) : (
              <div class="copy-row">
                <input
                  class="input mono"
                  type="password"
                  placeholder="ghp_… or github_pat_…"
                  autoComplete="off"
                  value={token.value}
                  onInput={(e) => (token.value = e.currentTarget.value)}
                  aria-label="GitHub token"
                />
                <Button onClick={() => void makeGist()} disabled={!!busy.value}>
                  Publish
                </Button>
              </div>
            )}
          </section>

          <section>
            <h3>
              <Icon name="file" size={16} /> Embed
            </h3>
            {best ? (
              <Field label="Paste this into your site, docs or Notion">
                <CopyRow value={embedSnippet(best, demo.title)} label="Embed code" />
              </Field>
            ) : (
              <p class="muted">Create a link or a Gist link first; the embed points at it.</p>
            )}
          </section>

          <section>
            <h3>
              <Icon name="download" size={16} /> Export
            </h3>
            <div class="export-grid">
              <Button
                icon="file"
                disabled={!!busy.value}
                onClick={() =>
                  void task("Building the HTML file…", async () =>
                    download(await exportHtml(demo, getAssetBlob), fileName(demo.title, "html")),
                  )
                }
              >
                HTML player
              </Button>
              <Button
                icon="video"
                disabled={!!busy.value}
                onClick={() =>
                  void task("Rendering the video…", async (signal) => {
                    const blob = await exportVideo(
                      demo,
                      getAssetBlob,
                      (r) => (ratio.value = r),
                      signal,
                      { text: videoText.value },
                    );
                    download(
                      blob,
                      fileName(demo.title, blob.type === "video/mp4" ? "mp4" : "webm"),
                    );
                  })
                }
              >
                MP4 video
              </Button>
              <Button
                icon="image"
                disabled={!!busy.value}
                onClick={() =>
                  void task("Rendering the GIF…", async (signal) =>
                    download(
                      await exportGif(demo, getAssetBlob, (r) => (ratio.value = r), signal, {
                        text: videoText.value,
                      }),
                      fileName(demo.title, "gif"),
                    ),
                  )
                }
              >
                GIF
              </Button>
              <Button
                icon="copy"
                disabled={!!busy.value}
                onClick={() =>
                  void task("Writing the JSON…", async () =>
                    download(await exportJson(demo, getAssetBlob), fileName(demo.title, "json")),
                  )
                }
              >
                Project JSON
              </Button>
              <Button
                icon="file"
                disabled={!!busy.value}
                onClick={() => download(exportVtt(demo), fileName(demo.title, "vtt"))}
              >
                Subtitles (.vtt)
              </Button>
            </div>
            <div class="row video-text">
              <span class="small muted">Text in the MP4 and GIF</span>
              <fieldset class="segmented" aria-label="Text in the MP4 and GIF">
                {(
                  [
                    ["tooltips", "Tooltips"],
                    ["subtitles", "Subtitles"],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={videoText.value === value}
                    class={videoText.value === value ? "is-on" : ""}
                    onClick={() => (videoText.value = value)}
                  >
                    {label}
                  </button>
                ))}
              </fieldset>
            </div>
            <p class="muted small">
              The HTML file plays offline, from disk or any host. The JSON keeps everything editable
              (open it from the home page) and follows the{" "}
              <a href="./schema.json" target="_blank" rel="noopener">
                documented schema
              </a>
              , so an AI agent can write or edit demos too.
            </p>
          </section>

          {busy.value && (
            <div class="busy">
              <div class="spinner" aria-hidden="true" />
              <span>{busy.value}</span>
              {ratio.value > 0 && <progress max={1} value={ratio.value} />}
              <Button size="sm" onClick={() => abort.current?.abort()}>
                Cancel
              </Button>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
