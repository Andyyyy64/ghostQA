/**
 * Integration tests for Explorer.runAnthropicDesktop() and Explorer.runGenericDesktop().
 *
 * All dependencies (IObserver, INavigator, AnthropicComputerUseProvider, DesktopPlanner)
 * are fully mocked — no Xvfb/xdotool required.
 *
 * Tests:
 * - runAnthropicDesktop: observe → action → screenshot loop
 * - runAnthropicDesktop: collects discoveries from process logs
 * - runAnthropicDesktop: stops at max_steps
 * - runAnthropicDesktop: handles action errors gracefully
 * - runGenericDesktop: observe → plan → act cycle
 * - runGenericDesktop: collects AI discoveries with dedup
 * - runGenericDesktop: collects process log discoveries
 * - runGenericDesktop: stops when planner says done
 * - runGenericDesktop: stops at max_steps
 * - runGenericDesktop: handles action errors gracefully
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock AnthropicComputerUseProvider
const mockStartSession = vi.fn();
const mockSendToolResult = vi.fn();

vi.mock("../src/ai/anthropic-computer-use", () => ({
  AnthropicComputerUseProvider: class {
    startSession = mockStartSession;
    sendToolResult = mockSendToolResult;
  },
}));

// Mock DesktopPlanner
const mockDesktopPlan = vi.fn();

vi.mock("../src/explorer/desktop-planner", () => ({
  DesktopPlanner: class {
    plan = mockDesktopPlan;
  },
}));

import { Explorer } from "../src/explorer/action-loop";
import type { GhostQAConfig } from "../src/types/config";
import type { DiffAnalysis } from "../src/types/impact";
import type { Recorder } from "../src/recorder/recorder";
import type { IObserver, INavigator, DisplayState, DesktopAction } from "../src/explorer/types";

// --- Factories ---

function makeConfig(overrides: Partial<GhostQAConfig["explorer"]> = {}): GhostQAConfig {
  return {
    app: {
      name: "test", root: ".", build: "echo build", start: "echo start",
      url: "http://localhost:3000",
      healthcheck: { path: "/", timeout: 5000, interval: 500 },
    },
    environment: { mode: "native", docker: { image: "", volumes: [] } },
    ai: {
      provider: "anthropic", model: "claude-sonnet-4-20250514",
      api_key_env: "ANTHROPIC_API_KEY", max_budget_usd: 5,
      cli: { command: "claude", args: [] }, routing: {},
    },
    explorer: {
      enabled: true, mode: "desktop", max_steps: 50, max_duration: 300000,
      viewport: { width: 1280, height: 720 },
      desktop: { display: ":99", app_command: "", window_timeout: 30000 },
      ...overrides,
    },
    reporter: {
      output_dir: ".ghostqa-runs", formats: ["html", "json"],
      video: false, screenshots: true,
    },
    constraints: {
      no_payment: false, no_delete: false, no_external_links: false,
      allowed_domains: [], forbidden_selectors: [],
    },
  } as GhostQAConfig;
}

function makeAnalysis(): DiffAnalysis {
  return {
    files: [],
    summary: "Changed settings page",
    impact_areas: [{
      area: "Settings", risk: "high", description: "Config save changed",
      affected_urls: ["/settings"], suggested_actions: ["Test save"],
    }],
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
        total_usd: 0.1, input_tokens: 100, output_tokens: 50, is_rate_limited: false,
      }),
    },
    chatWithImage: vi.fn(),
    chat: vi.fn(),
    useTask: vi.fn().mockReturnThis(),
    resetTask: vi.fn().mockReturnThis(),
  } as any;
}

function makeDisplayState(overrides: Partial<DisplayState> = {}): DisplayState {
  return {
    identifier: "Test App",
    title: "Test App",
    axTree: "",
    screenshotBase64: "base64screenshot",
    logs: [],
    timestamp: Date.now(),
    displaySize: { width: 1280, height: 720 },
    ...overrides,
  };
}

function makeObserver(states?: DisplayState[]): IObserver {
  let callCount = 0;
  const defaultState = makeDisplayState();
  return {
    startListening: vi.fn(),
    observe: vi.fn().mockImplementation(async () => {
      if (states && callCount < states.length) {
        return states[callCount++];
      }
      callCount++;
      return defaultState;
    }),
    screenshot: vi.fn().mockResolvedValue("/tmp/desktop-ss.png"),
    screenshotBase64: vi.fn().mockResolvedValue("base64data"),
  };
}

function makeNavigator(): INavigator {
  return {
    execute: vi.fn().mockResolvedValue(undefined),
    navigateToTarget: vi.fn().mockResolvedValue(undefined),
    dispose: vi.fn().mockResolvedValue(undefined),
  };
}

// --- Tests ---

describe("Explorer.runAnthropicDesktop", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ANTHROPIC_API_KEY = "test-key";
  });

  it("completes observe → action → screenshot loop", async () => {
    const ai = makeAiClient();
    const config = makeConfig({ max_steps: 5 });
    const recorder = makeRecorder();
    const observer = makeObserver();
    const navigator = makeNavigator();
    const explorer = new Explorer(ai, config, recorder);

    // startSession returns an action, then sendToolResult returns done
    mockStartSession.mockResolvedValue({
      action: { action: "left_click", coordinate: [100, 200] },
      toolUseId: "tool-1",
      reasoning: "Clicking button",
      done: false,
      inputTokens: 100,
      outputTokens: 50,
    });
    mockSendToolResult.mockResolvedValue({
      action: null,
      toolUseId: null,
      reasoning: "Done testing",
      done: true,
      inputTokens: 100,
      outputTokens: 50,
    });

    const result = await explorer.runAnthropicDesktop(
      observer, navigator, makeAnalysis()
    );

    expect(observer.startListening).toHaveBeenCalled();
    expect(observer.observe).toHaveBeenCalled();
    expect(mockStartSession).toHaveBeenCalledOnce();
    expect(navigator.execute).toHaveBeenCalledOnce();
    expect(mockSendToolResult).toHaveBeenCalledOnce();
    expect(result.steps_taken).toBe(1);
  });

  it("runs multiple action steps before done", async () => {
    const ai = makeAiClient();
    const config = makeConfig({ max_steps: 10 });
    const recorder = makeRecorder();
    const observer = makeObserver();
    const navigator = makeNavigator();
    const explorer = new Explorer(ai, config, recorder);

    mockStartSession.mockResolvedValue({
      action: { action: "left_click", coordinate: [100, 200] },
      toolUseId: "tool-1", reasoning: "Step 1", done: false,
      inputTokens: 100, outputTokens: 50,
    });

    let sendCount = 0;
    mockSendToolResult.mockImplementation(async () => {
      sendCount++;
      if (sendCount < 3) {
        return {
          action: { action: "left_click", coordinate: [200, 300] },
          toolUseId: `tool-${sendCount + 1}`, reasoning: `Step ${sendCount + 1}`,
          done: false, inputTokens: 100, outputTokens: 50,
        };
      }
      return {
        action: null, toolUseId: null, reasoning: "All done",
        done: true, inputTokens: 100, outputTokens: 50,
      };
    });

    const result = await explorer.runAnthropicDesktop(
      observer, navigator, makeAnalysis()
    );

    expect(result.steps_taken).toBe(3);
    expect(navigator.execute).toHaveBeenCalledTimes(3);
  });

  it("collects discoveries from process logs", async () => {
    const ai = makeAiClient();
    const config = makeConfig({ max_steps: 5 });
    const recorder = makeRecorder();
    const observer = makeObserver([
      makeDisplayState({
        logs: ["Segmentation fault (core dumped)"],
      }),
      makeDisplayState({ logs: [] }),
    ]);
    const navigator = makeNavigator();
    const explorer = new Explorer(ai, config, recorder);

    mockStartSession.mockResolvedValue({
      action: null, toolUseId: null, reasoning: "Done",
      done: true, inputTokens: 100, outputTokens: 50,
    });

    const result = await explorer.runAnthropicDesktop(
      observer, navigator, makeAnalysis()
    );

    // Segfault should be detected as a critical discovery
    expect(result.discoveries.length).toBeGreaterThanOrEqual(1);
    expect(result.discoveries[0].title).toContain("Process error");
    expect(result.discoveries[0].severity).toBe("critical");
  });

  it("stops at max_steps", async () => {
    const ai = makeAiClient();
    const config = makeConfig({ max_steps: 2 });
    const recorder = makeRecorder();
    const observer = makeObserver();
    const navigator = makeNavigator();
    const explorer = new Explorer(ai, config, recorder);

    mockStartSession.mockResolvedValue({
      action: { action: "left_click", coordinate: [100, 200] },
      toolUseId: "tool-1", reasoning: "Keep going", done: false,
      inputTokens: 100, outputTokens: 50,
    });

    mockSendToolResult.mockResolvedValue({
      action: { action: "left_click", coordinate: [200, 300] },
      toolUseId: "tool-2", reasoning: "Still going", done: false,
      inputTokens: 100, outputTokens: 50,
    });

    const result = await explorer.runAnthropicDesktop(
      observer, navigator, makeAnalysis()
    );

    expect(result.steps_taken).toBe(2);
  });

  it("handles action errors gracefully", async () => {
    const ai = makeAiClient();
    const config = makeConfig({ max_steps: 5 });
    const recorder = makeRecorder();
    const observer = makeObserver();
    const navigator = makeNavigator();
    const explorer = new Explorer(ai, config, recorder);

    // Make navigator.execute throw
    (navigator.execute as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("xdotool: window not found")
    );

    mockStartSession.mockResolvedValue({
      action: { action: "left_click", coordinate: [100, 200] },
      toolUseId: "tool-1", reasoning: "Click button", done: false,
      inputTokens: 100, outputTokens: 50,
    });
    mockSendToolResult.mockResolvedValue({
      action: null, toolUseId: null, reasoning: "Done",
      done: true, inputTokens: 100, outputTokens: 50,
    });

    // Should not throw
    const result = await explorer.runAnthropicDesktop(
      observer, navigator, makeAnalysis()
    );

    expect(result.steps_taken).toBe(1);
  });

  it("reports progress via onProgress callback", async () => {
    const ai = makeAiClient();
    const config = makeConfig({ max_steps: 5 });
    const recorder = makeRecorder();
    const observer = makeObserver();
    const navigator = makeNavigator();
    const explorer = new Explorer(ai, config, recorder);

    mockStartSession.mockResolvedValue({
      action: { action: "left_click", coordinate: [100, 200] },
      toolUseId: "tool-1", reasoning: "Step 1", done: false,
      inputTokens: 100, outputTokens: 50,
    });
    mockSendToolResult.mockResolvedValue({
      action: null, toolUseId: null, reasoning: "Done",
      done: true, inputTokens: 100, outputTokens: 50,
    });

    const progress: string[] = [];
    await explorer.runAnthropicDesktop(
      observer, navigator, makeAnalysis(), (msg) => progress.push(msg)
    );

    expect(progress.length).toBeGreaterThan(0);
    expect(progress.some(p => p.includes("Desktop step"))).toBe(true);
  });
});

describe("Explorer.runGenericDesktop", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("completes observe → plan → act cycle", async () => {
    const ai = makeAiClient();
    const config = makeConfig({ max_steps: 5 });
    const recorder = makeRecorder();
    const observer = makeObserver();
    const navigator = makeNavigator();
    const explorer = new Explorer(ai, config, recorder);

    let callCount = 0;
    mockDesktopPlan.mockImplementation(async () => {
      callCount++;
      if (callCount <= 2) {
        return {
          reasoning: `Step ${callCount}`,
          action: { kind: "desktop", action: "left_click", coordinate: [100, 200] },
          observation: "ok",
          discovery: null,
          done: false,
        };
      }
      return {
        reasoning: "All tested",
        action: { kind: "desktop", action: "wait", duration: 100 },
        observation: "done",
        discovery: null,
        done: true,
      };
    });

    const result = await explorer.runGenericDesktop(
      observer, navigator, makeAnalysis()
    );

    expect(observer.startListening).toHaveBeenCalled();
    expect(result.steps_taken).toBe(2);
    expect(navigator.execute).toHaveBeenCalledTimes(2);
  });

  it("collects AI discoveries with dedup", async () => {
    const ai = makeAiClient();
    const config = makeConfig({ max_steps: 10 });
    const recorder = makeRecorder();
    const observer = makeObserver();
    const navigator = makeNavigator();
    const explorer = new Explorer(ai, config, recorder);

    let callCount = 0;
    mockDesktopPlan.mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        return {
          reasoning: "Found a bug",
          action: { kind: "desktop", action: "left_click", coordinate: [100, 200] },
          observation: "error",
          discovery: { title: "Button crash", description: "App crashes on click", severity: "high" },
          done: false,
        };
      }
      if (callCount === 2) {
        // Duplicate discovery — same title
        return {
          reasoning: "Same bug again",
          action: { kind: "desktop", action: "left_click", coordinate: [100, 200] },
          observation: "same error",
          discovery: { title: "Button crash", description: "App crashes on click", severity: "high" },
          done: false,
        };
      }
      return {
        reasoning: "Done",
        action: { kind: "desktop", action: "wait", duration: 100 },
        observation: "",
        discovery: null,
        done: true,
      };
    });

    const result = await explorer.runGenericDesktop(
      observer, navigator, makeAnalysis()
    );

    // Only 1 unique discovery (duplicate filtered)
    expect(result.discoveries.length).toBe(1);
    expect(result.discoveries[0].title).toBe("Button crash");
  });

  it("collects process log discoveries", async () => {
    const ai = makeAiClient();
    const config = makeConfig({ max_steps: 5 });
    const recorder = makeRecorder();
    const observer = makeObserver([
      makeDisplayState({ logs: ["FATAL ERROR: out of memory"] }),
      makeDisplayState({ logs: [] }),
    ]);
    const navigator = makeNavigator();
    const explorer = new Explorer(ai, config, recorder);

    mockDesktopPlan.mockResolvedValue({
      reasoning: "Done",
      action: { kind: "desktop", action: "wait", duration: 100 },
      observation: "",
      discovery: null,
      done: true,
    });

    const result = await explorer.runGenericDesktop(
      observer, navigator, makeAnalysis()
    );

    expect(result.discoveries.length).toBeGreaterThanOrEqual(1);
    expect(result.discoveries[0].severity).toBe("critical");
  });

  it("stops when planner says done", async () => {
    const ai = makeAiClient();
    const config = makeConfig({ max_steps: 50 });
    const recorder = makeRecorder();
    const observer = makeObserver();
    const navigator = makeNavigator();
    const explorer = new Explorer(ai, config, recorder);

    mockDesktopPlan.mockResolvedValue({
      reasoning: "Immediately done",
      action: { kind: "desktop", action: "wait", duration: 100 },
      observation: "",
      discovery: null,
      done: true,
    });

    const result = await explorer.runGenericDesktop(
      observer, navigator, makeAnalysis()
    );

    expect(result.steps_taken).toBe(0);
    expect(mockDesktopPlan).toHaveBeenCalledOnce();
  });

  it("stops at max_steps", async () => {
    const ai = makeAiClient();
    const config = makeConfig({ max_steps: 3 });
    const recorder = makeRecorder();
    const observer = makeObserver();
    const navigator = makeNavigator();
    const explorer = new Explorer(ai, config, recorder);

    mockDesktopPlan.mockResolvedValue({
      reasoning: "Keep going",
      action: { kind: "desktop", action: "left_click", coordinate: [100, 200] },
      observation: "ok",
      discovery: null,
      done: false,
    });

    const result = await explorer.runGenericDesktop(
      observer, navigator, makeAnalysis()
    );

    expect(result.steps_taken).toBe(3);
  });

  it("handles action errors gracefully", async () => {
    const ai = makeAiClient();
    const config = makeConfig({ max_steps: 5 });
    const recorder = makeRecorder();
    const observer = makeObserver();
    const navigator = makeNavigator();
    const explorer = new Explorer(ai, config, recorder);

    (navigator.execute as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("scrot: cannot capture")
    );

    let callCount = 0;
    mockDesktopPlan.mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        return {
          reasoning: "Click",
          action: { kind: "desktop", action: "left_click", coordinate: [100, 200] },
          observation: "", discovery: null, done: false,
        };
      }
      return {
        reasoning: "Done",
        action: { kind: "desktop", action: "wait", duration: 100 },
        observation: "", discovery: null, done: true,
      };
    });

    // Should not throw
    const result = await explorer.runGenericDesktop(
      observer, navigator, makeAnalysis()
    );

    expect(result.steps_taken).toBe(1);
  });

  it("reports progress via onProgress callback", async () => {
    const ai = makeAiClient();
    const config = makeConfig({ max_steps: 5 });
    const recorder = makeRecorder();
    const observer = makeObserver();
    const navigator = makeNavigator();
    const explorer = new Explorer(ai, config, recorder);

    mockDesktopPlan.mockResolvedValue({
      reasoning: "Done",
      action: { kind: "desktop", action: "wait", duration: 100 },
      observation: "", discovery: null, done: true,
    });

    const progress: string[] = [];
    await explorer.runGenericDesktop(
      observer, navigator, makeAnalysis(), (msg) => progress.push(msg)
    );

    expect(progress.length).toBeGreaterThan(0);
    expect(progress.some(p => p.includes("Desktop step"))).toBe(true);
  });
});
