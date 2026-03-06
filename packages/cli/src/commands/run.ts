import { Command } from "commander";
import consola from "consola";
import ora from "ora";
import {
  loadConfig,
  runPipeline,
  comparePipeline,
  loadBaseline,
  Comparator,
  Reporter,
} from "@ghostqa/core";
import { resolve, join } from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";

export const runCommand = new Command("run")
  .description("Analyze code changes and run AI-powered browser tests")
  .option("-c, --config <path>", "Config file path", ".ghostqa.yml")
  .option("--diff <ref>", "Git diff reference (default: HEAD~1)")
  .option("--base <ref>", "Base commit for Before/After comparison")
  .option("--head <ref>", "Head commit for Before/After comparison (default: HEAD)")
  .option("--no-explore", "Skip AI exploration")
  .option("--budget <usd>", "Override max budget in USD", parseFloat)
  .option("--baseline", "Use saved baseline instead of re-running base")
  .action(async (opts) => {
    const cwd = process.cwd();
    const spinner = ora("Loading configuration...").start();

    try {
      const config = await loadConfig(cwd, opts.config);

      if (opts.budget !== undefined) {
        config.ai.max_budget_usd = opts.budget;
      }
      if (opts.explore === false) {
        config.explorer.enabled = false;
      }

      spinner.succeed("Configuration loaded");

      const onProgress = (msg: string) => {
        spinner.text = msg;
        spinner.start();
      };

      // Baseline comparison mode: --baseline flag uses saved baseline as base
      if (opts.baseline) {
        onProgress("Loading saved baseline...");
        const baseResult = await loadBaseline(cwd);
        if (!baseResult) {
          spinner.fail("No baseline found. Save one first: ghostqa baseline save <run-id>");
          process.exit(1);
        }

        onProgress("Running pipeline on head...");
        const headPipelineResult = await runPipeline({
          config,
          cwd,
          diffRef: opts.diff ?? "HEAD~1",
          onProgress: (msg) => onProgress(`[HEAD] ${msg}`),
        });

        // Read full RunResult from head run's summary.json
        const headRunDir = resolve(
          cwd,
          config.reporter.output_dir,
          headPipelineResult.run_id
        );
        const headResult = JSON.parse(
          await readFile(join(headRunDir, "summary.json"), "utf-8")
        );

        // Compare
        onProgress("Comparing against baseline...");
        const comparator = new Comparator();
        const comparison = comparator.compare(
          baseResult,
          headResult,
          `baseline:${baseResult.run_id}`,
          "HEAD"
        );

        // Generate comparison report
        onProgress("Generating comparison report...");
        await mkdir(headRunDir, { recursive: true });
        await writeFile(
          join(headRunDir, "comparison.json"),
          JSON.stringify(comparison, null, 2),
          "utf-8"
        );

        const reporter = new Reporter(headRunDir);
        const reportPath = await reporter.writeComparisonHtml(comparison);

        const result = { ...comparison, report_path: reportPath };

        spinner.stop();

        const icon =
          result.verdict === "pass"
            ? "[PASS]"
            : result.verdict === "fail"
              ? "[FAIL]"
              : "[WARN]";

        consola.log("");
        consola.log(`${icon} Verdict: ${result.verdict.toUpperCase()} (vs baseline)`);
        consola.log(`   Baseline: ${baseResult.run_id}`);
        consola.log(`   New issues: ${result.regressions.new_discoveries.length}`);
        consola.log(`   Fixed: ${result.regressions.fixed_discoveries.length}`);
        if (result.cost.is_rate_limited) {
          consola.log(`   Rate limit: check claude → /usage | codex → /status`);
        } else {
          consola.log(`   Cost: $${result.cost.total_usd.toFixed(4)}`);
        }
        consola.log(`   Report: ${result.report_path}`);
        consola.log("");

        if (result.verdict === "fail") {
          process.exit(1);
        }
        return;
      }

      // Before/After mode: --base flag triggers comparison pipeline
      if (opts.base) {
        const result = await comparePipeline({
          config,
          cwd,
          baseRef: opts.base,
          headRef: opts.head ?? "HEAD",
          onProgress,
        });

        spinner.stop();

        const icon =
          result.verdict === "pass"
            ? "[PASS]"
            : result.verdict === "fail"
              ? "[FAIL]"
              : "[WARN]";

        consola.log("");
        consola.log(`${icon} Verdict: ${result.verdict.toUpperCase()} (comparison)`);
        consola.log(`   New issues: ${result.regressions.new_discoveries.length}`);
        consola.log(`   Fixed: ${result.regressions.fixed_discoveries.length}`);
        if (result.cost.is_rate_limited) {
          consola.log(`   Rate limit: check claude → /usage | codex → /status`);
        } else {
          consola.log(`   Cost: $${result.cost.total_usd.toFixed(4)}`);
        }
        consola.log(`   Report: ${result.report_path}`);
        consola.log("");

        if (result.verdict === "fail") {
          process.exit(1);
        }
        return;
      }

      // Single-run mode (original behavior)
      const result = await runPipeline({
        config,
        cwd,
        diffRef: opts.diff ?? "HEAD~1",
        onProgress,
      });

      spinner.stop();

      const icon =
        result.verdict === "pass"
          ? "[PASS]"
          : result.verdict === "fail"
            ? "[FAIL]"
            : "[WARN]";

      consola.log("");
      consola.log(`${icon} Verdict: ${result.verdict.toUpperCase()}`);
      consola.log(`   Discoveries: ${result.discoveries.length}`);
      if (result.cost.is_rate_limited) {
        consola.log(`   Rate limit: check claude → /usage | codex → /status`);
      } else {
        consola.log(`   Cost: $${result.cost.total_usd.toFixed(4)}`);
      }
      consola.log(`   Report: ${result.report_path}`);
      consola.log("");

      if (result.verdict === "fail") {
        process.exit(1);
      }
    } catch (err) {
      spinner.fail("Run failed");
      consola.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });
