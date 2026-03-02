import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { Page, BrowserContext } from "playwright";
import consola from "consola";
import type { ReporterConfig } from "../types/config";

export class Recorder {
  private runDir: string;
  private screenshotCount = 0;

  constructor(
    private config: ReporterConfig,
    private runId: string
  ) {
    this.runDir = join(config.output_dir, runId);
  }

  get outputDir(): string {
    return this.runDir;
  }

  async init(): Promise<void> {
    await mkdir(join(this.runDir, "screenshots"), { recursive: true });
    await mkdir(join(this.runDir, "videos"), { recursive: true });
    await mkdir(join(this.runDir, "traces"), { recursive: true });
    consola.debug(`Recorder output: ${this.runDir}`);
  }

  contextOptions(): {
    recordVideo?: { dir: string; size?: { width: number; height: number } };
    recordHar?: { path: string };
  } {
    const opts: ReturnType<Recorder["contextOptions"]> = {};

    if (this.config.video) {
      opts.recordVideo = {
        dir: join(this.runDir, "videos"),
        size: { width: 1280, height: 720 },
      };
    }

    return opts;
  }

  async screenshot(page: Page, label?: string): Promise<string> {
    this.screenshotCount++;
    const name = label
      ? `${this.screenshotCount}-${label}.png`
      : `${this.screenshotCount}.png`;
    const path = join(this.runDir, "screenshots", name);
    await page.screenshot({ path, fullPage: false });
    return path;
  }

  async screenshotBase64(page: Page): Promise<string> {
    const buffer = await page.screenshot({ fullPage: false });
    return buffer.toString("base64");
  }

  async collectConsoleLogs(page: Page): Promise<string[]> {
    const logs: string[] = [];
    page.on("console", (msg) => {
      logs.push(`[${msg.type()}] ${msg.text()}`);
    });
    page.on("pageerror", (err) => {
      logs.push(`[error] ${err.message}`);
    });
    return logs;
  }

  async saveHar(context: BrowserContext): Promise<void> {
    // HAR is saved automatically via context options
    consola.debug("HAR recording saved");
  }
}
