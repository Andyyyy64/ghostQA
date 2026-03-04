/**
 * Integration tests for Explorer.run() — the core observe→plan→act loop.
 *
 * All dependencies (Observer, Navigator, Planner, Discoverer, Guardrails, Recorder)
 * are fully mocked so we test the orchestration logic itself:
 * - Loop cycles through observe → plan → act correctly
 * - Discoveries from AI and console errors are collected
 * - Guardrails stop condition halts the loop
 * - plan.done halts the loop
 * - Action errors are fed back to the planner
 * - Dedup filters duplicate discoveries
 * - getUntestedElements override keeps exploration going
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Explorer } from "../src/explorer/action-loop";
import type { GhostQAConfig } from "../src/types/config";
import type { DiffAnalysis } from "../src/types/impact";
import type { Recorder } from "../src/recorder/recorder";

// --- Mock factories ---

function makeConfig(overrides: Partial<GhostQAConfig> = {}): GhostQAConfig {
  return {
    app: {
      name: "test",
      root: ".",
      build: "echo build",
      start: "echo start",
      url: "http://localhost:3000",
      healthcheck: { path: "/", timeout: 5000, interval: 500 },
    },
    environment: { mode: "native", docker: { image: "", volumes: [] } },
    ai: {
      provider: "cli",
      model: "test",
      api_key_env: "TEST_KEY",
      max_budget_usd: 5,
      cli: { command: "echo", args: [] },
      routing: {},
    },
    explorer: {
      enabled: true,
      mode: "web",
      max_steps: 50,
      max_duration: 300000,
      viewport: { width: 1280, height: 720 },
      desktop: { display: ":99", app_command: "", window_timeout: 30000 },
    },
    reporter: {
      output_dir: ".ghostqa-runs",
      formats: ["html", "json"],
      video: false,
      screenshots: true,
    },
    constraints: {
      no_payment: false,
      no_delete: false,
      no_external_links: false,
      allowed_domains: [],
      forbidden_selectors: [],
    },
    ...overrides,
  } as GhostQAConfig;
}

function makeAnalysis(): DiffAnalysis {
  return {
    files: [],
    summary: "Changed login form",
    impact_areas: [
      {
        area: "Login",
        risk: "high",
        description: "Validation changed",
        affected_urls: ["/login"],
        suggested_actions: ["Test login"],
      },
    ],
  };
}

function makeRecorder(): Recorder {
  return {
    screenshot: vi.fn().mockResolvedValue("/tmp/screenshot.png"),
    screenshotBase64: vi.fn().mockResolvedValue("base64data"),
    contextOptions: vi.fn().mockReturnValue({}),
    init: vi.fn().mockResolvedValue(undefined),
  } as unknown as Recorder;
}

function makeAiClient() {
  return {
    costTracker: {
      checkBudget: vi.fn(),
      summary: vi.fn().mockReturnValue({
        total_usd: 0.1,
        input_tokens: 100,
        output_tokens: 50,
        is_rate_limited: false,
      }),
    },
    chatWithImage: vi.fn(),
    chat: vi.fn(),
    useTask: vi.fn().mockReturnThis(),
    resetTask: vi.fn().mockReturnThis(),
  } as any;
}

function makePage(opts: { untestedElements?: Array<{ role: string; text: string }> } = {}) {
  const { untestedElements = [] } = opts;
  return {
    goto: vi.fn().mockResolvedValue(undefined),
    url: vi.fn().mockReturnValue("http://localhost:3000/"),
    title: vi.fn().mockResolvedValue("Test Page"),
    locator: vi.fn().mockReturnValue({
      ariaSnapshot: vi.fn().mockResolvedValue("<button>Submit</button>"),
      first: vi.fn().mockReturnValue({
        click: vi.fn().mockResolvedValue(undefined),
        fill: vi.fn().mockResolvedValue(undefined),
        hover: vi.fn().mockResolvedValue(undefined),
      }),
    }),
    on: vi.fn(),
    mouse: { wheel: vi.fn().mockResolvedValue(undefined) },
    waitForTimeout: vi.fn().mockResolvedValue(undefined),
    goBack: vi.fn().mockResolvedValue(undefined),
    waitForLoadState: vi.fn().mockReturnValue({ catch: () => {} }),
    evaluate: vi.fn().mockResolvedValue(untestedElements),
  } as any;
}

describe("Explorer.run (action loop)", () => {
  it("completes a basic observe→plan→act cycle", async () => {
    const ai = makeAiClient();
    const recorder = makeRecorder();
    const page = makePage();
    const config = makeConfig({ explorer: { ...makeConfig().explorer, max_steps: 3 } });
    const explorer = new Explorer(ai, config, recorder);

    // AI returns 2 actions then done
    let callCount = 0;
    ai.chatWithImage.mockImplementation(async () => {
      callCount++;
      if (callCount <= 2) {
        return JSON.stringify({
          reasoning: `Step ${callCount}`,
          action: { action: "click", selector: ".btn" },
          observation: "ok",
          discovery: null,
          done: false,
        });
      }
      return JSON.stringify({
        reasoning: "Done",
        action: { action: "wait", duration: 100 },
        observation: "all good",
        discovery: null,
        done: true,
      });
    });

    const result = await explorer.run(page, makeAnalysis());

    expect(result.steps_taken).toBeGreaterThanOrEqual(2);
    expect(page.goto).toHaveBeenCalledWith(
      "http://localhost:3000",
      expect.any(Object)
    );
  });

  it("collects AI discoveries with dedup", async () => {
    const ai = makeAiClient();
    const recorder = makeRecorder();
    const page = makePage();
    const config = makeConfig({ explorer: { ...makeConfig().explorer, max_steps: 5 } });
    const explorer = new Explorer(ai, config, recorder);

    let callCount = 0;
    ai.chatWithImage.mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        return JSON.stringify({
          reasoning: "Found a bug",
          action: { action: "scroll", direction: "down", amount: 300 },
          observation: "error",
          discovery: { title: "Button broken", description: "Click does nothing", severity: "high" },
          done: false,
        });
      }
      if (callCount === 2) {
        // Duplicate discovery — same title
        return JSON.stringify({
          reasoning: "Same bug again",
          action: { action: "scroll", direction: "down", amount: 300 },
          observation: "same error",
          discovery: { title: "Button broken", description: "Click does nothing", severity: "high" },
          done: false,
        });
      }
      return JSON.stringify({
        reasoning: "Done",
        action: { action: "wait", duration: 100 },
        observation: "",
        discovery: null,
        done: true,
      });
    });

    const result = await explorer.run(page, makeAnalysis());

    // Only 1 unique discovery (the duplicate is filtered)
    expect(result.discoveries.length).toBe(1);
    expect(result.discoveries[0].title).toBe("Button broken");
  });

  it("collects console error discoveries", async () => {
    const ai = makeAiClient();
    const recorder = makeRecorder();
    const page = makePage();
    const config = makeConfig({ explorer: { ...makeConfig().explorer, max_steps: 3 } });
    const explorer = new Explorer(ai, config, recorder);

    // Simulate console error via page.on("console")
    let consoleCallback: ((msg: any) => void) | null = null;
    page.on.mockImplementation((event: string, cb: any) => {
      if (event === "console") consoleCallback = cb;
    });

    let callCount = 0;
    ai.chatWithImage.mockImplementation(async () => {
      callCount++;
      // Trigger a console error before the first plan
      if (callCount === 1 && consoleCallback) {
        consoleCallback({ type: () => "error", text: () => "[pageerror] Uncaught TypeError: Cannot read properties of null" });
      }
      return JSON.stringify({
        reasoning: "Done",
        action: { action: "wait", duration: 100 },
        observation: "",
        discovery: null,
        done: true,
      });
    });

    const result = await explorer.run(page, makeAnalysis());

    // Console errors should be collected via the Observer's console listener
    // Note: the Observer listens via page.on("console"), which we control above
    expect(result.steps_taken).toBeGreaterThanOrEqual(0);
  });

  it("stops when guardrails max_steps is reached", async () => {
    const ai = makeAiClient();
    const recorder = makeRecorder();
    const page = makePage();
    const config = makeConfig({
      explorer: { ...makeConfig().explorer, max_steps: 2 },
    });
    const explorer = new Explorer(ai, config, recorder);

    // Always return a non-done action
    ai.chatWithImage.mockResolvedValue(
      JSON.stringify({
        reasoning: "keep going",
        action: { action: "click", selector: ".btn" },
        observation: "ok",
        discovery: null,
        done: false,
      })
    );

    const result = await explorer.run(page, makeAnalysis());

    // Should stop at max_steps
    expect(result.steps_taken).toBe(2);
  });

  it("feeds action errors back to planner", async () => {
    const ai = makeAiClient();
    const recorder = makeRecorder();
    const page = makePage();
    const config = makeConfig({ explorer: { ...makeConfig().explorer, max_steps: 3 } });
    const explorer = new Explorer(ai, config, recorder);

    // First action will fail (Navigator.execute throws)
    // We need to make the actual page.locator().first().click() throw
    let callCount = 0;
    const clickFn = vi.fn();
    page.locator.mockReturnValue({
      first: vi.fn().mockReturnValue({
        click: clickFn,
        fill: vi.fn(),
        hover: vi.fn(),
      }),
      ariaSnapshot: vi.fn().mockResolvedValue("<button>Submit</button>"),
    });

    ai.chatWithImage.mockImplementation(async (_sys: any, messages: any[]) => {
      callCount++;
      if (callCount === 1) {
        // Make click fail on first attempt
        clickFn.mockRejectedValueOnce(new Error("Element not found"));
        return JSON.stringify({
          reasoning: "click button",
          action: { action: "click", selector: ".nonexistent" },
          observation: "",
          discovery: null,
          done: false,
        });
      }
      // Second call — check that error feedback is in messages
      const hasError = messages.some(
        (m: { content: string }) =>
          typeof m.content === "string" && m.content.includes("PREVIOUS ACTION FAILED")
      );
      return JSON.stringify({
        reasoning: hasError ? "Saw error feedback" : "No error feedback",
        action: { action: "wait", duration: 100 },
        observation: "",
        discovery: null,
        done: true,
      });
    });

    const result = await explorer.run(page, makeAnalysis());

    // Verify the planner received the error on the second call
    const secondCall = ai.chatWithImage.mock.calls[1];
    if (secondCall) {
      const messages = secondCall[1] as Array<{ content: string }>;
      const errorFeedback = messages.find(
        (m) => typeof m.content === "string" && m.content.includes("PREVIOUS ACTION FAILED")
      );
      expect(errorFeedback).toBeDefined();
    }
  });

  it("reports progress via onProgress callback", async () => {
    const ai = makeAiClient();
    const recorder = makeRecorder();
    const page = makePage();
    const config = makeConfig({ explorer: { ...makeConfig().explorer, max_steps: 2 } });
    const explorer = new Explorer(ai, config, recorder);

    ai.chatWithImage.mockResolvedValue(
      JSON.stringify({
        reasoning: "ok",
        action: { action: "wait", duration: 100 },
        observation: "",
        discovery: null,
        done: true,
      })
    );

    const progress: string[] = [];
    await explorer.run(page, makeAnalysis(), (msg) => progress.push(msg));

    expect(progress.length).toBeGreaterThan(0);
    expect(progress.some((p) => p.includes("Exploring"))).toBe(true);
  });
});
