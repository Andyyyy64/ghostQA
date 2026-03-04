import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import consola from "consola";
import type { RunResult, Verdict, Discovery } from "../types/discovery";
import type { ComparisonResult } from "../types/comparison";

export class Reporter {
  constructor(private outputDir: string) {}

  determineVerdict(discoveries: Discovery[]): Verdict {
    if (discoveries.some((d) => d.severity === "critical" || d.severity === "high")) {
      return "fail";
    }
    if (discoveries.some((d) => d.severity === "medium")) {
      return "warn";
    }
    return "pass";
  }

  async writeJson(result: RunResult): Promise<string> {
    const path = join(this.outputDir, "summary.json");
    await writeFile(path, JSON.stringify(result, null, 2), "utf-8");
    consola.debug(`JSON report: ${path}`);
    return path;
  }

  async writeHtml(result: RunResult): Promise<string> {
    const path = join(this.outputDir, "report.html");
    const html = this.generateHtml(result);
    await writeFile(path, html, "utf-8");
    consola.info(`HTML report: ${path}`);
    return path;
  }

  async writeComparisonHtml(comparison: ComparisonResult): Promise<string> {
    const path = join(this.outputDir, "report.html");
    const html = this.generateComparisonHtml(comparison);
    await writeFile(path, html, "utf-8");
    consola.info(`Comparison report: ${path}`);
    return path;
  }

