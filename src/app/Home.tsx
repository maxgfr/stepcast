import { useSignal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import { framesFromImages, framesFromVideo } from "../capture/import";
import type { CapturedFrame } from "../capture/recorder";
import { type Demo, parseDemo } from "../model/demo";
import { deleteProject, getBlob, listProjects, type Project } from "../model/store";
import { Player } from "../player/Player";
import { decodeBundle, withObjectUrls } from "../share/bundle";
import { navigate } from "./router";
import { blobsFromUrls, createProject, createProjectFromDemo } from "./state";
import { Button, errorText, Icon, IconButton, Modal, toast } from "./ui";

function ProjectCard({ p, onDelete }: { p: Project; onDelete: () => void }) {
  const thumb = useSignal("");
  useEffect(() => {
    const key = p.demo.steps[0]?.image ?? p.frames[0]?.asset;
    if (!key) return;
    let url = "";
    void getBlob(p.id, key).then((b) => {
      if (b) thumb.value = url = URL.createObjectURL(b);
    });
    return () => url && URL.revokeObjectURL(url);
  }, [p.id]);
  const date = new Date(p.updatedAt).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
  return (
    <li class="project">
      <a class="project-link" href={`#/edit/${p.id}`}>
        <div class="project-thumb">
          {thumb.value ? <img src={thumb.value} alt="" /> : <Icon name="image" size={28} />}
        </div>
        <div class="project-meta">
          <span class="project-title">{p.demo.title}</span>
          <span class="project-sub">
            {p.demo.steps.length} steps · {p.frames.length} screenshots · {date}
          </span>
        </div>
      </a>
      <IconButton icon="trash" label={`Delete ${p.demo.title}`} onClick={onDelete} />
    </li>
  );
}

const EXAMPLES = [
  { file: "sample.txt", label: "How stepcast works" },
  { file: "todomvc.txt", label: "Made by AI from a recording" },
] as const;

function Sample() {
  const which = useSignal(0);
  const demos = useSignal<Record<number, Demo>>({});
  const failed = useSignal(false);
  useEffect(() => {
    const i = which.value;
    if (demos.value[i]) return;
    const ex = EXAMPLES[i];
    if (!ex) return;
    fetch(`./examples/${ex.file}`)
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error("missing"))))
      .then(decodeBundle)
      .then((d) => {
        demos.value = { ...demos.value, [i]: withObjectUrls(d) };
      })
      .catch(() => {
        failed.value = true;
      });
  }, [which.value]);
  const demo = demos.value[which.value];
  return (
    <>
      <div class="sample-tabs" role="tablist" aria-label="Examples">
        {EXAMPLES.map((ex, i) => (
          <button
            key={ex.file}
            type="button"
            role="tab"
            aria-selected={which.value === i}
            class={which.value === i ? "is-on" : ""}
            onClick={() => (which.value = i)}
          >
            {i === 1 && <Icon name="sparkles" size={14} />} {ex.label}
          </button>
        ))}
      </div>
      {demo ? (
        <Player key={which.value} demo={demo} branding={false} />
      ) : (
        <div class={`sample-placeholder ${failed.value ? "" : "is-loading"}`} aria-hidden="true" />
      )}
    </>
  );
}

function VideoModal({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="stepcast in one minute" onClose={onClose} wide>
      <video class="demo-video" src="./media/stepcast-demo.mp4" controls autoPlay playsInline />
    </Modal>
  );
}

