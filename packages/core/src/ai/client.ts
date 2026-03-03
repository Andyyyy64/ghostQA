import type { AiProvider, ChatMessage } from "./provider";
import { GeminiProvider } from "./gemini-provider";
import { CliProvider } from "./cli-provider";
import { CostTracker } from "./cost-tracker";
import type { AiConfig } from "../types/config";

export type AiTask = "diff_analysis" | "test_generation" | "ui_control" | "triage";

export class AiClient {
  private defaultProvider: AiProvider;
  private taskProviders: Partial<Record<AiTask, AiProvider>> = {};
  private activeProvider: AiProvider;
  public costTracker: CostTracker;

  constructor(private config: AiConfig) {
    this.costTracker = new CostTracker(config.model, config.max_budget_usd);
    this.defaultProvider = createProvider(config);
    this.activeProvider = this.defaultProvider;

    if (config.provider === "cli") {
      this.costTracker.isRateLimited = true;
    }

    // Build task-specific providers from routing config
    const routing = config.routing;
    for (const [task, providerConfig] of Object.entries(routing)) {
      if (providerConfig) {
        this.taskProviders[task as AiTask] = createProvider(providerConfig);
      }
    }
  }

  /** Set the active task context for routing */
  useTask(task: AiTask): this {
    this.activeProvider = this.taskProviders[task] ?? this.defaultProvider;
    return this;
  }

  /** Reset to default provider */
  resetTask(): this {
    this.activeProvider = this.defaultProvider;
    return this;
  }

  async chat(
    system: string,
    messages: ChatMessage[],
    options?: { maxTokens?: number }
  ): Promise<string> {
    this.costTracker.checkBudget();
    const response = await this.activeProvider.chat(system, messages, options);
    this.costTracker.track(response.inputTokens, response.outputTokens);
    this.syncCliCost(this.activeProvider);
    return response.text;
  }

  async chatWithImage(
    system: string,
    messages: ChatMessage[],
    imageBase64: string,
    mediaType: "image/png" | "image/jpeg" | "image/webp" = "image/png",
    options?: { maxTokens?: number }
  ): Promise<string> {
    this.costTracker.checkBudget();
    const response = await this.activeProvider.chatWithImage(
      system,
      messages,
      imageBase64,
      mediaType,
      options
    );
    this.costTracker.track(response.inputTokens, response.outputTokens);
    this.syncCliCost(this.activeProvider);
    return response.text;
  }

  private syncCliCost(provider: AiProvider): void {
    if (provider instanceof CliProvider && provider.reportedCostUsd > 0) {
      this.costTracker.addReportedCost(provider.reportedCostUsd);
      provider.reportedCostUsd = 0;
    }
  }
}

function createProvider(config: { provider: string; model: string; api_key_env: string; cli: { command: string; args: string[] } }): AiProvider {
  switch (config.provider) {
    case "gemini": {
      const apiKey = process.env[config.api_key_env];
      if (!apiKey) {
        throw new Error(
          `API key not found. Set ${config.api_key_env} environment variable.`
        );
      }
      return new GeminiProvider(apiKey, config.model);
    }
    case "cli": {
      return new CliProvider(config.cli.command, config.cli.args);
    }
    default:
      throw new Error(`Unknown AI provider: ${config.provider}`);
  }
}
