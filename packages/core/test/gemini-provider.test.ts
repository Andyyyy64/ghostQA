import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the @google/generative-ai module
const mockGenerateContent = vi.fn();
const mockGetGenerativeModel = vi.fn().mockReturnValue({
  generateContent: mockGenerateContent,
});

vi.mock("@google/generative-ai", () => ({
  GoogleGenerativeAI: class {
    constructor() {}
    getGenerativeModel = mockGetGenerativeModel;
  },
}));

import { GeminiProvider } from "../src/ai/gemini-provider";

function mockResponse(text: string, inputTokens = 100, outputTokens = 50) {
  return {
    response: {
      text: () => text,
      usageMetadata: {
        promptTokenCount: inputTokens,
        candidatesTokenCount: outputTokens,
      },
    },
  };
}

describe("GeminiProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("chat", () => {
    it("converts assistant role to model role", async () => {
      mockGenerateContent.mockResolvedValue(mockResponse("Hello"));
      const provider = new GeminiProvider("fake-key", "gemini-2.0-flash");

      await provider.chat("system prompt", [
        { role: "user", content: "Hi" },
        { role: "assistant", content: "Hello" },
        { role: "user", content: "How are you?" },
      ]);

      const callArgs = mockGenerateContent.mock.calls[0][0];
      expect(callArgs.contents[0].role).toBe("user");
      expect(callArgs.contents[1].role).toBe("model");
      expect(callArgs.contents[2].role).toBe("user");
    });

    it("sets system instruction", async () => {
      mockGenerateContent.mockResolvedValue(mockResponse("ok"));
      const provider = new GeminiProvider("fake-key", "gemini-2.0-flash");

      await provider.chat("Be helpful", [{ role: "user", content: "Hi" }]);

      expect(mockGetGenerativeModel).toHaveBeenCalledWith(
        expect.objectContaining({
          systemInstruction: "Be helpful",
        })
      );
    });

    it("extracts token counts from usageMetadata", async () => {
      mockGenerateContent.mockResolvedValue(mockResponse("response", 200, 80));
      const provider = new GeminiProvider("fake-key", "gemini-2.0-flash");

      const result = await provider.chat("sys", [
        { role: "user", content: "test" },
      ]);

      expect(result.inputTokens).toBe(200);
      expect(result.outputTokens).toBe(80);
      expect(result.text).toBe("response");
    });
  });

  describe("chatWithImage", () => {
    it("prepends image inlineData to last message parts", async () => {
      mockGenerateContent.mockResolvedValue(mockResponse("I see an image"));
      const provider = new GeminiProvider("fake-key", "gemini-2.0-flash");

      await provider.chatWithImage(
        "system",
        [{ role: "user", content: "Describe this" }],
        "base64data",
        "image/png"
      );

      const callArgs = mockGenerateContent.mock.calls[0][0];
      const lastContent = callArgs.contents[callArgs.contents.length - 1];
      // Image part should be first
      expect(lastContent.parts[0].inlineData).toEqual({
        data: "base64data",
        mimeType: "image/png",
      });
      // Text part should follow
      expect(lastContent.parts[1].text).toBe("Describe this");
    });

    it("defaults mediaType to image/png", async () => {
      mockGenerateContent.mockResolvedValue(mockResponse("ok"));
      const provider = new GeminiProvider("fake-key", "gemini-2.0-flash");

      await provider.chatWithImage(
        "system",
        [{ role: "user", content: "test" }],
        "data"
      );

      const callArgs = mockGenerateContent.mock.calls[0][0];
      const lastContent = callArgs.contents[callArgs.contents.length - 1];
      expect(lastContent.parts[0].inlineData.mimeType).toBe("image/png");
    });
  });
});
