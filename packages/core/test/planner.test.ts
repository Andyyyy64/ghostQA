import { describe, it, expect, vi, beforeEach } from "vitest";
import { Planner, type PlanResult } from "../src/explorer/planner";
import type { AiClient } from "../src/ai/client";
import type { DiffAnalysis } from "../src/types/impact";
import type { PageState } from "../src/explorer/observer";

function makeAiClient(response: string): AiClient {
  return {
    chatWithImage: vi.fn().mockResolvedValue(response),
  } as unknown as AiClient;
}

function makeAnalysis(): DiffAnalysis {
  return {
    summary: "Changed login form validation",
    impact_areas: [
      { area: "Login page", risk: "high", description: "Validation logic changed" },
    ],
  } as DiffAnalysis;
}

function makeState(overrides: Partial<PageState> = {}): PageState {
  return {
    url: "http://localhost:3000/login",
    title: "Login",
    axTree: "<button>Submit</button>",
    screenshotBase64: "abc123",
    consoleLogs: [],
    ...overrides,
  } as PageState;
}

describe("Planner", () => {
  describe("plan — valid JSON response", () => {
    it("parses a normal action response", async () => {
      const json = JSON.stringify({
        reasoning: "Testing the login button",
        action: { action: "click", selector: "text=Login" },
        observation: "Login form visible",
        discovery: null,
        done: false,
      });
      const ai = makeAiClient(json);
      const planner = new Planner(ai, makeAnalysis());

      const result = await planner.plan(makeState());

      expect(result.action).toEqual({ action: "click", selector: "text=Login" });
      expect(result.reasoning).toBe("Testing the login button");
      expect(result.done).toBe(false);
      expect(result.discovery).toBeNull();
    });

    it("extracts discovery when present", async () => {
      const json = JSON.stringify({
        reasoning: "Found a bug",
        action: { action: "wait", duration: 500 },
        observation: "Error displayed",
        discovery: {
          title: "Login 500 error",
          description: "Server returns 500 on submit",
          severity: "critical",
        },
        done: false,
      });
      const ai = makeAiClient(json);
      const planner = new Planner(ai, makeAnalysis());

      const result = await planner.plan(makeState());

      expect(result.discovery).toEqual({
        title: "Login 500 error",
        description: "Server returns 500 on submit",
        severity: "critical",
      });
    });

    it("respects done: true", async () => {
      const json = JSON.stringify({
        reasoning: "All areas tested",
        action: { action: "wait", duration: 500 },
        observation: "",
        discovery: null,
        done: true,
      });
      const ai = makeAiClient(json);
      const planner = new Planner(ai, makeAnalysis());

      const result = await planner.plan(makeState());
      expect(result.done).toBe(true);
    });
  });

  describe("plan — parse failure recovery", () => {
    it("returns scroll fallback on first parse failure", async () => {
      const ai = makeAiClient("This is not JSON at all.");
      const planner = new Planner(ai, makeAnalysis());

      const result = await planner.plan(makeState());

      expect(result.action.action).toBe("scroll");
      expect(result.done).toBe(false);
    });

    it("returns done: true after 3 consecutive parse failures", async () => {
      const ai = makeAiClient("still not json");
      const planner = new Planner(ai, makeAnalysis());

      await planner.plan(makeState());
      await planner.plan(makeState());
      const result = await planner.plan(makeState());

      expect(result.done).toBe(true);
      expect(result.reasoning).toContain("parse failures");
    });

    it("injects JSON reminder into history after parse failure", async () => {
      const ai = makeAiClient("not json");
      const planner = new Planner(ai, makeAnalysis());

      await planner.plan(makeState());

      // The AI should receive the JSON reminder on the next call
      // We verify indirectly: chatWithImage should be called, and
      // the next plan call should include the reminder in history
      const chatMock = ai.chatWithImage as ReturnType<typeof vi.fn>;
      expect(chatMock).toHaveBeenCalledTimes(1);

      // Second call — history should now include the reminder
      await planner.plan(makeState());
      expect(chatMock).toHaveBeenCalledTimes(2);
      // The second call's messages (arg index 1) should contain the reminder
      const secondCallMessages = chatMock.mock.calls[1][1];
      const hasReminder = secondCallMessages.some(
        (m: { content: string }) => m.content.includes("not valid JSON")
      );
      expect(hasReminder).toBe(true);
    });
  });

  describe("extractFallbackAction", () => {
    it("detects 'all tests complete' as done", async () => {
      const ai = makeAiClient("I've finished. All tests complete and no bugs found.");
      const planner = new Planner(ai, makeAnalysis());

      const result = await planner.plan(makeState());
      expect(result.done).toBe(true);
    });

    it("detects 'finished testing' as done", async () => {
      const ai = makeAiClient("Finished testing all impact areas.");
      const planner = new Planner(ai, makeAnalysis());

      const result = await planner.plan(makeState());
      expect(result.done).toBe(true);
    });

    it("detects 'exploration complete' as done", async () => {
      const ai = makeAiClient("Exploration complete. Everything looks good.");
      const planner = new Planner(ai, makeAnalysis());

      const result = await planner.plan(makeState());
      expect(result.done).toBe(true);
    });

    it("extracts click action from natural language", async () => {
      const ai = makeAiClient("I'll click on Submit button");
      const planner = new Planner(ai, makeAnalysis());

      const result = await planner.plan(makeState());
      expect(result.action.action).toBe("click");
      expect((result.action as any).selector).toContain("Submit");
      expect(result.done).toBe(false);
    });

    it("extracts type action from natural language", async () => {
      const ai = makeAiClient("type 'hello' into search field");
      const planner = new Planner(ai, makeAnalysis());

      const result = await planner.plan(makeState());
      expect(result.action.action).toBe("type");
      expect((result.action as any).text).toBe("hello");
      expect(result.done).toBe(false);
    });

    it("falls back to scroll when text is unrecognizable", async () => {
      const ai = makeAiClient("hmm interesting page layout here");
      const planner = new Planner(ai, makeAnalysis());

      const result = await planner.plan(makeState());
      expect(result.action.action).toBe("scroll");
      expect(result.done).toBe(false);
    });
  });

  describe("history management", () => {
    it("trims history to 16 when exceeding 20", async () => {
      const json = JSON.stringify({
        reasoning: "ok",
        action: { action: "wait", duration: 100 },
        observation: "",
        discovery: null,
        done: false,
      });
      const ai = makeAiClient(json);
      const planner = new Planner(ai, makeAnalysis());

      // Each plan() adds 2 entries (user + assistant) to history.
      // After 10 calls = 20 entries. The 11th call pushes user (21), which triggers trim to 16,
      // then the AI response is appended (17). But on the *12th* call, the history passed
      // to chatWithImage should reflect the trimmed state.
      for (let i = 0; i < 12; i++) {
        await planner.plan(makeState());
      }

      // Trim happens AFTER chatWithImage + assistant push: if > 20, slice(-16).
      // vi.fn() records array references (not copies), so we check the final state
      // of the history after all calls. Without trimming, 12 calls = 24 entries.
      // With trimming, it should stay bounded.
      const chatMock = ai.chatWithImage as ReturnType<typeof vi.fn>;
      const lastCall = chatMock.mock.calls[chatMock.mock.calls.length - 1];
      const finalHistory = lastCall[1] as Array<{ role: string; content: string }>;
      // History is trimmed to 16 when > 20, so final length should be well under 24
      expect(finalHistory.length).toBeLessThanOrEqual(20);
    });
  });

  describe("lastActionError", () => {
    it("appends warning to stateDescription", async () => {
      const json = JSON.stringify({
        reasoning: "ok",
        action: { action: "click", selector: ".btn" },
        observation: "",
        discovery: null,
        done: false,
      });
      const ai = makeAiClient(json);
      const planner = new Planner(ai, makeAnalysis());

      await planner.plan(makeState(), "Element not found");

      const chatMock = ai.chatWithImage as ReturnType<typeof vi.fn>;
      // chatWithImage is called with (system, history, image)
      // history is the array of messages; the last one is the user message with the error appended
      const history = chatMock.mock.calls[0][1] as Array<{
        role: string;
        content: string;
      }>;
      // Find the user message that contains the error warning
      const userMsgWithError = history.find(
        (m) => m.role === "user" && m.content.includes("PREVIOUS ACTION FAILED")
      );
      expect(userMsgWithError).toBeDefined();
      expect(userMsgWithError!.content).toContain("Element not found");
    });
  });
});
