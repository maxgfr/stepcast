/**
 * Static server for dist/, used by the dev loop and the end-to-end tests. It sends the headers
 * that isolate the page; under /bare/stepcast/ it sends none, like GitHub Pages, where
 * public/sw.js adds them.
 */
import { join, normalize } from "node:path";

export const ISOLATION = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
  "Cross-Origin-Resource-Policy": "same-origin",
};

export function serveApp(opts: { port: number; dir: string }) {
  return Bun.serve({
    port: opts.port,
    async fetch(req) {
      const url = new URL(req.url);
      const bare = url.pathname.startsWith("/bare/");
      let path = decodeURIComponent(url.pathname).replace(/^(\/bare)?\/stepcast/, "");
      if (path === "" || path.endsWith("/")) path += "index.html";
      const file = Bun.file(join(opts.dir, normalize(path).replace(/^(\.\.[/\\])+/, "")));
      if (!(await file.exists())) return new Response("Not found", { status: 404 });
      return new Response(file, { headers: bare ? {} : ISOLATION });
    },
  });
}

if (import.meta.main) {
  const server = serveApp({
    port: Number(process.env.PORT ?? 4173),
    dir: join(import.meta.dir, "../dist"),
  });
  console.log(`serving dist/ on http://localhost:${server.port}/stepcast/`);
}
