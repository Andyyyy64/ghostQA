/**
 * Tests for constraint enforcement (Navigator.checkConstraints).
 */
import { describe, it, expect } from "vitest";
import { Navigator } from "../src/explorer/navigator";

// We test checkConstraints indirectly via execute() which calls it before running the action.
// Since execute() needs a real Playwright Page, we test the constraint logic by
// inspecting the error messages thrown. We use a minimal mock page.

function mockPage(url = "http://localhost:3000/page"): any {
  return {
    url: () => url,
    locator: () => ({ first: () => ({ click: async () => {}, fill: async () => {}, hover: async () => {} }) }),
    mouse: { wheel: async () => {} },
    waitForTimeout: async () => {},
    goBack: async () => {},
    goto: async () => {},
    waitForLoadState: () => ({ catch: () => {} }),
  };
}

describe("Navigator constraints", () => {
  it("blocks forbidden selectors", async () => {
    const nav = new Navigator({
      no_payment: false,
      no_delete: false,
      no_external_links: false,
      allowed_domains: [],
      forbidden_selectors: [".admin-panel", "#danger-zone"],
    });

    await expect(
      nav.execute(mockPage(), { action: "click", selector: ".admin-panel button" })
    ).rejects.toThrow("forbidden pattern");

    await expect(
      nav.execute(mockPage(), { action: "click", selector: "#danger-zone" })
    ).rejects.toThrow("forbidden pattern");

    // Allowed selector should not throw
    await nav.execute(mockPage(), { action: "click", selector: ".safe-button" });
  });

  it("does not block payment selectors (enforced via AI prompt, not regex)", async () => {
    const nav = new Navigator({
      no_payment: true,
      no_delete: false,
      no_external_links: false,
      allowed_domains: [],
      forbidden_selectors: [],
    });

    // no_payment is now AI-prompt-enforced, so these should NOT throw
    await nav.execute(mockPage(), { action: "click", selector: "text=Purchase Now" });
    await nav.execute(mockPage(), { action: "click", selector: "[data-action=checkout]" });
    await nav.execute(mockPage(), { action: "click", selector: "text=Submit" });
  });

  it("does not block delete selectors (enforced via AI prompt, not regex)", async () => {
    const nav = new Navigator({
      no_payment: false,
      no_delete: true,
      no_external_links: false,
      allowed_domains: [],
      forbidden_selectors: [],
    });

    // no_delete is now AI-prompt-enforced, so these should NOT throw
    await nav.execute(mockPage(), { action: "click", selector: "text=Delete Account" });
    await nav.execute(mockPage(), { action: "click", selector: ".remove-item" });
  });

  it("blocks external navigation when no_external_links=true", async () => {
    const nav = new Navigator({
      no_payment: false,
      no_delete: false,
      no_external_links: true,
      allowed_domains: [],
      forbidden_selectors: [],
    });

    await expect(
      nav.execute(mockPage("http://localhost:3000/page"), {
        action: "goto",
        url: "http://evil.com/phishing",
      })
    ).rejects.toThrow("external navigation blocked");

    // Same-host navigation should be allowed
    await nav.execute(mockPage("http://localhost:3000/page"), {
      action: "goto",
      url: "http://localhost:3000/other",
    });
  });

  it("restricts to allowed_domains", async () => {
    const nav = new Navigator({
      no_payment: false,
      no_delete: false,
      no_external_links: false,
      allowed_domains: ["localhost", "127.0.0.1"],
      forbidden_selectors: [],
    });

    await expect(
      nav.execute(mockPage(), { action: "goto", url: "http://example.com/page" })
    ).rejects.toThrow("not in allowed_domains");

    // Allowed domain should work
    await nav.execute(mockPage(), { action: "goto", url: "http://localhost:8080/api" });
  });

  it("allows all actions with no constraints", async () => {
    const nav = new Navigator(); // Defaults

    await nav.execute(mockPage(), { action: "click", selector: "text=Delete" });
    await nav.execute(mockPage(), { action: "click", selector: "text=Purchase" });
    await nav.execute(mockPage(), { action: "goto", url: "http://external.com" });
  });
});
