import { describe, it, expect, vi, beforeEach } from "vitest";
import { DesktopPlanner } from "../src/explorer/desktop-planner";
import type { AiClient } from "../src/ai/client";
import type { DiffAnalysis } from "../src/types/impact";
import type { DisplayState } from "../src/explorer/types";

function makeMockAi(response: string): AiClient {
  return {
    chatWithImage: vi.fn().mockResolvedValue(response),
    costTracker: { checkBudget: vi.fn(), track: vi.fn() },
  } as unknown as AiClient;
}

function makeAnalysis(): DiffAnalysis {
  return {
    summary: "Changed login form validation",
    impact_areas: [
      { area: "Login page", risk: "high", description: "Validation logic changed" },
    ],
    suggested_actions: [],
  };
}

function makeState(overrides?: Partial<DisplayState>): DisplayState {
  return {
    identifier: "My App",
    title: "My App",
    axTree: "",
    screenshotBase64: "aW1hZ2U=",
    logs: [],
    timestamp: Date.now(),
    displaySize: { width: 1280, height: 720 },
    ...overrides,
  };
}

describe("DesktopPlanner", () => {
  describe("plan — valid JSON response", () => {
    it("parses a valid click action", async () => {
      const ai = makeMockAi(JSON.stringify({
        reasoning: "Clicking the login button",
        action: { action: "left_click", coordinate: [500, 300] },
        observation: "I see a login form",
        discovery: null,
        done: false,
      }));

      const planner = new DesktopPlanner(ai, makeAnalysis(), { width: 1280, height: 720 });
      const result = await planner.plan(makeState());

      expect(result.reasoning).toBe("Clicking the login button");
      expect(result.action).toEqual({
        kind: "desktop",
        action: "left_click",
        coordinate: [500, 300],
        text: undefined,
        direction: undefined,
        amount: undefined,
        duration: undefined,
      });
      expect(result.done).toBe(false);
      expect(result.discovery).toBeNull();
    });

    it("parses a type action", async () => {
      const ai = makeMockAi(JSON.stringify({
        reasoning: "Typing username",
        action: { action: "type", text: "admin" },
        observation: "Text field is focused",
        discovery: null,
        done: false,
      }));

      const planner = new DesktopPlanner(ai, makeAnalysis(), { width: 1280, height: 720 });
      const result = await planner.plan(makeState());

      expect(result.action.action).toBe("type");
      expect(result.action.text).toBe("admin");
    });

    it("parses a discovery", async () => {
      const ai = makeMockAi(JSON.stringify({
        reasoning: "Button crashes the app",
        action: { action: "wait", duration: 1000 },
        observation: "Error dialog appeared",
        discovery: { title: "Crash on save", description: "App crashes when clicking save", severity: "critical" },
        done: false,
      }));

      const planner = new DesktopPlanner(ai, makeAnalysis(), { width: 1280, height: 720 });
      const result = await planner.plan(makeState());

      expect(result.discovery).toEqual({
        title: "Crash on save",
        description: "App crashes when clicking save",
        severity: "critical",
      });
    });

    it("parses done=true", async () => {
      const ai = makeMockAi(JSON.stringify({
        reasoning: "All areas tested",
        action: { action: "wait", duration: 500 },
        observation: "Done",
        discovery: null,
        done: true,
      }));

      const planner = new DesktopPlanner(ai, makeAnalysis(), { width: 1280, height: 720 });
      const result = await planner.plan(makeState());

      expect(result.done).toBe(true);
    });
  });

  describe("plan — missing action fallback", () => {
    it("defaults to wait when action is missing", async () => {
      const ai = makeMockAi(JSON.stringify({
        reasoning: "Thinking...",
        observation: "Looking at screen",
        discovery: null,
        done: false,
      }));

      const planner = new DesktopPlanner(ai, makeAnalysis(), { width: 1280, height: 720 });
      const result = await planner.plan(makeState());

      expect(result.action).toEqual({
        kind: "desktop",
        action: "wait",
        duration: 1000,
      });
    });
  });

  describe("plan — JSON parse recovery", () => {
    it("recovers from markdown-wrapped JSON", async () => {
      const ai = makeMockAi("```json\n" + JSON.stringify({
        reasoning: "Clicking button",
        action: { action: "left_click", coordinate: [100, 200] },
        observation: "Saw a button",
        discovery: null,
        done: false,
      }) + "\n```");

      const planner = new DesktopPlanner(ai, makeAnalysis(), { width: 1280, height: 720 });
      const result = await planner.plan(makeState());

      expect(result.action.action).toBe("left_click");
      expect(result.action.coordinate).toEqual([100, 200]);
    });

    it("falls back to wait on completely invalid response", async () => {
      const ai = makeMockAi("I can't understand what to do here.");

      const planner = new DesktopPlanner(ai, makeAnalysis(), { width: 1280, height: 720 });
      const result = await planner.plan(makeState());

      expect(result.reasoning).toContain("Parse failed");
      expect(result.action.action).toBe("wait");
      expect(result.done).toBe(false);
    });

    it("stops after 3 consecutive parse failures", async () => {
      const ai = makeMockAi("not json at all");
      const planner = new DesktopPlanner(ai, makeAnalysis(), { width: 1280, height: 720 });

      await planner.plan(makeState());  // fail 1
      await planner.plan(makeState());  // fail 2
      const result = await planner.plan(makeState());  // fail 3

      expect(result.done).toBe(true);
      expect(result.reasoning).toContain("too many parse failures");
    });

    it("resets parse failure count on successful parse", async () => {
      const badAi = {
        chatWithImage: vi.fn()
          .mockResolvedValueOnce("not json")
          .mockResolvedValueOnce("not json")
          .mockResolvedValueOnce(JSON.stringify({
            reasoning: "ok now",
            action: { action: "wait", duration: 500 },
            observation: "recovered",
            discovery: null,
            done: false,
          }))
          .mockResolvedValueOnce("not json")
          .mockResolvedValueOnce("not json")
          // 5th call — should NOT be done since we reset the counter
          .mockResolvedValueOnce("not json"),
        costTracker: { checkBudget: vi.fn(), track: vi.fn() },
      } as unknown as AiClient;

      const planner = new DesktopPlanner(badAi, makeAnalysis(), { width: 1280, height: 720 });

      await planner.plan(makeState());  // fail 1
      await planner.plan(makeState());  // fail 2
      const success = await planner.plan(makeState());  // success → resets counter
      expect(success.reasoning).toBe("ok now");

      await planner.plan(makeState());  // fail 1 again
      await planner.plan(makeState());  // fail 2 again
      const result = await planner.plan(makeState());  // fail 3 → done

      expect(result.done).toBe(true);
    });
  });

  describe("plan — history management", () => {
    it("passes history to AI on subsequent calls", async () => {
      // Capture history length at each call (array is passed by reference)
      const historyLengths: number[] = [];
      const chatFn = vi.fn().mockImplementation((_system: string, messages: unknown[]) => {
        historyLengths.push(messages.length);
        return Promise.resolve(JSON.stringify({
          reasoning: "step",
          action: { action: "wait", duration: 500 },
          observation: "",
          discovery: null,
          done: false,
        }));
      });

      const ai = {
        chatWithImage: chatFn,
        costTracker: { checkBudget: vi.fn(), track: vi.fn() },
      } as unknown as AiClient;

      const planner = new DesktopPlanner(ai, makeAnalysis(), { width: 1280, height: 720 });

      await planner.plan(makeState());
      await planner.plan(makeState());

      // First call: [user1] = 1, Second call: [user1, assistant1, user2] = 3
      expect(historyLengths).toEqual([1, 3]);
    });

    it("truncates history beyond 20 entries", async () => {
      const chatFn = vi.fn().mockResolvedValue(JSON.stringify({
        reasoning: "step",
        action: { action: "wait", duration: 500 },
        observation: "",
        discovery: null,
        done: false,
      }));

      const ai = {
        chatWithImage: chatFn,
        costTracker: { checkBudget: vi.fn(), track: vi.fn() },
      } as unknown as AiClient;

      const planner = new DesktopPlanner(ai, makeAnalysis(), { width: 1280, height: 720 });

      // Call 12 times → 24 history entries (12 user + 12 assistant)
      for (let i = 0; i < 12; i++) {
        await planner.plan(makeState());
      }

      // After truncation (>20), history should be sliced to last 16
      const lastCallHistory = chatFn.mock.calls[11][1];
      expect(lastCallHistory.length).toBeLessThanOrEqual(20);
    });
  });

  describe("plan — action error feedback", () => {
    it("includes error message in state description", async () => {
      const chatFn = vi.fn().mockResolvedValue(JSON.stringify({
        reasoning: "trying again",
        action: { action: "left_click", coordinate: [200, 300] },
        observation: "",
        discovery: null,
        done: false,
      }));

      const ai = {
        chatWithImage: chatFn,
        costTracker: { checkBudget: vi.fn(), track: vi.fn() },
      } as unknown as AiClient;

      const planner = new DesktopPlanner(ai, makeAnalysis(), { width: 1280, height: 720 });

      await planner.plan(makeState(), "Element not found at coordinates");

      const historyPassedToAi = chatFn.mock.calls[0][1];
      const userMessage = historyPassedToAi[0].content;
      expect(userMessage).toContain("PREVIOUS ACTION FAILED");
      expect(userMessage).toContain("Element not found at coordinates");
    });
  });

  describe("plan — system prompt construction", () => {
    it("includes display size in system prompt", async () => {
      const chatFn = vi.fn().mockResolvedValue(JSON.stringify({
        reasoning: "step",
        action: { action: "wait", duration: 500 },
        observation: "",
        discovery: null,
        done: false,
      }));

      const ai = {
        chatWithImage: chatFn,
        costTracker: { checkBudget: vi.fn(), track: vi.fn() },
      } as unknown as AiClient;

      const planner = new DesktopPlanner(ai, makeAnalysis(), { width: 1920, height: 1080 });
      await planner.plan(makeState());

      const systemPrompt = chatFn.mock.calls[0][0];
      expect(systemPrompt).toContain("1920x1080");
    });

    it("includes impact areas in system prompt", async () => {
      const chatFn = vi.fn().mockResolvedValue(JSON.stringify({
        reasoning: "step",
        action: { action: "wait", duration: 500 },
        observation: "",
        discovery: null,
        done: false,
      }));

      const ai = {
        chatWithImage: chatFn,
        costTracker: { checkBudget: vi.fn(), track: vi.fn() },
      } as unknown as AiClient;

      const planner = new DesktopPlanner(ai, makeAnalysis(), { width: 1280, height: 720 });
      await planner.plan(makeState());

      const systemPrompt = chatFn.mock.calls[0][0];
      expect(systemPrompt).toContain("Login page");
      expect(systemPrompt).toContain("Validation logic changed");
    });

    it("passes screenshot to chatWithImage", async () => {
      const chatFn = vi.fn().mockResolvedValue(JSON.stringify({
        reasoning: "step",
        action: { action: "wait", duration: 500 },
        observation: "",
        discovery: null,
        done: false,
      }));

      const ai = {
        chatWithImage: chatFn,
        costTracker: { checkBudget: vi.fn(), track: vi.fn() },
      } as unknown as AiClient;

      const planner = new DesktopPlanner(ai, makeAnalysis(), { width: 1280, height: 720 });
      await planner.plan(makeState({ screenshotBase64: "base64screenshot" }));

      expect(chatFn.mock.calls[0][2]).toBe("base64screenshot");
    });
  });

  describe("plan — scroll action parsing", () => {
    it("parses scroll with direction and amount", async () => {
      const ai = makeMockAi(JSON.stringify({
        reasoning: "Scrolling down",
        action: { action: "scroll", coordinate: [640, 360], direction: "down", amount: 500 },
        observation: "Page content",
        discovery: null,
        done: false,
      }));

      const planner = new DesktopPlanner(ai, makeAnalysis(), { width: 1280, height: 720 });
      const result = await planner.plan(makeState());

      expect(result.action.action).toBe("scroll");
      expect(result.action.coordinate).toEqual([640, 360]);
      expect(result.action.direction).toBe("down");
      expect(result.action.amount).toBe(500);
    });
  });
});
