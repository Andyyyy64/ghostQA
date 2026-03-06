import { Command } from "commander";
import consola from "consola";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

export const replayCommand = new Command("replay")
  .description("Run a previously generated replay test")
  .argument("<path>", "Path to replay.spec.ts file")
  .action(async (path: string) => {
    const specPath = resolve(process.cwd(), path);
    consola.info(`Running replay: ${specPath}`);

    const result = spawnSync("npx", ["playwright", "test", specPath], {
      stdio: "inherit",
      cwd: process.cwd(),
    });

    process.exit(result.status ?? 1);
  });
