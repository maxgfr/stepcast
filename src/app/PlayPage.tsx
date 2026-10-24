/** A shared demo: from the link itself (#/play/…) or from a Gist (#/gist/…). */
import { useSignal } from "@preact/signals";
import { useEffect } from "preact/hooks";
import type { Demo } from "../model/demo";
import { Player } from "../player/Player";
import { decodeBundle, withObjectUrls } from "../share/bundle";
import { fetchGist } from "../share/gist";
import { navigate } from "./router";
import { createProjectFromDemo } from "./state";
import { Button, errorText, toast } from "./ui";

export function PlayPage({
  bundle,
  gist,
  embed,
}: {
  bundle?: string;
  gist?: string;
  embed: boolean;
}) {
  const demo = useSignal<Demo | null>(null);
  const error = useSignal("");
  const raw = useSignal<Awaited<ReturnType<typeof decodeBundle>> | null>(null);

  useEffect(() => {
    let live = true;
    let urls: string[] = [];
    error.value = "";
    demo.value = null;
    (async () => {
      const text = gist ? await fetchGist(gist) : (bundle ?? "");
      if (!text) throw new Error("This link holds no demo.");
      const decoded = await decodeBundle(text);
      if (!live) return;
      raw.value = decoded;
      const d = withObjectUrls(decoded);
      urls = Object.values(d.images);
      demo.value = d;
      document.title = `${d.title} · stepcast`;
    })().catch((err) => {
      if (live) error.value = errorText(err);
    });
    return () => {
      live = false;
      for (const u of urls) URL.revokeObjectURL(u);
    };
  }, [bundle, gist]);

  const remix = async () => {
    if (!raw.value) return;
    try {
      const id = await createProjectFromDemo(raw.value.demo, raw.value.blobs);
      navigate(`#/edit/${id}`);
    } catch (err) {
      toast(errorText(err), "error");
    }
  };

  if (error.value) {
    return (
      <main class={`play ${embed ? "play-embed" : ""}`}>
        <div class="play-error">
          <p>{error.value}</p>
          {!embed && (
            <Button variant="primary" onClick={() => navigate("#/")}>
              Make your own demo
            </Button>
          )}
        </div>
      </main>
    );
  }
  if (!demo.value)
    return (
      <main class={`play ${embed ? "play-embed" : ""}`}>
        <div class="sample-placeholder is-loading" />
      </main>
    );

  if (embed) {
    return (
      <main class="play play-embed">
        <Player demo={demo.value} mode="embed" />
      </main>
    );
  }
  return (
    <main class="play">
      <div class="play-head">
        <div>
          <h1>{demo.value.title}</h1>
          {demo.value.description && <p class="muted">{demo.value.description}</p>}
        </div>
        <div class="row">
          <Button size="sm" onClick={() => void remix()}>
            Edit a copy
          </Button>
          <Button size="sm" variant="primary" onClick={() => navigate("#/")}>
            Make your own
          </Button>
        </div>
      </div>
      <Player demo={demo.value} mode="full" branding={false} />
    </main>
  );
}
