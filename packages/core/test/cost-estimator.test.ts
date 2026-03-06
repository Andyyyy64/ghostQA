import { describe, it, expect } from "vitest";
import { estimateCost } from "../src/ai/cost-estimator";
import type { GhostQAConfig } from "../src/types/config";

function makeConfig(overrides: {
  provider?: string;
  model?: string;
  max_steps?: number;
  max_budget_usd?: number;
}): GhostQAConfig {
  return {
    app: {
      name: "test-app",
      root: ".",
      build: "echo build",
      start: "echo start",
      url: "http://localhost:3000",
      healthcheck: { path: "/", timeout: 30000, interval: 1000 },
    },
    environment: {
      mode: "native",
      docker: { image: "ghostqa/runner:latest", volumes: [] },
    },
    ai: {
      provider: (overrides.provider ?? "gemini") as "gemini" | "anthropic" | "openai" | "cli",
      model: overrides.model ?? "gemini-2.0-flash",
      api_key_env: "GEMINI_API_KEY",
      cli: { command: "claude", args: [] },
      max_budget_usd: overrides.max_budget_usd ?? 5.0,
      routing: {},
    },
    explorer: {
      enabled: true,
      mode: "web",
      max_steps: overrides.max_steps ?? 50,
      max_duration: 300000,
      retry_discoveries: 0,
      viewport: { width: 1280, height: 720 },
      desktop: {
        display: ":99",
        app_command: "",
        window_timeout: 30000,
      },
    },
    reporter: {
      output_dir: ".ghostqa-runs",
      formats: ["html", "json"],
      video: true,
      screenshots: true,
    },
    constraints: {
      no_payment: false,
      no_delete: false,
      no_external_links: false,
      allowed_domains: [],
      forbidden_selectors: [],
    },
  };
}

describe("estimateCost", () => {
  it("returns non-zero cost for gemini API provider", () => {
    const config = makeConfig({ provider: "gemini", model: "gemini-2.0-flash" });
    const estimate = estimateCost(config, 100);

    expect(estimate.provider).toBe("gemini");
    expect(estimate.model).toBe("gemini-2.0-flash");
    expect(estimate.is_rate_limited).toBe(false);
    expect(estimate.estimated_cost_usd.low).toBeGreaterThan(0);
    expect(estimate.estimated_cost_usd.high).toBeGreaterThan(0);
    expect(estimate.estimated_cost_usd.high).toBeGreaterThanOrEqual(estimate.estimated_cost_usd.low);
  });

  it("returns is_rate_limited true and cost 0 for CLI provider", () => {
    const config = makeConfig({ provider: "cli", model: "claude-sonnet-4-20250514" });
    const estimate = estimateCost(config, 100);

    expect(estimate.is_rate_limited).toBe(true);
    expect(estimate.estimated_cost_usd.low).toBe(0);
    expect(estimate.estimated_cost_usd.high).toBe(0);
  });

  it("returns cost 0 gracefully for unknown model", () => {
    const config = makeConfig({ provider: "anthropic", model: "some-future-model-v99" });
    const estimate = estimateCost(config, 100);

    expect(estimate.is_rate_limited).toBe(false);
    expect(estimate.estimated_cost_usd.low).toBe(0);
    expect(estimate.estimated_cost_usd.high).toBe(0);
  });

  it("estimates steps as ~70% of max_steps", () => {
    const config = makeConfig({ max_steps: 100 });
    const estimate = estimateCost(config, 50);

    expect(estimate.estimated_steps).toBe(70);
  });

  it("more diff lines results in more tokens estimated", () => {
    const config = makeConfig({});
    const smallDiff = estimateCost(config, 10);
    const largeDiff = estimateCost(config, 500);

    expect(largeDiff.estimated_tokens.input).toBeGreaterThan(smallDiff.estimated_tokens.input);
    // Output tokens should be the same (they don't depend on diff size)
    expect(largeDiff.estimated_tokens.output).toBe(smallDiff.estimated_tokens.output);
  });

  it("caps diff tokens at 8000", () => {
    const config = makeConfig({});
    const hugeDiff = estimateCost(config, 10000);
    const cappedDiff = estimateCost(config, 5000);

    // Both exceed the cap (10000*5=50000 > 8000, 5000*5=25000 > 8000)
    // so input tokens should be identical
    expect(hugeDiff.estimated_tokens.input).toBe(cappedDiff.estimated_tokens.input);
  });
});
