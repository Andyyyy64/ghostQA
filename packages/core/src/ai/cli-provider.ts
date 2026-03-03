import { execa } from "execa";
import { writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { nanoid } from "nanoid";
import consola from "consola";
import type { AiProvider, ChatMessage, ChatResponse } from "./provider";

/** Rough token estimate fallback: ~4 chars per token */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

interface ClaudeJsonOutput {
  result: string;
  total_cost_usd?: number;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
}

/**
 * CLI LLM tool provider — delegates AI calls to installed CLI tools.
 *
 * Supported tools:
 *   claude  — Claude Code CLI (uses --output-format json for usage tracking)
 *   codex   — OpenAI Codex CLI (stdin piped to `codex -q`)
 *   gemini  — Gemini CLI (uses --output-format json for usage tracking)
 */
export class CliProvider implements AiProvider {
  private command: string;
  private extraArgs: string[];
  /** Cost from the most recent Claude CLI call (reset after each sync) */
  public reportedCostUsd = 0;

  constructor(command: string, extraArgs: string[] = []) {
    this.command = command;
    this.extraArgs = extraArgs;
  }

  async chat(
    system: string,
    messages: ChatMessage[],
    _options?: { maxTokens?: number }
  ): Promise<ChatResponse> {
    const prompt = this.buildPrompt(system, messages);
    return this.invoke(prompt);
  }

  async chatWithImage(
    system: string,
    messages: ChatMessage[],
    imageBase64: string,
    _mediaType?: "image/png" | "image/jpeg" | "image/webp",
    _options?: { maxTokens?: number }
  ): Promise<ChatResponse> {
    const imgPath = join(tmpdir(), `ghostqa-${nanoid(6)}.png`);
    await writeFile(imgPath, Buffer.from(imageBase64, "base64"));

    const prompt = this.buildPrompt(system, messages, imgPath);
    try {
      return await this.invoke(prompt);
    } finally {
      await rm(imgPath, { force: true }).catch(() => {});
    }
  }

  private buildPrompt(
    system: string,
    messages: ChatMessage[],
    imagePath?: string
  ): string {
    const parts: string[] = [];
    parts.push(system);
    parts.push("---");

    for (const msg of messages) {
      const label = msg.role === "user" ? "User" : "Assistant";
      parts.push(`${label}:\n${msg.content}`);
    }

    if (imagePath) {
      parts.push(`\n[Screenshot attached: ${imagePath}]`);
    }

    return parts.join("\n\n");
  }

  private async invoke(prompt: string): Promise<ChatResponse> {
    const cmd = this.resolveCommand();
    const args = this.buildArgs();
    const isClaude = this.isClaude();

    consola.debug(`CLI AI: ${cmd} ${args.join(" ")} (${prompt.length} chars via stdin)`);

    const result = await execa(cmd, args, {
      input: prompt,
      timeout: 180_000,
      reject: false,
    });

    if (result.exitCode !== 0 && result.stderr) {
      consola.warn(`CLI tool stderr: ${result.stderr.slice(0, 300)}`);
    }

    const raw = result.stdout.trim();

    // Claude/Gemini with --output-format json returns structured data with usage info
    if (isClaude) {
      return this.parseClaudeJson(raw, prompt);
    }
    if (this.isGemini()) {
      return this.parseGeminiJson(raw, prompt);
    }

    // Other CLI tools: use text output + estimation
    consola.debug(`CLI AI response (${raw.length} chars): ${raw.slice(0, 200)}...`);
    return {
      text: raw,
      inputTokens: estimateTokens(prompt),
      outputTokens: estimateTokens(raw),
    };
  }

  private parseClaudeJson(raw: string, prompt: string): ChatResponse {
    try {
      const data = JSON.parse(raw) as ClaudeJsonOutput;
      const text = data.result ?? "";
      const usage = data.usage;

      const inputTokens =
        (usage?.input_tokens ?? 0) +
        (usage?.cache_creation_input_tokens ?? 0) +
        (usage?.cache_read_input_tokens ?? 0);
      const outputTokens = usage?.output_tokens ?? 0;

      if (data.total_cost_usd) {
        this.reportedCostUsd = data.total_cost_usd;
      }

      consola.debug(
        `Claude usage: ${inputTokens} in / ${outputTokens} out, cost: $${(data.total_cost_usd ?? 0).toFixed(4)}`
      );

      return { text, inputTokens, outputTokens };
    } catch {
      // JSON parse failed — claude might have returned plain text
      consola.debug("Failed to parse Claude JSON output, falling back to text");
      return {
        text: raw,
        inputTokens: estimateTokens(prompt),
        outputTokens: estimateTokens(raw),
      };
    }
  }

  private parseGeminiJson(raw: string, prompt: string): ChatResponse {
    try {
      const data = JSON.parse(raw);
      const text = data.response ?? data.result ?? raw;

      consola.debug(`Gemini CLI response (${String(text).length} chars)`);

      return {
        text: typeof text === "string" ? text : JSON.stringify(text),
        inputTokens: data.usage?.input_tokens ?? estimateTokens(prompt),
        outputTokens: data.usage?.output_tokens ?? estimateTokens(String(text)),
      };
    } catch {
      consola.debug("Failed to parse Gemini CLI JSON output, falling back to text");
      return {
        text: raw,
        inputTokens: estimateTokens(prompt),
        outputTokens: estimateTokens(raw),
      };
    }
  }

  private isClaude(): boolean {
    const cmd = this.command.split("/").pop() ?? this.command;
    return cmd === "claude";
  }

  private isGemini(): boolean {
    const cmd = this.command.split("/").pop() ?? this.command;
    return cmd === "gemini";
  }

  private resolveCommand(): string {
    return this.command;
  }

  private buildArgs(): string[] {
    const cmd = this.command.split("/").pop() ?? this.command;

    switch (cmd) {
      case "claude":
        // Use JSON output to get usage/cost data; extract result text ourselves
        return ["-p", "--output-format", "json", ...this.extraArgs];

      case "codex":
        return ["-q", ...this.extraArgs];

      case "gemini":
        return ["-p", "--output-format", "json", ...this.extraArgs];

      default:
        return [...this.extraArgs];
    }
  }
}
