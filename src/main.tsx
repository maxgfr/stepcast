import { render } from "preact";
import { Editor } from "./app/editor/Editor";
import { Home } from "./app/Home";
import { PlayPage } from "./app/PlayPage";
import { Record } from "./app/Record";
import { route } from "./app/router";
import { Icon, Toasts } from "./app/ui";

function Brand() {
  return (
    <a class="brand" href="#/" aria-label="stepcast home">
      <svg width="26" height="26" viewBox="0 0 32 32" aria-hidden="true">
        <rect width="32" height="32" rx="9" fill="var(--accent)" />
        <path
          d="M9 21.5h5v-5h5v-5h5"
          fill="none"
          stroke="#fff"
          stroke-width="2.6"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
        <circle cx="24" cy="11.5" r="2.4" fill="#fff" />
      </svg>
      <span>stepcast</span>
    </a>
  );
}

function App() {
  const r = route.value;
  if (r.name === "play" && r.embed) return <PlayPage bundle={r.bundle} embed />;
  if (r.name === "gist" && r.embed) return <PlayPage gist={r.id} embed />;
  if (r.name === "edit") {
    return (
      <>
        <Editor id={r.id} start={r.start} />
        <Toasts />
      </>
    );
  }
  return (
    <div class="shell">
      <header class="topbar">
        <Brand />
        <nav class="topnav">
          <a href="#/record">Record</a>
          <a href="./llms.txt" target="_blank" rel="noopener">
            For AI agents
          </a>
          <a
            class="icon-link"
            href="https://github.com/maxgfr/stepcast"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Source on GitHub"
          >
            <Icon name="github" />
          </a>
        </nav>
      </header>
      {r.name === "record" ? (
        <Record />
      ) : r.name === "play" ? (
        <PlayPage bundle={r.bundle} embed={false} />
      ) : r.name === "gist" ? (
        <PlayPage gist={r.id} embed={false} />
      ) : (
        <Home />
      )}
      <footer class="footer">
        <span>
          stepcast runs entirely in your browser. Recordings and keys stay on this device; AI calls
          go straight to the provider you choose.
        </span>
        <a href="https://github.com/maxgfr/stepcast" target="_blank" rel="noopener noreferrer">
          MIT · GitHub
        </a>
      </footer>
      <Toasts />
    </div>
  );
}

const root = document.getElementById("app");
if (root) render(<App />, root);
