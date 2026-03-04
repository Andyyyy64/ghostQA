import consola from "consola";
import type { CostTracker, BudgetExceededError } from "../ai/cost-tracker";
import type { ExplorerConfig } from "../types/config";

export class Guardrails {
  private stepCount = 0;
  private startTime: number;
  private visitedUrls = new Set<string>();
  private recentActions: string[] = [];
  public testedSelectors = new Set<string>();

  constructor(
    private config: ExplorerConfig,
    private costTracker: CostTracker
  ) {
    this.startTime = Date.now();
  }

  recordStep(url: string, action: string): void {
    this.stepCount++;
    this.visitedUrls.add(url);
    this.recentActions.push(action);
    if (this.recentActions.length > 10) {
      this.recentActions.shift();
    }
    // Track selector for coverage
    const selector = action.split(":").slice(1).join(":");
    if (selector) this.testedSelectors.add(selector.toLowerCase());
  }

  shouldStop(): { stop: boolean; reason?: string } {
    if (this.stepCount >= this.config.max_steps) {
      return { stop: true, reason: `Max steps reached (${this.config.max_steps})` };
    }

    const elapsed = Date.now() - this.startTime;
    if (elapsed >= this.config.max_duration) {
      return { stop: true, reason: `Max duration reached (${this.config.max_duration}ms)` };
    }

    try {
      this.costTracker.checkBudget();
    } catch {
      return { stop: true, reason: "Budget exceeded" };
    }

    if (this.isLooping()) {
      return { stop: true, reason: "Loop detected" };
    }

    return { stop: false };
  }

  private isLooping(): boolean {
    if (this.recentActions.length < 6) return false;

    // Check if the last 3 actions repeat the 3 before them
    const recent = this.recentActions.slice(-6);
    const first = recent.slice(0, 3).join("|");
    const second = recent.slice(3).join("|");
    return first === second;
  }

  get stats() {
    return {
      steps_taken: this.stepCount,
      pages_visited: this.visitedUrls.size,
      elapsed_ms: Date.now() - this.startTime,
    };
  }
}
