import type { AiClient } from "../ai/client";
import type { DiffAnalysis } from "../types/impact";
import type { LayerAConfig } from "../types/config";
import consola from "consola";

const SYSTEM_PROMPT = `You are a senior QA automation engineer. Generate Playwright test code that ACTUALLY WORKS.

CRITICAL rules for generating tests that pass:
- import { test, expect } from '@playwright/test'
- ALWAYS use test.describe() to group related tests
- ALWAYS navigate to the page first: await page.goto(BASE_URL)
- ALWAYS wait for the page to be ready before interacting: await page.waitForLoadState('networkidle') or await page.waitForSelector(...)
- Use RESILIENT locators in this priority order:
  1. page.getByRole('button', { name: 'Add' })
  2. page.getByText('exact text')
  3. page.getByPlaceholder('placeholder text')
  4. page.locator('[data-testid="..."]')
  5. page.locator('css selector') — last resort
- Keep assertions SIMPLE and OBSERVABLE:
  - Check that elements exist: await expect(page.getByText('...')).toBeVisible()
  - Check element count: await expect(page.locator('li')).toHaveCount(N)
  - Check page title: await expect(page).toHaveTitle(...)
  - Check URL: await expect(page).toHaveURL(...)
  - Check text content: await expect(locator).toContainText('...')
- Do NOT assert on exact pixel values, colors, or computed styles
- Do NOT assert on timing or animation states
- Add try/catch ONLY for cleanup, never to swallow assertion errors
- Each test should be SHORT (under 15 lines of test body)

Output ONLY the TypeScript code. No markdown fences, no explanations. Just the raw code starting with import statements.`;

export interface GeneratedTest {
  name: string;
  code: string;
}

export class TestGenerator {
  constructor(
    private ai: AiClient,
    private config: LayerAConfig,
    private appUrl: string
  ) {}

  async generate(analysis: DiffAnalysis): Promise<GeneratedTest[]> {
    if (analysis.impact_areas.length === 0) {
      consola.info("No impact areas to generate tests for");
      return [];
    }

    const impactSummary = analysis.impact_areas
      .map(
        (area) =>
          `- ${area.area} (${area.risk} risk): ${area.description}\n  URLs: ${area.affected_urls.join(", ")}\n  Actions: ${area.suggested_actions.join(", ")}`
      )
      .join("\n");

    const response = await this.ai.chat(SYSTEM_PROMPT, [
      {
        role: "user",
        content: `Generate up to ${this.config.max_tests} Playwright tests for the application at ${this.appUrl}.

Every test MUST start with: await page.goto('${this.appUrl}');

Diff summary: ${analysis.summary}

Impact areas:
${impactSummary}

Generate one test.describe block. Focus on verifying the CHANGED behavior described above. Test what the user would actually see and interact with.`,
      },
    ]);

    return this.parseTests(response);
  }

  private parseTests(response: string): GeneratedTest[] {
    // 0. Unescape literal \n sequences before any extraction
    //    CLI tools sometimes return the entire response as a single line with escaped newlines
    let text = response;
    if (text.includes("\\n") && !text.includes("\n")) {
      text = text
        .replace(/\\n/g, "\n")
        .replace(/\\t/g, "\t")
        .replace(/\\r/g, "\r")
        .replace(/\\"/g, '"');
    }

    let code = "";

    // 1. Try extracting from markdown code block
    const codeBlockMatch = text.match(
      /```(?:typescript|ts|javascript|js)?\s*\n([\s\S]*?)```/
    );
    if (codeBlockMatch) {
      code = codeBlockMatch[1].trim();
    }

    // 2. Try extracting from import statement onwards
    if (!code) {
      const importMatch = text.match(
        /(import\s+\{[^}]*\}\s+from\s+['"]@playwright\/test['"][\s\S]*)/
      );
      if (importMatch) {
        code = importMatch[1].trim();
      }
    }

    // 3. Validate: must have playwright import AND test calls
    const hasPlaywrightImport = code.includes("@playwright/test");
    const hasTestCall = /\btest\s*\(/.test(code) || /\btest\.describe\s*\(/.test(code);

    if (!hasPlaywrightImport || !hasTestCall) {
      consola.warn("Response does not contain valid Playwright test code");
      consola.debug(`Response preview: ${response.slice(0, 300)}`);
      return [];
    }

    consola.info(`Extracted test code (${code.length} chars)`);
    return [{ name: "generated-tests", code }];
  }
}
