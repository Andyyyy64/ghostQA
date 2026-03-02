import { writeFile, mkdir, rm, symlink, stat, cp, readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { createRequire } from "node:module";
import { execa } from "execa";
import { nanoid } from "nanoid";
import consola from "consola";
import type { GeneratedTest } from "./test-generator";
import type { Discovery } from "../types/discovery";
import type { LayerAConfig } from "../types/config";

// Resolve paths from ghostqa's own @playwright/test dependency
function resolvePlaywright(): { cli: string; nodeModules: string } | null {
  try {
    const require = createRequire(import.meta.url);
    const pkgPath = require.resolve("@playwright/test/package.json");
    const pkgDir = dirname(pkgPath);
    const cli = join(pkgDir, "cli.js");
    // node_modules directory (parent of @playwright/)
    const nodeModules = join(pkgDir, "..", "..");
    return { cli, nodeModules };
  } catch {
    return null;
  }
}

export interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
  duration: number;
}

export interface LayerAResult {
  tests: TestResult[];
  discoveries: Discovery[];
}

export class TestRunner {
  constructor(
    private config: LayerAConfig,
    private outputDir: string
  ) {}

  async run(tests: GeneratedTest[]): Promise<LayerAResult> {
    if (tests.length === 0) {
      return { tests: [], discoveries: [] };
    }

    const tmpDir = join(this.outputDir, ".layer-a-tests");
    await mkdir(tmpDir, { recursive: true });

    const pw = resolvePlaywright();

    // Symlink node_modules into test dir so imports resolve
    if (pw) {
      const symlinkPath = join(tmpDir, "node_modules");
      try {
        await stat(symlinkPath);
      } catch {
        await symlink(pw.nodeModules, symlinkPath, "junction").catch(() =>
          symlink(pw.nodeModules, symlinkPath, "dir").catch(() => {
            consola.debug(`Failed to symlink node_modules`);
          })
        );
      }
    }

    const results: TestResult[] = [];
    const discoveries: Discovery[] = [];

    try {
      for (const test of tests) {
        const testFile = join(tmpDir, `${test.name}-${nanoid(6)}.spec.ts`);
        await writeFile(testFile, test.code, "utf-8");
        consola.debug(`Written test: ${testFile}`);

        const result = await this.runSingleTest(pw, testFile, test.name, tmpDir);

        // Retry once on failure — flaky tests or timing issues
        if (!result.passed) {
          consola.debug(`Retrying failed test: ${test.name}`);
          const retry = await this.runSingleTest(pw, testFile, test.name, tmpDir);
          if (retry.passed) {
            results.push(retry);
            continue;
          }
        }

        results.push(result);
        if (!result.passed) {
          discoveries.push({
            id: `la-${nanoid(8)}`,
            source: "layer-a",
            severity: "high",
            title: `Test failed: ${test.name}`,
            description: result.error?.slice(0, 500) ?? "Unknown error",
            url: "",
            timestamp: Date.now(),
          });
        }
      }
    } finally {
      // Copy generated tests to a permanent location before cleanup
      const savedDir = join(this.outputDir, "generated-tests");
      try {
        await mkdir(savedDir, { recursive: true });
        await cp(tmpDir, savedDir, {
          recursive: true,
          filter: (src) => !src.includes("node_modules"),
        });
        consola.info(`Generated tests saved to ${savedDir}`);
      } catch {
        // save best-effort
      }

      try {
        await rm(tmpDir, { recursive: true });
      } catch {
        // cleanup best-effort
      }
    }

    const passed = results.filter((r) => r.passed).length;
    const failed = results.filter((r) => !r.passed).length;
    consola.info(`Layer A: ${passed} passed, ${failed} failed`);

    return { tests: results, discoveries };
  }

  private async runSingleTest(
    pw: ReturnType<typeof resolvePlaywright>,
    testFile: string,
    testName: string,
    tmpDir: string
  ): Promise<TestResult> {
    const startTime = Date.now();
    const jsonOutputPath = join(tmpDir, `results-${nanoid(4)}.json`);

    try {
      const cmd = pw ? "node" : "npx";
      const args = pw
        ? [pw.cli, "test", testFile, "--reporter=json", "--timeout", String(this.config.timeout_per_test)]
        : ["playwright", "test", testFile, "--reporter=json", "--timeout", String(this.config.timeout_per_test)];

      await execa(cmd, args, {
        timeout: this.config.timeout_per_test + 5000,
        env: {
          ...process.env,
          PLAYWRIGHT_JSON_OUTPUT_NAME: jsonOutputPath,
        },
      });

      return { name: testName, passed: true, duration: Date.now() - startTime };
    } catch (err) {
      const duration = Date.now() - startTime;

      // Try to extract structured error from Playwright JSON report
      const detailedError = await this.extractPlaywrightError(jsonOutputPath);
      const rawError = err instanceof Error ? err.message : String(err);
      const errorMsg = detailedError ?? rawError;

      return { name: testName, passed: false, error: errorMsg, duration };
    }
  }

  /** Extract the actual assertion/test error from Playwright's JSON report */
  private async extractPlaywrightError(jsonPath: string): Promise<string | null> {
    try {
      const raw = await readFile(jsonPath, "utf-8");
      const report = JSON.parse(raw);

      // Playwright JSON report structure: { suites: [{ specs: [{ tests: [{ results: [{ errors }] }] }] }] }
      const errors: string[] = [];
      for (const suite of report.suites ?? []) {
        for (const spec of suite.specs ?? []) {
          for (const test of spec.tests ?? []) {
            for (const result of test.results ?? []) {
              if (result.errors?.length > 0) {
                for (const e of result.errors) {
                  const msg = e.message ?? e.stack ?? "";
                  if (msg) errors.push(msg.slice(0, 300));
                }
              }
            }
          }
        }
      }

      return errors.length > 0 ? errors.join("\n---\n") : null;
    } catch {
      return null;
    }
  }
}