  private generateComparisonHtml(c: ComparisonResult): string {
    const verdictColor =
      c.verdict === "pass" ? "#22c55e" : c.verdict === "fail" ? "#ef4444" : "#f59e0b";

    const newDiscoveriesHtml = c.regressions.new_discoveries
      .map(
        (d) => `
      <div class="discovery ${d.severity}">
        <div class="discovery-header">
          <span class="severity-badge">${d.severity.toUpperCase()}</span>
          <span class="source-badge new">NEW</span>
          <strong>${escapeHtml(d.title)}</strong>
        </div>
        <p>${escapeHtml(d.description)}</p>
        <div class="meta"><span>URL: ${escapeHtml(d.url)}</span></div>
      </div>`
      )
      .join("\n");

    const fixedDiscoveriesHtml = c.regressions.fixed_discoveries
      .map(
        (d) => `
      <div class="discovery fixed">
        <div class="discovery-header">
          <span class="severity-badge" style="background:#22c55e;color:#000">FIXED</span>
          <strong>${escapeHtml(d.title)}</strong>
        </div>
        <p>${escapeHtml(d.description)}</p>
      </div>`
      )
      .join("\n");

    const visualDiffsHtml = c.visual.diffs
      .map(
        (v) => `
      <div class="visual-entry">
        <h4>${escapeHtml(v.page_url)} — ${v.diff_percent}% changed</h4>
        <div class="visual-row">
          <div><p>Base</p><img src="${v.base_screenshot}" /></div>
          <div><p>Diff</p><img src="${v.diff_image}" /></div>
          <div><p>Head</p><img src="${v.head_screenshot}" /></div>
        </div>
      </div>`
      )
      .join("\n");

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>ghostQA Comparison - ${c.base_ref} → ${c.head_ref}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0a0a0a; color: #e5e5e5; padding: 2rem; line-height: 1.6; }
    .container { max-width: 960px; margin: 0 auto; }
    h1 { font-size: 1.5rem; margin-bottom: 0.5rem; }
    h2 { font-size: 1.2rem; margin: 1.5rem 0 0.75rem; }
    h3 { font-size: 1rem; margin: 1rem 0 0.5rem; }
    .subtitle { color: #888; margin-bottom: 2rem; }
    .verdict-card { background: #171717; border: 1px solid #333; border-radius: 12px; padding: 1.5rem; margin-bottom: 1.5rem; display: flex; align-items: center; gap: 1rem; }
    .verdict-icon { width: 48px; height: 48px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: bold; font-size: 1.2rem; color: #000; }
    .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 1rem; margin-bottom: 1.5rem; }
    .stat-card { background: #171717; border: 1px solid #333; border-radius: 8px; padding: 1rem; }
    .stat-card .label { color: #888; font-size: 0.85rem; }
    .stat-card .value { font-size: 1.4rem; font-weight: bold; margin-top: 0.25rem; }
    .delta-up { color: #ef4444; }
    .delta-down { color: #22c55e; }
    .delta-zero { color: #888; }
    .comparison-table { width: 100%; border-collapse: collapse; margin: 0.75rem 0; }
    .comparison-table th, .comparison-table td { padding: 0.5rem 0.75rem; text-align: left; border-bottom: 1px solid #333; }
    .comparison-table th { color: #888; font-weight: normal; font-size: 0.85rem; }
    .discovery { background: #171717; border: 1px solid #333; border-radius: 8px; padding: 1rem; margin-bottom: 0.75rem; }
    .discovery.critical, .discovery.high { border-left: 4px solid #ef4444; }
    .discovery.medium { border-left: 4px solid #f59e0b; }
    .discovery.low, .discovery.info { border-left: 4px solid #3b82f6; }
    .discovery.fixed { border-left: 4px solid #22c55e; }
    .discovery-header { display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.5rem; }
    .severity-badge { font-size: 0.7rem; padding: 2px 6px; border-radius: 4px; background: #333; font-weight: bold; }
    .source-badge { font-size: 0.7rem; padding: 2px 6px; border-radius: 4px; background: #1e293b; color: #93c5fd; }
    .source-badge.new { background: #7f1d1d; color: #fca5a5; }
    .meta { color: #888; font-size: 0.85rem; margin-top: 0.5rem; }
    .section { margin-bottom: 2rem; }
    .visual-entry { margin-bottom: 1.5rem; }
    .visual-row { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 0.5rem; }
    .visual-row img { width: 100%; border: 1px solid #333; border-radius: 4px; }
    .visual-row p { color: #888; font-size: 0.85rem; margin-bottom: 0.25rem; }
  </style>
</head>
<body>
  <div class="container">
    <h1>ghostQA Comparison Report</h1>
    <p class="subtitle">${escapeHtml(c.base_ref)} → ${escapeHtml(c.head_ref)} | ${new Date(c.started_at).toLocaleString()}</p>

    <div class="verdict-card">
      <div class="verdict-icon" style="background: ${verdictColor}">
        ${c.verdict === "pass" ? "OK" : c.verdict === "fail" ? "!!" : "!"}
      </div>
      <div>
        <div style="font-size: 1.3rem; font-weight: bold;">Verdict: ${c.verdict.toUpperCase()}</div>
        <div style="color: #888;">${c.regressions.new_discoveries.length} new issue(s), ${c.regressions.fixed_discoveries.length} fixed</div>
      </div>
    </div>

    <div class="stats">
      <div class="stat-card">
        <div class="label">Console Errors</div>
        <div class="value ${c.behavioral.console_errors.delta > 0 ? "delta-up" : c.behavioral.console_errors.delta < 0 ? "delta-down" : "delta-zero"}">${c.behavioral.console_errors.base} → ${c.behavioral.console_errors.head} (${c.behavioral.console_errors.delta > 0 ? "+" : ""}${c.behavioral.console_errors.delta})</div>
      </div>
      <div class="stat-card">
        <div class="label">${c.cost.is_rate_limited ? "AI Usage" : "Total Cost"}</div>
        <div class="value">${c.cost.is_rate_limited ? "Rate limited" : `$${c.cost.total_usd.toFixed(4)}`}</div>
      </div>
    </div>

    <div class="section">
      <h2>Before / After</h2>
      <table class="comparison-table">
        <tr><th></th><th>Base</th><th>Head</th><th>Delta</th></tr>
        <tr>
          <td>Exploration Steps</td>
          <td>${c.base.explorer.steps_taken}</td>
          <td>${c.head.explorer.steps_taken}</td>
          <td>-</td>
        </tr>
        <tr>
          <td>Discoveries</td>
          <td>${c.base.discoveries.length}</td>
          <td>${c.head.discoveries.length}</td>
          <td class="${c.regressions.new_discoveries.length > 0 ? "delta-up" : c.regressions.fixed_discoveries.length > 0 ? "delta-down" : "delta-zero"}">${c.regressions.new_discoveries.length} new, ${c.regressions.fixed_discoveries.length} fixed</td>
        </tr>
      </table>
    </div>

    ${c.regressions.new_discoveries.length > 0 ? `<div class="section"><h2>New Issues (Regressions)</h2>${newDiscoveriesHtml}</div>` : ""}
    ${c.regressions.fixed_discoveries.length > 0 ? `<div class="section"><h2>Fixed Issues</h2>${fixedDiscoveriesHtml}</div>` : ""}

    ${c.visual.diffs.length > 0 ? `<div class="section"><h2>Visual Diff</h2>${visualDiffsHtml}</div>` : ""}

    <div class="section">
      <h2>Diff Summary</h2>
      <p>${escapeHtml(c.diff_analysis.summary)}</p>
    </div>
  </div>
</body>
</html>`;
  }

  private generateHtml(result: RunResult): string {
    const verdictColor =
      result.verdict === "pass"
        ? "#22c55e"
        : result.verdict === "fail"
          ? "#ef4444"
          : "#f59e0b";

    const discoveriesHtml = result.discoveries
      .map(
        (d) => `
      <div class="discovery ${d.severity}">
        <div class="discovery-header">
          <span class="severity-badge">${d.severity.toUpperCase()}</span>
          <span class="source-badge">${d.source}</span>
          <strong>${escapeHtml(d.title)}</strong>
        </div>
        <p>${escapeHtml(d.description)}</p>
        <div class="meta">
          <span>URL: ${escapeHtml(d.url)}</span>
        </div>
        ${
          d.steps_to_reproduce
            ? `<details><summary>Steps to reproduce</summary><ol>${d.steps_to_reproduce.map((s) => `<li>${escapeHtml(s)}</li>`).join("")}</ol></details>`
            : ""
        }
        ${
          d.console_errors
            ? `<details><summary>Console errors (${d.console_errors.length})</summary><pre>${d.console_errors.map(escapeHtml).join("\n")}</pre></details>`
            : ""
        }
        ${
          d.screenshot_path
            ? `<details><summary>Screenshot</summary><img src="${d.screenshot_path}" style="max-width:100%" /></details>`
            : ""
        }
      </div>`
      )
      .join("\n");

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>ghostQA Report - ${result.run_id}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0a0a0a; color: #e5e5e5; padding: 2rem; line-height: 1.6; }
    .container { max-width: 900px; margin: 0 auto; }
    h1 { font-size: 1.5rem; margin-bottom: 0.5rem; }
    .subtitle { color: #888; margin-bottom: 2rem; }
    .verdict-card { background: #171717; border: 1px solid #333; border-radius: 12px; padding: 1.5rem; margin-bottom: 1.5rem; display: flex; align-items: center; gap: 1rem; }
    .verdict-icon { width: 48px; height: 48px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: bold; font-size: 1.2rem; color: #000; }
    .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 1rem; margin-bottom: 1.5rem; }
    .stat-card { background: #171717; border: 1px solid #333; border-radius: 8px; padding: 1rem; }
    .stat-card .label { color: #888; font-size: 0.85rem; }
    .stat-card .value { font-size: 1.4rem; font-weight: bold; margin-top: 0.25rem; }
    .discovery { background: #171717; border: 1px solid #333; border-radius: 8px; padding: 1rem; margin-bottom: 0.75rem; }
    .discovery.critical, .discovery.high { border-left: 4px solid #ef4444; }
    .discovery.medium { border-left: 4px solid #f59e0b; }
    .discovery.low, .discovery.info { border-left: 4px solid #3b82f6; }
    .discovery-header { display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.5rem; }
    .severity-badge { font-size: 0.7rem; padding: 2px 6px; border-radius: 4px; background: #333; font-weight: bold; }
    .source-badge { font-size: 0.7rem; padding: 2px 6px; border-radius: 4px; background: #1e293b; color: #93c5fd; }
    .meta { color: #888; font-size: 0.85rem; margin-top: 0.5rem; }
    details { margin-top: 0.5rem; }
    summary { cursor: pointer; color: #93c5fd; font-size: 0.85rem; }
    pre { background: #0a0a0a; padding: 0.75rem; border-radius: 4px; overflow-x: auto; font-size: 0.85rem; margin-top: 0.5rem; }
    h2 { font-size: 1.2rem; margin: 1.5rem 0 0.75rem; }
    .section { margin-bottom: 2rem; }
  </style>
</head>
<body>
  <div class="container">
    <h1>ghostQA Report</h1>
    <p class="subtitle">Run: ${result.run_id} | ${new Date(result.started_at).toLocaleString()}</p>

    <div class="verdict-card">
      <div class="verdict-icon" style="background: ${verdictColor}">
        ${result.verdict === "pass" ? "OK" : result.verdict === "fail" ? "!!" : "!"}
      </div>
      <div>
        <div style="font-size: 1.3rem; font-weight: bold;">Verdict: ${result.verdict.toUpperCase()}</div>
        <div style="color: #888;">${result.discoveries.length} discovery(ies) found</div>
      </div>
    </div>

    <div class="stats">
      <div class="stat-card">
        <div class="label">Diff</div>
        <div class="value">${result.diff_analysis.files_changed} files</div>
        <div class="label">${result.diff_analysis.impact_areas} impact areas</div>
      </div>
      <div class="stat-card">
        <div class="label">Exploration</div>
        <div class="value">${result.explorer.steps_taken} steps</div>
        <div class="label">${result.explorer.pages_visited} pages visited</div>
      </div>
      <div class="stat-card">
        <div class="label">${result.cost.is_rate_limited ? "AI Usage" : "Cost"}</div>
        <div class="value">${result.cost.is_rate_limited ? "Rate limited" : `$${result.cost.total_usd.toFixed(4)}`}</div>
        <div class="label">${result.cost.is_rate_limited ? "claude → /usage | codex → /status" : `${(result.cost.input_tokens + result.cost.output_tokens).toLocaleString()} tokens`}</div>
      </div>
    </div>

    ${
      result.discoveries.length > 0
        ? `<div class="section"><h2>Discoveries</h2>${discoveriesHtml}</div>`
        : `<div class="section"><h2>Discoveries</h2><p style="color:#888">No issues found.</p></div>`
    }

    <div class="section">
      <h2>Diff Summary</h2>
      <p>${escapeHtml(result.diff_analysis.summary)}</p>
    </div>
  </div>
</body>
</html>`;
  }
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
