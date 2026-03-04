import type { Page } from "playwright";
import consola from "consola";
import type { AiClient } from "../ai/client";
import type { DiffAnalysis } from "../types/impact";
import type { GhostQAConfig } from "../types/config";
import type { Discovery } from "../types/discovery";
import type { Recorder } from "../recorder/recorder";
import type { IObserver, INavigator, DesktopAction, DesktopActionType } from "./types";
import { Observer } from "./observer";
import { Navigator } from "./navigator";
import { Planner } from "./planner";
import { Discoverer } from "./discoverer";
import { Guardrails } from "./guardrails";

export type ExplorerMode = "web" | "desktop" | "auto";

export interface ExplorerResult {
  steps_taken: number;
  pages_visited: number;
  discoveries: Discovery[];
}

export class Explorer {
  constructor(
    private ai: AiClient,
    private config: GhostQAConfig,
    private recorder: Recorder
  ) {}

  async run(
    page: Page,
    analysis: DiffAnalysis,
    onProgress?: (msg: string) => void
  ): Promise<ExplorerResult> {
    consola.info("=== AI Exploration ===");

    const observer = new Observer(this.recorder);
    const navigator = new Navigator(this.config.constraints);
    const planner = new Planner(this.ai, analysis);
    const discoverer = new Discoverer();
    const guardrails = new Guardrails(
      this.config.explorer,
      this.ai.costTracker
    );

    const discoveries: Discovery[] = [];

    // Navigate to the app
    await page.goto(this.config.app.url, {
      waitUntil: "domcontentloaded",
      timeout: 10000,
    });

    observer.startListening(page);

    let lastActionError: string | undefined;

    while (true) {
      const stopCheck = guardrails.shouldStop();
      if (stopCheck.stop) {
        consola.info(`Stopping exploration: ${stopCheck.reason}`);
        break;
      }

      // Observe
      const state = await observer.observe(page);
      onProgress?.(
        `Exploring: ${state.url} (step ${guardrails.stats.steps_taken + 1}/${this.config.explorer.max_steps})`
      );

      // Check console for errors
      const consoleDiscoveries = discoverer.detectFromConsole(state);
      if (consoleDiscoveries.length > 0) {
        const screenshot = await this.recorder.screenshot(page, "console-error");
        for (const d of consoleDiscoveries) {
          d.screenshot_path = screenshot;
          if (!discoverer.isDuplicate(d, discoveries)) {
            discoveries.push(d);
          }
        }
      }

      // Screenshot every step for the report trace
      const stepNum = guardrails.stats.steps_taken + 1;
      await this.recorder.screenshot(page, `step-${stepNum}`);

      // Plan (pass action error from previous step so AI knows it failed)
      const plan = await planner.plan(state, lastActionError);
      lastActionError = undefined;
      consola.info(`Step ${stepNum}: ${plan.reasoning}`);

      // Record discovery from AI (with dedup)
      if (plan.discovery) {
        const screenshot = await this.recorder.screenshot(page, "discovery");
        const d = discoverer.createFromPlan(plan.discovery, state.url, screenshot);
        if (!discoverer.isDuplicate(d, discoveries)) {
          discoveries.push(d);
          consola.warn(`Discovery: [${d.severity}] ${d.title}`);
        } else {
          consola.debug(`Duplicate discovery skipped: ${d.title}`);
        }
      }

      if (plan.done) {
        consola.info("AI exploration complete (AI decided to stop)");
        break;
      }

      // Act
      try {
        await navigator.execute(page, plan.action);
      } catch (err) {
        lastActionError = err instanceof Error ? err.message : String(err);
        consola.warn(`Action failed: ${lastActionError}`);
      }

      guardrails.recordStep(
        state.url,
        `${plan.action.action}:${plan.action.selector ?? plan.action.url ?? ""}`
      );
    }

    const stats = guardrails.stats;
    consola.info(
      `Exploration: ${stats.steps_taken} steps, ${stats.pages_visited} pages, ${discoveries.length} discoveries`
    );

    return {
      steps_taken: stats.steps_taken,
      pages_visited: stats.pages_visited,
      discoveries,
    };
  }

