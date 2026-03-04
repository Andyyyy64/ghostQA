import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock execa
const mockExeca = vi.fn();
vi.mock("execa", () => ({
  execa: (...args: any[]) => mockExeca(...args),
}));

// Mock global fetch for healthcheck
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

import { AppRunner } from "../src/app-runner/runner";
import type { AppConfig } from "../src/types/config";

function makeConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    name: "test-app",
    root: ".",
    build: "npm run build",
    start: "npm start",
    url: "http://localhost:3000",
    healthcheck: {
      path: "/health",
      timeout: 5000,
      interval: 100,
    },
    ...overrides,
  };
}

describe("AppRunner", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("build", () => {
    it("calls execa with shell: true and build command", async () => {
      mockExeca.mockResolvedValue({ exitCode: 0 });
      const runner = new AppRunner(makeConfig());

      await runner.build("/project");

      expect(mockExeca).toHaveBeenCalledWith(
        "npm run build",
        expect.objectContaining({
          cwd: "/project",
          shell: true,
          env: expect.objectContaining({ NODE_ENV: "production" }),
        })
      );
    });

    it("sets NODE_ENV to production", async () => {
      mockExeca.mockResolvedValue({ exitCode: 0 });
      const runner = new AppRunner(makeConfig());

      await runner.build("/project");

      const callEnv = mockExeca.mock.calls[0][1].env;
      expect(callEnv.NODE_ENV).toBe("production");
    });
  });

  describe("start", () => {
    it("calls execa with shell: true and start command", async () => {
      const mockProcess = {
        catch: vi.fn().mockReturnThis(),
        kill: vi.fn(),
      };
      mockExeca.mockReturnValue(mockProcess);
      mockFetch.mockResolvedValue({ ok: true });

      const runner = new AppRunner(makeConfig());
      await runner.start("/project");

      expect(mockExeca).toHaveBeenCalledWith(
        "npm start",
        expect.objectContaining({
          cwd: "/project",
          shell: true,
          detached: false,
        })
      );
    });

    it("waits for healthcheck before resolving", async () => {
      const mockProcess = {
        catch: vi.fn().mockReturnThis(),
        kill: vi.fn(),
      };
      mockExeca.mockReturnValue(mockProcess);

      // First call fails, second succeeds
      mockFetch
        .mockRejectedValueOnce(new Error("Connection refused"))
        .mockResolvedValueOnce({ ok: true });

      const runner = new AppRunner(makeConfig());
      await runner.start("/project");

      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
  });

  describe("stop", () => {
    it("sends SIGTERM to the process", async () => {
      const mockProcess = {
        catch: vi.fn().mockReturnThis(),
        kill: vi.fn(),
        then: vi.fn().mockImplementation((resolve: any) => {
          resolve?.();
          return mockProcess;
        }),
        [Symbol.toStringTag]: "Promise",
      };
      // Make mockProcess thenable for Promise.race
      Object.assign(mockProcess, {
        then(resolve: any, reject: any) {
          resolve?.();
          return Promise.resolve();
        },
      });

      mockExeca.mockReturnValue(mockProcess);
      mockFetch.mockResolvedValue({ ok: true });

      const runner = new AppRunner(makeConfig());
      await runner.start("/project");
      await runner.stop();

      expect(mockProcess.kill).toHaveBeenCalledWith("SIGTERM");
    });

    it("does nothing when no process is running", async () => {
      const runner = new AppRunner(makeConfig());
      // Should not throw
      await runner.stop();
    });
  });

  describe("waitForHealthy", () => {
    it("throws when healthcheck times out", async () => {
      const mockProcess = {
        catch: vi.fn().mockReturnThis(),
        kill: vi.fn(),
      };
      mockExeca.mockReturnValue(mockProcess);
      mockFetch.mockRejectedValue(new Error("Connection refused"));

      const runner = new AppRunner(
        makeConfig({
          healthcheck: { path: "/health", timeout: 500, interval: 100 },
        })
      );

      await expect(runner.start("/project")).rejects.toThrow(
        "Healthcheck failed"
      );
    });
  });
});
