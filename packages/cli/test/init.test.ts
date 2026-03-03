import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile, access } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

const CLI = join(import.meta.dirname, "../../cli/dist/index.js");

function run(args: string[], cwd: string) {
  const result = spawnSync("node", [CLI, ...args], {
    cwd,
    encoding: "utf-8",
    timeout: 10_000,
  });
  return {
    output: (result.stdout ?? "") + (result.stderr ?? ""),
    exitCode: result.status ?? 1,
  };
}

describe("ghostqa init", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "ghostqa-cli-init-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("creates .ghostqa.yml in target directory", async () => {
    run(["init"], tmpDir);
    const configPath = join(tmpDir, ".ghostqa.yml");
    await access(configPath);
    const content = await readFile(configPath, "utf-8");
    expect(content).toContain("app:");
    expect(content).toContain("ai:");
  });

  it("warns when config already exists", () => {
    run(["init"], tmpDir);
    const result = run(["init"], tmpDir);
    expect(result.output).toMatch(/already exists/i);
  });

  it("--force overwrites existing config", async () => {
    run(["init"], tmpDir);
    const result = run(["init", "--force"], tmpDir);
    expect(result.exitCode).toBe(0);
    // Verify the file was recreated
    const content = await readFile(join(tmpDir, ".ghostqa.yml"), "utf-8");
    expect(content).toContain("app:");
  });
});
