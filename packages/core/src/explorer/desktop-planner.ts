import type { AiClient } from "../ai/client";
import type { DiffAnalysis } from "../types/impact";
import type { DisplayState, DesktopAction, DesktopActionType } from "./types";
import { extractJson } from "../ai/parse-json";
import consola from "consola";

const DESKTOP_SYSTEM_PROMPT = `You are an AI QA explorer testing a desktop application for bugs. You control the mouse and keyboard by producing coordinate-based actions.

Screen resolution is {W}x{H}. Coordinates [0,0] = top-left corner.

Available actions:
- left_click: Click at coordinates { "action": "left_click", "coordinate": [x, y] }
- right_click: Right-click at coordinates { "action": "right_click", "coordinate": [x, y] }
- double_click: Double-click at coordinates { "action": "double_click", "coordinate": [x, y] }
- type: Type text { "action": "type", "text": "hello world" }
- key: Press key combo { "action": "key", "text": "ctrl+s" }
- scroll: Scroll at coordinates { "action": "scroll", "coordinate": [x, y], "direction": "down", "amount": 300 }
- wait: Wait for UI { "action": "wait", "duration": 1000 }

Respond with ONLY this JSON (no markdown, no code fences):
{
  "reasoning": "Brief explanation of what you're testing and why",
  "action": { "action": "left_click", "coordinate": [500, 300] },
  "observation": "What you notice about the current screen",
  "discovery": null,
  "done": false
}

CRITICAL rules:
- Set "done": true ONLY after you have tested ALL impact areas.
- EVERY bug you find MUST be reported via the "discovery" field.
- Set "discovery" to { "title": "short title", "description": "detailed description", "severity": "critical|high|medium|low|info" } when you find a bug.
- Look at the screenshot carefully. Identify UI elements by their visual position.
- When clicking buttons or inputs, estimate the CENTER coordinates of the element.`;

export interface DesktopPlanResult {
  reasoning: string;
  action: DesktopAction;
  observation: string;
  discovery: {
    title: string;
    description: string;
    severity: "critical" | "high" | "medium" | "low" | "info";
  } | null;
  done: boolean;
}

export class DesktopPlanner {
  private history: Array<{ role: "user" | "assistant"; content: string }> = [];
  private parseFailures = 0;

  constructor(
    private ai: AiClient,
    private analysis: DiffAnalysis,
    private displaySize: { width: number; height: number }
  ) {}

  async plan(state: DisplayState, lastActionError?: string): Promise<DesktopPlanResult> {
    let stateDescription = `Current screen state:
Window title: ${state.title}
${state.logs.length > 0 ? `Process logs since last action:\n${state.logs.join("\n")}` : "No new process logs."}`;

    if (lastActionError) {
      stateDescription += `\n\n⚠️ YOUR PREVIOUS ACTION FAILED with error: ${lastActionError}\nAdjust your approach (e.g. use different coordinates, or try a different interaction).`;
    }

    this.history.push({ role: "user", content: stateDescription });

    const systemPrompt = DESKTOP_SYSTEM_PROMPT
      .replace("{W}", String(this.displaySize.width))
      .replace("{H}", String(this.displaySize.height));

    const systemWithContext = `${systemPrompt}

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

    if (this.history.length > 20) {
      this.history = this.history.slice(-16);
    }

    const result = this.parseResponse(response);

    if (this.parseFailures > 0) {
      this.history.push({
        role: "user",
        content: "Your response was not valid JSON. Respond with ONLY a JSON object.",
      });
    }

    return result;
  }

  private parseResponse(response: string): DesktopPlanResult {
    try {
      const parsed = extractJson<Record<string, unknown>>(response);
      this.parseFailures = 0;

      const rawAction = parsed.action as Record<string, unknown> | undefined;
      const action: DesktopAction = rawAction
        ? {
            kind: "desktop",
            action: ((rawAction.action as string) ?? "wait") as DesktopActionType,
            coordinate: rawAction.coordinate as [number, number] | undefined,
            text: rawAction.text as string | undefined,
            direction: rawAction.direction as "up" | "down" | undefined,
            amount: rawAction.amount as number | undefined,
            duration: rawAction.duration as number | undefined,
          }
        : { kind: "desktop", action: "wait", duration: 1000 };

      return {
        reasoning: String(parsed.reasoning ?? ""),
        action,
        observation: String(parsed.observation ?? ""),
        discovery: (parsed.discovery as DesktopPlanResult["discovery"]) ?? null,
        done: Boolean(parsed.done),
      };
    } catch (err) {
      this.parseFailures++;
      consola.warn(
        `DesktopPlanner parse failed (${this.parseFailures}/3): ${err instanceof Error ? err.message : String(err)}`
      );

      if (this.parseFailures >= 3) {
        return {
          reasoning: "Stopping: too many parse failures",
          action: { kind: "desktop", action: "wait", duration: 500 },
          observation: "",
          discovery: null,
          done: true,
        };
      }

      return {
        reasoning: "Parse failed, waiting to retry",
        action: { kind: "desktop", action: "wait", duration: 1000 },
        observation: "",
        discovery: null,
        done: false,
      };
    }
  }
}
