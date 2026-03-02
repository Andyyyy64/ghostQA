import type { AiClient } from "../ai/client";
import type { PageState } from "./observer";
import type { BrowserAction } from "./navigator";
import type { DiffAnalysis } from "../types/impact";
import { extractJson } from "../ai/parse-json";
import consola from "consola";

const SYSTEM_PROMPT = `You are an AI QA explorer testing a web application for bugs. You interact with the browser by producing actions.

Your goal:
- Explore the application systematically
- Test interactive elements (buttons, forms, links, dropdowns)
- Look for visual bugs, broken layouts, errors, crashes
- Verify that key flows work correctly
- Note any console errors or unexpected behavior

Available actions:
- click: Click an element { "action": "click", "selector": "css or text selector" }
- type: Type into an input { "action": "type", "selector": "selector", "text": "value" }
- scroll: Scroll the page { "action": "scroll", "direction": "down"|"up", "amount": 300 }
- wait: Wait for content { "action": "wait", "duration": 1000 }
- back: Go back { "action": "back" }
- goto: Navigate to URL { "action": "goto", "url": "..." }
- hover: Hover over element { "action": "hover", "selector": "selector" }
- select: Select option { "action": "select", "selector": "selector", "text": "option" }

For selectors, prefer semantic selectors: text="Login", role=button[name="Submit"], etc.

Respond with ONLY this JSON (no markdown, no code fences, no explanation):
{
  "reasoning": "Brief explanation of what you're testing and why",
  "action": { "action": "click", "selector": "text=Something" },
  "observation": "What you notice about the current state (any issues?)",
  "discovery": null,
  "done": false
}

Set "done": true when you've explored thoroughly enough.
Set "discovery" to an object with "title", "description", "severity" when you find a bug.`;

export interface PlanResult {
  reasoning: string;
  action: BrowserAction;
  observation: string;
  discovery: {
    title: string;
    description: string;
    severity: "critical" | "high" | "medium" | "low" | "info";
  } | null;
  done: boolean;
}

export class Planner {
  private history: Array<{ role: "user" | "assistant"; content: string }> = [];
  private parseFailures = 0;

  constructor(
    private ai: AiClient,
    private analysis: DiffAnalysis
  ) {}

  async plan(state: PageState): Promise<PlanResult> {
    const stateDescription = `Current page state:
URL: ${state.url}
Title: ${state.title}

Accessibility tree:
${state.axTree}

${state.consoleLogs.length > 0 ? `Console logs since last action:\n${state.consoleLogs.join("\n")}` : "No new console logs."}`;

    this.history.push({ role: "user", content: stateDescription });

    const systemWithContext = `${SYSTEM_PROMPT}

Context about the code changes being tested:
${this.analysis.summary}

Impact areas to focus on:
${this.analysis.impact_areas.map((a) => `- ${a.area} (${a.risk}): ${a.description}`).join("\n") || "- General application testing"}`;

    const response = await this.ai.chatWithImage(
      systemWithContext,
      this.history,
      state.screenshotBase64
    );

    this.history.push({ role: "assistant", content: response });

    // Keep history manageable
    if (this.history.length > 20) {
      this.history = this.history.slice(-16);
    }

    return this.parseResponse(response);
  }

  private parseResponse(response: string): PlanResult {
    try {
      const parsed = extractJson<Record<string, unknown>>(response);
      this.parseFailures = 0;

      return {
        reasoning: String(parsed.reasoning ?? ""),
        action: (parsed.action as BrowserAction) ?? { action: "wait", duration: 1000 },
        observation: String(parsed.observation ?? ""),
        discovery: (parsed.discovery as PlanResult["discovery"]) ?? null,
        done: Boolean(parsed.done),
      };
    } catch (err) {
      this.parseFailures++;
      consola.warn(
        `Planner parse failed (${this.parseFailures}/3): ${err instanceof Error ? err.message : String(err)}`
      );

      // Give up after 3 consecutive parse failures
      if (this.parseFailures >= 3) {
        return {
          reasoning: "Stopping: too many parse failures",
          action: { action: "wait", duration: 500 },
          observation: "",
          discovery: null,
          done: true,
        };
      }

      // Otherwise scroll to see more content and continue
      return {
        reasoning: "Parse failed, scrolling to continue exploration",
        action: { action: "scroll", direction: "down", amount: 300 },
        observation: "",
        discovery: null,
        done: false,
      };
    }
  }
}
