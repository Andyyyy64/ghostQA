import { Command } from "commander";
import consola from "consola";
import open from "open";
import { readdir, stat } from "node:fs/promises";
import { resolve, join } from "node:path";

export const viewCommand = new Command("view")
  .description("Open the latest HTML report in your browser")
  .option("-r, --run <id>", "Specific run ID to view")
  .option(
    "-d, --dir <path>",
    "Output directory",
    ".ghostqa-runs"
  )
  .action(async (opts) => {
    const cwd = process.cwd();
    const outputDir = resolve(cwd, opts.dir);

    try {
      let reportPath: string;

      if (opts.run) {
        reportPath = join(outputDir, opts.run, "report.html");
      } else {
        const entries = await readdir(outputDir);
        const dirs = [];
        for (const entry of entries) {
          const s = await stat(join(outputDir, entry));
          if (s.isDirectory()) {
            dirs.push({ name: entry, mtime: s.mtimeMs });
          }
        }
        dirs.sort((a, b) => b.mtime - a.mtime);

        if (dirs.length === 0) {
          consola.error("No runs found. Run 'ghostqa run' first.");
          process.exit(1);
        }

        reportPath = join(outputDir, dirs[0].name, "report.html");
      }

      consola.info(`Opening ${reportPath}`);
      await open(reportPath);
    } catch (err) {
      consola.error(
        `Failed to open report: ${err instanceof Error ? err.message : String(err)}`
      );
      process.exit(1);
    }
  });
