import type { Page } from "playwright";
import type { Recorder } from "../recorder/recorder";

export interface PageState {
  url: string;
  title: string;
  axTree: string;
  screenshotBase64: string;
  consoleLogs: string[];
  timestamp: number;
}

export class Observer {
  private consoleLogs: string[] = [];
  private listening = false;

  constructor(private recorder: Recorder) {}

  startListening(page: Page): void {
    if (this.listening) return;
    this.listening = true;

    page.on("console", (msg) => {
      this.consoleLogs.push(`[${msg.type()}] ${msg.text()}`);
    });
    page.on("pageerror", (err) => {
      this.consoleLogs.push(`[pageerror] ${err.message}`);
    });
  }

  async observe(page: Page): Promise<PageState> {
    const [url, title, axTree, screenshotBase64] = await Promise.all([
      page.url(),
      page.title(),
      this.getAxTree(page),
      this.recorder.screenshotBase64(page),
    ]);

    const logs = [...this.consoleLogs];
    this.consoleLogs = [];

    return {
      url,
      title,
      axTree,
      screenshotBase64,
      consoleLogs: logs,
      timestamp: Date.now(),
    };
  }

  private async getAxTree(page: Page): Promise<string> {
    try {
      // Playwright 1.49+ uses ariaSnapshot() instead of deprecated accessibility.snapshot()
      const snapshot = await page.locator(":root").ariaSnapshot();
      return snapshot || "(empty accessibility tree)";
    } catch {
      return "(failed to get accessibility tree)";
    }
  }
}
