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
        id: `console-${nanoid(8)}`,
        source: "explorer",
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
      id: `ai-${nanoid(8)}`,
      source: "explorer",
      severity: plan.severity,
      title: plan.title,
      description: plan.description,
      url,
      screenshot_path: screenshotPath,
      timestamp: Date.now(),
    };
  }

  /** Check if a discovery is a duplicate of an existing one */
  isDuplicate(candidate: Discovery, existing: Discovery[]): boolean {
    const candidateTitle = candidate.title.toLowerCase();
    const candidateDesc = candidate.description.toLowerCase();

    for (const d of existing) {
      const title = d.title.toLowerCase();
      const desc = d.description.toLowerCase();

      // Exact title match
      if (candidateTitle === title) return true;

      // Significant word overlap in titles (strip punctuation for comparison)
      const strip = (s: string) => s.replace(/[^a-z0-9\s]/g, "");
      const candidateWords = new Set(strip(candidateTitle).split(/\s+/).filter(w => w.length > 3));
      const existingWords = new Set(strip(title).split(/\s+/).filter(w => w.length > 3));
      if (candidateWords.size > 0 && existingWords.size > 0) {
        let overlap = 0;
        for (const w of candidateWords) {
          if (existingWords.has(w)) overlap++;
        }
        const similarity = overlap / Math.min(candidateWords.size, existingWords.size);
        if (similarity >= 0.6) return true;
      }

      // Console error dedup: same error message
      if (candidate.console_errors && d.console_errors) {
        const a = candidate.console_errors[0];
        const b = d.console_errors[0];
        if (a && b && a === b) return true;
      }

      // Cross-source dedup: console error message appears in AI discovery title/description
      // e.g. console "[pageerror] remov is not defined" vs AI "Delete button: 'remov is not defined'"
      const consoleErrors = candidate.console_errors ?? d.console_errors;
      if (consoleErrors) {
        const otherText = candidate.console_errors ? (title + " " + desc) : (candidateTitle + " " + candidateDesc);
        for (const err of consoleErrors) {
          // Extract the core error message (strip [error]/[pageerror] prefix)
          const core = err.replace(/^\[(error|pageerror)\]\s*/i, "").toLowerCase();
          if (core.length > 5 && otherText.includes(core)) return true;
        }
      }

      // Description substring match (one contains the other's core message)
      if (candidateDesc.length > 20 && desc.length > 20) {
        const shortDesc = candidateDesc.length < desc.length ? candidateDesc : desc;
        const longDesc = candidateDesc.length < desc.length ? desc : candidateDesc;
        // Extract first sentence as the "core" of the description
        const core = shortDesc.split(/[.!]\s/)[0];
        if (core.length > 20 && longDesc.includes(core)) return true;
      }
    }

    return false;
  }
}
