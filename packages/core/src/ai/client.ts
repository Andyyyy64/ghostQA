import type { AiProvider, ChatMessage } from "./provider";
import { GeminiProvider } from "./gemini-provider";
import { CliProvider } from "./cli-provider";
import { CostTracker } from "./cost-tracker";
import type { AiConfig } from "../types/config";

export class AiClient {
  private provider: AiProvider;
  public costTracker: CostTracker;

  constructor(config: AiConfig) {
    this.costTracker = new CostTracker(config.model, config.max_budget_usd);
    this.provider = createProvider(config);
  }

  async chat(
    system: string,
    messages: ChatMessage[],
    options?: { maxTokens?: number }
  ): Promise<string> {
    this.costTracker.checkBudget();
    const response = await this.provider.chat(system, messages, options);
    this.costTracker.track(response.inputTokens, response.outputTokens);
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
    const response = await this.provider.chatWithImage(
      system,
      messages,
      imageBase64,
      mediaType,
      options
    );
    this.costTracker.track(response.inputTokens, response.outputTokens);
    return response.text;
  }
}

function createProvider(config: AiConfig): AiProvider {
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
