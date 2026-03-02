import type { AiClient } from "../ai/client";
import type { DiffAnalysis } from "../types/impact";
import type { LayerAConfig, GhostQAConfig } from "../types/config";
import consola from "consola";

const SYSTEM_PROMPT = `You are a senior QA automation engineer. Generate Playwright test code based on the diff analysis and application context.

Rules:
- Use @playwright/test syntax (import { test, expect } from '@playwright/test')
- Tests should be self-contained and independent
- Include clear test descriptions
- Use semantic locators (getByRole, getByText, getByLabel) when possible
- Add assertions for expected outcomes
- Handle loading states with waitFor
- Each test should verify one specific behavior

Output ONLY valid TypeScript code wrapped in a code block. No explanations outside the code block.`;

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
        content: `Generate up to ${this.config.max_tests} Playwright tests for this application at ${this.appUrl}.

Diff summary: ${analysis.summary}

Impact areas:
${impactSummary}

Generate one test.describe block containing multiple test cases. Base URL is ${this.appUrl}.`,
      },
    ]);

    return this.parseTests(response);
  }

  private parseTests(response: string): GeneratedTest[] {
    const codeMatch = response.match(/```(?:typescript|ts|javascript|js)?\s*\n([\s\S]*?)```/);
    if (!codeMatch) {
      consola.warn("No code block found in test generation response");
      return [];
    }

    const code = codeMatch[1].trim();

    // Extract individual test names from the code
    const testNames = [...code.matchAll(/test\(['"`](.+?)['"`]/g)].map(
      (m) => m[1]
    );

    if (testNames.length === 0) {
      return [{ name: "generated-test", code }];
    }

    // Return the full test file as a single generated test
    return [{ name: "generated-tests", code }];
  }
}
