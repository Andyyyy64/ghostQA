import type { Page } from "playwright";
import consola from "consola";
import type { GhostQAConfig } from "../types/config";

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
  private constraints: GhostQAConfig["constraints"];

  constructor(constraints?: GhostQAConfig["constraints"]) {
    this.constraints = constraints ?? {
      no_payment: false,
      no_delete: false,
      no_external_links: false,
      allowed_domains: [],
      forbidden_selectors: [],
    };
  }

  async execute(page: Page, action: BrowserAction): Promise<void> {
    this.checkConstraints(page, action);
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

  private checkConstraints(page: Page, action: BrowserAction): void {
    const c = this.constraints;

    // Check forbidden selectors
    if (action.selector && c.forbidden_selectors.length > 0) {
      for (const fs of c.forbidden_selectors) {
        if (action.selector.includes(fs)) {
          throw new Error(`Constraint: selector "${action.selector}" matches forbidden pattern "${fs}"`);
        }
      }
    }

    // Check payment-related actions
    if (c.no_payment && action.selector) {
      const lower = action.selector.toLowerCase();
      if (/pay|purchase|buy|checkout|subscribe|billing/i.test(lower)) {
        throw new Error(`Constraint: payment action blocked (no_payment=true): "${action.selector}"`);
      }
    }

    // Check delete-related actions
    if (c.no_delete && action.selector) {
      const lower = action.selector.toLowerCase();
      if (/delete|remove|destroy|drop/i.test(lower)) {
        throw new Error(`Constraint: delete action blocked (no_delete=true): "${action.selector}"`);
      }
    }

    // Check domain constraints for goto actions
    if (action.action === "goto" && action.url) {
      if (c.no_external_links) {
        const currentHost = new URL(page.url()).hostname;
        const targetHost = new URL(action.url).hostname;
        if (targetHost !== currentHost) {
          throw new Error(`Constraint: external navigation blocked (no_external_links=true): "${action.url}"`);
        }
      }
      if (c.allowed_domains.length > 0) {
        const targetHost = new URL(action.url).hostname;
        if (!c.allowed_domains.includes(targetHost)) {
          throw new Error(`Constraint: domain "${targetHost}" not in allowed_domains: [${c.allowed_domains.join(", ")}]`);
        }
      }
    }
  }
}
