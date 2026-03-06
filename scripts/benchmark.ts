/**
 * Benchmark script — measures ghostQA detection rate on planted bugs.
 *
 * Usage: npx tsx scripts/benchmark.ts
 *
 * Runs ghostqa against bench-app and checks which planted bugs were found.
 */
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BENCH_APP = resolve(__dirname, "../examples/bench-app");
const CLI = resolve(__dirname, "../packages/cli/dist/index.js");

const PLANTED_BUGS = [
  { id: "BUG-1",  desc: "Empty form submission",    keywords: ["form validation", "empty submission", "required field", "form accept", "form submit"] },
  { id: "BUG-2",  desc: "Dead 404 link",            keywords: ["nonexistent", "broken link", "dead link", "/nonexistent-page", "reports link"] },
  { id: "BUG-3",  desc: "Console error on fetch",   keywords: ["syntaxerror", "unexpected token", "json parse", "fetch fail", "api data"] },
  { id: "BUG-4",  desc: "Clipped button",           keywords: ["clipped", "clip", "cut off", "overflow", "truncat", "delete my account"] },
  { id: "BUG-5",  desc: "Infinite loading",         keywords: ["load more", "stuck loading", "never resolves", "loading state", "loading..."] },
  { id: "BUG-6",  desc: "Counter goes negative",    keywords: ["below zero", "negative", "counter goes", "-1", "lower bound"] },
  { id: "BUG-7",  desc: "Double-submit / no disable",keywords: ["double", "duplicate order", "order #2", "does not disable", "not disable"] },
  { id: "BUG-8",  desc: "Tab content mismatch",     keywords: ["tab content", "tab switch", "tab don't", "wrong content", "specifications"] },
  { id: "BUG-9",  desc: "Sort always ascending",    keywords: ["sort", "ascending", "descending", "user directory", "table sort"] },
  { id: "BUG-10", desc: "Export does nothing",       keywords: ["export as csv", "export button", "export data", "export nothing", "no visible effect"] },
  { id: "BUG-11", desc: "Tooltip never hides",      keywords: ["tooltip", "hover info", "tooltip never", "tooltip stays", "tooltip visible"] },
  { id: "BUG-12", desc: "Progress exceeds 100%",    keywords: ["progress bar", "exceed 100", "over 100", "beyond 100", "150%", "120%", "110%"] },
  { id: "BUG-13", desc: "Modal can't close",        keywords: ["modal", "edit settings", "settings modal", "modal close", "modal dismiss"] },
  { id: "BUG-14", desc: "Accordion won't collapse", keywords: ["accordion", "faq collapse", "faq close", "accordion collapse", "won't collapse"] },
  { id: "BUG-15", desc: "Broken image",             keywords: ["broken image", "missing image", "team photo", "img src", "photo gallery"] },
];

async function main() {
  console.log("=== ghostQA Benchmark ===\n");
  console.log("Installing bench-app dependencies...");

  spawnSync("npm", ["install"], { cwd: BENCH_APP, stdio: "inherit" });

  console.log("\nRunning ghostqa against bench-app...\n");

  const env = { ...process.env };
  delete env.CLAUDECODE;

  const result = spawnSync("node", [CLI, "run", "--diff", "HEAD~1"], {
    cwd: BENCH_APP,
    env,
    encoding: "utf-8",
    timeout: 900_000,
    maxBuffer: 10 * 1024 * 1024,
    stdio: ["pipe", "pipe", "pipe"],
  });

  const output = (result.stdout ?? "") + (result.stderr ?? "");

  if (result.error) {
    console.error(`ghostqa failed to launch: ${result.error.message}`);
    console.error(output.slice(-4000));
    process.exit(1);
  }

  if (result.status !== 0 && result.status !== 1) {
    console.error(`ghostqa exited with code ${result.status}`);
    if (result.signal) console.error(`Signal: ${result.signal}`);
    console.error(output.slice(-4000));
    process.exit(1);
  }

  // Extract run ID
  const runIdMatch = output.match(/Run ID: (run-[\w-]+)/);
  if (!runIdMatch) {
    console.error("Failed to extract run ID");
    console.error(output.slice(-3000));
    process.exit(1);
  }

  const runDir = join(BENCH_APP, ".ghostqa-runs", runIdMatch[1]);
  let summaryRaw: string;
  try {
    summaryRaw = await readFile(join(runDir, "summary.json"), "utf-8");
  } catch (error) {
    console.error(`summary.json was not generated for ${runIdMatch[1]}`);
    if (result.signal) console.error(`Process signal: ${result.signal}`);
    console.error(output.slice(-4000));
    throw error;
  }
  const summary = JSON.parse(summaryRaw);

  console.log(`\nVerdict: ${summary.verdict.toUpperCase()}`);
  console.log(`Discoveries: ${summary.discoveries.length}`);
  console.log(`Steps: ${summary.explorer.steps_taken}\n`);

  // Check which planted bugs were found
  let found = 0;
  for (const bug of PLANTED_BUGS) {
    const matched = summary.discoveries.some((d: { title: string; description: string }) => {
      const text = `${d.title} ${d.description}`.toLowerCase();
      return bug.keywords.some(k => text.includes(k.toLowerCase()));
    });

    console.log(`  ${matched ? "FOUND" : "MISSED"}  ${bug.id}: ${bug.keywords.slice(0, 3).join(", ")}`);
    if (matched) found++;
  }

  const rate = Math.round((found / PLANTED_BUGS.length) * 100);
  console.log(`\n=== Detection Rate: ${found}/${PLANTED_BUGS.length} (${rate}%) ===\n`);
}

main().catch(console.error);
