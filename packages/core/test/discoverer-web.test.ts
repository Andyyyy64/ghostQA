/**
 * Tests for Discoverer — web-side console error detection.
 *
 * The existing discoverer.test.ts covers desktop mode (detectFromLogs, isDuplicate, createFromPlan).
 * This file covers detectFromConsole() which is specific to web/Playwright mode.
 */
import { describe, it, expect } from "vitest";
import { Discoverer } from "../src/explorer/discoverer";
import type { PageState } from "../src/explorer/observer";

function makeState(consoleLogs: string[] = []): PageState {
  return {
    url: "http://localhost:3000/page",
    title: "Test",
    axTree: "",
    screenshotBase64: "",
    consoleLogs,
    timestamp: Date.now(),
  };
}

describe("Discoverer — detectFromConsole (web)", () => {
  it("detects [pageerror] as high severity", () => {
    const d = new Discoverer();
    const state = makeState([
      "[pageerror] Uncaught TypeError: Cannot read properties of null",
    ]);

    const discoveries = d.detectFromConsole(state);

    expect(discoveries).toHaveLength(1);
    expect(discoveries[0].severity).toBe("high");
    expect(discoveries[0].title).toContain("Console error");
  });

  it("detects [error] with known error pattern", () => {
    const d = new Discoverer();
    const state = makeState([
      "[error] Failed to fetch https://api.example.com/data",
    ]);

    const discoveries = d.detectFromConsole(state);

    expect(discoveries).toHaveLength(1);
    expect(discoveries[0].severity).toBe("medium");
  });

  it("ignores [error] without known patterns", () => {
    const d = new Discoverer();
    const state = makeState(["[error] Some random browser warning"]);

    const discoveries = d.detectFromConsole(state);

    expect(discoveries).toHaveLength(0);
  });

  it("ignores non-error console messages", () => {
    const d = new Discoverer();
    const state = makeState([
      "[log] App initialized",
      "[warn] Deprecated API usage",
      "[info] Rendering complete",
    ]);

    const discoveries = d.detectFromConsole(state);

    expect(discoveries).toHaveLength(0);
  });

  it("detects multiple errors in one observe", () => {
    const d = new Discoverer();
    const state = makeState([
      "[pageerror] ReferenceError: x is not defined",
      "[error] 500 Internal Server Error on /api/save",
      "[log] normal log",
    ]);

    const discoveries = d.detectFromConsole(state);

    expect(discoveries).toHaveLength(2);
  });

  it("includes URL and description from log", () => {
    const d = new Discoverer();
    const state = makeState([
      "[pageerror] TypeError: Cannot read properties of undefined (reading 'map')",
    ]);

    const discoveries = d.detectFromConsole(state);

    expect(discoveries[0].url).toBe("http://localhost:3000/page");
    expect(discoveries[0].description).toContain("TypeError");
  });

  it("detects 404 Not Found as error", () => {
    const d = new Discoverer();
    const state = makeState(["[error] 404 Not Found: /api/missing"]);

    const discoveries = d.detectFromConsole(state);
    expect(discoveries).toHaveLength(1);
  });

  it("detects chunk load error", () => {
    const d = new Discoverer();
    const state = makeState([
      "[error] Chunk load error: Loading chunk vendors failed",
    ]);

    const discoveries = d.detectFromConsole(state);
    expect(discoveries).toHaveLength(1);
  });

  it("returns empty for empty logs", () => {
    const d = new Discoverer();
    const discoveries = d.detectFromConsole(makeState([]));
    expect(discoveries).toHaveLength(0);
  });
});
