/**
 * Tests for run-pipeline orchestration logic.
 *
 * Mocks all heavy dependencies (Playwright, AI, AppRunner, etc.)
 * to test the pipeline's flow control.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// vi.hoisted() ensures these are available in vi.mock factories
const {
  mockBuild, mockStart, mockStop,
  mockAnalyze,
  mockExplorerRun,
  mockRecorderInit, mockContextOptions,
  mockWriteJson, mockWriteHtml, mockDetermineVerdict,
  mockLaunch,
} = vi.hoisted(() => ({
  mockBuild: vi.fn().mockResolvedValue(undefined),
  mockStart: vi.fn().mockResolvedValue(undefined),
  mockStop: vi.fn().mockResolvedValue(undefined),
  mockAnalyze: vi.fn().mockResolvedValue({
    files: [{ path: "src/app.ts", status: "modified", additions: 1, deletions: 1, patch: "" }],
    summary: "Test changes",
    impact_areas: [{ area: "Main", description: "test", risk: "medium", affected_urls: ["/"], suggested_actions: [] }],
  }),
  mockExplorerRun: vi.fn().mockResolvedValue({
    steps_taken: 10, pages_visited: 3, discoveries: [],
  }),
  mockRecorderInit: vi.fn().mockResolvedValue(undefined),
  mockContextOptions: vi.fn().mockReturnValue({}),
  mockWriteJson: vi.fn().mockResolvedValue(undefined),
  mockWriteHtml: vi.fn().mockResolvedValue("/output/report.html"),
  mockDetermineVerdict: vi.fn().mockReturnValue("pass"),
  mockLaunch: vi.fn().mockResolvedValue({
    newContext: vi.fn().mockResolvedValue({
      newPage: vi.fn().mockResolvedValue({
        goto: vi.fn(), url: vi.fn().mockReturnValue("http://localhost:3000"), on: vi.fn(),
      }),
      close: vi.fn(),
    }),
    close: vi.fn(),
  }),
}));

vi.mock("../src/app-runner/runner", () => ({
  AppRunner: class { build = mockBuild; start = mockStart; stop = mockStop; },
}));

vi.mock("../src/diff-analyzer/analyzer", () => ({
  DiffAnalyzer: class { analyze = mockAnalyze; },
}));

vi.mock("../src/explorer/action-loop", () => ({
  Explorer: class { run = mockExplorerRun; runAnthropicDesktop = vi.fn(); runGenericDesktop = vi.fn(); },
}));

vi.mock("../src/recorder/recorder", () => ({
  Recorder: class {
    init = mockRecorderInit; contextOptions = mockContextOptions;
    screenshot = vi.fn().mockResolvedValue("/tmp/ss.png");
    screenshotBase64 = vi.fn().mockResolvedValue("abc");
  },
}));

vi.mock("../src/reporter/reporter", () => ({
  Reporter: class { writeJson = mockWriteJson; writeHtml = mockWriteHtml; determineVerdict = mockDetermineVerdict; },
}));

vi.mock("../src/environment/manager", () => ({
  setupEnvironment: vi.fn().mockResolvedValue({ cleanup: vi.fn().mockResolvedValue(undefined) }),
}));

vi.mock("playwright", () => ({ chromium: { launch: mockLaunch } }));

import { runPipeline, type PipelineOptions } from "../src/orchestrator/run-pipeline";
import { BudgetExceededError } from "../src/ai/cost-tracker";

function makeOptions(overrides: Partial<PipelineOptions> = {}): PipelineOptions {
  return {
    config: {
      app: {
        name: "test", root: ".", build: "echo ok", start: "echo ok",
        url: "http://localhost:3000",
        healthcheck: { path: "/", timeout: 5000, interval: 500 },
      },
      environment: { mode: "native", docker: { image: "", volumes: [] } },
      ai: {
        provider: "cli", model: "test", api_key_env: "KEY", max_budget_usd: 5,
        cli: { command: "echo", args: [] }, routing: {},
      },
      explorer: {
        enabled: true, mode: "web", max_steps: 50, max_duration: 300000,
        viewport: { width: 1280, height: 720 },
        desktop: { display: ":99", app_command: "", window_timeout: 30000 },
      },
      reporter: {
        output_dir: "/tmp/ghostqa-test-runs", formats: ["html", "json"],
        video: false, screenshots: true,
      },
      constraints: {
        no_payment: false, no_delete: false, no_external_links: false,
        allowed_domains: [], forbidden_selectors: [],
      },
    } as any,
    cwd: "/tmp/test-project",
    diffRef: "HEAD~1",
    ...overrides,
  };
}

describe("runPipeline", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Restore defaults after clearAllMocks
    mockAnalyze.mockResolvedValue({
      files: [{ path: "a.ts", status: "modified", additions: 1, deletions: 1, patch: "" }],
      summary: "test",
      impact_areas: [{ area: "Main", description: "t", risk: "medium", affected_urls: ["/"], suggested_actions: [] }],
    });
    mockExplorerRun.mockResolvedValue({ steps_taken: 5, pages_visited: 2, discoveries: [] });
    mockWriteHtml.mockResolvedValue("/output/report.html");
    mockDetermineVerdict.mockReturnValue("pass");
    mockLaunch.mockResolvedValue({
      newContext: vi.fn().mockResolvedValue({
        newPage: vi.fn().mockResolvedValue({
          goto: vi.fn(), url: vi.fn().mockReturnValue("http://localhost:3000"), on: vi.fn(),
        }),
        close: vi.fn(),
      }),
      close: vi.fn(),
    });
  });

  it("executes pipeline steps in order: analyze → build → start → explore → report", async () => {
    const callOrder: string[] = [];
    mockAnalyze.mockImplementation(async () => {
      callOrder.push("analyze");
      return {
        files: [{ path: "a.ts", status: "modified", additions: 1, deletions: 1, patch: "" }],
        summary: "test",
        impact_areas: [{ area: "Main", description: "t", risk: "medium", affected_urls: ["/"], suggested_actions: [] }],
      };
    });
    mockBuild.mockImplementation(async () => { callOrder.push("build"); });
    mockStart.mockImplementation(async () => { callOrder.push("start"); });
    mockExplorerRun.mockImplementation(async () => {
      callOrder.push("explore");
      return { steps_taken: 5, pages_visited: 2, discoveries: [] };
    });
    mockWriteHtml.mockImplementation(async () => {
      callOrder.push("report");
      return "/output/report.html";
    });

    const result = await runPipeline(makeOptions());

    expect(callOrder).toEqual(["analyze", "build", "start", "explore", "report"]);
    expect(result.verdict).toBe("pass");
    expect(result.run_id).toMatch(/^run-/);
  });

  it("stops app after exploration (finally block)", async () => {
    await runPipeline(makeOptions());
    expect(mockStop).toHaveBeenCalled();
  });

  it("generates partial report on BudgetExceededError", async () => {
    mockExplorerRun.mockRejectedValue(new BudgetExceededError(5.5, 5.0));

    const result = await runPipeline(makeOptions());

    expect(result.verdict).toBeDefined();
    expect(mockWriteHtml).toHaveBeenCalled();
    expect(mockStop).toHaveBeenCalled();
  });

  it("skips exploration when explorer.enabled=false", async () => {
    const opts = makeOptions();
    opts.config.explorer.enabled = false;

    await runPipeline(opts);

    expect(mockExplorerRun).not.toHaveBeenCalled();
    expect(mockWriteHtml).toHaveBeenCalled();
  });

  it("skips exploration when no impact areas found", async () => {
    mockAnalyze.mockResolvedValue({ files: [], summary: "No changes", impact_areas: [] });

    await runPipeline(makeOptions());

    expect(mockExplorerRun).not.toHaveBeenCalled();
  });

  it("tracks progress via onProgress callback", async () => {
    const progress: string[] = [];
    await runPipeline(makeOptions({ onProgress: (msg) => progress.push(msg) }));

    expect(progress.length).toBeGreaterThan(0);
    expect(progress).toContain("Initializing...");
  });

  it("propagates non-budget errors", async () => {
    mockExplorerRun.mockRejectedValue(new Error("Unexpected crash"));
    await expect(runPipeline(makeOptions())).rejects.toThrow("Unexpected crash");
  });
});
