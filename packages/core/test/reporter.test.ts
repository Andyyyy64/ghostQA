import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdir } from "node:fs/promises";
import { Reporter } from "../src/reporter/reporter";
import type { RunResult, Discovery } from "../src/types/discovery";

function makeResult(discoveries: Discovery[] = []): RunResult {
  return {
    run_id: "test-run-1",
    verdict: "pass",
    started_at: Date.now() - 10_000,
    finished_at: Date.now(),
    config: {},
    diff_analysis: { summary: "Test diff", files_changed: 2, impact_areas: 1 },
    layer_a: { tests_generated: 3, tests_passed: 2, tests_failed: 1, discoveries: [] },
    layer_b: { steps_taken: 10, pages_visited: 3, discoveries: [] },
    cost: { total_usd: 0.5, input_tokens: 1000, output_tokens: 500, is_rate_limited: false },
    discoveries,
  };
}

function makeDiscovery(severity: Discovery["severity"]): Discovery {
  return {
    id: `d-${severity}`,
    source: "layer-b",
    severity,
    title: `${severity} issue`,
    description: `A ${severity} severity issue`,
    url: "http://localhost:3000/",
    timestamp: Date.now(),
  };
}

describe("Reporter", () => {
  let tmpDir: string;
  let reporter: Reporter;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "ghostqa-report-"));
    await mkdir(tmpDir, { recursive: true });
    reporter = new Reporter(tmpDir);
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  describe("determineVerdict", () => {
    it("returns pass when no discoveries", () => {
      expect(reporter.determineVerdict([])).toBe("pass");
    });

    it("returns warn for medium severity", () => {
      expect(reporter.determineVerdict([makeDiscovery("medium")])).toBe("warn");
    });

    it("returns fail for high severity", () => {
      expect(reporter.determineVerdict([makeDiscovery("high")])).toBe("fail");
    });

    it("returns fail for critical severity", () => {
      expect(reporter.determineVerdict([makeDiscovery("critical")])).toBe("fail");
    });

    it("returns pass for low/info only", () => {
      expect(
        reporter.determineVerdict([makeDiscovery("low"), makeDiscovery("info")])
      ).toBe("pass");
    });

    it("fail takes precedence over warn", () => {
      expect(
        reporter.determineVerdict([makeDiscovery("medium"), makeDiscovery("critical")])
      ).toBe("fail");
    });
  });

  describe("writeJson", () => {
    it("writes valid JSON summary", async () => {
      const result = makeResult();
      const path = await reporter.writeJson(result);
      const content = JSON.parse(await readFile(path, "utf-8"));
      expect(content.run_id).toBe("test-run-1");
      expect(content.verdict).toBe("pass");
      expect(content.cost.total_usd).toBe(0.5);
    });
  });

  describe("writeHtml", () => {
    it("writes HTML report with verdict", async () => {
      const result = makeResult([makeDiscovery("high")]);
      result.verdict = "fail";
      const path = await reporter.writeHtml(result);
      const html = await readFile(path, "utf-8");
      expect(html).toContain("<!DOCTYPE html>");
      expect(html).toContain("ghostQA Report");
      expect(html).toContain("FAIL");
      expect(html).toContain("high issue");
    });

    it("escapes HTML in discovery fields", async () => {
      const d = makeDiscovery("medium");
      d.title = '<script>alert("xss")</script>';
      const result = makeResult([d]);
      const path = await reporter.writeHtml(result);
      const html = await readFile(path, "utf-8");
      expect(html).not.toContain("<script>");
      expect(html).toContain("&lt;script&gt;");
    });
  });
});
