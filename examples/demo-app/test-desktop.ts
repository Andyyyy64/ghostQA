/**
 * Desktop computer-use exploration test script.
 *
 * Prerequisites:
 *   Xvfb :99 -screen 0 1280x720x24 &
 *   DISPLAY=:99 openbox &
 *   node server.js &   (demo-app on localhost:3000)
 *   DISPLAY=:99 google-chrome --no-sandbox --disable-gpu --window-size=1280,720 \
 *     --no-first-run --disable-default-apps http://localhost:3000 &
 *
 * Run:
 *   npx tsx test-desktop.ts
 */

import {
  DesktopEnvironment,
  DesktopObserver,
  DesktopNavigator,
  DesktopPlanner,
  Discoverer,
  AiClient,
} from "../../packages/core/src/index";
import type { DiffAnalysis, Discovery } from "../../packages/core/src/index";
import { mkdirSync } from "node:fs";

const DISPLAY = ":99";
const OUTPUT_DIR = "/tmp/ghostqa-desktop-test";
const VIEWPORT = { width: 1280, height: 720 };
const MAX_STEPS = 15;

// Fake diff analysis pointing AI at the demo-app's known issues
const analysis: DiffAnalysis = {
  summary:
    "Todo App with potential bugs: item counter display, filter buttons, add/delete functionality",
  files: [],
  impact_areas: [
    {
      area: "Todo item counter",
      description:
        "The item counter at the bottom may display incorrectly (shows [object Object] instead of number)",
      risk: "high",
      suggested_actions: ["Check the items left counter text"],
    },
    {
      area: "Add todo functionality",
      description: "Adding new todo items via the input field and Add button",
      risk: "medium",
      suggested_actions: ["Try adding a new todo item"],
    },
    {
      area: "Filter buttons (All/Active/Done)",
      description:
        "Filter buttons should show/hide todos based on completion status",
      risk: "medium",
      suggested_actions: [
        "Click each filter button and verify the list updates",
      ],
    },
    {
      area: "Clear Completed button",
      description: "Should remove completed todos from the list",
      risk: "medium",
      suggested_actions: ["Complete a todo, then click Clear Completed"],
    },
  ],
};

async function main() {
  mkdirSync(`${OUTPUT_DIR}/screenshots`, { recursive: true });

  console.log("=== ghostQA Desktop Exploration Test ===\n");

  // 1. Setup AI client — CLI provider with claude
  const ai = new AiClient({
    provider: "cli",
    model: "claude-sonnet-4-20250514",
    api_key_env: "",
    max_budget_usd: 5.0,
    cli: { command: "claude", args: ["--model", "sonnet"] },
    routing: {},
  });

  // 2. Setup desktop components
  //    Chrome is already running on :99, so we skip launchApp().
  const env = new DesktopEnvironment({
    display: DISPLAY,
    appCommand: "true",
    windowName: "Todo App",
    windowTimeout: 5000,
  });

  console.log("Checking for window...");
  const windowId = await env.waitForWindow();
  console.log(`Window found: ${windowId}\n`);

  const observer = new DesktopObserver(env, OUTPUT_DIR, VIEWPORT);
  const navigator = new DesktopNavigator(DISPLAY);
  const planner = new DesktopPlanner(ai, analysis, VIEWPORT);
  const discoverer = new Discoverer();

  observer.startListening();

  const discoveries: Discovery[] = [];

  // 3. Exploration loop
  for (let step = 1; step <= MAX_STEPS; step++) {
    console.log(`\n--- Step ${step}/${MAX_STEPS} ---`);

    const state = await observer.observe();
    console.log(`Window: ${state.title}`);

    // Check process logs for errors
    const logDiscoveries = discoverer.detectFromLogs(state);
    for (const d of logDiscoveries) {
      if (!discoverer.isDuplicate(d, discoveries)) {
        discoveries.push(d);
        console.log(`[LOG DISCOVERY] ${d.severity}: ${d.title}`);
      }
    }

    await observer.screenshot(`step-${step}`);

    // Ask AI what to do next
    console.log("Asking AI...");
    const plan = await planner.plan(state);
    console.log(`Reasoning: ${plan.reasoning}`);
    console.log(
      `Action: ${plan.action.action} ${plan.action.coordinate ? `[${plan.action.coordinate}]` : ""} ${plan.action.text ?? ""}`
    );

    if (plan.discovery) {
      const screenshotPath = await observer.screenshot("discovery");
      const d = discoverer.createFromPlan(
        plan.discovery,
        state.title,
        screenshotPath
      );
      if (!discoverer.isDuplicate(d, discoveries)) {
        discoveries.push(d);
        console.log(`\n🐛 DISCOVERY [${d.severity}]: ${d.title}`);
        console.log(`   ${d.description}\n`);
      }
    }

    if (plan.done) {
      console.log("\nAI decided exploration is complete.");
      break;
    }

    try {
      await navigator.execute(plan.action);
      console.log("Action executed.");
    } catch (err) {
      console.log(`Action failed: ${err}`);
    }
  }

  // 4. Summary
  console.log("\n\n=== Exploration Complete ===");
  console.log(`Discoveries: ${discoveries.length}`);
  for (const d of discoveries) {
    console.log(
      `  [${d.severity}] ${d.title}: ${d.description.slice(0, 120)}`
    );
  }
  console.log(`Screenshots: ${OUTPUT_DIR}/screenshots/`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
