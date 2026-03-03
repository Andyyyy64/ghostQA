import { resolve } from "node:path";
import { chromium } from "playwright";
import { nanoid } from "nanoid";
import consola from "consola";
import type { GhostQAConfig } from "../types/config";
import type { RunResult, Discovery } from "../types/discovery";
import { AiClient } from "../ai/client";
import { BudgetExceededError } from "../ai/cost-tracker";
import { DiffAnalyzer } from "../diff-analyzer/analyzer";
import { setupEnvironment } from "../environment/manager";
import { AppRunner } from "../app-runner/runner";
import { LayerARunner } from "../layer-a/runner";
import { LayerBRunner } from "../layer-b/action-loop";
import { Recorder } from "../recorder/recorder";
import { Reporter } from "../reporter/reporter";

export interface PipelineOptions {
  config: GhostQAConfig;
  cwd: string;
  diffRef: string;
  onProgress?: (msg: string) => void;
}

export interface PipelineResult {
  verdict: string;
  discoveries: Discovery[];
  cost: { total_usd: number; input_tokens: number; output_tokens: number; is_rate_limited: boolean };
  report_path: string;
}

export async function runPipeline(
  options: PipelineOptions
): Promise<PipelineResult> {
  const { config, cwd, diffRef, onProgress } = options;
  const runId = `run-${nanoid(10)}`;
  const outputDir = resolve(cwd, config.reporter.output_dir, runId);

  consola.info(`Run ID: ${runId}`);
  onProgress?.("Initializing...");

  const ai = new AiClient(config.ai);
  const recorder = new Recorder(config.reporter, runId);
  await recorder.init();

  const reporter = new Reporter(outputDir);
  const startedAt = Date.now();
  let environment: { cleanup: () => Promise<void> } | undefined;

  // Track resources for cleanup on SIGINT/SIGTERM
  let activeBrowser: import("playwright").Browser | null = null;
  let activeContext: import("playwright").BrowserContext | null = null;
  let activeAppRunner: AppRunner | null = null;
  let interrupted = false;

  const cleanup = async () => {
    if (interrupted) return;
    interrupted = true;
    consola.warn("Interrupted — cleaning up...");
    try { if (activeContext) await activeContext.close(); } catch {}
    try { if (activeBrowser) await activeBrowser.close(); } catch {}
    try { if (activeAppRunner) await activeAppRunner.stop(); } catch {}
    try { if (environment) await environment.cleanup(); } catch {}
  };

  const onSignal = () => { cleanup().then(() => process.exit(130)); };
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);

  const result: RunResult = {
    run_id: runId,
    verdict: "pass",
    started_at: startedAt,
    finished_at: 0,
    config: config as unknown as Record<string, unknown>,
    diff_analysis: { summary: "", files_changed: 0, impact_areas: 0 },
    layer_a: {
      tests_generated: 0,
      tests_passed: 0,
      tests_failed: 0,
      discoveries: [],
    },
    layer_b: { steps_taken: 0, pages_visited: 0, discoveries: [] },
    cost: { total_usd: 0, input_tokens: 0, output_tokens: 0, is_rate_limited: false },
    discoveries: [],
  };

  try {
    // 1. Diff analysis
    onProgress?.("Analyzing diff...");
    const diffAnalyzer = new DiffAnalyzer(ai);
    const analysis = await diffAnalyzer.analyze(cwd, diffRef);
    result.diff_analysis = {
      summary: analysis.summary,
      files_changed: analysis.files.length,
      impact_areas: analysis.impact_areas.length,
    };

    // 2. Setup environment
    onProgress?.("Setting up environment...");
    environment = await setupEnvironment(config.environment, cwd);

    // 3. Build & start app
    onProgress?.("Building application...");
    const appRunner = new AppRunner(config.app);
    activeAppRunner = appRunner;
    await appRunner.build(cwd);

    onProgress?.("Starting application...");
    await appRunner.start(cwd);

    try {
      // 4. Launch browser
      onProgress?.("Launching browser...");
      const browser = await chromium.launch({ headless: true });
      activeBrowser = browser;

      const context = await browser.newContext({
        viewport: config.layer_b.viewport,
        ...recorder.contextOptions(),
      });
      activeContext = context;

      const page = await context.newPage();

      try {
        // 5. Layer A
        if (config.layer_a.enabled) {
          onProgress?.("Layer A: Generating tests...");
          const layerA = new LayerARunner(ai, config, outputDir);
          const layerAResult = await layerA.run(analysis);
          result.layer_a = {
            tests_generated: layerAResult.tests.length,
            tests_passed: layerAResult.tests.filter((t) => t.passed).length,
            tests_failed: layerAResult.tests.filter((t) => !t.passed).length,
            discoveries: layerAResult.discoveries,
          };
          result.discoveries.push(...layerAResult.discoveries);
        }

        // 6. Layer B
        if (config.layer_b.enabled) {
          onProgress?.("Layer B: AI exploration...");
          const layerB = new LayerBRunner(ai, config, recorder);
          const layerBResult = await layerB.run(page, analysis, onProgress);
          result.layer_b = {
            steps_taken: layerBResult.steps_taken,
            pages_visited: layerBResult.pages_visited,
            discoveries: layerBResult.discoveries,
          };
          result.discoveries.push(...layerBResult.discoveries);
        }
      } finally {
        activeContext = null;
        activeBrowser = null;
        await context.close();
        await browser.close();
        if (config.reporter.video) {
          consola.info("Video saved to run output directory");
        }
      }
    } finally {
      activeAppRunner = null;
      await appRunner.stop();
    }
  } catch (err) {
    if (err instanceof BudgetExceededError) {
      consola.warn("Budget exceeded, generating partial report");
    } else {
      throw err;
    }
  } finally {
    if (environment) {
      await environment.cleanup();
    }
  }

  // 7. Generate report
  onProgress?.("Generating report...");
  result.verdict = reporter.determineVerdict(result.discoveries);
  result.finished_at = Date.now();
  result.cost = ai.costTracker.summary();

  await reporter.writeJson(result);
  const reportPath = await reporter.writeHtml(result);

  // Remove signal handlers now that we're done
  process.removeListener("SIGINT", onSignal);
  process.removeListener("SIGTERM", onSignal);

  return {
    verdict: result.verdict,
    discoveries: result.discoveries,
    cost: result.cost,
    report_path: reportPath,
  };
}
