import type { Page } from "playwright";
import consola from "consola";
import type { AiClient } from "../ai/client";
import type { DiffAnalysis } from "../types/impact";
import type { GhostQAConfig } from "../types/config";
import type { Discovery } from "../types/discovery";
import type { Recorder } from "../recorder/recorder";
import { Observer } from "./observer";
import { Navigator } from "./navigator";
import { Planner } from "./planner";
import { Discoverer } from "./discoverer";
import { Guardrails } from "./guardrails";

export interface LayerBResult {
  steps_taken: number;
  pages_visited: number;
  discoveries: Discovery[];
}

export class LayerBRunner {
  constructor(
    private ai: AiClient,
    private config: GhostQAConfig,
    private recorder: Recorder
  ) {}

  async run(
    page: Page,
    analysis: DiffAnalysis,
    onProgress?: (msg: string) => void
  ): Promise<LayerBResult> {
    consola.info("=== Layer B: AI Exploration ===");

    const observer = new Observer(this.recorder);
    const navigator = new Navigator();
    const planner = new Planner(this.ai, analysis);
    const discoverer = new Discoverer();
    const guardrails = new Guardrails(
      this.config.layer_b,
      this.ai.costTracker
    );

    const discoveries: Discovery[] = [];

    // Navigate to the app
    await page.goto(this.config.app.url, {
      waitUntil: "domcontentloaded",
      timeout: 10000,
    });

    observer.startListening(page);

    while (true) {
      const stopCheck = guardrails.shouldStop();
      if (stopCheck.stop) {
        consola.info(`Stopping exploration: ${stopCheck.reason}`);
        break;
      }

      // Observe
      const state = await observer.observe(page);
      onProgress?.(
        `Exploring: ${state.url} (step ${guardrails.stats.steps_taken + 1}/${this.config.layer_b.max_steps})`
      );

      // Check console for errors
      const consoleDiscoveries = discoverer.detectFromConsole(state);
      if (consoleDiscoveries.length > 0) {
        const screenshot = await this.recorder.screenshot(page, "console-error");
        for (const d of consoleDiscoveries) {
          d.screenshot_path = screenshot;
          discoveries.push(d);
        }
      }

      // Plan
      const plan = await planner.plan(state);
      consola.debug(`Plan: ${plan.reasoning}`);

      // Record discovery from AI
      if (plan.discovery) {
        const screenshot = await this.recorder.screenshot(page, "discovery");
        const d = discoverer.createFromPlan(plan.discovery, state.url, screenshot);
        discoveries.push(d);
        consola.warn(`Discovery: [${d.severity}] ${d.title}`);
      }

      if (plan.done) {
        consola.info("AI exploration complete (AI decided to stop)");
        break;
      }

      // Act
      try {
        await navigator.execute(page, plan.action);
      } catch (err) {
        consola.debug(
          `Action failed: ${err instanceof Error ? err.message : String(err)}`
        );
        // Not necessarily a bug — element might have disappeared
      }

      guardrails.recordStep(
        state.url,
        `${plan.action.action}:${plan.action.selector ?? plan.action.url ?? ""}`
      );
    }

    const stats = guardrails.stats;
    consola.info(
      `Layer B: ${stats.steps_taken} steps, ${stats.pages_visited} pages, ${discoveries.length} discoveries`
    );

    return {
      steps_taken: stats.steps_taken,
      pages_visited: stats.pages_visited,
      discoveries,
    };
  }
}
