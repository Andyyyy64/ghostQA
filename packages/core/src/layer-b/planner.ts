import type { AiClient } from "../ai/client";
import type { PageState } from "./observer";
import type { BrowserAction } from "./navigator";
import type { DiffAnalysis } from "../types/impact";
import type { GhostQAConfig } from "../types/config";
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

CRITICAL rules:
- Set "done": true ONLY after you have tested ALL impact areas and reported ALL bugs you found.
- EVERY bug you find MUST be reported via the "discovery" field. If you mention a bug in "reasoning" but don't set "discovery", it will be LOST.
- Report ONE discovery per step. If you find multiple bugs, report them in separate steps.
- Do NOT summarize or conclude in natural language. ALWAYS respond with the JSON object.
- Set "discovery" to { "title": "short title", "description": "detailed description", "severity": "critical|high|medium|low|info" } when you find a bug.`;

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

  private flows: GhostQAConfig["flows"];

  constructor(
    private ai: AiClient,
    private analysis: DiffAnalysis,
    flows: GhostQAConfig["flows"] = []
  ) {
    this.flows = flows;
  }

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
${this.analysis.impact_areas.map((a) => `- ${a.area} (${a.risk}): ${a.description}`).join("\n") || "- General application testing"}
${this.flows.length > 0 ? `\nDefined test flows (prioritize these):\n${this.flows.map((f) => `- [${f.priority}] ${f.name}: ${f.goal}`).join("\n")}` : ""}`;

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

    const result = this.parseResponse(response);

    // If parse failed, inject a reminder so the next request gets JSON
    if (this.parseFailures > 0) {
      this.history.push({
        role: "user",
        content:
          "Your response was not valid JSON. You MUST respond with ONLY a JSON object, no markdown, no explanation. Continue exploring or set done:true if finished.",
      });
    }

    return result;
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

      // Try to salvage an action from natural language
      const fallback = this.extractFallbackAction(response);
      if (fallback) {
        this.parseFailures = Math.max(0, this.parseFailures - 1); // partial recovery
        return fallback;
      }

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

  /** Try to extract a usable action from a natural-language response */
  private extractFallbackAction(text: string): PlanResult | null {
    const lower = text.toLowerCase();

    // Detect if the AI is saying it's done
    if (
      lower.includes("all tests complete") ||
      lower.includes("finished testing") ||
      lower.includes("exploration complete") ||
      lower.includes("all impact areas")
    ) {
      return {
        reasoning: text.slice(0, 200),
        action: { action: "wait", duration: 500 },
        observation: "",
        discovery: null,
        done: true,
      };
    }

    // Detect click intent: "click on X" / "click the X button"
    const clickMatch = text.match(
      /click(?:\s+on)?\s+(?:the\s+)?["']?([^"'\n,.]+?)["']?\s*(?:button|link|element|$)/i
    );
    if (clickMatch) {
      return {
        reasoning: text.slice(0, 200),
        action: { action: "click", selector: `text=${clickMatch[1].trim()}` },
        observation: "",
        discovery: null,
        done: false,
      };
    }

    // Detect type intent: "type X into Y"
    const typeMatch = text.match(
      /type\s+["']([^"']+)["']\s+(?:into|in)\s+(?:the\s+)?(.+?)(?:\s+field|\s+input)?$/im
    );
    if (typeMatch) {
      return {
        reasoning: text.slice(0, 200),
        action: { action: "type", selector: `placeholder=${typeMatch[2].trim()}`, text: typeMatch[1] },
        observation: "",
        discovery: null,
        done: false,
      };
    }

    return null;
  }
}
