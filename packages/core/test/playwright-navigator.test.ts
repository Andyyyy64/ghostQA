import { describe, it, expect, vi } from "vitest";
import { PlaywrightNavigator } from "../src/explorer/playwright-navigator";
import type { WebAction, DesktopAction } from "../src/explorer/types";

function mockPage(url = "http://localhost:3000/page"): any {
  return {
    url: () => url,
    locator: vi.fn().mockReturnValue({
      first: vi.fn().mockReturnValue({
        click: vi.fn().mockResolvedValue(undefined),
        fill: vi.fn().mockResolvedValue(undefined),
        hover: vi.fn().mockResolvedValue(undefined),
        selectOption: vi.fn().mockResolvedValue(undefined),
      }),
    }),
    mouse: { wheel: vi.fn().mockResolvedValue(undefined) },
    waitForTimeout: vi.fn().mockResolvedValue(undefined),
    goBack: vi.fn().mockResolvedValue(undefined),
    goto: vi.fn().mockResolvedValue(undefined),
    waitForLoadState: vi.fn().mockReturnValue({ catch: () => {} }),
  };
}

function webAction(overrides: Partial<WebAction> = {}): WebAction {
  return { kind: "web", action: "click", selector: ".btn", ...overrides };
}

describe("PlaywrightNavigator", () => {
  describe("action dispatch", () => {
    it("throws on desktop actions", async () => {
      const page = mockPage();
      const nav = new PlaywrightNavigator(page);
      const desktopAction: DesktopAction = {
        kind: "desktop",
        action: "left_click",
        coordinate: [100, 200],
      };

      await expect(nav.execute(desktopAction)).rejects.toThrow(
        "cannot execute desktop actions"
      );
    });

    it("click: calls locator().first().click()", async () => {
      const page = mockPage();
      const nav = new PlaywrightNavigator(page);

      await nav.execute(webAction({ action: "click", selector: "text=Submit" }));

      expect(page.locator).toHaveBeenCalledWith("text=Submit");
      const locatorResult = page.locator.mock.results[0].value;
      expect(locatorResult.first).toHaveBeenCalled();
    });

    it("type: calls locator().first().fill()", async () => {
      const page = mockPage();
      const nav = new PlaywrightNavigator(page);

      await nav.execute(
        webAction({ action: "type", selector: "#email", text: "test@example.com" })
      );

      expect(page.locator).toHaveBeenCalledWith("#email");
    });

    it("scroll down: calls mouse.wheel with positive deltaY", async () => {
      const page = mockPage();
      const nav = new PlaywrightNavigator(page);

      await nav.execute(
        webAction({ action: "scroll", direction: "down", amount: 500 })
      );

      expect(page.mouse.wheel).toHaveBeenCalledWith(0, 500);
    });

    it("scroll up: calls mouse.wheel with negative deltaY", async () => {
      const page = mockPage();
      const nav = new PlaywrightNavigator(page);

      await nav.execute(
        webAction({ action: "scroll", direction: "up", amount: 300 })
      );

      expect(page.mouse.wheel).toHaveBeenCalledWith(0, -300);
    });

    it("goto: calls page.goto()", async () => {
      const page = mockPage();
      const nav = new PlaywrightNavigator(page);

      await nav.execute(
        webAction({ action: "goto", url: "http://localhost:3000/about" })
      );

      expect(page.goto).toHaveBeenCalledWith(
        "http://localhost:3000/about",
        expect.any(Object)
      );
    });
  });

  describe("constraints", () => {
    it("blocks forbidden_selectors", async () => {
      const page = mockPage();
      const nav = new PlaywrightNavigator(page, {
        no_payment: false,
        no_delete: false,
        no_external_links: false,
        allowed_domains: [],
        forbidden_selectors: [".admin-panel"],
      });

      await expect(
        nav.execute(webAction({ selector: ".admin-panel .btn" }))
      ).rejects.toThrow("forbidden pattern");
    });

    it("allows non-forbidden selectors", async () => {
      const page = mockPage();
      const nav = new PlaywrightNavigator(page, {
        no_payment: false,
        no_delete: false,
        no_external_links: false,
        allowed_domains: [],
        forbidden_selectors: [".admin-panel"],
      });

      await nav.execute(webAction({ selector: ".safe-btn" }));
      // Should not throw
    });

    it("blocks external navigation when no_external_links=true", async () => {
      const page = mockPage("http://localhost:3000/");
      const nav = new PlaywrightNavigator(page, {
        no_payment: false,
        no_delete: false,
        no_external_links: true,
        allowed_domains: [],
        forbidden_selectors: [],
      });

      await expect(
        nav.execute(webAction({ action: "goto", url: "http://evil.com/" }))
      ).rejects.toThrow("external navigation blocked");
    });

    it("allows same-host navigation when no_external_links=true", async () => {
      const page = mockPage("http://localhost:3000/");
      const nav = new PlaywrightNavigator(page, {
        no_payment: false,
        no_delete: false,
        no_external_links: true,
        allowed_domains: [],
        forbidden_selectors: [],
      });

      await nav.execute(
        webAction({ action: "goto", url: "http://localhost:3000/other" })
      );
    });

    it("blocks domains not in allowed_domains", async () => {
      const page = mockPage();
      const nav = new PlaywrightNavigator(page, {
        no_payment: false,
        no_delete: false,
        no_external_links: false,
        allowed_domains: ["localhost"],
        forbidden_selectors: [],
      });

      await expect(
        nav.execute(
          webAction({ action: "goto", url: "http://example.com/page" })
        )
      ).rejects.toThrow("not in allowed_domains");
    });

    it("allows domains in allowed_domains", async () => {
      const page = mockPage();
      const nav = new PlaywrightNavigator(page, {
        no_payment: false,
        no_delete: false,
        no_external_links: false,
        allowed_domains: ["localhost", "127.0.0.1"],
        forbidden_selectors: [],
      });

      await nav.execute(
        webAction({ action: "goto", url: "http://localhost:8080/api" })
      );
    });
  });
});