export function Home() {
  const projects = useSignal<Project[]>([]);
  const busy = useSignal<{ text: string; ratio: number } | null>(null);
  const video = useSignal(false);
  const abort = useRef<AbortController | null>(null);
  const videoInput = useRef<HTMLInputElement>(null);
  const imageInput = useRef<HTMLInputElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const refresh = () => {
    listProjects()
      .then((list) => {
        projects.value = list;
      })
      .catch(() => toast("Saved demos cannot be read in this browser (private mode?).", "error"));
  };
  useEffect(refresh, []);

  const importVideo = async (file: File) => {
    const ctrl = new AbortController();
    abort.current = ctrl;
    busy.value = { text: "Finding the key screens in your video…", ratio: 0 };
    const frames: CapturedFrame[] = [];
    try {
      await framesFromVideo(
        file,
        (f) => frames.push(f),
        (ratio) => {
          busy.value = { text: `Finding the key screens… ${frames.length} so far`, ratio };
        },
        ctrl.signal,
      );
      if (frames.length === 0) throw new Error("No screen was found in this video.");
      const id = await createProject(file.name.replace(/\.[^.]+$/, ""), frames, file);
      navigate(`#/edit/${id}?start=1`);
    } catch (err) {
      toast(errorText(err), "error");
    } finally {
      busy.value = null;
    }
  };

  const importImages = async (files: File[]) => {
    try {
      const frames = await framesFromImages(files.sort((a, b) => a.name.localeCompare(b.name)));
      const id = await createProject("Untitled demo", frames, null);
      navigate(`#/edit/${id}?start=1`);
    } catch (err) {
      toast(errorText(err), "error");
    }
  };

  const importFile = async (file: File) => {
    try {
      const text = await file.text();
      let id: string;
      const embedded = text.match(
        /<script type="text\/plain" id="stepcast-data">([\s\S]*?)<\/script>/,
      );
      if (embedded?.[1]) {
        const { demo, blobs } = await decodeBundle(embedded[1]);
        id = await createProjectFromDemo(demo, blobs);
      } else if (/^[A-Za-z0-9_-]{40,}$/.test(text.trim())) {
        const { demo, blobs } = await decodeBundle(text);
        id = await createProjectFromDemo(demo, blobs);
      } else {
        const res = parseDemo(JSON.parse(text));
        if (!res.ok) throw new Error(`This JSON is not a stepcast demo: ${res.error}`);
        id = await createProjectFromDemo(res.demo, await blobsFromUrls(res.demo.images));
      }
      navigate(`#/edit/${id}`);
    } catch (err) {
      toast(err instanceof SyntaxError ? "This file is not valid JSON." : errorText(err), "error");
    }
  };

  return (
    <main class="home">
      <section class="hero">
        <div class="hero-copy">
          <p class="eyebrow">
            <Icon name="sparkles" size={15} /> AI-made interactive demos
          </p>
          <h1>Record your screen. Get a click-through demo.</h1>
          <p class="lede">
            stepcast takes screenshots while you record, then AI picks the screens that tell the
            story and writes the hotspots, tooltips, zooms and blurs. Tweak anything by hand, share
            a link. All in your browser, nothing uploaded.
          </p>
          <div class="hero-actions">
            <Button variant="primary" size="lg" icon="record" onClick={() => navigate("#/record")}>
              Record a demo
            </Button>
            <Button size="lg" icon="video" onClick={() => videoInput.current?.click()}>
              Import a video
            </Button>
          </div>
          <div class="hero-more">
            <button type="button" class="link-btn" onClick={() => (video.value = true)}>
              <Icon name="play" size={15} /> Watch the 1-minute video
            </button>
            <button type="button" class="link-btn" onClick={() => imageInput.current?.click()}>
              <Icon name="image" size={15} /> Start from screenshots
            </button>
            <button type="button" class="link-btn" onClick={() => fileInput.current?.click()}>
              <Icon name="file" size={15} /> Open a stepcast file
            </button>
          </div>
        </div>
        <div class="hero-demo">
          <Sample />
        </div>
      </section>

      <section class="how" aria-label="How it works">
        <ol>
          <li>
            <span class="how-num">1</span>
            <h3>Record</h3>
            <p>
              Share a tab, a window or your screen and click through your product. Screens are
              captured as they change, or when you press Snap.
            </p>
          </li>
          <li>
            <span class="how-num">2</span>
            <h3>Let AI direct</h3>
            <p>
              Say what the demo should show. The AI picks the key screens, places hotspots, writes
              tooltips, zooms on small targets and blurs personal data.
            </p>
          </li>
          <li>
            <span class="how-num">3</span>
            <h3>Polish &amp; share</h3>
            <p>
              Adjust any step by hand, then share a link, embed it, or export HTML, MP4 or GIF. Your
              own API key, or no key at all with copy-paste.
            </p>
          </li>
        </ol>
      </section>

      <section class="projects">
        <h2>Your demos</h2>
        {projects.value.length === 0 ? (
          <p class="muted">Demos you make are saved in this browser and listed here.</p>
        ) : (
          <ul class="project-list">
            {projects.value.map((p) => (
              <ProjectCard
                key={p.id}
                p={p}
                onDelete={() => {
                  if (!window.confirm(`Delete "${p.demo.title}"? This cannot be undone.`)) return;
                  void deleteProject(p.id).then(refresh);
                }}
              />
            ))}
          </ul>
        )}
      </section>

      <input
        ref={videoInput}
        type="file"
        accept="video/*"
        hidden
        onChange={(e) => {
          const f = e.currentTarget.files?.[0];
          e.currentTarget.value = "";
          if (f) void importVideo(f);
        }}
      />
      <input
        ref={imageInput}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => {
          const files = [...(e.currentTarget.files ?? [])];
          e.currentTarget.value = "";
          if (files.length) void importImages(files);
        }}
      />
      <input
        ref={fileInput}
        type="file"
        accept=".json,.html,.txt,application/json,text/html"
        hidden
        onChange={(e) => {
          const f = e.currentTarget.files?.[0];
          e.currentTarget.value = "";
          if (f) void importFile(f);
        }}
      />

      {video.value && <VideoModal onClose={() => (video.value = false)} />}
      {busy.value && (
        <Modal title="Importing" onClose={() => abort.current?.abort()}>
          <p>{busy.value.text}</p>
          <progress max={1} value={busy.value.ratio} />
          <div class="modal-actions">
            <Button onClick={() => abort.current?.abort()}>Cancel</Button>
          </div>
        </Modal>
      )}
    </main>
  );
}
