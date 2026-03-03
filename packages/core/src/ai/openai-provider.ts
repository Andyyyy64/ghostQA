import OpenAI from "openai";
import type { AiProvider, ChatMessage, ChatResponse } from "./provider";

export class OpenAIProvider implements AiProvider {
  private client: OpenAI;
  private model: string;

  constructor(apiKey: string, model: string) {
    this.client = new OpenAI({ apiKey });
    this.model = model;
  }

  async chat(
    system: string,
    messages: ChatMessage[],
    options?: { maxTokens?: number }
  ): Promise<ChatResponse> {
    const response = await this.client.chat.completions.create({
      model: this.model,
      max_tokens: options?.maxTokens ?? 4096,
      messages: [
        { role: "system", content: system },
        ...messages.map((m) => ({
          role: m.role as "user" | "assistant",
          content: m.content,
        })),
      ],
    });

    const text = response.choices[0]?.message?.content ?? "";

    return {
      text,
      inputTokens: response.usage?.prompt_tokens ?? 0,
      outputTokens: response.usage?.completion_tokens ?? 0,
    };
  }

  async chatWithImage(
    system: string,
    messages: ChatMessage[],
    imageBase64: string,
    mediaType: "image/png" | "image/jpeg" | "image/webp" = "image/png",
    options?: { maxTokens?: number }
  ): Promise<ChatResponse> {
    const openaiMessages: OpenAI.ChatCompletionMessageParam[] = [
      { role: "system", content: system },
    ];

    for (let i = 0; i < messages.length; i++) {
      const m = messages[i];
      if (m.role === "user" && i === messages.length - 1) {
        // Attach image to last user message
        openaiMessages.push({
          role: "user",
          content: [
            {
              type: "image_url",
              image_url: {
                url: `data:${mediaType};base64,${imageBase64}`,
              },
            },
            { type: "text", text: m.content },
          ],
        });
      } else {
        openaiMessages.push({
          role: m.role,
          content: m.content,
        });
      }
    }

    const response = await this.client.chat.completions.create({
      model: this.model,
      max_tokens: options?.maxTokens ?? 4096,
      messages: openaiMessages,
    });

    const text = response.choices[0]?.message?.content ?? "";

    return {
      text,
      inputTokens: response.usage?.prompt_tokens ?? 0,
      outputTokens: response.usage?.completion_tokens ?? 0,
    };
  }
}
