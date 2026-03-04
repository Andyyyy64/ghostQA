import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { IObserver, DisplayState } from "./types";
import type { DesktopEnvironment } from "./desktop-environment";

/**
 * DesktopObserver — IObserver implementation for desktop applications.
 * Uses scrot for screenshots and collects process stdout/stderr as logs.
 */
export class DesktopObserver implements IObserver {
  private screenshotCount = 0;
  private listening = false;

  constructor(
    private env: DesktopEnvironment,
    private outputDir: string,
    private viewport: { width: number; height: number }
  ) {}

  startListening(): void {
    // Process log collection is always active via DesktopEnvironment
    this.listening = true;
  }

  async observe(): Promise<DisplayState> {
    const [title, screenshotBase64, windowAlive] = await Promise.all([
      this.env.getActiveWindowTitle(),
      this.env.screenshotBase64(),
      this.env.isWindowAlive(),
    ]);

    const logs = this.env.drainLogs();

    // If window disappeared, add a synthetic log
    if (!windowAlive) {
      logs.push("[stderr] Window disappeared — possible crash");
    }

    return {
      identifier: title,
      title,
      axTree: "", // No AX tree in desktop mode
      screenshotBase64,
      logs,
      timestamp: Date.now(),
      displaySize: this.viewport,
    };
  }

  async screenshot(label?: string): Promise<string> {
    this.screenshotCount++;
    const name = label
      ? `${this.screenshotCount}-${label}.png`
      : `${this.screenshotCount}.png`;
    const path = join(this.outputDir, "screenshots", name);
    await this.env.screenshot(path);
    return path;
  }

  async screenshotBase64(): Promise<string> {
    return this.env.screenshotBase64();
  }
}
