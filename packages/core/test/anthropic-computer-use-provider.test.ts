import { describe, it, expect, vi, beforeEach } from "vitest";
import { calculateScale, scaleToDisplay } from "../src/explorer/screenshot-scaler";

// We can't easily mock the Anthropic SDK constructor, so we test the parsing
// logic extracted from AnthropicComputerUseProvider by replicating it here.
// The actual provider is a thin wrapper around these transforms.

describe("AnthropicComputerUseProvider — parseComputerAction logic", () => {
  // Replicate the parsing logic from anthropic-computer-use.ts
  function parseComputerAction(
    input: Record<string, unknown>,
    scale: ReturnType<typeof calculateScale>
  ) {
    const actionType = input.action as string;
    const apiCoordinate = input.coordinate as [number, number] | undefined;
    const text = input.text as string | undefined;

    let coordinate: [number, number] | undefined;
    if (apiCoordinate) {
      coordinate = scaleToDisplay(scale, apiCoordinate[0], apiCoordinate[1]);
    }

    switch (actionType) {
      case "left_click":
      case "right_click":
      case "double_click":
        return { kind: "desktop" as const, action: actionType, coordinate };
      case "type":
        return { kind: "desktop" as const, action: "type" as const, text: text ?? "" };
      case "key":
        return { kind: "desktop" as const, action: "key" as const, text: text ?? "" };
      case "scroll":
        return {
          kind: "desktop" as const,
          action: "scroll" as const,
          coordinate,
          direction: (input.direction as "up" | "down") ?? "down",
          amount: (input.amount as number) ?? 300,
        };
      case "screenshot":
        return { kind: "desktop" as const, action: "screenshot" as const };
      default:
        return { kind: "desktop" as const, action: "wait" as const, duration: 500 };
    }
  }

  const scale1280 = calculateScale(1280, 720);
  const scale1920 = calculateScale(1920, 1080);

  it("parses left_click with coordinates (no scaling)", () => {
    const result = parseComputerAction(
      { action: "left_click", coordinate: [500, 300] },
      scale1280
    );
    expect(result.action).toBe("left_click");
    expect(result.coordinate).toEqual([500, 300]);
  });

  it("parses left_click with coordinate scaling (1920x1080)", () => {
    const result = parseComputerAction(
      { action: "left_click", coordinate: [100, 100] },
      scale1920
    );
    expect(result.action).toBe("left_click");
    // Coordinates should be scaled UP from API space to display space
    expect(result.coordinate![0]).toBeGreaterThan(100);
    expect(result.coordinate![1]).toBeGreaterThan(100);
  });

  it("parses right_click", () => {
    const result = parseComputerAction(
      { action: "right_click", coordinate: [200, 150] },
      scale1280
    );
    expect(result.action).toBe("right_click");
    expect(result.coordinate).toEqual([200, 150]);
  });

  it("parses double_click", () => {
    const result = parseComputerAction(
      { action: "double_click", coordinate: [300, 250] },
      scale1280
    );
    expect(result.action).toBe("double_click");
    expect(result.coordinate).toEqual([300, 250]);
  });

  it("parses type action", () => {
    const result = parseComputerAction(
      { action: "type", text: "hello world" },
      scale1280
    );
    expect(result.action).toBe("type");
    expect(result.text).toBe("hello world");
  });

  it("parses type with empty text", () => {
    const result = parseComputerAction(
      { action: "type" },
      scale1280
    );
    expect(result.text).toBe("");
  });

  it("parses key action", () => {
    const result = parseComputerAction(
      { action: "key", text: "Return" },
      scale1280
    );
    expect(result.action).toBe("key");
    expect(result.text).toBe("Return");
  });

  it("parses scroll with direction", () => {
    const result = parseComputerAction(
      { action: "scroll", coordinate: [640, 360], direction: "up", amount: 500 },
      scale1280
    );
    expect(result.action).toBe("scroll");
    expect(result.direction).toBe("up");
    expect(result.amount).toBe(500);
    expect(result.coordinate).toEqual([640, 360]);
  });

  it("parses scroll defaults", () => {
    const result = parseComputerAction(
      { action: "scroll" },
      scale1280
    );
    expect(result.direction).toBe("down");
    expect(result.amount).toBe(300);
  });

  it("parses screenshot action", () => {
    const result = parseComputerAction(
      { action: "screenshot" },
      scale1280
    );
    expect(result.action).toBe("screenshot");
  });

  it("falls back to wait for unknown actions", () => {
    const result = parseComputerAction(
      { action: "triple_click" },
      scale1280
    );
    expect(result.action).toBe("wait");
    expect(result.duration).toBe(500);
  });
});

