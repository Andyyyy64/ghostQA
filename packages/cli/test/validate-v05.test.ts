/**
 * Validate CLI e2e test for v0.5 config fields.
 *
 * Verifies that ghostqa validate accepts configs with:
 * - constraints section
 * - ai.routing section
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

const CLI = resolve(import.meta.dirname, "../dist/index.js");

describe("ghostqa validate (v0.5 config)", () => {
  let tempDir: string;

  beforeAll(() => {
    tempDir = mkdtempSync(join(tmpdir(), "ghostqa-v05-"));
  });

  afterAll(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("validates config with constraints section", () => {
    const config = `
app:
  name: test-app
  build: "npm run build"
  start: "npm start"
  url: "http://localhost:3000"

constraints:
  no_payment: true
  no_delete: true
  no_external_links: true
  allowed_domains:
    - localhost
    - "127.0.0.1"
  forbidden_selectors:
    - ".admin-only"
    - "#danger-zone"
`;
    writeFileSync(join(tempDir, ".ghostqa.yml"), config);

    const result = spawnSync("node", [CLI, "validate"], {
      cwd: tempDir,
      encoding: "utf-8",
      timeout: 10_000,
    });
    expect(result.status).toBe(0);
  });

  it("validates config with ai.routing section", () => {
    const config = `
app:
  name: test-app
  build: "npm run build"
  start: "npm start"
  url: "http://localhost:3000"

ai:
  provider: gemini
  model: gemini-2.0-flash
  api_key_env: GEMINI_API_KEY
  max_budget_usd: 5.0
  routing:
    diff_analysis:
      provider: cli
      model: claude-sonnet
      cli:
        command: claude
        args: ["-p"]
    ui_control:
      provider: gemini
      model: gemini-2.0-flash
      api_key_env: GEMINI_API_KEY
`;
    writeFileSync(join(tempDir, ".ghostqa.yml"), config);

    const result = spawnSync("node", [CLI, "validate"], {
      cwd: tempDir,
      encoding: "utf-8",
      timeout: 10_000,
    });
    expect(result.status).toBe(0);
  });

  it("validates full v0.5 config with all sections", () => {
    const config = `
app:
  name: full-app
  build: "pnpm build"
  start: "pnpm start"
  url: "http://localhost:3000"

ai:
  provider: cli
  model: claude-sonnet
  max_budget_usd: 3.0
  cli:
    command: claude
    args: ["-p"]
  routing:
    diff_analysis:
      provider: gemini
      model: gemini-2.0-flash
      api_key_env: GEMINI_API_KEY

explorer:
  enabled: true
  max_steps: 80
  max_duration: 600000
  viewport:
    width: 1440
    height: 900

constraints:
  no_payment: true
  no_delete: true
  no_external_links: false
  allowed_domains:
    - localhost
  forbidden_selectors:
    - ".internal-admin"

reporter:
  output_dir: ".ghostqa-runs"
  formats:
    - html
    - json
  video: true
  screenshots: true
`;
    writeFileSync(join(tempDir, ".ghostqa.yml"), config);

    const result = spawnSync("node", [CLI, "validate"], {
      cwd: tempDir,
      encoding: "utf-8",
      timeout: 10_000,
    });
    expect(result.status).toBe(0);
  });

});
