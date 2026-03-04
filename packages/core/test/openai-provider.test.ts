import { describe, it, expect, vi, beforeEach } from "vitest";

const mockCreate = vi.fn();

vi.mock("openai", () => ({
  default: class MockOpenAI {
    constructor() {}
    chat = {
      completions: { create: mockCreate },
    };
  },
}));

import { OpenAIProvider } from "../src/ai/openai-provider";

function mockResponse(text: string, promptTokens = 100, completionTokens = 50) {
  return {
    choices: [{ message: { content: text } }],
    usage: { prompt_tokens: promptTokens, completion_tokens: completionTokens },
  };
}

describe("OpenAIProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("chat", () => {
    it("prepends system message to messages", async () => {
      mockCreate.mockResolvedValue(mockResponse("Hi"));
      const provider = new OpenAIProvider("fake-key", "gpt-4o");

      await provider.chat("Be helpful", [
        { role: "user", content: "Hello" },
      ]);

      const callArgs = mockCreate.mock.calls[0][0];
      expect(callArgs.messages[0]).toEqual({
        role: "system",
        content: "Be helpful",
      });
      expect(callArgs.messages[1]).toEqual({
        role: "user",
        content: "Hello",
      });
    });

    it("extracts token counts from usage", async () => {
      mockCreate.mockResolvedValue(mockResponse("ok", 200, 80));
      const provider = new OpenAIProvider("fake-key", "gpt-4o");

      const result = await provider.chat("sys", [
        { role: "user", content: "test" },
      ]);

      expect(result.inputTokens).toBe(200);
      expect(result.outputTokens).toBe(80);
      expect(result.text).toBe("ok");
    });

    it("handles empty choices gracefully", async () => {
      mockCreate.mockResolvedValue({
        choices: [],
        usage: { prompt_tokens: 10, completion_tokens: 0 },
      });
      const provider = new OpenAIProvider("fake-key", "gpt-4o");

      const result = await provider.chat("sys", [
        { role: "user", content: "test" },
      ]);

      expect(result.text).toBe("");
    });
  });

  describe("chatWithImage", () => {
    it("attaches image_url to last user message as data URI", async () => {
      mockCreate.mockResolvedValue(mockResponse("I see it"));
      const provider = new OpenAIProvider("fake-key", "gpt-4o");

      await provider.chatWithImage(
        "system",
        [
          { role: "user", content: "First msg" },
          { role: "assistant", content: "Ok" },
          { role: "user", content: "Describe this" },
        ],
        "base64data",
        "image/png"
      );

      const callArgs = mockCreate.mock.calls[0][0];
      const messages = callArgs.messages;

      // System message first
      expect(messages[0].role).toBe("system");

      // Last user message should have image_url + text
      const lastMsg = messages[messages.length - 1];
      expect(lastMsg.role).toBe("user");
      expect(lastMsg.content).toBeInstanceOf(Array);
      expect(lastMsg.content[0].type).toBe("image_url");
      expect(lastMsg.content[0].image_url.url).toBe(
        "data:image/png;base64,base64data"
      );
      expect(lastMsg.content[1].type).toBe("text");
      expect(lastMsg.content[1].text).toBe("Describe this");
    });

    it("keeps earlier messages as plain strings", async () => {
      mockCreate.mockResolvedValue(mockResponse("ok"));
      const provider = new OpenAIProvider("fake-key", "gpt-4o");

      await provider.chatWithImage(
        "sys",
        [
          { role: "user", content: "First" },
          { role: "assistant", content: "Second" },
          { role: "user", content: "Third" },
        ],
        "img"
      );

      const callArgs = mockCreate.mock.calls[0][0];
      const messages = callArgs.messages;

      // messages[0] = system, messages[1] = First (plain), messages[2] = Second (plain)
      expect(messages[1].content).toBe("First");
      expect(messages[2].content).toBe("Second");
    });
  });
});
