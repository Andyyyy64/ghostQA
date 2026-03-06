/**
 * Tests for TASK-2: Seed/Retry for Flaky Detection
 *
 * Validates:
 * - AiProviderConfigSchema accepts optional seed field
 * - ExplorerConfigSchema accepts retry_discoveries field with default 0
 * - seed is truly optional (config validates without it)
 * - Discovery confidence field is assigned correctly based on source and retry config
 */
import { describe, it, expect, vi } from "vitest";
import {
  AiProviderConfigSchema,
  ExplorerConfigSchema,
  AiConfigSchema,
} from "../src/types/config";
import { Explorer } from "../src/explorer/action-loop";
import type { GhostQAConfig } from "../src/types/config";
import type { DiffAnalysis } from "../src/types/impact";
import type { Recorder } from "../src/recorder/recorder";

// --- helpers ---

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
      emit_replay: false,
      retry_discoveries: 0,
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
    outputDir: "/tmp/ghostqa-test",
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

function makePage() {
  return {
    goto: vi.fn().mockResolvedValue(undefined),
    url: vi.fn().mockReturnValue("http://localhost:3000/"),
    title: vi.fn().mockResolvedValue("Test Page"),
    locator: vi.fn().mockImplementation((sel: string) => {
      if (sel === "form") return { all: vi.fn().mockResolvedValue([]) };
      return {
        ariaSnapshot: vi.fn().mockResolvedValue("<button>Submit</button>"),
        first: vi.fn().mockReturnValue({
          click: vi.fn().mockResolvedValue(undefined),
          fill: vi.fn().mockResolvedValue(undefined),
          hover: vi.fn().mockResolvedValue(undefined),
        }),
      };
    }),
    on: vi.fn(),
    mouse: { wheel: vi.fn().mockResolvedValue(undefined) },
    waitForTimeout: vi.fn().mockResolvedValue(undefined),
    goBack: vi.fn().mockResolvedValue(undefined),
    waitForLoadState: vi.fn().mockReturnValue({ catch: () => {} }),
    evaluate: vi.fn().mockResolvedValue([]),
  } as any;
}

// --- Schema tests ---

describe("AiProviderConfigSchema — seed field", () => {
  it("accepts a seed number", () => {
    const result = AiProviderConfigSchema.parse({ seed: 42 });
    expect(result.seed).toBe(42);
  });

  it("seed is optional (validates without it)", () => {
    const result = AiProviderConfigSchema.parse({});
    expect(result.seed).toBeUndefined();
  });

  it("seed propagates through AiConfigSchema", () => {
    const result = AiConfigSchema.parse({ seed: 123 });
    expect(result.seed).toBe(123);
  });
});

describe("ExplorerConfigSchema — retry_discoveries field", () => {
  it("accepts retry_discoveries", () => {
    const result = ExplorerConfigSchema.parse({ retry_discoveries: 3 });
    expect(result.retry_discoveries).toBe(3);
  });

  it("defaults to 0 when not provided", () => {
    const result = ExplorerConfigSchema.parse({});
    expect(result.retry_discoveries).toBe(0);
  });

  it("accepts 0 explicitly", () => {
    const result = ExplorerConfigSchema.parse({ retry_discoveries: 0 });
    expect(result.retry_discoveries).toBe(0);
  });
});

// --- Confidence assignment tests ---

describe("Explorer confidence assignment", () => {
  it("assigns 'high' confidence to console-sourced discoveries", async () => {
    const ai = makeAiClient();
    const recorder = makeRecorder();
    const page = makePage();
    const config = makeConfig({
      explorer: {
        ...makeConfig().explorer,
        max_steps: 3,
        retry_discoveries: 0,
      },
    });
    const explorer = new Explorer(ai, config, recorder);

    // Simulate console error via page.on("console")
    let consoleCallback: ((msg: any) => void) | null = null;
    page.on.mockImplementation((event: string, cb: any) => {
      if (event === "console") consoleCallback = cb;
    });

    let callCount = 0;
    ai.chatWithImage.mockImplementation(async () => {
      callCount++;
      if (callCount === 1 && consoleCallback) {
        consoleCallback({
          type: () => "error",
          text: () => "[pageerror] Uncaught ReferenceError: foo is not defined",
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

    // Console-sourced discoveries should be "high" confidence
    const consoleDiscoveries = result.discoveries.filter(
      (d) => d.source === "console"
    );
    for (const d of consoleDiscoveries) {
      expect(d.confidence).toBe("high");
    }
  });

  it("assigns 'low' confidence to AI-sourced discoveries when retry_discoveries=0", async () => {
    const ai = makeAiClient();
    const recorder = makeRecorder();
    const page = makePage();
    const config = makeConfig({
      explorer: {
        ...makeConfig().explorer,
        max_steps: 5,
        retry_discoveries: 0,
      },
    });
    const explorer = new Explorer(ai, config, recorder);

    let callCount = 0;
    ai.chatWithImage.mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        return JSON.stringify({
          reasoning: "Found a visual bug",
          action: { action: "scroll", direction: "down", amount: 300 },
          observation: "layout issue",
          discovery: {
            title: "Layout broken",
            description: "Elements overlap",
            severity: "medium",
          },
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

    const aiDiscoveries = result.discoveries.filter(
      (d) => d.source === "explorer"
    );
    expect(aiDiscoveries.length).toBe(1);
    expect(aiDiscoveries[0].confidence).toBe("low");
  });

  it("assigns 'medium' confidence to AI-sourced discoveries when retry_discoveries>0", async () => {
    const ai = makeAiClient();
    const recorder = makeRecorder();
    const page = makePage();
    const config = makeConfig({
      explorer: {
        ...makeConfig().explorer,
        max_steps: 5,
        retry_discoveries: 2,
      },
    });
    const explorer = new Explorer(ai, config, recorder);

    let callCount = 0;
    ai.chatWithImage.mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        return JSON.stringify({
          reasoning: "Found a visual bug",
          action: { action: "scroll", direction: "down", amount: 300 },
          observation: "layout issue",
          discovery: {
            title: "Button misaligned",
            description: "Button is shifted 20px right",
            severity: "low",
          },
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

    const aiDiscoveries = result.discoveries.filter(
      (d) => d.source === "explorer"
    );
    expect(aiDiscoveries.length).toBe(1);
    expect(aiDiscoveries[0].confidence).toBe("medium");
  });
});
