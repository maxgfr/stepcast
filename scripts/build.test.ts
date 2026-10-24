import { describe, expect, it } from "bun:test";
import { auditHtml, CSP } from "./build";

describe("build audit", () => {
  it("refuses inline scripts, handlers, styles and external URLs", () => {
    expect(() => auditHtml("<script>alert(1)</script>")).toThrow("inline <script>");
    expect(() => auditHtml('<img src="x.png" onerror="x()">')).toThrow("inline event handler");
    expect(() => auditHtml("<style>a{}</style>")).toThrow("inline <style>");
    expect(() => auditHtml('<script src="https://cdn.example/x.js"></script>')).toThrow(
      "external URL",
    );
    expect(() => auditHtml('<link href="/abs.css">')).toThrow("absolute path");
    expect(() => auditHtml('<script type="module" src="./index.js"></script>')).not.toThrow();
  });

  it("allows no eval and no third-party script", () => {
    expect(CSP).toContain("script-src 'self'");
    expect(CSP).not.toContain("unsafe-eval");
    expect(CSP).not.toContain("unsafe-inline");
  });
});
