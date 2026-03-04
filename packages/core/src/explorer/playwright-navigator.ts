import type { Page } from "playwright";
import consola from "consola";
import type { GhostQAConfig } from "../types/config";
import type { INavigator, ExplorerAction, WebAction } from "./types";

/**
 * PlaywrightNavigator — INavigator implementation wrapping the existing Navigator logic.
 * Uses Playwright CSS/text selectors for element interaction.
 */
export class PlaywrightNavigator implements INavigator {
  private constraints: GhostQAConfig["constraints"];

  constructor(
    private page: Page,
    constraints?: GhostQAConfig["constraints"]
  ) {
    this.constraints = constraints ?? {
      no_payment: false,
      no_delete: false,
      no_external_links: false,
      allowed_domains: [],
      forbidden_selectors: [],
    };
  }

  async execute(action: ExplorerAction): Promise<void> {
    if (action.kind !== "web") {
      throw new Error(`PlaywrightNavigator cannot execute desktop actions`);
    }
    this.checkConstraints(action);
    consola.debug(`Action: ${action.action} ${action.selector ?? action.url ?? ""}`);

    switch (action.action) {
      case "click":
        if (!action.selector) throw new Error("click requires selector");
        await this.page.locator(action.selector).first().click({ timeout: 5000 });
        break;

      case "type":
        if (!action.selector || !action.text)
          throw new Error("type requires selector and text");
        await this.page.locator(action.selector).first().fill(action.text);
        break;

      case "scroll":
        await this.page.mouse.wheel(
          0,
          action.direction === "up"
            ? -(action.amount ?? 300)
            : (action.amount ?? 300)
        );
        break;

      case "wait":
        await this.page.waitForTimeout(action.duration ?? 1000);
        break;

      case "back":
        await this.page.goBack({ timeout: 5000 });
        break;

      case "goto":
        if (!action.url) throw new Error("goto requires url");
        await this.page.goto(action.url, { timeout: 10000, waitUntil: "domcontentloaded" });
        break;

      case "select":
        if (!action.selector || !action.text)
          throw new Error("select requires selector and text");
        await this.page.locator(action.selector).first().selectOption(action.text);
        break;

      case "hover":
        if (!action.selector) throw new Error("hover requires selector");
        await this.page.locator(action.selector).first().hover();
        break;

      default:
        throw new Error(`Unknown action: ${(action as WebAction).action}`);
    }

    await this.page.waitForLoadState("domcontentloaded").catch(() => {});
    await this.page.waitForTimeout(300);
  }

  async navigateToTarget(target: string): Promise<void> {
    await this.page.goto(target, {
      waitUntil: "domcontentloaded",
      timeout: 10000,
    });
  }

  async dispose(): Promise<void> {
    // Playwright page lifecycle is managed externally
  }

  private checkConstraints(action: WebAction): void {
    const c = this.constraints;

    if (action.selector && c.forbidden_selectors.length > 0) {
      for (const fs of c.forbidden_selectors) {
        if (action.selector.includes(fs)) {
          throw new Error(`Constraint: selector "${action.selector}" matches forbidden pattern "${fs}"`);
        }
      }
    }

    if (c.no_payment && action.selector) {
      if (/pay|purchase|buy|checkout|subscribe|billing/i.test(action.selector)) {
        throw new Error(`Constraint: payment action blocked (no_payment=true): "${action.selector}"`);
      }
    }

    if (c.no_delete && action.selector) {
      if (/delete|remove|destroy|drop/i.test(action.selector)) {
        throw new Error(`Constraint: delete action blocked (no_delete=true): "${action.selector}"`);
      }
    }

    if (action.action === "goto" && action.url) {
      if (c.no_external_links) {
        const currentHost = new URL(this.page.url()).hostname;
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
