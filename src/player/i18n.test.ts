import { describe, expect, it } from "bun:test";
import { RESPONSE_LANGUAGES } from "llm-connect";
import { parseDemo } from "../model/demo";
import { isRtl, PLAYER_LANGUAGES, playerLabels } from "./i18n";

describe("player languages", () => {
  it("speaks every language AI mode writes in", () => {
    for (const l of RESPONSE_LANGUAGES) expect(PLAYER_LANGUAGES).toContain(l.code);
  });

  it("picks the labels of a language, region or not, and falls back to English", () => {
    expect(playerLabels("fr").next).toBe("Suivant");
    expect(playerLabels("fr-CA").back).toBe("Retour");
    expect(playerLabels("xx").next).toBe("Next");
    expect(playerLabels(undefined).start).toBe("Start");
  });

  it("knows right-to-left languages", () => {
    expect(isRtl("ar")).toBe(true);
    expect(isRtl("fr")).toBe(false);
  });

  it("demos are English unless they say otherwise", () => {
    const res = parseDemo({});
    expect(res.ok && res.demo.language).toBe("en");
  });
});
