import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { CliProvider } from "../src/ai/cli-provider";

// Access private methods via type cast for unit testing
function asAny(provider: CliProvider): any {
  return provider as any;
}

describe("CliProvider", () => {
  describe("buildPrompt", () => {
    it("joins system + messages with --- separator", () => {
      const p = new CliProvider("claude");
      const result = asAny(p).buildPrompt("You are a tester", [
        { role: "user", content: "Hello" },
        { role: "assistant", content: "Hi there" },
      ]);
      expect(result).toContain("You are a tester");
      expect(result).toContain("---");
      expect(result).toContain("User:\nHello");
      expect(result).toContain("Assistant:\nHi there");
    });

    it("appends image read instruction when imagePath provided", () => {
      const p = new CliProvider("claude");
      const result = asAny(p).buildPrompt(
        "system",
        [{ role: "user", content: "Describe" }],
        "/tmp/screenshot.png"
      );
      expect(result).toContain("Read and analyze the screenshot");
      expect(result).toContain("/tmp/screenshot.png");
    });

    it("does not include image instruction without imagePath", () => {
      const p = new CliProvider("claude");
      const result = asAny(p).buildPrompt("system", [
        { role: "user", content: "Hello" },
      ]);
      expect(result).not.toContain("screenshot");
    });
  });

  describe("buildArgs", () => {
    it("claude: returns -p --output-format json --dangerously-skip-permissions", () => {
      const p = new CliProvider("claude");
      const args = asAny(p).buildArgs();
      expect(args).toContain("-p");
      expect(args).toContain("--output-format");
      expect(args).toContain("json");
      expect(args).toContain("--dangerously-skip-permissions");
    });

    it("codex: returns exec --dangerously-bypass-approvals-and-sandbox", () => {
      const p = new CliProvider("codex");
      const args = asAny(p).buildArgs();
      expect(args).toContain("exec");
      expect(args).toContain("--dangerously-bypass-approvals-and-sandbox");
    });

    it("codex + imagePath: includes -i <path>", () => {
      const p = new CliProvider("codex");
      const args = asAny(p).buildArgs("/tmp/img.png");
      expect(args).toContain("-i");
      expect(args).toContain("/tmp/img.png");
    });

    it("codex without imagePath: no -i flag", () => {
      const p = new CliProvider("codex");
      const args = asAny(p).buildArgs();
      expect(args).not.toContain("-i");
    });

    it("gemini: returns -p --output-format json", () => {
      const p = new CliProvider("gemini");
      const args = asAny(p).buildArgs();
      expect(args).toContain("-p");
      expect(args).toContain("--output-format");
      expect(args).toContain("json");
    });

    it("unknown command: returns only extraArgs", () => {
      const p = new CliProvider("my-custom-tool", ["--flag"]);
      const args = asAny(p).buildArgs();
      expect(args).toEqual(["--flag"]);
    });

    it("passes extraArgs for claude", () => {
      const p = new CliProvider("claude", ["--model", "opus"]);
      const args = asAny(p).buildArgs();
      expect(args).toContain("--model");
      expect(args).toContain("opus");
    });
  });

  describe("parseClaudeJson", () => {
    it("parses valid Claude JSON output with usage", () => {
      const p = new CliProvider("claude");
      const raw = JSON.stringify({
        result: "Hello world",
        total_cost_usd: 0.005,
        usage: {
          input_tokens: 100,
          output_tokens: 50,
          cache_creation_input_tokens: 10,
          cache_read_input_tokens: 5,
        },
      });

      const response = asAny(p).parseClaudeJson(raw, "test prompt");

      expect(response.text).toBe("Hello world");
      expect(response.inputTokens).toBe(115); // 100 + 10 + 5
      expect(response.outputTokens).toBe(50);
      expect(p.reportedCostUsd).toBe(0.005);
    });

    it("falls back to text when JSON is invalid", () => {
      const p = new CliProvider("claude");
      const raw = "This is not JSON";

      const response = asAny(p).parseClaudeJson(raw, "test prompt");

      expect(response.text).toBe("This is not JSON");
      // Should use estimateTokens fallback
      expect(response.inputTokens).toBeGreaterThan(0);
      expect(response.outputTokens).toBeGreaterThan(0);
    });

    it("handles missing usage fields gracefully", () => {
      const p = new CliProvider("claude");
      const raw = JSON.stringify({ result: "response text" });

      const response = asAny(p).parseClaudeJson(raw, "prompt");

      expect(response.text).toBe("response text");
      expect(response.inputTokens).toBe(0);
      expect(response.outputTokens).toBe(0);
    });
  });

  describe("parseGeminiJson", () => {
    it("parses valid Gemini JSON with response field", () => {
      const p = new CliProvider("gemini");
      const raw = JSON.stringify({
        response: "Gemini says hello",
        usage: { input_tokens: 80, output_tokens: 30 },
      });

      const response = asAny(p).parseGeminiJson(raw, "prompt");

      expect(response.text).toBe("Gemini says hello");
      expect(response.inputTokens).toBe(80);
      expect(response.outputTokens).toBe(30);
    });

    it("falls back to raw text on parse failure", () => {
      const p = new CliProvider("gemini");
      const response = asAny(p).parseGeminiJson("bad json", "prompt");

      expect(response.text).toBe("bad json");
    });
  });

  describe("isClaude / isCodex / isGemini", () => {
    it("identifies claude command", () => {
      const p = new CliProvider("claude");
      expect(asAny(p).isClaude()).toBe(true);
      expect(asAny(p).isCodex()).toBe(false);
      expect(asAny(p).isGemini()).toBe(false);
    });

    it("identifies codex command", () => {
      const p = new CliProvider("codex");
      expect(asAny(p).isCodex()).toBe(true);
      expect(asAny(p).isClaude()).toBe(false);
    });

    it("identifies gemini command", () => {
      const p = new CliProvider("gemini");
      expect(asAny(p).isGemini()).toBe(true);
      expect(asAny(p).isClaude()).toBe(false);
    });

    it("identifies command from full path", () => {
      const p = new CliProvider("/usr/local/bin/claude");
      expect(asAny(p).isClaude()).toBe(true);
    });
  });
});
