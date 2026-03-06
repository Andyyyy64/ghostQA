import * as core from "@actions/core";
import * as github from "@actions/github";
import { loadConfig, runPipeline, comparePipeline } from "@ghostqa/core";
import { formatComparisonComment, formatSingleRunComment } from "./format";

async function run(): Promise<void> {
  try {
    const cwd = process.cwd();
    const configFile = core.getInput("config") || undefined;
    const config = await loadConfig(cwd, configFile);

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

run();
