/**
 * Entry of the exported HTML file: the demo's bundle sits in the page itself
 * (#stepcast-data), so the file works offline, from disk or from any host.
 */
import { render } from "preact";
import { decodeBundle, withObjectUrls } from "../share/bundle";
import { Player } from "./Player";

async function main(): Promise<void> {
  const root = document.getElementById("stepcast");
  const data = document.getElementById("stepcast-data")?.textContent ?? "";
  if (!root) return;
  try {
    const demo = withObjectUrls(await decodeBundle(data));
    document.title = demo.title || document.title;
    render(<Player demo={demo} />, root);
    root.querySelector<HTMLElement>(".sc-player")?.focus({ preventScroll: true });
  } catch (err) {
    root.textContent = err instanceof Error ? err.message : "This demo could not be opened.";
  }
}

void main();
