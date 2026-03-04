import { describe, it, expect, vi, beforeEach } from "vitest";

const mockCreate = vi.fn();

vi.mock("@anthropic-ai/sdk", () => ({
  default: class MockAnthropic {
    constructor() {}
    messages = { create: mockCreate };
  },
}));

import { AnthropicProvider } from "../src/ai/anthropic-provider";

function mockResponse(
  text: string,
  inputTokens = 100,
  outputTokens = 50
) {
  return {
    content: [{ type: "text", text }],
    usage: { input_tokens: inputTokens, output_tokens: outputTokens },
  };
}

describe("AnthropicProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("chat", () => {
    it("passes system as top-level parameter", async () => {
      mockCreate.mockResolvedValue(mockResponse("Hello"));
      const provider = new AnthropicProvider("fake-key", "claude-sonnet-4-20250514");

      await provider.chat("Be concise", [{ role: "user", content: "Hi" }]);

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          system: "Be concise",
          model: "claude-sonnet-4-20250514",
        })
      );
    });

    it("joins multiple text blocks", async () => {
      mockCreate.mockResolvedValue({
        content: [
          { type: "text", text: "Hello " },
          { type: "text", text: "world" },
        ],
        usage: { input_tokens: 10, output_tokens: 5 },
      });
      const provider = new AnthropicProvider("fake-key", "claude-sonnet-4-20250514");

      const result = await provider.chat("sys", [
        { role: "user", content: "test" },
      ]);

      expect(result.text).toBe("Hello world");
    });

    it("extracts token counts from usage", async () => {
      mockCreate.mockResolvedValue(mockResponse("ok", 200, 80));
      const provider = new AnthropicProvider("fake-key", "claude-sonnet-4-20250514");

      const result = await provider.chat("sys", [
        { role: "user", content: "test" },
      ]);

      expect(result.inputTokens).toBe(200);
      expect(result.outputTokens).toBe(80);
    });
  });

  describe("chatWithImage", () => {
    it("attaches image block to last user message", async () => {
      mockCreate.mockResolvedValue(mockResponse("I see the image"));
      const provider = new AnthropicProvider("fake-key", "claude-sonnet-4-20250514");

      await provider.chatWithImage(
        "system",
        [
          { role: "user", content: "First message" },
          { role: "assistant", content: "Ok" },
          { role: "user", content: "Describe this screenshot" },
        ],
        "base64data",
        "image/png"
      );

      const callArgs = mockCreate.mock.calls[0][0];
      const messages = callArgs.messages;
      const lastMsg = messages[messages.length - 1];

      // Last user message should have image + text content
      expect(lastMsg.role).toBe("user");
      expect(lastMsg.content).toBeInstanceOf(Array);
      expect(lastMsg.content[0].type).toBe("image");
      expect(lastMsg.content[0].source.data).toBe("base64data");
      expect(lastMsg.content[1].type).toBe("text");
      expect(lastMsg.content[1].text).toBe("Describe this screenshot");
    });

    it("earlier messages remain as plain strings", async () => {
      mockCreate.mockResolvedValue(mockResponse("ok"));
      const provider = new AnthropicProvider("fake-key", "claude-sonnet-4-20250514");

      await provider.chatWithImage(
        "system",
        [
          { role: "user", content: "First" },
          { role: "assistant", content: "Second" },
          { role: "user", content: "Third" },
        ],
        "img",
        "image/png"
      );

      const callArgs = mockCreate.mock.calls[0][0];
      const messages = callArgs.messages;

      // First user message: plain string
      expect(messages[0].content).toBe("First");
      // Assistant message: plain string
      expect(messages[1].content).toBe("Second");
    });
  });
});
