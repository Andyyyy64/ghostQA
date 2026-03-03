/**
 * Tests for `ghostqa validate` CLI command.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

const CLI = resolve(import.meta.dirname, "../dist/index.js");

describe("ghostqa validate", () => {
  let tempDir: string;

  beforeAll(() => {
    tempDir = mkdtempSync(join(tmpdir(), "ghostqa-validate-"));
  });

  afterAll(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("fails when no config file exists", () => {
    const result = spawnSync("node", [CLI, "validate"], {
      cwd: tempDir,
      encoding: "utf-8",
      timeout: 10_000,
    });
    const output = (result.stdout ?? "") + (result.stderr ?? "");
    expect(output).toMatch(/no .ghostqa.yml found/i);
    expect(result.status).toBe(1);
  });

  it("validates a well-formed config and exits 0", () => {
    const config = `
app:
  name: test-app
  build: "npm run build"
  start: "npm start"
  url: "http://localhost:3000"
`;
    writeFileSync(join(tempDir, ".ghostqa.yml"), config);

    const result = spawnSync("node", [CLI, "validate"], {
      cwd: tempDir,
      encoding: "utf-8",
      timeout: 10_000,
    });
    // Valid config should exit cleanly (0), not crash (>0)
    expect(result.status).toBe(0);
  });

  it("reports errors for invalid config", () => {
    writeFileSync(join(tempDir, ".ghostqa.yml"), "invalid: yaml: {{}}");

    const result = spawnSync("node", [CLI, "validate"], {
      cwd: tempDir,
      encoding: "utf-8",
      timeout: 10_000,
    });
    const output = (result.stdout ?? "") + (result.stderr ?? "");
    expect(output).toMatch(/invalid|error/i);
    expect(result.status).toBe(1);
  });

  it("--help shows usage", () => {
    const result = spawnSync("node", [CLI, "validate", "--help"], {
      cwd: tempDir,
      encoding: "utf-8",
      timeout: 10_000,
    });
    expect(result.stdout).toContain("Validate");
  });
});
