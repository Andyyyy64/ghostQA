import { Command } from "commander";
import consola from "consola";
import { loadConfig, configExists } from "@ghostqa/core";

export const recordCommand = new Command("record")
  .description("Record a manual browser session for replay")
  .option("-u, --url <url>", "URL to open")
  .option("-c, --config <path>", "Config file path")
  .action(async (opts) => {
    const cwd = process.cwd();

    let url = opts.url;
    if (!url) {
      if (await configExists(cwd)) {
        const config = await loadConfig(cwd, opts.config);
        url = config.app.url;
      } else {
        url = "http://localhost:3000";
      }
    }

    consola.info(`Recording session at ${url}`);
    consola.info("Interact with the browser. Close it when done.");

    // Dynamic import to avoid breaking CLI when playwright isn't installed
    const { chromium } = await import("playwright");

    const browser = await chromium.launch({ headless: false });
    const context = await browser.newContext({
      recordVideo: { dir: ".ghostqa-recordings" },
    });
    const page = await context.newPage();

    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });

    // Wait for browser to close
    await new Promise<void>((resolve) => {
      browser.on("disconnected", () => resolve());
    });

    consola.success("Recording saved to .ghostqa-recordings/");
  });
