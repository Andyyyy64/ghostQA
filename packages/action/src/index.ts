import * as core from "@actions/core";
import * as github from "@actions/github";
import { readFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { loadConfig, runPipeline, comparePipeline } from "@ghostqa/core";

async function run(): Promise<void> {
  try {
    const cwd = process.cwd();
    const config = await loadConfig(cwd);

    // Apply input overrides
    const budget = core.getInput("budget");
    if (budget) {
      config.ai.max_budget_usd = parseFloat(budget);
    }
    if (core.getInput("explore") === "false") {
      config.explorer.enabled = false;
    }

    const baseInput = core.getInput("base");
    const headInput = core.getInput("head") || "HEAD";

    // Auto-detect base from PR context
    let baseRef = baseInput;
    if (!baseRef && github.context.payload.pull_request) {
      baseRef = github.context.payload.pull_request.base.sha;
    }

    let verdict: string;
    let discoveryCount: number;
    let reportPath: string;
    let costUsd: number;
    let commentBody: string;

    if (baseRef) {
      // Before/After comparison mode
      core.info(`Running comparison: ${baseRef} → ${headInput}`);
      const result = await comparePipeline({
        config,
        cwd,
        baseRef,
        headRef: headInput,
        onProgress: (msg) => core.info(msg),
      });

      verdict = result.verdict;
      discoveryCount = result.regressions.new_discoveries.length;
      reportPath = result.report_path;
      costUsd = result.cost.total_usd;

      commentBody = formatComparisonComment(result);
    } else {
      // Single-run mode
      core.info("Running single pipeline (no base ref detected)");
      const result = await runPipeline({
        config,
        cwd,
        diffRef: "HEAD~1",
        onProgress: (msg) => core.info(msg),
      });

      verdict = result.verdict;
      discoveryCount = result.discoveries.length;
      reportPath = result.report_path;
      costUsd = result.cost.total_usd;

      commentBody = formatSingleRunComment(result);
    }

    // Set outputs
    core.setOutput("verdict", verdict);
    core.setOutput("discoveries", discoveryCount.toString());
    core.setOutput("report-path", reportPath);
    core.setOutput("cost", costUsd.toFixed(4));

    // Post PR comment if enabled and in PR context
    if (
      core.getInput("comment") !== "false" &&
      github.context.payload.pull_request
    ) {
      const token = process.env.GITHUB_TOKEN;
      if (token) {
        const octokit = github.getOctokit(token);
        const { owner, repo } = github.context.repo;
        const prNumber = github.context.payload.pull_request.number;

        // Find existing ghostQA comment to update
        const { data: comments } = await octokit.rest.issues.listComments({
          owner,
          repo,
          issue_number: prNumber,
        });

        const existingComment = comments.find(
          (c: { body?: string }) => c.body?.includes("ghostqa Report")
        );

        if (existingComment) {
          await octokit.rest.issues.updateComment({
            owner,
            repo,
            comment_id: existingComment.id,
            body: commentBody,
          });
        } else {
          await octokit.rest.issues.createComment({
            owner,
            repo,
            issue_number: prNumber,
            body: commentBody,
          });
        }

        core.info("PR comment posted");
      } else {
        core.warning("GITHUB_TOKEN not set — skipping PR comment");
      }
    }

    // Fail the action if verdict is fail
    if (verdict === "fail") {
      core.setFailed(`ghostQA verdict: FAIL (${discoveryCount} issue(s) found)`);
    }
  } catch (err) {
    core.setFailed(err instanceof Error ? err.message : String(err));
  }
}

function formatComparisonComment(result: {
  verdict: string;
  cost: { total_usd: number; is_rate_limited: boolean };
  regressions: {
    new_discoveries: Array<{ title: string; severity: string; description: string }>;
    fixed_discoveries: Array<{ title: string }>;
  };
  behavioral: {
    console_errors: { base: number; head: number; delta: number };
  };
  base: { explorer: { steps_taken: number; pages_visited: number }; discoveries: unknown[] };
  head: { explorer: { steps_taken: number; pages_visited: number }; discoveries: unknown[] };
}): string {
  const icon =
    result.verdict === "pass"
      ? ":white_check_mark:"
      : result.verdict === "fail"
        ? ":x:"
        : ":warning:";

  const costStr = result.cost.is_rate_limited
    ? "Rate limited"
    : `$${result.cost.total_usd.toFixed(2)}`;

  let body = `## :ghost: ghostqa Report\n\n`;
  body += `**Verdict: ${icon} ${result.verdict.toUpperCase()}** | :moneybag: ${costStr}\n\n`;

  body += `### Before / After\n\n`;
  body += `| | Base | Head | Delta |\n`;
  body += `|---|---|---|---|\n`;
  body += `| Exploration Steps | ${result.base.explorer.steps_taken} | ${result.head.explorer.steps_taken} | — |\n`;
  body += `| Discoveries | ${result.base.discoveries.length} | ${result.head.discoveries.length} | ${result.regressions.new_discoveries.length} new, ${result.regressions.fixed_discoveries.length} fixed |\n`;
  body += `| Console errors | ${result.behavioral.console_errors.base} | ${result.behavioral.console_errors.head} | ${result.behavioral.console_errors.delta > 0 ? `:warning: +${result.behavioral.console_errors.delta}` : "OK"} |\n\n`;

  if (result.regressions.new_discoveries.length > 0) {
    body += `### :x: New Issues\n\n`;
    for (const d of result.regressions.new_discoveries) {
      body += `- **[${d.severity.toUpperCase()}]** ${d.title}\n  ${d.description.slice(0, 200)}\n\n`;
    }
  }

  if (result.regressions.fixed_discoveries.length > 0) {
    body += `### :white_check_mark: Fixed Issues\n\n`;
    for (const d of result.regressions.fixed_discoveries) {
      body += `- ~~${d.title}~~\n`;
    }
    body += "\n";
  }

  body += `---\n:robot: Generated with [ghostQA](https://github.com/user/ghostqa)`;

  return body;
}

function formatSingleRunComment(result: {
  verdict: string;
  discoveries: Array<{ title: string; severity: string; description: string }>;
  cost: { total_usd: number; is_rate_limited: boolean };
}): string {
  const icon =
    result.verdict === "pass"
      ? ":white_check_mark:"
      : result.verdict === "fail"
        ? ":x:"
        : ":warning:";

  const costStr = result.cost.is_rate_limited
    ? "Rate limited"
    : `$${result.cost.total_usd.toFixed(2)}`;

  let body = `## :ghost: ghostqa Report\n\n`;
  body += `**Verdict: ${icon} ${result.verdict.toUpperCase()}** | :moneybag: ${costStr}\n\n`;

  if (result.discoveries.length > 0) {
    body += `### Discoveries (${result.discoveries.length})\n\n`;
    for (const d of result.discoveries) {
      body += `- **[${d.severity.toUpperCase()}]** ${d.title}\n  ${d.description.slice(0, 200)}\n\n`;
    }
  } else {
    body += `No issues found.\n\n`;
  }

  body += `---\n:robot: Generated with [ghostQA](https://github.com/user/ghostqa)`;

  return body;
}

run();
