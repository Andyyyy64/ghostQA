import { describe, it, expect } from "vitest";
import { generateReplayTest, type ReplayStep } from "../src/explorer/replay-generator";
import type { Discovery } from "../src/types/discovery";
import { ExplorerConfigSchema } from "../src/types/config";

const APP_URL = "http://localhost:3000";

function makeDiscovery(overrides: Partial<Discovery> = {}): Discovery {
  return {
    id: "d-1",
    source: "explorer",
    severity: "high",
    title: "Button broken",
    description: "Click does nothing",
    url: "http://localhost:3000/",
    timestamp: Date.now(),
    ...overrides,
  };
}

describe("generateReplayTest", () => {
  it("generates a valid Playwright test with click actions", () => {
    const steps: ReplayStep[] = [
      {
        action: { action: "click", selector: 'text="Add Todo"' },
        url: "http://localhost:3000/",
      },
    ];

    const output = generateReplayTest(APP_URL, steps, []);

    expect(output).toContain('import { test, expect } from "@playwright/test"');
    expect(output).toContain("await page.goto(");
    expect(output).toContain(`await page.locator("text=\\"Add Todo\\"").first().click()`);
    expect(output).toContain("no issues discovered");
  });

  it("generates type (fill) actions", () => {
    const steps: ReplayStep[] = [
      {
        action: { action: "type", selector: 'input[placeholder="New todo"]', text: "test item" },
        url: "http://localhost:3000/",
      },
    ];

    const output = generateReplayTest(APP_URL, steps, []);

    expect(output).toContain('.first().fill("test item")');
    expect(output).toContain('input[placeholder=\\"New todo\\"]');
  });

  it("generates scroll actions", () => {
    const steps: ReplayStep[] = [
      {
        action: { action: "scroll", direction: "down", amount: 500 },
        url: "http://localhost:3000/",
      },
      {
        action: { action: "scroll", direction: "up", amount: 200 },
        url: "http://localhost:3000/",
      },
    ];

    const output = generateReplayTest(APP_URL, steps, []);

    expect(output).toContain("await page.mouse.wheel(0, 500)");
    expect(output).toContain("await page.mouse.wheel(0, -200)");
  });

  it("generates goto actions", () => {
    const steps: ReplayStep[] = [
      {
        action: { action: "goto", url: "http://localhost:3000/settings" },
        url: "http://localhost:3000/",
      },
    ];

    const output = generateReplayTest(APP_URL, steps, []);

    expect(output).toContain('await page.goto("http://localhost:3000/settings")');
  });

  it("generates wait actions", () => {
    const steps: ReplayStep[] = [
      {
        action: { action: "wait", duration: 2000 },
        url: "http://localhost:3000/",
      },
    ];

    const output = generateReplayTest(APP_URL, steps, []);

    expect(output).toContain("await page.waitForTimeout(2000)");
  });

  it("generates back actions", () => {
    const steps: ReplayStep[] = [
      {
        action: { action: "back" },
        url: "http://localhost:3000/page2",
      },
    ];

    const output = generateReplayTest(APP_URL, steps, []);

    expect(output).toContain("await page.goBack()");
  });

  it("generates select actions", () => {
    const steps: ReplayStep[] = [
      {
        action: { action: "select", selector: "#priority", text: "high" },
        url: "http://localhost:3000/",
      },
    ];

    const output = generateReplayTest(APP_URL, steps, []);

    expect(output).toContain('.first().selectOption("high")');
  });

  it("generates hover actions", () => {
    const steps: ReplayStep[] = [
      {
        action: { action: "hover", selector: ".menu-item" },
        url: "http://localhost:3000/",
      },
    ];

    const output = generateReplayTest(APP_URL, steps, []);

    expect(output).toContain('.first().hover()');
  });

  it("includes discoveries as comments", () => {
    const steps: ReplayStep[] = [
      {
        action: { action: "click", selector: 'text="Submit"' },
        url: "http://localhost:3000/",
        discovery: { title: "Form crashes on empty input", description: "Clicking submit without data causes a 500 error" },
      },
    ];

    const discoveries = [makeDiscovery({ title: "Form crashes on empty input", description: "Clicking submit without data causes a 500 error" })];

    const output = generateReplayTest(APP_URL, steps, discoveries);

    expect(output).toContain("Discovery: Form crashes on empty input");
    expect(output).toContain("Clicking submit without data causes a 500 error");
    expect(output).toContain("discovered 1 issue");
    // Discovery summary section
    expect(output).toContain("[high] Form crashes on empty input");
  });

  it("handles multiple discoveries", () => {
    const discoveries = [
      makeDiscovery({ title: "Bug A", severity: "critical" }),
      makeDiscovery({ id: "d-2", title: "Bug B", severity: "low" }),
    ];

    const output = generateReplayTest(APP_URL, [], discoveries);

    expect(output).toContain("discovered 2 issues");
    expect(output).toContain("[critical] Bug A");
    expect(output).toContain("[low] Bug B");
  });

  it("handles empty steps array", () => {
    const output = generateReplayTest(APP_URL, [], []);

    expect(output).toContain('import { test, expect } from "@playwright/test"');
    expect(output).toContain("await page.goto(");
    expect(output).toContain("No steps were recorded");
    expect(output).toContain("no issues discovered");
  });

  it("handles multiple steps in sequence", () => {
    const steps: ReplayStep[] = [
      { action: { action: "click", selector: 'text="Login"' }, url: "http://localhost:3000/" },
      { action: { action: "type", selector: "#email", text: "user@test.com" }, url: "http://localhost:3000/login" },
      { action: { action: "type", selector: "#password", text: "password123" }, url: "http://localhost:3000/login" },
      { action: { action: "click", selector: 'text="Sign In"' }, url: "http://localhost:3000/login" },
    ];

    const output = generateReplayTest(APP_URL, steps, []);

    expect(output).toContain("Step 1:");
    expect(output).toContain("Step 2:");
    expect(output).toContain("Step 3:");
    expect(output).toContain("Step 4:");
  });

  it("escapes newlines in discovery descriptions", () => {
    const steps: ReplayStep[] = [
      {
        action: { action: "click", selector: ".btn" },
        url: "http://localhost:3000/",
        discovery: { title: "Multi\nline\ntitle", description: "Line1\nLine2\nLine3" },
      },
    ];

    const output = generateReplayTest(APP_URL, steps, []);

    // Should not contain raw newlines inside comments
    expect(output).not.toMatch(/\/\/ .*\n.*\n.*title/);
    expect(output).toContain("Multi line title");
  });
});

describe("ExplorerConfigSchema emit_replay", () => {
  it("defaults emit_replay to false", () => {
    const config = ExplorerConfigSchema.parse({});
    expect(config.emit_replay).toBe(false);
  });

  it("accepts emit_replay: true", () => {
    const config = ExplorerConfigSchema.parse({ emit_replay: true });
    expect(config.emit_replay).toBe(true);
  });
});
