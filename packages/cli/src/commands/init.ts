import { Command } from "commander";
import consola from "consola";
import { configExists, generateConfig } from "@ghostqa/core";

export const initCommand = new Command("init")
  .description("Initialize ghostQA configuration in current directory")
  .option("-f, --force", "Overwrite existing config")
  .action(async (opts) => {
    const cwd = process.cwd();

    if (!opts.force && (await configExists(cwd))) {
      consola.warn(
        ".ghostqa.yml already exists. Use --force to overwrite."
      );
      return;
    }

    const path = await generateConfig(cwd);
    consola.success(`Created ${path}`);
    consola.info("Edit .ghostqa.yml to configure your project, then run:");
    consola.info("  ghostqa doctor  # check dependencies");
    consola.info("  ghostqa run     # run analysis");
  });
