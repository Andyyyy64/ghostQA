import { execa, type ResultPromise } from "execa";
import consola from "consola";

export interface DesktopEnvironmentConfig {
  display: string;
  appCommand: string;
  windowName?: string;
  windowTimeout: number;
}

/**
 * Manages a desktop application lifecycle inside an Xvfb environment.
 * Handles: app launch, window detection, screenshot capture, process log collection.
 */
export class DesktopEnvironment {
  private appProcess: ResultPromise | null = null;
  private stderrLogs: string[] = [];
  private stdoutLogs: string[] = [];

  constructor(private config: DesktopEnvironmentConfig) {}

  get display(): string {
    return this.config.display;
  }

  /** Launch the desktop application */
  async launchApp(cwd: string): Promise<void> {
    const env = { ...process.env, DISPLAY: this.config.display };
    const [cmd, ...args] = this.config.appCommand.split(/\s+/);

    consola.info(`Launching desktop app: ${this.config.appCommand} (DISPLAY=${this.config.display})`);

    this.appProcess = execa(cmd, args, {
      cwd,
      env,
      reject: false,
      stdio: ["ignore", "pipe", "pipe"],
    });

    // Collect stdout/stderr for error detection
    this.appProcess.stdout?.on("data", (chunk: Buffer) => {
      const line = chunk.toString().trim();
      if (line) {
        this.stdoutLogs.push(`[stdout] ${line}`);
        // Keep last 200 lines
        if (this.stdoutLogs.length > 200) this.stdoutLogs.shift();
      }
    });

    this.appProcess.stderr?.on("data", (chunk: Buffer) => {
      const line = chunk.toString().trim();
      if (line) {
        this.stderrLogs.push(`[stderr] ${line}`);
        if (this.stderrLogs.length > 200) this.stderrLogs.shift();
      }
    });

    // Don't await — app runs in background
    this.appProcess.catch(() => {});
  }

  /** Wait for a window matching the expected name to appear */
  async waitForWindow(): Promise<string> {
    const deadline = Date.now() + this.config.windowTimeout;
    const windowName = this.config.windowName;
    const env = { ...process.env, DISPLAY: this.config.display };

    consola.info(`Waiting for window${windowName ? ` "${windowName}"` : ""}...`);

    while (Date.now() < deadline) {
      try {
        const searchArgs = windowName
          ? ["search", "--name", windowName]
          : ["search", "--onlyvisible", "--name", ""];
        const result = await execa("xdotool", searchArgs, { env, reject: false });

        if (result.stdout.trim()) {
          const windowId = result.stdout.trim().split("\n")[0];
          consola.info(`Window found: ${windowId}`);
          return windowId;
        }
      } catch {
        // xdotool not found or other error
      }

      await new Promise((r) => setTimeout(r, 500));
    }

    throw new Error(
      `Window not found within ${this.config.windowTimeout}ms${windowName ? ` (searching for "${windowName}")` : ""}`
    );
  }

  /** Check if the application window still exists */
  async isWindowAlive(): Promise<boolean> {
    const env = { ...process.env, DISPLAY: this.config.display };
    const searchArgs = this.config.windowName
      ? ["search", "--name", this.config.windowName]
      : ["search", "--onlyvisible", "--name", ""];

    try {
      const result = await execa("xdotool", searchArgs, { env, reject: false });
      return result.stdout.trim().length > 0;
    } catch {
      return false;
    }
  }

  /** Get the active window title */
  async getActiveWindowTitle(): Promise<string> {
    const env = { ...process.env, DISPLAY: this.config.display };
    try {
      const result = await execa("xdotool", ["getactivewindow", "getwindowname"], {
        env,
        reject: false,
      });
      return result.stdout.trim() || "(unknown)";
    } catch {
      return "(unknown)";
    }
  }

  /** Take a screenshot using scrot */
  async screenshot(outputPath: string): Promise<void> {
    const env = { ...process.env, DISPLAY: this.config.display };
    await execa("scrot", [outputPath], { env });
  }

  /** Take a screenshot and return as base64 */
  async screenshotBase64(): Promise<string> {
    const { join } = await import("node:path");
    const { readFile, rm } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");

    const tmpPath = join(tmpdir(), `ghostqa-scrot-${Date.now()}.png`);
    const env = { ...process.env, DISPLAY: this.config.display };
    await execa("scrot", [tmpPath], { env });
    try {
      const buf = await readFile(tmpPath);
      return buf.toString("base64");
    } finally {
      await rm(tmpPath, { force: true }).catch(() => {});
    }
  }

  /** Get recent process logs (stdout + stderr) and clear the buffer */
  drainLogs(): string[] {
    const logs = [...this.stdoutLogs, ...this.stderrLogs];
    this.stdoutLogs = [];
    this.stderrLogs = [];
    return logs;
  }

  /** Stop the application */
  async stop(): Promise<void> {
    if (this.appProcess) {
      consola.info("Stopping desktop application...");
      this.appProcess.kill("SIGTERM");
      // Give it 5 seconds to exit gracefully
      const timeout = setTimeout(() => {
        this.appProcess?.kill("SIGKILL");
      }, 5000);
      try {
        await this.appProcess;
      } catch {
        // Expected — process was killed
      }
      clearTimeout(timeout);
      this.appProcess = null;
    }
  }

  /** Build xdotool command for a desktop action */
  static buildXdotoolCommand(
    action: string,
    coordinate?: [number, number],
    text?: string
  ): string[][] {
    const commands: string[][] = [];

    switch (action) {
      case "left_click":
        if (!coordinate) throw new Error("left_click requires coordinate");
        commands.push(["mousemove", "--sync", String(coordinate[0]), String(coordinate[1])]);
        commands.push(["click", "1"]);
        break;

      case "right_click":
        if (!coordinate) throw new Error("right_click requires coordinate");
        commands.push(["mousemove", "--sync", String(coordinate[0]), String(coordinate[1])]);
        commands.push(["click", "3"]);
        break;

      case "double_click":
        if (!coordinate) throw new Error("double_click requires coordinate");
        commands.push(["mousemove", "--sync", String(coordinate[0]), String(coordinate[1])]);
        commands.push(["click", "--repeat", "2", "--delay", "50", "1"]);
        break;

      case "type":
        if (!text) throw new Error("type requires text");
        commands.push(["type", "--clearmodifiers", "--delay", "12", text]);
        break;

      case "key":
        if (!text) throw new Error("key requires text (key combo)");
        commands.push(["key", "--clearmodifiers", text]);
        break;

      case "scroll":
        // Default: scroll down 3 clicks
        if (coordinate) {
          commands.push(["mousemove", "--sync", String(coordinate[0]), String(coordinate[1])]);
        }
        commands.push(["click", "--repeat", "3", "5"]); // button5 = scroll down
        break;

      default:
        throw new Error(`Unknown desktop action: ${action}`);
    }

    return commands;
  }
}
