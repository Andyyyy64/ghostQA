import { execa } from "execa";
import consola from "consola";
import type { AiClient } from "../ai/client";
import type { DiffAnalysis, ImpactArea, DiffFile } from "../types/impact";
import { extractJson } from "../ai/parse-json";
import { parseDiffOutput } from "./parser";

const ANALYSIS_SYSTEM_PROMPT = `You are a senior QA engineer analyzing code changes to identify potential impact areas for testing.
Given a git diff, identify:
1. Which areas of the application are affected
2. What risks exist (regressions, broken flows, visual changes)
3. Which URLs/pages should be tested
4. Suggested test actions

Respond with ONLY this JSON (no markdown, no explanation):
{
  "summary": "Brief summary of the changes",
  "impact_areas": [
    {
      "area": "Area name (e.g. 'Login page', 'Navigation', 'API calls')",
      "description": "What changed and why it matters",
      "risk": "high|medium|low",
      "affected_urls": ["/path1", "/path2"],
      "suggested_actions": ["Click login button", "Fill form and submit"]
    }
  ]
}`;

export class DiffAnalyzer {
  constructor(private ai: AiClient) {}

  async analyze(cwd: string, diffRef: string): Promise<DiffAnalysis> {
    consola.info(`Analyzing diff: ${diffRef}`);

    const diffOutput = await this.getDiff(cwd, diffRef);

    if (!diffOutput.trim()) {
      consola.warn("No diff found, using empty analysis");
      return {
        files: [],
        summary: "No changes detected",
        impact_areas: [],
      };
    }

    const files = parseDiffOutput(diffOutput);
    consola.info(`Found ${files.length} changed file(s)`);

    const truncatedDiff = this.truncateDiff(diffOutput, 8000);

    const response = await this.ai.chat(ANALYSIS_SYSTEM_PROMPT, [
      {
        role: "user",
        content: `Analyze this diff and identify impact areas:\n\n${truncatedDiff}`,
      },
    ]);

    const analysis = this.parseResponse(response, files);
    consola.info(
      `Identified ${analysis.impact_areas.length} impact area(s)`
    );

    return analysis;
  }

  private async getDiff(cwd: string, diffRef: string): Promise<string> {
    try {
      const result = await execa("git", ["diff", diffRef], { cwd });
      return result.stdout;
    } catch {
      consola.warn(
        `Failed to get diff for ${diffRef}, trying unstaged changes`
      );
      try {
        const result = await execa("git", ["diff"], { cwd });
        return result.stdout;
      } catch {
        return "";
      }
    }
  }

  private truncateDiff(diff: string, maxChars: number): string {
    if (diff.length <= maxChars) return diff;
    return diff.slice(0, maxChars) + "\n\n... (diff truncated)";
  }

  private parseResponse(
    response: string,
    files: DiffFile[]
  ): DiffAnalysis {
    try {
      const parsed = extractJson<{
        summary: string;
        impact_areas: ImpactArea[];
      }>(response);

      return {
        files,
        summary: parsed.summary ?? "Analysis complete",
        impact_areas: parsed.impact_areas ?? [],
      };
    } catch (err) {
      consola.warn(
        `Failed to parse AI analysis response: ${err instanceof Error ? err.message : String(err)}`
      );
      // Fallback: synthesize impact areas from file paths
      return {
        files,
        summary: `${files.length} file(s) changed`,
        impact_areas: this.fallbackImpactAreas(files),
      };
    }
  }

  private fallbackImpactAreas(files: DiffFile[]): ImpactArea[] {
    if (files.length === 0) return [];

    // Generate a generic impact area so Layer A/B still have something to work with
    return [
      {
        area: "Application",
        description: `${files.length} file(s) were modified: ${files.map((f) => f.path).join(", ")}`,
        risk: "medium",
        affected_urls: ["/"],
        suggested_actions: [
          "Navigate to the main page",
          "Test interactive elements",
          "Check for console errors",
        ],
      },
    ];
  }
}
