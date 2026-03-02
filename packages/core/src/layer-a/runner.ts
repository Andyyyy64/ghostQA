import type { AiClient } from "../ai/client";
import type { DiffAnalysis } from "../types/impact";
import type { GhostQAConfig } from "../types/config";
import type { Discovery } from "../types/discovery";
import { TestGenerator } from "./test-generator";
import { TestRunner, type LayerAResult } from "./test-runner";
import consola from "consola";

export class LayerARunner {
  private generator: TestGenerator;
  private runner: TestRunner;

  constructor(
    private ai: AiClient,
    private config: GhostQAConfig,
    outputDir: string
  ) {
    this.generator = new TestGenerator(ai, config.layer_a, config.app.url);
    this.runner = new TestRunner(config.layer_a, outputDir);
  }

  async run(analysis: DiffAnalysis): Promise<LayerAResult> {
    consola.info("=== Layer A: Test Generation & Execution ===");

    const tests = await this.generator.generate(analysis);
    consola.info(`Generated ${tests.length} test file(s)`);

    if (tests.length === 0) {
      return { tests: [], discoveries: [] };
    }

    return this.runner.run(tests);
  }
}
