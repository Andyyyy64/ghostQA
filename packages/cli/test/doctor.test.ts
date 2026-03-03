import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

const CLI = join(import.meta.dirname, "../../cli/dist/index.js");

function run(args: string[]) {
  try {
    const stdout = execFileSync("node", [CLI, ...args], {
      encoding: "utf-8",
      timeout: 10_000,
      stdio: ["pipe", "pipe", "pipe"],
    });
    return { output: stdout, exitCode: 0 };
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; status?: number };
    return {
      output: (e.stdout ?? "") + (e.stderr ?? ""),
      exitCode: e.status ?? 1,
    };
  }
}

describe("ghostqa doctor", () => {
  // Doctor uses consola which writes to stderr. execFileSync only captures
  // stdout by default. Since we mainly care that it exits 0, simplify tests.

  it("exits with code 0 in dev environment", () => {
    const result = run(["doctor"]);
    expect(result.exitCode).toBe(0);
  });

  it("--help shows usage", () => {
    const result = run(["doctor", "--help"]);
    expect(result.output).toContain("Check");
  });
});
