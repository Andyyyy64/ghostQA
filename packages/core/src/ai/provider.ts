export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ChatResponse {
  text: string;
  inputTokens: number;
  outputTokens: number;
}

export interface AiProvider {
  chat(
    system: string,
    messages: ChatMessage[],
    options?: { maxTokens?: number; seed?: number }
  ): Promise<ChatResponse>;

  chatWithImage(
    system: string,
    messages: ChatMessage[],
    imageBase64: string,
    mediaType?: "image/png" | "image/jpeg" | "image/webp",
    options?: { maxTokens?: number; seed?: number }
  ): Promise<ChatResponse>;
}
