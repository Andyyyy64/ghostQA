import { nanoid } from "nanoid";
import type { Discovery } from "../types/discovery";
import type { PageState } from "./observer";

const ERROR_PATTERNS = [
  /uncaught\s+(?:type|reference|syntax|range)error/i,
  /cannot\s+read\s+propert/i,
  /is\s+not\s+a\s+function/i,
  /is\s+not\s+defined/i,
  /failed\s+to\s+fetch/i,
  /network\s+error/i,
  /500\s+internal\s+server/i,
  /404\s+not\s+found/i,
  /chunk\s+load\s+error/i,
];

export class Discoverer {
  detectFromConsole(
    state: PageState,
    screenshotPath?: string
  ): Discovery[] {
    const discoveries: Discovery[] = [];

    for (const log of state.consoleLogs) {
      if (!log.startsWith("[error]") && !log.startsWith("[pageerror]")) {
        continue;
      }

      const isKnownError = ERROR_PATTERNS.some((p) => p.test(log));
      if (!isKnownError && !log.startsWith("[pageerror]")) continue;

      discoveries.push({
        id: `lb-console-${nanoid(8)}`,
        source: "layer-b",
        severity: log.startsWith("[pageerror]") ? "high" : "medium",
        title: `Console error on ${state.url}`,
        description: log.slice(0, 500),
        url: state.url,
        screenshot_path: screenshotPath,
        console_errors: [log],
        timestamp: state.timestamp,
      });
    }

    return discoveries;
  }

  createFromPlan(
    plan: {
      title: string;
      description: string;
      severity: "critical" | "high" | "medium" | "low" | "info";
    },
    url: string,
    screenshotPath?: string
  ): Discovery {
    return {
      id: `lb-ai-${nanoid(8)}`,
      source: "layer-b",
      severity: plan.severity,
      title: plan.title,
      description: plan.description,
      url,
      screenshot_path: screenshotPath,
      timestamp: Date.now(),
    };
  }
}
