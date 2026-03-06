import Anthropic from "@anthropic-ai/sdk";
import type { AiProvider, ChatMessage, ChatResponse } from "./provider";

export class AnthropicProvider implements AiProvider {
  private client: Anthropic;
  private model: string;
  private seed?: number;

  constructor(apiKey: string, model: string, seed?: number) {
    this.client = new Anthropic({ apiKey });
    this.model = model;
    this.seed = seed;
  }

  async chat(
    system: string,
    messages: ChatMessage[],
    options?: { maxTokens?: number; seed?: number }
  ): Promise<ChatResponse> {
    const seed = options?.seed ?? this.seed;
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: options?.maxTokens ?? 4096,
      system,
      messages: messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
      ...(seed !== undefined ? { metadata: { user_id: `seed-${seed}` } } : {}),
    });

    const text =
      response.content
        .filter((b) => b.type === "text")
        .map((b) => b.text)
        .join("") || "";

    return {
      text,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    };
  }

  async chatWithImage(
    system: string,
    messages: ChatMessage[],
    imageBase64: string,
    mediaType: "image/png" | "image/jpeg" | "image/webp" = "image/png",
    options?: { maxTokens?: number; seed?: number }
  ): Promise<ChatResponse> {
    // Build messages with image attached to last user message
    const anthropicMessages: Anthropic.MessageParam[] = messages.map((m, i) => {
      if (m.role === "user" && i === messages.length - 1) {
        return {
          role: "user" as const,
          content: [
            {
              type: "image" as const,
              source: {
                type: "base64" as const,
                media_type: mediaType,
                data: imageBase64,
              },
            },
            { type: "text" as const, text: m.content },
          ],
        };
      }
      return { role: m.role as "user" | "assistant", content: m.content };
    });

    const seed = options?.seed ?? this.seed;
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: options?.maxTokens ?? 4096,
      system,
      messages: anthropicMessages,
      ...(seed !== undefined ? { metadata: { user_id: `seed-${seed}` } } : {}),
    });

    const text =
      response.content
        .filter((b) => b.type === "text")
        .map((b) => b.text)
        .join("") || "";

    return {
      text,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    };
  }
}
