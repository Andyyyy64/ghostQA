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
      const snapshot = await page.accessibility.snapshot();
      if (!snapshot) return "(empty accessibility tree)";
      return this.formatAxNode(snapshot, 0);
    } catch {
      return "(failed to get accessibility tree)";
    }
  }

  private formatAxNode(
    node: {
      role: string;
      name: string;
      children?: Array<{ role: string; name: string; children?: unknown[] }>;
      [key: string]: unknown;
    },
    depth: number
  ): string {
    const indent = "  ".repeat(depth);
    let line = `${indent}[${node.role}] "${node.name}"`;

    if (node.value) line += ` value="${node.value}"`;
    if (node.checked !== undefined) line += ` checked=${node.checked}`;
    if (node.disabled) line += ` disabled`;

    const lines = [line];
    if (node.children) {
      for (const child of node.children) {
        lines.push(
          this.formatAxNode(child as Parameters<typeof this.formatAxNode>[0], depth + 1)
        );
      }
    }
    return lines.join("\n");
  }
}
