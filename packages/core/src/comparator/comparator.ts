import { readdir, readFile } from "node:fs/promises";
import { join, basename } from "node:path";
import type { RunResult, Discovery } from "../types/discovery";
import type {
  ComparisonResult,
  BehavioralDiff,
  VisualDiffEntry,
} from "../types/comparison";

export class Comparator {
  compare(
    baseResult: RunResult,
    headResult: RunResult,
    baseRef: string,
    headRef: string
  ): ComparisonResult {
    const regressions = this.compareDiscoveries(
      baseResult.discoveries,
      headResult.discoveries
    );

    const behavioral = this.compareBehavioral(baseResult, headResult);

    const verdict = this.determineVerdict(regressions, behavioral);

    return {
      run_id: headResult.run_id,
      verdict,
      base_ref: baseRef,
      head_ref: headRef,
      started_at: baseResult.started_at,
      finished_at: headResult.finished_at,
      diff_analysis: headResult.diff_analysis,
      base: {
        run_id: baseResult.run_id,
        explorer: baseResult.explorer,
        discoveries: baseResult.discoveries,
      },
      head: {
        run_id: headResult.run_id,
        explorer: headResult.explorer,
        discoveries: headResult.discoveries,
      },
      regressions: {
        new_discoveries: regressions.newDiscoveries,
        fixed_discoveries: regressions.fixedDiscoveries,
      },
      behavioral,
      visual: { pages_compared: 0, diffs: [] },
      cost: {
        total_usd: baseResult.cost.total_usd + headResult.cost.total_usd,
        input_tokens: baseResult.cost.input_tokens + headResult.cost.input_tokens,
        output_tokens:
          baseResult.cost.output_tokens + headResult.cost.output_tokens,
        is_rate_limited:
          baseResult.cost.is_rate_limited || headResult.cost.is_rate_limited,
      },
    };
  }

  /**
   * Compare screenshots from two run dirs using pixel-level diff.
   * Mutates the `visual` field of the comparison result.
   */
  async compareVisual(
    baseRunDir: string,
    headRunDir: string,
    diffOutputDir: string
  ): Promise<VisualDiffEntry[]> {
    const { default: pixelmatch } = await import("pixelmatch");
    const { PNG } = await import("pngjs");
    const { writeFile, mkdir } = await import("node:fs/promises");

    await mkdir(diffOutputDir, { recursive: true });

    const baseScreenshots = await this.listScreenshots(
      join(baseRunDir, "screenshots")
    );
    const headScreenshots = await this.listScreenshots(
      join(headRunDir, "screenshots")
    );

    // Match screenshots by filename
    const commonNames = baseScreenshots.filter((name) =>
      headScreenshots.includes(name)
    );

    const diffs: VisualDiffEntry[] = [];

    for (const name of commonNames) {
      const basePath = join(baseRunDir, "screenshots", name);
      const headPath = join(headRunDir, "screenshots", name);

      try {
        const baseImg = PNG.sync.read(await readFile(basePath));
        const headImg = PNG.sync.read(await readFile(headPath));

        // Resize to smaller if dimensions don't match
        if (
          baseImg.width !== headImg.width ||
          baseImg.height !== headImg.height
        ) {
          continue; // Skip mismatched dimensions
        }

        const { width, height } = baseImg;
        const diffImg = new PNG({ width, height });
        const numDiffPixels = pixelmatch(
          baseImg.data,
          headImg.data,
          diffImg.data,
          width,
          height,
          { threshold: 0.1 }
        );

        const diffPercent = (numDiffPixels / (width * height)) * 100;

        if (diffPercent > 0.5) {
          // Only report meaningful diffs
          const diffPath = join(diffOutputDir, `diff-${name}`);
          await writeFile(diffPath, PNG.sync.write(diffImg));

          diffs.push({
            page_url: name.replace(/\.png$/, ""),
            base_screenshot: basePath,
            head_screenshot: headPath,
            diff_image: diffPath,
            diff_percent: Math.round(diffPercent * 100) / 100,
          });
        }
      } catch {
        // Skip files that can't be compared
      }
    }

    return diffs;
  }

  private compareDiscoveries(
    baseDiscoveries: Discovery[],
    headDiscoveries: Discovery[]
  ): { newDiscoveries: Discovery[]; fixedDiscoveries: Discovery[] } {
    const baseTitles = new Set(baseDiscoveries.map((d) => d.title.toLowerCase()));
    const headTitles = new Set(headDiscoveries.map((d) => d.title.toLowerCase()));

    const newDiscoveries = headDiscoveries.filter(
      (d) => !baseTitles.has(d.title.toLowerCase())
    );
    const fixedDiscoveries = baseDiscoveries.filter(
      (d) => !headTitles.has(d.title.toLowerCase())
    );

    return { newDiscoveries, fixedDiscoveries };
  }

  private compareBehavioral(
    baseResult: RunResult,
    headResult: RunResult
  ): BehavioralDiff {
    const baseConsoleErrors = this.countConsoleErrors(baseResult);
    const headConsoleErrors = this.countConsoleErrors(headResult);

    return {
      console_errors: {
        base: baseConsoleErrors,
        head: headConsoleErrors,
        delta: headConsoleErrors - baseConsoleErrors,
      },
      http_failures: {
        base: 0, // HAR-based — parsed separately if available
        head: 0,
        delta: 0,
      },
    };
  }

  private countConsoleErrors(result: RunResult): number {
    let count = 0;
    for (const d of result.discoveries) {
      if (d.console_errors) {
        count += d.console_errors.length;
      }
    }
    return count;
  }

  private determineVerdict(
    regressions: { newDiscoveries: Discovery[]; fixedDiscoveries: Discovery[] },
    behavioral: BehavioralDiff
  ): "pass" | "fail" | "warn" {
    // FAIL: new critical/high discoveries
    if (
      regressions.newDiscoveries.some(
        (d) => d.severity === "critical" || d.severity === "high"
      )
    ) {
      return "fail";
    }

    // WARN: new medium discoveries or increased console errors
    if (
      regressions.newDiscoveries.some((d) => d.severity === "medium") ||
      behavioral.console_errors.delta > 0
    ) {
      return "warn";
    }

    return "pass";
  }

  private async listScreenshots(dir: string): Promise<string[]> {
    try {
      const files = await readdir(dir);
      return files.filter((f) => f.endsWith(".png"));
    } catch {
      return [];
    }
  }
}
