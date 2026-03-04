/**
 * Tests for task-based AI model routing (AiClient.useTask/resetTask).
 */
import { describe, it, expect, vi } from "vitest";
import { AiClient } from "../src/ai/client";

// Mock the providers to verify which one gets called
vi.mock("../src/ai/gemini-provider", () => ({
  GeminiProvider: class MockGeminiProvider {
    model: string;
    constructor(_apiKey: string, model: string) {
      this.model = model;
    }
    async chat() {
      return { text: `response-from-${this.model}`, inputTokens: 10, outputTokens: 5 };
    }
    async chatWithImage() {
      return { text: `image-response-from-${this.model}`, inputTokens: 20, outputTokens: 10 };
    }
  },
}));

vi.mock("../src/ai/cli-provider", () => ({
  CliProvider: class MockCliProvider {
    command: string;
    reportedCostUsd = 0;
    constructor(command: string) {
      this.command = command;
    }
    async chat() {
      return { text: `cli-response`, inputTokens: 0, outputTokens: 0 };
    }
    async chatWithImage() {
      return { text: `cli-image-response`, inputTokens: 0, outputTokens: 0 };
    }
  },
}));

describe("AiClient routing", () => {
  const baseConfig = {
    provider: "gemini" as const,
    model: "gemini-default",
    api_key_env: "GEMINI_API_KEY",
    max_budget_usd: 10,
    cli: { command: "claude", args: [] },
    routing: {},
  };

  // Set env var for Gemini provider
  process.env.GEMINI_API_KEY = "test-key";

  it("uses default provider when no routing configured", async () => {
    const client = new AiClient(baseConfig);
    const result = await client.chat("system", [{ role: "user", content: "test" }]);
    expect(result).toBe("response-from-gemini-default");
  });

  it("switches to task-specific provider with useTask()", async () => {
    const config = {
      ...baseConfig,
      routing: {
        diff_analysis: {
          provider: "gemini" as const,
          model: "gemini-diff-model",
          api_key_env: "GEMINI_API_KEY",
          cli: { command: "claude", args: [] },
        },
      },
    };

    const client = new AiClient(config);

    // Default provider
    let result = await client.chat("system", [{ role: "user", content: "test" }]);
    expect(result).toBe("response-from-gemini-default");

    // Switch to diff_analysis task
    client.useTask("diff_analysis");
    result = await client.chat("system", [{ role: "user", content: "test" }]);
    expect(result).toBe("response-from-gemini-diff-model");

    // Reset back to default
    client.resetTask();
    result = await client.chat("system", [{ role: "user", content: "test" }]);
    expect(result).toBe("response-from-gemini-default");
  });

  it("falls back to default for unconfigured tasks", async () => {
    const config = {
      ...baseConfig,
      routing: {
        diff_analysis: {
          provider: "gemini" as const,
          model: "gemini-diff-model",
          api_key_env: "GEMINI_API_KEY",
          cli: { command: "claude", args: [] },
        },
      },
    };

    const client = new AiClient(config);

    // exploration has no routing config, should use default
    client.useTask("exploration");
    const result = await client.chat("system", [{ role: "user", content: "test" }]);
    expect(result).toBe("response-from-gemini-default");
  });

  it("tracks costs through task switches", async () => {
    const config = {
      ...baseConfig,
      routing: {
        ui_control: {
          provider: "gemini" as const,
          model: "gemini-vision",
          api_key_env: "GEMINI_API_KEY",
          cli: { command: "claude", args: [] },
        },
      },
    };

    const client = new AiClient(config);

    await client.chat("system", [{ role: "user", content: "test" }]);
    client.useTask("ui_control");
    await client.chat("system", [{ role: "user", content: "test" }]);
    client.resetTask();

    const cost = client.costTracker.summary();
    expect(cost.input_tokens).toBe(20); // 10 + 10
    expect(cost.output_tokens).toBe(10); // 5 + 5
  });

  it("useTask returns this for chaining", () => {
    const client = new AiClient(baseConfig);
    const result = client.useTask("diff_analysis");
    expect(result).toBe(client);
  });
});