  /**
   * Desktop exploration using Anthropic's native computer_20251124 tool.
   * The AI returns coordinate-based actions via the tool_use loop.
   */
  async runAnthropicDesktop(
    observer: IObserver,
    navigator: INavigator,
    analysis: DiffAnalysis,
    onProgress?: (msg: string) => void
  ): Promise<ExplorerResult> {
    consola.info("=== Desktop Exploration (Anthropic Computer Use) ===");

    const { AnthropicComputerUseProvider } = await import("../ai/anthropic-computer-use");
    const { calculateScale, scaleToDisplay } = await import("./screenshot-scaler");

    const discoverer = new Discoverer();
    const guardrails = new Guardrails(this.config.explorer, this.ai.costTracker);
    const discoveries: Discovery[] = [];

    const viewport = this.config.explorer.viewport;
    const scaleInfo = calculateScale(viewport.width, viewport.height);

    const provider = new AnthropicComputerUseProvider(
      process.env[this.config.ai.api_key_env] ?? "",
      this.config.ai.model,
      { width: viewport.width, height: viewport.height }
    );

    observer.startListening();
    const state = await observer.observe();

    // Check process logs for errors
    const logDiscoveries = discoverer.detectFromLogs(state);
    for (const d of logDiscoveries) {
      if (!discoverer.isDuplicate(d, discoveries)) discoveries.push(d);
    }

    const systemPrompt = this.buildDesktopSystemPrompt(analysis);
    const userMessage = `Begin exploring the application. Impact areas: ${analysis.impact_areas.map(a => a.area).join(", ")}`;

    let step = await provider.startSession(systemPrompt, userMessage, state.screenshotBase64);

    while (!step.done) {
      const stopCheck = guardrails.shouldStop();
      if (stopCheck.stop) {
        consola.info(`Stopping: ${stopCheck.reason}`);
        break;
      }

      if (step.action) {
        onProgress?.(`Desktop step ${guardrails.stats.steps_taken + 1}: ${step.action.action}`);

        // Scale coordinates from API space to display space
        let coordinate = step.action.coordinate;
        if (coordinate) {
          const [dx, dy] = scaleToDisplay(scaleInfo, coordinate[0], coordinate[1]);
          coordinate = [Math.round(dx), Math.round(dy)];
        }

        const desktopAction: DesktopAction = {
          kind: "desktop",
          action: step.action.action as DesktopActionType,
          coordinate,
          text: step.action.text,
        };

        try {
          await navigator.execute(desktopAction);
        } catch (err) {
          consola.warn(`Action failed: ${err}`);
        }

        guardrails.recordStep(state.identifier, `${step.action.action}:${coordinate?.join(",") ?? ""}`);
      }

      // Observe after action
      const newState = await observer.observe();
      const newLogDiscoveries = discoverer.detectFromLogs(newState);
      for (const d of newLogDiscoveries) {
        if (!discoverer.isDuplicate(d, discoveries)) discoveries.push(d);
      }

      // Send screenshot back to continue the tool-use loop
      step = await provider.sendToolResult(
        step.toolUseId!,
        newState.screenshotBase64
      );
    }

    const stats = guardrails.stats;
    consola.info(`Desktop exploration: ${stats.steps_taken} steps, ${discoveries.length} discoveries`);

    return { steps_taken: stats.steps_taken, pages_visited: stats.pages_visited, discoveries };
  }

  /**
   * Desktop exploration using generic AI providers (Gemini/OpenAI/CLI).
   * Uses coordinate-based JSON responses via DesktopPlanner.
   */
  async runGenericDesktop(
    observer: IObserver,
    navigator: INavigator,
    analysis: DiffAnalysis,
    onProgress?: (msg: string) => void
  ): Promise<ExplorerResult> {
    consola.info("=== Desktop Exploration (Generic) ===");

    const { DesktopPlanner } = await import("./desktop-planner");

    const discoverer = new Discoverer();
    const guardrails = new Guardrails(this.config.explorer, this.ai.costTracker);
    const discoveries: Discovery[] = [];

    const viewport = this.config.explorer.viewport;
    const planner = new DesktopPlanner(this.ai, analysis, viewport);

    observer.startListening();

    while (true) {
      const stopCheck = guardrails.shouldStop();
      if (stopCheck.stop) {
        consola.info(`Stopping: ${stopCheck.reason}`);
        break;
      }

      const state = await observer.observe();
      onProgress?.(`Desktop step ${guardrails.stats.steps_taken + 1}/${this.config.explorer.max_steps}`);

      // Check process logs
      const logDiscoveries = discoverer.detectFromLogs(state);
      for (const d of logDiscoveries) {
        if (!discoverer.isDuplicate(d, discoveries)) discoveries.push(d);
      }

      const plan = await planner.plan(state);
      consola.info(`Step ${guardrails.stats.steps_taken + 1}: ${plan.reasoning}`);

      if (plan.discovery) {
        const screenshotPath = await observer.screenshot("discovery");
        const d = discoverer.createFromPlan(plan.discovery, state.identifier, screenshotPath);
        if (!discoverer.isDuplicate(d, discoveries)) {
          discoveries.push(d);
          consola.warn(`Discovery: [${d.severity}] ${d.title}`);
        }
      }

      if (plan.done) {
        consola.info("Desktop exploration complete (AI decided to stop)");
        break;
      }

      if (plan.action) {
        try {
          await navigator.execute(plan.action);
        } catch (err) {
          consola.warn(`Action failed: ${err}`);
        }
        guardrails.recordStep(
          state.identifier,
          `${plan.action.action}:${plan.action.coordinate?.join(",") ?? ""}`
        );
      }
    }

    const stats = guardrails.stats;
    consola.info(`Desktop exploration: ${stats.steps_taken} steps, ${discoveries.length} discoveries`);

    return { steps_taken: stats.steps_taken, pages_visited: stats.pages_visited, discoveries };
  }

  private buildDesktopSystemPrompt(analysis: DiffAnalysis): string {
    const constraints = this.config.constraints;
    let constraintText = "";
    if (constraints.no_payment) constraintText += "- NEVER interact with payment/purchase/buy/checkout elements\n";
    if (constraints.no_delete) constraintText += "- NEVER click delete/remove/destroy buttons\n";

    return `You are a QA engineer testing a desktop application via screenshots and coordinate-based clicking.

DIFF SUMMARY: ${analysis.summary}

IMPACT AREAS:
${analysis.impact_areas.map(a => `- ${a.area}: ${a.description}`).join("\n")}

YOUR TASK:
1. Systematically explore the impact areas listed above
2. Look for visual bugs, crashes, errors, or unexpected behavior
3. Click buttons, fill forms, navigate menus to test functionality
4. Report any issues you find

${constraintText ? `CONSTRAINTS:\n${constraintText}` : ""}

When you find a bug, describe it clearly in your response text.`;
  }
}
