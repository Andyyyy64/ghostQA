import { Command } from "commander";
import consola from "consola";
import ora from "ora";
import { loadConfig, runPipeline, comparePipeline } from "@ghostqa/core";

export const runCommand = new Command("run")
  .description("Analyze code changes and run AI-powered browser tests")
  .option("-c, --config <path>", "Config file path", ".ghostqa.yml")
  .option("--diff <ref>", "Git diff reference (default: HEAD~1)")
  .option("--base <ref>", "Base commit for Before/After comparison")
  .option("--head <ref>", "Head commit for Before/After comparison (default: HEAD)")
  .option("--no-layer-a", "Skip Layer A (generated E2E tests)")
  .option("--no-layer-b", "Skip Layer B (AI exploration)")
  .option("--budget <usd>", "Override max budget in USD", parseFloat)
  .action(async (opts) => {
    const cwd = process.cwd();
    const spinner = ora("Loading configuration...").start();

    try {
      const config = await loadConfig(cwd);

      if (opts.budget !== undefined) {
        config.ai.max_budget_usd = opts.budget;
      }
      if (opts.layerA === false) {
        config.layer_a.enabled = false;
      }
      if (opts.layerB === false) {
        config.layer_b.enabled = false;
      }

      spinner.succeed("Configuration loaded");

      const onProgress = (msg: string) => {
        spinner.text = msg;
        spinner.start();
      };

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
        consola.log(`   Test regressions: ${result.regressions.test_regressions}`);
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
