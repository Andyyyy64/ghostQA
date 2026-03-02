import { execa, type ResultPromise } from "execa";
import consola from "consola";
import type { AppConfig } from "../types/config";

export class AppRunner {
  private process: ResultPromise | null = null;

  constructor(private config: AppConfig) {}

  async build(cwd: string): Promise<void> {
    consola.info(`Building: ${this.config.build}`);
    const [cmd, ...args] = this.config.build.split(/\s+/);
    await execa(cmd, args, {
      cwd,
      stdio: "pipe",
      env: { ...process.env, NODE_ENV: "production" },
    });
    consola.success("Build complete");
  }

  async start(cwd: string): Promise<void> {
    consola.info(`Starting: ${this.config.start}`);
    const [cmd, ...args] = this.config.start.split(/\s+/);
    this.process = execa(cmd, args, {
      cwd,
      stdio: "pipe",
      env: { ...process.env },
      detached: false,
    });

    // Don't await — the process should keep running
    this.process.catch(() => {
      // Process exited, that's expected during cleanup
    });

    await this.waitForHealthy();
    consola.success(`App running at ${this.config.url}`);
  }

  async stop(): Promise<void> {
    if (this.process) {
      consola.info("Stopping app...");
      this.process.kill("SIGTERM");
      try {
        await this.process;
      } catch {
        // Process killed, expected
      }
      this.process = null;
    }
  }

  private async waitForHealthy(): Promise<void> {
    const { timeout, interval, path } = this.config.healthcheck;
    const url = new URL(path, this.config.url).href;
    const deadline = Date.now() + timeout;

    consola.info(`Waiting for healthcheck: ${url}`);

    while (Date.now() < deadline) {
      try {
        const response = await fetch(url);
        if (response.ok) return;
      } catch {
        // Not ready yet
      }
      await sleep(interval);
    }

    throw new Error(
      `Healthcheck failed: ${url} did not respond within ${timeout}ms`
    );
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
