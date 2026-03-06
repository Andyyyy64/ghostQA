import { execa, type ResultPromise } from "execa";
import consola from "consola";
import type { AppConfig } from "../types/config";

export class AppRunner {
  private process: ResultPromise | null = null;

  constructor(private config: AppConfig) {}

  async build(cwd: string): Promise<void> {
    consola.info(`Building: ${this.config.build}`);
    await execa(this.config.build, {
      cwd,
      shell: true,
      stdio: "pipe",
      env: { ...process.env, NODE_ENV: "production" },
    });
    consola.success("Build complete");
  }

  async start(cwd: string): Promise<void> {
    consola.info(`Starting: ${this.config.start}`);
    this.process = execa(this.config.start, {
      cwd,
      shell: true,
      stdio: "pipe",
      env: { ...process.env },
      detached: true,
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
      const pid = this.process.pid;
      // Kill entire process group (shell + children like vite/node)
      try {
        if (pid) process.kill(-pid, "SIGTERM");
      } catch {
        this.process.kill("SIGTERM");
      }
      try {
        await Promise.race([
          this.process,
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error("Kill timeout")), 5000)
          ),
        ]);
      } catch {
        // Timeout or process killed — force kill the group
        try {
          if (pid) process.kill(-pid, "SIGKILL");
        } catch {}
        try {
          this.process.kill("SIGKILL");
        } catch {}
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
