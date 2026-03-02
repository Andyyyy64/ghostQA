import type { AiClient } from "../ai/client";
import type { PageState } from "./observer";
import type { BrowserAction } from "./navigator";
import type { DiffAnalysis } from "../types/impact";

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

Respond with JSON:
{
  "reasoning": "Brief explanation of what you're testing and why",
  "action": { ... },
  "observation": "What you notice about the current state (any issues?)",
  "discovery": null or { "title": "...", "description": "...", "severity": "critical|high|medium|low|info" },
  "done": false
}

Set "done": true when you've explored thoroughly or found enough issues.`;

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
${this.analysis.impact_areas.map((a) => `- ${a.area} (${a.risk}): ${a.description}`).join("\n")}`;

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
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error("No JSON found");

      const parsed = JSON.parse(jsonMatch[0]);
      return {
        reasoning: parsed.reasoning ?? "",
        action: parsed.action ?? { action: "wait", duration: 1000 },
        observation: parsed.observation ?? "",
        discovery: parsed.discovery ?? null,
        done: parsed.done ?? false,
      };
    } catch {
      return {
        reasoning: "Failed to parse plan, waiting",
        action: { action: "wait", duration: 1000 },
        observation: "",
        discovery: null,
        done: true,
      };
    }
  }
}
