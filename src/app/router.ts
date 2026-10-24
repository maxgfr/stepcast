/**
 * Hash routes, so every page works from GitHub Pages without a server:
 *   #/                 home
 *   #/record           record a demo
 *   #/edit/<id>        edit a project (?start=1 asks for AI or manual mode)
 *   #/play/<bundle>    play a shared demo; #/embed/<bundle> without the chrome
 *   #/gist/<id>        play a demo stored in a Gist; #/embed/gist/<id>
 */
import { signal } from "@preact/signals";

export type Route =
  | { name: "home" }
  | { name: "record" }
  | { name: "edit"; id: string; start: boolean }
  | { name: "play"; bundle: string; embed: boolean }
  | { name: "gist"; id: string; embed: boolean };

export function parseRoute(hash: string): Route {
  const h = hash.replace(/^#\/?/, "");
  const [path = "", query = ""] = h.split("?");
  const parts = path.split("/");
  const params = new URLSearchParams(query);
  switch (parts[0]) {
    case "record":
      return { name: "record" };
    case "edit":
      return parts[1]
        ? { name: "edit", id: parts[1], start: params.has("start") }
        : { name: "home" };
    case "play":
      return { name: "play", bundle: parts.slice(1).join("/"), embed: false };
    case "gist":
      return { name: "gist", id: parts[1] ?? "", embed: false };
    case "embed":
      return parts[1] === "gist"
        ? { name: "gist", id: parts[2] ?? "", embed: true }
        : { name: "play", bundle: parts.slice(1).join("/"), embed: true };
    default:
      return { name: "home" };
  }
}

export const route = signal<Route>(
  parseRoute(typeof location === "undefined" ? "" : location.hash),
);

if (typeof window !== "undefined") {
  window.addEventListener("hashchange", () => {
    route.value = parseRoute(location.hash);
  });
}

export function navigate(hash: string): void {
  if (location.hash === hash) route.value = parseRoute(hash);
  else location.hash = hash;
}
