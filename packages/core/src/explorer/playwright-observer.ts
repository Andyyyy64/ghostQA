import type { Page } from "playwright";
import type { Recorder } from "../recorder/recorder";
import type { IObserver, DisplayState } from "./types";

/**
 * PlaywrightObserver — IObserver implementation wrapping the existing Observer logic.
 * Uses Playwright's AX tree + screenshot for page state observation.
 */
export class PlaywrightObserver implements IObserver {
  private consoleLogs: string[] = [];
  private listening = false;

  constructor(
    private page: Page,
    private recorder: Recorder,
    private viewport: { width: number; height: number }
  ) {}

  startListening(): void {
    if (this.listening) return;
    this.listening = true;

    this.page.on("console", (msg) => {
      this.consoleLogs.push(`[${msg.type()}] ${msg.text()}`);
    });
    this.page.on("pageerror", (err) => {
      this.consoleLogs.push(`[pageerror] ${err.message}`);
    });
  }

  async observe(): Promise<DisplayState> {
    const [url, title, axTree, screenshotBase64] = await Promise.all([
      this.page.url(),
      this.page.title(),
      this.getAxTree(),
      this.recorder.screenshotBase64(this.page),
    ]);

    const logs = [...this.consoleLogs];
    this.consoleLogs = [];

    return {
      identifier: url,
      title,
      axTree,
      screenshotBase64,
      logs,
      timestamp: Date.now(),
      displaySize: this.viewport,
    };
  }

  async screenshot(label?: string): Promise<string> {
    return this.recorder.screenshot(this.page, label);
  }

  async screenshotBase64(): Promise<string> {
    return this.recorder.screenshotBase64(this.page);
  }

  private async getAxTree(): Promise<string> {
    try {
      const snapshot = await this.page.locator(":root").ariaSnapshot();
      return snapshot || "(empty accessibility tree)";
    } catch {
      return "(failed to get accessibility tree)";
    }
  }
}
