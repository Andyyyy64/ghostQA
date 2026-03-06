import { Command } from "commander";
import consola from "consola";
import {
  saveBaseline,
  loadBaseline,
  listBaselines,
  clearBaseline,
} from "@ghostqa/core";

export const baselineCommand = new Command("baseline").description(
  "Manage approved baselines for comparison"
);

baselineCommand
  .command("save <run-id>")
  .description("Save a run as the approved baseline")
  .action(async (runId: string) => {
    const cwd = process.cwd();
    try {
      const dest = await saveBaseline(cwd, runId);
      consola.success(`Baseline saved: ${runId}`);
      consola.info(`Location: ${dest}`);
    } catch (err) {
      consola.error(
        `Failed to save baseline: ${err instanceof Error ? err.message : String(err)}`
      );
      process.exit(1);
    }
  });

baselineCommand
  .command("show")
  .description("Show current saved baseline")
  .action(async () => {
    const cwd = process.cwd();
    const baseline = await loadBaseline(cwd);
    if (!baseline) {
      consola.info("No baseline saved. Run: ghostqa baseline save <run-id>");
      return;
    }
    consola.log(
      `  ${baseline.run_id}  ${baseline.verdict.toUpperCase()}  ${baseline.discoveries.length} discoveries`
    );
  });

baselineCommand
  .command("list")
  .description("List saved baselines")
  .action(async () => {
    const cwd = process.cwd();
    const baselines = await listBaselines(cwd);
    if (baselines.length === 0) {
      consola.info("No baselines saved. Run: ghostqa baseline save <run-id>");
      return;
    }
    for (const b of baselines) {
      consola.log(
        `  ${b.run_id}  ${b.verdict.toUpperCase()}  ${b.discoveries_count} discoveries  (saved ${b.saved_at})`
      );
    }
  });

baselineCommand
  .command("clear")
  .description("Remove saved baseline")
  .action(async () => {
    const cwd = process.cwd();
    await clearBaseline(cwd);
    consola.success("Baseline cleared");
  });
