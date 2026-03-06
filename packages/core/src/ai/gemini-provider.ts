import {
  GoogleGenerativeAI,
  type Content,
  type Part,
} from "@google/generative-ai";
import type { AiProvider, ChatMessage, ChatResponse } from "./provider";

export class GeminiProvider implements AiProvider {
  private genAI: GoogleGenerativeAI;
  private model: string;
  private seed?: number;

  constructor(apiKey: string, model: string, seed?: number) {
    this.genAI = new GoogleGenerativeAI(apiKey);
    this.model = model;
    this.seed = seed;
  }

  async chat(
    system: string,
    messages: ChatMessage[],
    options?: { maxTokens?: number; seed?: number }
  ): Promise<ChatResponse> {
    const seed = options?.seed ?? this.seed;
    const model = this.genAI.getGenerativeModel({
      model: this.model,
      systemInstruction: system,
      generationConfig: {
        maxOutputTokens: options?.maxTokens ?? 4096,
        ...(seed !== undefined ? { seed } : {}),
      },
    });

    const contents = this.toContents(messages);
    const result = await model.generateContent({ contents });
    const response = result.response;
    const text = response.text();
    const usage = response.usageMetadata;

    return {
      text,
      inputTokens: usage?.promptTokenCount ?? 0,
      outputTokens: usage?.candidatesTokenCount ?? 0,
    };
  }

  async chatWithImage(
    system: string,
    messages: ChatMessage[],
    imageBase64: string,
    mediaType: "image/png" | "image/jpeg" | "image/webp" = "image/png",
    options?: { maxTokens?: number; seed?: number }
  ): Promise<ChatResponse> {
    const seed = options?.seed ?? this.seed;
    const model = this.genAI.getGenerativeModel({
      model: this.model,
      systemInstruction: system,
      generationConfig: {
        maxOutputTokens: options?.maxTokens ?? 4096,
        ...(seed !== undefined ? { seed } : {}),
      },
    });

    const contents = this.toContents(messages);

    // Attach image to last user message
    const last = contents[contents.length - 1];
    if (last) {
      const imagePart: Part = {
        inlineData: { data: imageBase64, mimeType: mediaType },
      };
      last.parts = [imagePart, ...last.parts];
    }

    const result = await model.generateContent({ contents });
    const response = result.response;
    const text = response.text();
    const usage = response.usageMetadata;

    return {
      text,
      inputTokens: usage?.promptTokenCount ?? 0,
      outputTokens: usage?.candidatesTokenCount ?? 0,
    };
  }

  private toContents(messages: ChatMessage[]): Content[] {
    return messages.map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    }));
  }
}
