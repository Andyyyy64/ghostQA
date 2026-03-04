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
 *   codex   — OpenAI Codex CLI (codex exec -i <image> for vision)
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

    try {
      if (this.isCodex()) {
        // Codex supports native image input via -i flag
        const prompt = this.buildPrompt(system, messages);
        return await this.invoke(prompt, imgPath);
      }
      // Claude/Gemini: reference the image path in the prompt text
      const prompt = this.buildPrompt(system, messages, imgPath);
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
      parts.push(
        `\nIMPORTANT: Read and analyze the screenshot image at ${imagePath} — it shows the current screen state.`
      );
    }

    return parts.join("\n\n");
  }

  private async invoke(
    prompt: string,
    imagePath?: string
  ): Promise<ChatResponse> {
    const cmd = this.resolveCommand();
    const args = this.buildArgs(imagePath);
    const isClaude = this.isClaude();

    consola.debug(
      `CLI AI: ${cmd} ${args.join(" ")} (${prompt.length} chars via stdin)`
    );

    // Remove Claude Code env vars to avoid nesting detection
    const cleanEnv = { ...process.env };
    delete cleanEnv.CLAUDECODE;
    delete cleanEnv.CLAUDE_CODE_ENTRYPOINT;

    const result = await execa(cmd, args, {
      input: prompt,
      timeout: 180_000,
      reject: false,
      env: cleanEnv,
      extendEnv: false,
    });

    if (result.exitCode !== 0 && result.stderr) {
      consola.warn(`CLI tool stderr: ${result.stderr.slice(0, 300)}`);
    }

    const raw = result.stdout.trim();

    if (isClaude) {
      return this.parseClaudeJson(raw, prompt);
    }
    if (this.isGemini()) {
      return this.parseGeminiJson(raw, prompt);
    }
    if (this.isCodex()) {
      return this.parseCodexOutput(raw, prompt);
    }

    consola.debug(
      `CLI AI response (${raw.length} chars): ${raw.slice(0, 200)}...`
    );
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
      consola.debug(
        "Failed to parse Claude JSON output, falling back to text"
      );
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
        outputTokens:
          data.usage?.output_tokens ?? estimateTokens(String(text)),
      };
    } catch {
      consola.debug(
        "Failed to parse Gemini CLI JSON output, falling back to text"
      );
      return {
        text: raw,
        inputTokens: estimateTokens(prompt),
        outputTokens: estimateTokens(raw),
      };
    }
  }

  /** Parse codex exec output — extract the last assistant message */
  private parseCodexOutput(raw: string, prompt: string): ChatResponse {
    consola.debug(
      `Codex response (${raw.length} chars): ${raw.slice(0, 200)}...`
    );
    return {
      text: raw,
      inputTokens: estimateTokens(prompt),
      outputTokens: estimateTokens(raw),
    };
  }

  private isClaude(): boolean {
    const cmd = this.command.split("/").pop() ?? this.command;
    return cmd === "claude";
  }

  private isCodex(): boolean {
    const cmd = this.command.split("/").pop() ?? this.command;
    return cmd === "codex";
  }

  private isGemini(): boolean {
    const cmd = this.command.split("/").pop() ?? this.command;
    return cmd === "gemini";
  }

  private resolveCommand(): string {
    return this.command;
  }

  private buildArgs(imagePath?: string): string[] {
    const cmd = this.command.split("/").pop() ?? this.command;

    switch (cmd) {
      case "claude":
        // --dangerously-skip-permissions: needed for -p mode to read image files
        return [
          "-p",
          "--output-format",
          "json",
          "--dangerously-skip-permissions",
          ...this.extraArgs,
        ];

      case "codex":
        // codex exec: non-interactive mode with native image support via -i
        return [
          "exec",
          "--dangerously-bypass-approvals-and-sandbox",
          ...(imagePath ? ["-i", imagePath] : []),
          ...this.extraArgs,
        ];

      case "gemini":
        return ["-p", "--output-format", "json", ...this.extraArgs];

      default:
        return [...this.extraArgs];
    }
  }
}
