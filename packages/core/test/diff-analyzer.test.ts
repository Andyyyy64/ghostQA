/**
 * Tests for DiffAnalyzer — git diff → AI impact estimation.
 *
 * Mocks: execa (git), AiClient (AI response)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockExeca = vi.fn();
vi.mock("execa", () => ({
  execa: (...args: any[]) => mockExeca(...args),
}));

import { DiffAnalyzer } from "../src/diff-analyzer/analyzer";

function makeAiClient(response: string) {
  return {
    chat: vi.fn().mockResolvedValue(response),
    useTask: vi.fn().mockReturnThis(),
    resetTask: vi.fn().mockReturnThis(),
  } as any;
}

describe("DiffAnalyzer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("parses AI response into DiffAnalysis", async () => {
    const diffOutput = `diff --git a/src/login.ts b/src/login.ts
--- a/src/login.ts
+++ b/src/login.ts
@@ -1,3 +1,3 @@
-const valid = true;
+const valid = false;`;

    mockExeca.mockResolvedValue({ stdout: diffOutput });

    const aiResponse = JSON.stringify({
      summary: "Changed login validation",
      impact_areas: [
        {
          area: "Login page",
          description: "Validation logic inverted",
          risk: "high",
          affected_urls: ["/login"],
          suggested_actions: ["Test login form"],
        },
      ],
    });
    const ai = makeAiClient(aiResponse);
    const analyzer = new DiffAnalyzer(ai);

    const result = await analyzer.analyze("/project", "HEAD~1");

    expect(result.summary).toBe("Changed login validation");
    expect(result.impact_areas).toHaveLength(1);
    expect(result.impact_areas[0].area).toBe("Login page");
    expect(result.files.length).toBeGreaterThanOrEqual(1);
    expect(result.files[0].path).toBe("src/login.ts");
  });

  it("returns empty analysis when diff is empty", async () => {
    mockExeca.mockResolvedValue({ stdout: "" });
    const ai = makeAiClient("{}");
    const analyzer = new DiffAnalyzer(ai);

    const result = await analyzer.analyze("/project", "HEAD~1");

    expect(result.summary).toBe("No changes detected");
    expect(result.impact_areas).toHaveLength(0);
    // AI should NOT be called when diff is empty
    expect(ai.chat).not.toHaveBeenCalled();
  });

  it("falls back to unstaged diff when ref diff fails", async () => {
    // First call (git diff HEAD~1) fails, second call (git diff) succeeds
    mockExeca
      .mockRejectedValueOnce(new Error("bad ref"))
      .mockResolvedValueOnce({
        stdout: `diff --git a/src/app.ts b/src/app.ts
--- a/src/app.ts
+++ b/src/app.ts
@@ -1 +1 @@
-old
+new`,
      });

    const aiResponse = JSON.stringify({
      summary: "App changes",
      impact_areas: [],
    });
    const ai = makeAiClient(aiResponse);
    const analyzer = new DiffAnalyzer(ai);

    const result = await analyzer.analyze("/project", "bad-ref");

    expect(result.files.length).toBeGreaterThanOrEqual(1);
    expect(mockExeca).toHaveBeenCalledTimes(2);
  });

  it("returns fallback impact areas when AI response is invalid", async () => {
    mockExeca.mockResolvedValue({
      stdout: `diff --git a/src/app.ts b/src/app.ts
--- a/src/app.ts
+++ b/src/app.ts
@@ -1 +1 @@
-old
+new`,
    });

    const ai = makeAiClient("This is not valid JSON at all");
    const analyzer = new DiffAnalyzer(ai);

    const result = await analyzer.analyze("/project", "HEAD~1");

    // Should fallback to file-based impact areas
    expect(result.impact_areas.length).toBeGreaterThanOrEqual(1);
    expect(result.impact_areas[0].area).toBe("Application");
    expect(result.impact_areas[0].description).toContain("src/app.ts");
  });

  it("truncates long diffs before sending to AI", async () => {
    // Generate a very long diff
    const longDiff = "diff --git a/src/big.ts b/src/big.ts\n" + "x".repeat(20000);
    mockExeca.mockResolvedValue({ stdout: longDiff });

    const aiResponse = JSON.stringify({
      summary: "Big changes",
      impact_areas: [],
    });
    const ai = makeAiClient(aiResponse);
    const analyzer = new DiffAnalyzer(ai);

    await analyzer.analyze("/project", "HEAD~1");

    // The content sent to AI should be truncated
    const chatCall = ai.chat.mock.calls[0];
    const userMessage = chatCall[1][0].content;
    expect(userMessage.length).toBeLessThan(longDiff.length);
    expect(userMessage).toContain("truncated");
  });

  it("returns empty when both diff commands fail", async () => {
    mockExeca.mockRejectedValue(new Error("git not found"));
    const ai = makeAiClient("{}");
    const analyzer = new DiffAnalyzer(ai);

    const result = await analyzer.analyze("/project", "HEAD~1");

    expect(result.summary).toBe("No changes detected");
    expect(result.impact_areas).toHaveLength(0);
  });
});
