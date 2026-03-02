import type { Page } from "playwright";
import consola from "consola";

export type ActionType =
  | "click"
  | "type"
  | "scroll"
  | "wait"
  | "back"
  | "goto"
  | "select"
  | "hover";

export interface BrowserAction {
  action: ActionType;
  selector?: string;
  text?: string;
  url?: string;
  direction?: "up" | "down";
  amount?: number;
  duration?: number;
}

export class Navigator {
  async execute(page: Page, action: BrowserAction): Promise<void> {
    consola.debug(`Action: ${action.action} ${action.selector ?? action.url ?? ""}`);

    switch (action.action) {
      case "click":
        if (!action.selector) throw new Error("click requires selector");
        await page.locator(action.selector).first().click({ timeout: 5000 });
        break;

      case "type":
        if (!action.selector || !action.text)
          throw new Error("type requires selector and text");
        await page.locator(action.selector).first().fill(action.text);
        break;

      case "scroll":
        await page.mouse.wheel(
          0,
          action.direction === "up"
            ? -(action.amount ?? 300)
            : (action.amount ?? 300)
        );
        break;

      case "wait":
        await page.waitForTimeout(action.duration ?? 1000);
        break;

      case "back":
        await page.goBack({ timeout: 5000 });
        break;

      case "goto":
        if (!action.url) throw new Error("goto requires url");
        await page.goto(action.url, { timeout: 10000, waitUntil: "domcontentloaded" });
        break;

      case "select":
        if (!action.selector || !action.text)
          throw new Error("select requires selector and text");
        await page.locator(action.selector).first().selectOption(action.text);
        break;

      case "hover":
        if (!action.selector) throw new Error("hover requires selector");
        await page.locator(action.selector).first().hover();
        break;

      default:
        throw new Error(`Unknown action: ${action.action}`);
    }

    // Wait for any navigation/rendering
    await page.waitForLoadState("domcontentloaded").catch(() => {});
    await page.waitForTimeout(300);
  }
}
