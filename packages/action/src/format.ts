export function formatComparisonComment(result: {
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

  body += `---\n:robot: Generated with [ghostQA](https://github.com/Andyyyy64/ghostQA)`;

  return body;
}

export function formatSingleRunComment(result: {
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

  body += `---\n:robot: Generated with [ghostQA](https://github.com/Andyyyy64/ghostQA)`;

  return body;
}
