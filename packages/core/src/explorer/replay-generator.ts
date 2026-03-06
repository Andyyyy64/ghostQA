import type { BrowserAction } from "./navigator";
import type { Discovery } from "../types/discovery";

export interface ReplayStep {
  action: BrowserAction;
  url: string;
  discovery?: { title: string; description: string } | null;
}

/**
 * Generate a Playwright test file from explorer steps and discoveries.
 *
 * The output is a self-contained `@playwright/test` spec that replays
 * the same actions the AI explorer performed during its run.
 * Discoveries are emitted as commented-out assertions so developers
 * can review and uncomment/adjust them.
 */
export function generateReplayTest(
  appUrl: string,
  steps: ReplayStep[],
  discoveries: Discovery[]
): string {
  const lines: string[] = [];

  lines.push('import { test, expect } from "@playwright/test";');
  lines.push("");

  const discoveryCount = discoveries.length;
  const testTitle =
    discoveryCount > 0
      ? `ghostQA replay — discovered ${discoveryCount} issue${discoveryCount === 1 ? "" : "s"}`
      : "ghostQA replay — no issues discovered";

  lines.push(`test("${testTitle}", async ({ page }) => {`);
  lines.push(`  await page.goto(${JSON.stringify(appUrl)});`);

  if (steps.length === 0) {
    lines.push("");
    lines.push("  // No steps were recorded during exploration.");
  }

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const stepNum = i + 1;
    lines.push("");

    // If this step has a discovery, emit it as a comment block
    if (step.discovery) {
      lines.push(`  // --- Discovery: ${escapeComment(step.discovery.title)} ---`);
      lines.push(`  // ${escapeComment(step.discovery.description)}`);
    }

    lines.push(`  // Step ${stepNum}: ${describeAction(step.action)}`);
    lines.push(`  ${generateActionCode(step.action)}`);
  }

  // Append discovery summaries at the bottom as reference comments
  if (discoveries.length > 0) {
    lines.push("");
    lines.push("  // ==========================================");
    lines.push("  // Discoveries found during AI exploration:");
    for (const d of discoveries) {
      lines.push(`  // [${d.severity}] ${escapeComment(d.title)}`);
      lines.push(`  //   ${escapeComment(d.description)}`);
    }
    lines.push("  // ==========================================");
  }

  lines.push("});");
  lines.push("");

  return lines.join("\n");
}

function describeAction(action: BrowserAction): string {
  switch (action.action) {
    case "click":
      return `Click ${action.selector ?? "element"}`;
    case "type":
      return `Type "${action.text ?? ""}" into ${action.selector ?? "input"}`;
    case "scroll":
      return `Scroll ${action.direction ?? "down"}`;
    case "wait":
      return `Wait ${action.duration ?? 1000}ms`;
    case "back":
      return "Go back";
    case "goto":
      return `Navigate to ${action.url ?? "page"}`;
    case "select":
      return `Select "${action.text ?? ""}" in ${action.selector ?? "select"}`;
    case "hover":
      return `Hover over ${action.selector ?? "element"}`;
    default:
      return `Action: ${action.action}`;
  }
}

function generateActionCode(action: BrowserAction): string {
  switch (action.action) {
    case "click":
      return `await page.locator(${JSON.stringify(action.selector ?? "body")}).first().click();`;
    case "type":
      return `await page.locator(${JSON.stringify(action.selector ?? "input")}).first().fill(${JSON.stringify(action.text ?? "")});`;
    case "scroll": {
      const amount = action.direction === "up"
        ? -(action.amount ?? 300)
        : (action.amount ?? 300);
      return `await page.mouse.wheel(0, ${amount});`;
    }
    case "wait":
      return `await page.waitForTimeout(${action.duration ?? 1000});`;
    case "back":
      return "await page.goBack();";
    case "goto":
      return `await page.goto(${JSON.stringify(action.url ?? "/")});`;
    case "select":
      return `await page.locator(${JSON.stringify(action.selector ?? "select")}).first().selectOption(${JSON.stringify(action.text ?? "")});`;
    case "hover":
      return `await page.locator(${JSON.stringify(action.selector ?? "body")}).first().hover();`;
    default:
      return `// Unknown action: ${action.action}`;
  }
}

/** Escape text for use inside a single-line JS comment */
function escapeComment(text: string): string {
  return text.replace(/\r?\n/g, " ").replace(/\*\//g, "* /");
}
