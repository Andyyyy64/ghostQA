import { writeFile, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { execa } from "execa";
import { nanoid } from "nanoid";
import consola from "consola";
import type { GeneratedTest } from "./test-generator";
import type { Discovery } from "../types/discovery";
import type { LayerAConfig } from "../types/config";

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

    const results: TestResult[] = [];
    const discoveries: Discovery[] = [];

    try {
      for (const test of tests) {
        const testFile = join(tmpDir, `${test.name}-${nanoid(6)}.spec.ts`);
        await writeFile(testFile, test.code, "utf-8");
        consola.debug(`Written test: ${testFile}`);

        const startTime = Date.now();
        try {
          await execa(
            "npx",
            [
              "playwright",
              "test",
              testFile,
              "--reporter=json",
              "--timeout",
              String(this.config.timeout_per_test),
            ],
            {
              timeout: this.config.timeout_per_test + 5000,
              env: { ...process.env, PLAYWRIGHT_JSON_OUTPUT_NAME: "results.json" },
            }
          );

          results.push({
            name: test.name,
            passed: true,
            duration: Date.now() - startTime,
          });
        } catch (err) {
          const duration = Date.now() - startTime;
          const errorMsg =
            err instanceof Error ? err.message : String(err);

          results.push({
            name: test.name,
            passed: false,
            error: errorMsg,
            duration,
          });

          discoveries.push({
            id: `la-${nanoid(8)}`,
            source: "layer-a",
            severity: "high",
            title: `Test failed: ${test.name}`,
            description: errorMsg.slice(0, 500),
            url: "",
            timestamp: Date.now(),
          });
        }
      }
    } finally {
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
}
