import { describe, it, expect } from "vitest";
import { Discoverer } from "../src/explorer/discoverer";
import type { DisplayState } from "../src/explorer/types";

describe("Discoverer (desktop mode)", () => {
  describe("detectFromLogs", () => {
    const discoverer = new Discoverer();

    function makeState(logs: string[]): DisplayState {
      return {
        identifier: "Test Window",
        title: "Test Window",
        axTree: "",
        screenshotBase64: "",
        logs,
        timestamp: Date.now(),
        displaySize: { width: 1280, height: 720 },
      };
    }

    it("detects stderr error lines", () => {
      const state = makeState(["[stderr] ERROR: something went wrong"]);
      const discoveries = discoverer.detectFromLogs(state);
      expect(discoveries).toHaveLength(1);
      expect(discoveries[0].severity).toBe("medium");
    });

    it("detects segfault as critical", () => {
      const state = makeState(["[stderr] Segmentation fault (core dumped)"]);
      const discoveries = discoverer.detectFromLogs(state);
      expect(discoveries).toHaveLength(1);
      expect(discoveries[0].severity).toBe("critical");
    });

    it("detects FATAL as critical", () => {
      const state = makeState(["FATAL: out of memory"]);
      const discoveries = discoverer.detectFromLogs(state);
      expect(discoveries).toHaveLength(1);
      expect(discoveries[0].severity).toBe("critical");
    });

    it("detects crash as critical", () => {
      const state = makeState(["Application crash detected"]);
      const discoveries = discoverer.detectFromLogs(state);
      expect(discoveries).toHaveLength(1);
      expect(discoveries[0].severity).toBe("critical");
    });

    it("detects panic as critical", () => {
      const state = makeState(["panic: runtime error: index out of range"]);
      const discoveries = discoverer.detectFromLogs(state);
      expect(discoveries).toHaveLength(1);
      expect(discoveries[0].severity).toBe("critical");
    });

    it("ignores normal stdout lines", () => {
      const state = makeState([
        "[stdout] Server started on port 3000",
        "[stdout] Request received: GET /",
      ]);
      const discoveries = discoverer.detectFromLogs(state);
      expect(discoveries).toHaveLength(0);
    });

    it("handles empty logs", () => {
      const state = makeState([]);
      const discoveries = discoverer.detectFromLogs(state);
      expect(discoveries).toHaveLength(0);
    });

    it("detects exception in logs", () => {
      const state = makeState(["Unhandled exception: TypeError: Cannot read property 'foo'"]);
      const discoveries = discoverer.detectFromLogs(state);
      expect(discoveries).toHaveLength(1);
    });

    it("sets correct discovery fields", () => {
      const state = makeState(["[stderr] Error: connection refused"]);
      const discoveries = discoverer.detectFromLogs(state);
      expect(discoveries[0]).toMatchObject({
        source: "explorer",
        url: "Test Window",
        console_errors: ["[stderr] Error: connection refused"],
      });
      expect(discoveries[0].id).toMatch(/^process-/);
    });
  });

  describe("isDuplicate", () => {
    const discoverer = new Discoverer();

    it("detects exact title match", () => {
      const candidate = {
        id: "a",
        source: "explorer" as const,
        severity: "medium" as const,
        title: "Button broken",
        description: "The button doesn't work",
        url: "Test Window",
        timestamp: Date.now(),
      };
      const existing = [{ ...candidate, id: "b" }];
      expect(discoverer.isDuplicate(candidate, existing)).toBe(true);
    });

    it("allows different discoveries", () => {
      const candidate = {
        id: "a",
        source: "explorer" as const,
        severity: "medium" as const,
        title: "Layout broken",
        description: "The layout is completely wrong",
        url: "Test Window",
        timestamp: Date.now(),
      };
      const existing = [{
        id: "b",
        source: "explorer" as const,
        severity: "high" as const,
        title: "Server crash",
        description: "The server returned 500",
        url: "Test Window",
        timestamp: Date.now(),
      }];
      expect(discoverer.isDuplicate(candidate, existing)).toBe(false);
    });
  });

  describe("createFromPlan", () => {
    const discoverer = new Discoverer();

    it("creates discovery with correct fields", () => {
      const d = discoverer.createFromPlan(
        { title: "Bug found", description: "Something is broken", severity: "high" },
        "My App Window",
        "/path/to/screenshot.png"
      );
      expect(d.id).toMatch(/^ai-/);
      expect(d.source).toBe("explorer");
      expect(d.severity).toBe("high");
      expect(d.title).toBe("Bug found");
      expect(d.url).toBe("My App Window");
      expect(d.screenshot_path).toBe("/path/to/screenshot.png");
    });
  });
});
