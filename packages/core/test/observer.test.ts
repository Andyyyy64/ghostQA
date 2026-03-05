/**
 * Tests for Observer — console log collection + PageState assembly.
 *
 * The Observer wraps Playwright Page events. We mock the Page object
 * to verify console log buffering, pageerror handling, and state assembly.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Observer } from "../src/explorer/observer";
import type { Recorder } from "../src/recorder/recorder";

function makeRecorder(): Recorder {
  return {
    screenshotBase64: vi.fn().mockResolvedValue("base64screenshot"),
    screenshot: vi.fn().mockResolvedValue("/tmp/ss.png"),
  } as unknown as Recorder;
}

function makePage() {
  const listeners: Record<string, ((...args: any[]) => void)[]> = {};
  return {
    on: vi.fn((event: string, cb: any) => {
      if (!listeners[event]) listeners[event] = [];
      listeners[event].push(cb);
    }),
    url: vi.fn().mockReturnValue("http://localhost:3000/test"),
    title: vi.fn().mockResolvedValue("Test Page"),
    locator: vi.fn().mockReturnValue({
      ariaSnapshot: vi.fn().mockResolvedValue("<button>OK</button>"),
    }),
    // Helper to trigger events in tests
    _emit: (event: string, ...args: any[]) => {
      for (const cb of listeners[event] ?? []) cb(...args);
    },
  };
}

describe("Observer", () => {
  describe("startListening", () => {
    it("registers console and pageerror handlers", () => {
      const recorder = makeRecorder();
      const observer = new Observer(recorder);
      const page = makePage();

      observer.startListening(page as any);

      expect(page.on).toHaveBeenCalledWith("console", expect.any(Function));
      expect(page.on).toHaveBeenCalledWith("pageerror", expect.any(Function));
    });

    it("does not register handlers twice", () => {
      const recorder = makeRecorder();
      const observer = new Observer(recorder);
      const page = makePage();

      observer.startListening(page as any);
      observer.startListening(page as any);

      // Should only be called twice (once for console, once for pageerror)
      expect(page.on).toHaveBeenCalledTimes(2);
    });
  });

  describe("observe", () => {
    it("returns PageState with url, title, axTree, screenshot", async () => {
      const recorder = makeRecorder();
      const observer = new Observer(recorder);
      const page = makePage();

      observer.startListening(page as any);
      const state = await observer.observe(page as any);

      expect(state.url).toBe("http://localhost:3000/test");
      expect(state.title).toBe("Test Page");
      expect(state.axTree).toBe("<button>OK</button>");
      expect(state.screenshotBase64).toBe("base64screenshot");
      expect(state.timestamp).toBeGreaterThan(0);
    });

    it("collects console logs and clears buffer", async () => {
      const recorder = makeRecorder();
      const observer = new Observer(recorder);
      const page = makePage();

      observer.startListening(page as any);

      // Simulate console messages
      page._emit("console", { type: () => "log", text: () => "Hello" });
      page._emit("console", { type: () => "error", text: () => "Something broke" });

      const state1 = await observer.observe(page as any);
      expect(state1.consoleLogs).toEqual([
        "[log] Hello",
        "[error] Something broke",
      ]);

      // Second observe should have empty logs (buffer cleared)
      const state2 = await observer.observe(page as any);
      expect(state2.consoleLogs).toEqual([]);
    });

    it("captures pageerror events", async () => {
      const recorder = makeRecorder();
      const observer = new Observer(recorder);
      const page = makePage();

      observer.startListening(page as any);

      page._emit("pageerror", { message: "Uncaught TypeError: x is not a function" });

      const state = await observer.observe(page as any);
      expect(state.consoleLogs).toEqual([
        "[pageerror] Uncaught TypeError: x is not a function",
      ]);
    });

    it("handles axTree failure gracefully", async () => {
      const recorder = makeRecorder();
      const observer = new Observer(recorder);
      const page = makePage();
      page.locator.mockReturnValue({
        ariaSnapshot: vi.fn().mockRejectedValue(new Error("Not supported")),
      });

      observer.startListening(page as any);
      const state = await observer.observe(page as any);

      expect(state.axTree).toContain("failed to get accessibility tree");
    });
  });
});
