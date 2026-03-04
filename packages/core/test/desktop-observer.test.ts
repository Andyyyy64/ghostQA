import { describe, it, expect, vi, beforeEach } from "vitest";
import { DesktopObserver } from "../src/explorer/desktop-observer";
import type { DesktopEnvironment } from "../src/explorer/desktop-environment";

function makeMockEnv(overrides?: Partial<Record<string, unknown>>): DesktopEnvironment {
  return {
    getActiveWindowTitle: vi.fn().mockResolvedValue("My App Window"),
    screenshotBase64: vi.fn().mockResolvedValue("c2NyZWVuc2hvdA=="),
    isWindowAlive: vi.fn().mockResolvedValue(true),
    drainLogs: vi.fn().mockReturnValue([]),
    screenshot: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as DesktopEnvironment;
}

describe("DesktopObserver", () => {
  describe("observe", () => {
    it("returns DisplayState with window title and screenshot", async () => {
      const env = makeMockEnv();
      const observer = new DesktopObserver(env, "/tmp/output", { width: 1280, height: 720 });
      observer.startListening();

      const state = await observer.observe();

      expect(state.identifier).toBe("My App Window");
      expect(state.title).toBe("My App Window");
      expect(state.screenshotBase64).toBe("c2NyZWVuc2hvdA==");
      expect(state.axTree).toBe("");
      expect(state.displaySize).toEqual({ width: 1280, height: 720 });
      expect(state.logs).toEqual([]);
      expect(state.timestamp).toBeGreaterThan(0);
    });

    it("includes process logs from environment", async () => {
      const env = makeMockEnv({
        drainLogs: vi.fn().mockReturnValue([
          "[stdout] Server started",
          "[stderr] Warning: deprecated API",
        ]),
      });
      const observer = new DesktopObserver(env, "/tmp/output", { width: 1280, height: 720 });

      const state = await observer.observe();

      expect(state.logs).toEqual([
        "[stdout] Server started",
        "[stderr] Warning: deprecated API",
      ]);
    });

    it("adds crash log when window disappears", async () => {
      const env = makeMockEnv({
        isWindowAlive: vi.fn().mockResolvedValue(false),
        drainLogs: vi.fn().mockReturnValue([]),
      });
      const observer = new DesktopObserver(env, "/tmp/output", { width: 1280, height: 720 });

      const state = await observer.observe();

      expect(state.logs).toContainEqual(
        "[stderr] Window disappeared — possible crash"
      );
    });

    it("preserves existing logs when window crashes", async () => {
      const env = makeMockEnv({
        isWindowAlive: vi.fn().mockResolvedValue(false),
        drainLogs: vi.fn().mockReturnValue(["[stderr] Segmentation fault"]),
      });
      const observer = new DesktopObserver(env, "/tmp/output", { width: 1280, height: 720 });

      const state = await observer.observe();

      expect(state.logs).toHaveLength(2);
      expect(state.logs[0]).toBe("[stderr] Segmentation fault");
      expect(state.logs[1]).toContain("Window disappeared");
    });
  });

  describe("screenshot", () => {
    it("delegates to env.screenshot with incrementing count", async () => {
      const mockScreenshot = vi.fn().mockResolvedValue(undefined);
      const env = makeMockEnv({ screenshot: mockScreenshot });
      const observer = new DesktopObserver(env, "/tmp/output", { width: 1280, height: 720 });

      const path1 = await observer.screenshot("step");
      const path2 = await observer.screenshot("discovery");

      expect(path1).toBe("/tmp/output/screenshots/1-step.png");
      expect(path2).toBe("/tmp/output/screenshots/2-discovery.png");
      expect(mockScreenshot).toHaveBeenCalledTimes(2);
    });

    it("uses numeric name when no label provided", async () => {
      const env = makeMockEnv();
      const observer = new DesktopObserver(env, "/tmp/output", { width: 1280, height: 720 });

      const path = await observer.screenshot();
      expect(path).toBe("/tmp/output/screenshots/1.png");
    });
  });

  describe("screenshotBase64", () => {
    it("delegates to env.screenshotBase64", async () => {
      const env = makeMockEnv({
        screenshotBase64: vi.fn().mockResolvedValue("base64data"),
      });
      const observer = new DesktopObserver(env, "/tmp/output", { width: 1280, height: 720 });

      const result = await observer.screenshotBase64();
      expect(result).toBe("base64data");
    });
  });
});