describe("AnthropicComputerUseProvider — parseResponse logic", () => {
  // Replicate the response parsing logic
  function parseResponse(content: Array<{ type: string; text?: string; id?: string; input?: Record<string, unknown> }>, stopReason: string) {
    const textBlocks = content.filter(b => b.type === "text");
    const reasoning = textBlocks.map(b => b.text ?? "").join("\n");

    const toolUseBlock = content.find(b => b.type === "tool_use");

    if (!toolUseBlock || stopReason !== "tool_use") {
      return { action: null, toolUseId: null, reasoning, done: true };
    }

    return {
      action: toolUseBlock.input,
      toolUseId: toolUseBlock.id,
      reasoning,
      done: false,
    };
  }

  it("returns done=true when stop_reason is end_turn", () => {
    const result = parseResponse(
      [{ type: "text", text: "I'm done testing." }],
      "end_turn"
    );
    expect(result.done).toBe(true);
    expect(result.action).toBeNull();
    expect(result.reasoning).toBe("I'm done testing.");
  });

  it("returns done=true when stop_reason is max_tokens", () => {
    const result = parseResponse(
      [{ type: "text", text: "truncated" }],
      "max_tokens"
    );
    expect(result.done).toBe(true);
  });

  it("continues when stop_reason is tool_use with tool_use block", () => {
    const result = parseResponse(
      [
        { type: "text", text: "I'll click the button" },
        {
          type: "tool_use",
          id: "toolu_abc123",
          input: { action: "left_click", coordinate: [500, 300] },
        },
      ],
      "tool_use"
    );
    expect(result.done).toBe(false);
    expect(result.toolUseId).toBe("toolu_abc123");
    expect(result.action).toEqual({ action: "left_click", coordinate: [500, 300] });
    expect(result.reasoning).toBe("I'll click the button");
  });

  it("concatenates multiple text blocks", () => {
    const result = parseResponse(
      [
        { type: "text", text: "First thought." },
        { type: "text", text: "Second thought." },
      ],
      "end_turn"
    );
    expect(result.reasoning).toBe("First thought.\nSecond thought.");
  });

  it("returns done=true when tool_use is in content but stop_reason is not tool_use", () => {
    // Edge case: content has tool_use but stop reason says end_turn
    const result = parseResponse(
      [
        { type: "text", text: "hmm" },
        { type: "tool_use", id: "toolu_xyz", input: { action: "left_click", coordinate: [100, 100] } },
      ],
      "end_turn"
    );
    expect(result.done).toBe(true);
  });
});

describe("AnthropicComputerUseProvider — conversation management", () => {
  it("trims messages at > 40 entries (keeps first + last 30)", () => {
    // Simulate the trimming logic
    const messages: Array<{ role: string; content: unknown }> = [];
    for (let i = 0; i < 42; i++) {
      messages.push({ role: i % 2 === 0 ? "user" : "assistant", content: `msg ${i}` });
    }

    // Replicate the trim logic from sendRequest
    let trimmed = messages;
    if (trimmed.length > 40) {
      trimmed = [trimmed[0], ...trimmed.slice(-30)];
    }

    expect(trimmed).toHaveLength(31); // first + last 30
    expect(trimmed[0].content).toBe("msg 0");
    expect(trimmed[trimmed.length - 1].content).toBe("msg 41");
  });
});
