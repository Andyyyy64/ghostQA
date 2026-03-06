import { Command } from "commander";
import consola from "consola";
import { loadConfig, configExists } from "@ghostqa/core";

export const validateCommand = new Command("validate")
  .description("Validate .ghostqa.yml configuration")
  .option("-c, --config <path>", "Config file path")
  .action(async (opts) => {
    const cwd = process.cwd();

    if (!opts.config && !(await configExists(cwd))) {
      consola.error("No .ghostqa.yml found. Run 'ghostqa init' first.");
      process.exit(1);
    }

    try {
      const config = await loadConfig(cwd, opts.config);
      consola.success("Configuration is valid");
      consola.info(`  App: ${config.app.name}`);
      consola.info(`  AI: ${config.ai.provider} (${config.ai.model})`);
      consola.info(`  Explorer: ${config.explorer.enabled ? "enabled" : "disabled"}`);
      if (config.constraints.no_payment || config.constraints.no_delete || config.constraints.no_external_links) {
        const active = [];
        if (config.constraints.no_payment) active.push("no_payment");
        if (config.constraints.no_delete) active.push("no_delete");
        if (config.constraints.no_external_links) active.push("no_external_links");
        consola.info(`  Constraints: ${active.join(", ")}`);
      }
    } catch (err) {
      consola.error("Configuration is invalid:");
      consola.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });
