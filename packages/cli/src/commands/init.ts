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

    const { path, project } = await generateConfig(cwd);

    const detections = [
      `Package manager: ${project.packageManager}`,
      project.framework ? `Framework: ${project.framework}` : null,
      `Start: ${project.start}`,
      `Port: ${project.port}`,
    ].filter(Boolean);

    consola.success(`Created ${path}`);
    consola.info(`Detected: ${detections.join(" | ")}`);
    consola.info("Review the config, then run:");
    consola.info("  ghostqa run     # start analysis");
  });
