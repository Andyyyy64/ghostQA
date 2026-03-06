import { Command } from "commander";
import consola from "consola";
import { loadConfig, configExists, estimateCost } from "@ghostqa/core";
import { spawnSync } from "node:child_process";

export const estimateCommand = new Command("estimate")
  .description("Estimate AI cost before running")
  .option("-c, --config <path>", "Config file path")
  .option("--diff <ref>", "Git diff reference", "HEAD~1")
  .action(async (opts) => {
    const cwd = process.cwd();

    if (!opts.config && !(await configExists(cwd))) {
      consola.error("No .ghostqa.yml found. Run 'ghostqa init' first.");
      process.exit(1);
    }

    const config = await loadConfig(cwd, opts.config);

    // Get diff line count
    const diffResult = spawnSync("git", ["diff", "--stat", opts.diff], {
      cwd,
      encoding: "utf-8",
    });
    const lines = (diffResult.stdout ?? "").split("\n");
    const lastLine = lines[lines.length - 2] ?? "";
    const insertions = parseInt(lastLine.match(/(\d+) insertion/)?.[1] ?? "0");
    const deletions = parseInt(lastLine.match(/(\d+) deletion/)?.[1] ?? "0");
    const totalLines = insertions + deletions;

    const estimate = estimateCost(config, totalLines);

    consola.log("");
    consola.log("Cost Estimate");
    consola.log(`  Provider: ${estimate.provider} (${estimate.model})`);
    consola.log(`  Estimated steps: ~${estimate.estimated_steps}`);
    consola.log(
      `  Estimated tokens: ~${estimate.estimated_tokens.input.toLocaleString()} in / ~${estimate.estimated_tokens.output.toLocaleString()} out`,
    );

    if (estimate.is_rate_limited) {
      consola.log("  Cost: Rate-limited (CLI subscription)");
      consola.log("  Check: claude -> /usage | codex -> /status");
    } else if (estimate.estimated_cost_usd.high > 0) {
      consola.log(
        `  Estimated cost: $${estimate.estimated_cost_usd.low.toFixed(2)} - $${estimate.estimated_cost_usd.high.toFixed(2)}`,
      );
      consola.log(
        `  Budget limit: $${config.ai.max_budget_usd.toFixed(2)}`,
      );
    } else {
      consola.log(
        `  Cost: Unknown model pricing — budget limit: $${config.ai.max_budget_usd.toFixed(2)}`,
      );
    }
    consola.log("");
  });
