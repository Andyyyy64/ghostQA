import { execa } from "execa";
import { writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { nanoid } from "nanoid";
import consola from "consola";
import type { AiProvider, ChatMessage, ChatResponse } from "./provider";

/**
 * CLI LLM tool provider — delegates AI calls to installed CLI tools.
 *
 * Supported tools:
 *   claude  — Claude Code CLI (stdin piped to `claude -p --output-format text`)
 *   codex   — OpenAI Codex CLI (stdin piped to `codex -q`)
 */
export class CliProvider implements AiProvider {
  private command: string;
  private extraArgs: string[];

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
    const text = await this.invoke(prompt);
    return { text, inputTokens: 0, outputTokens: 0 };
  }

  async chatWithImage(
    system: string,
    messages: ChatMessage[],
    imageBase64: string,
    _mediaType?: "image/png" | "image/jpeg" | "image/webp",
    _options?: { maxTokens?: number }
  ): Promise<ChatResponse> {
    // Save image to temp file so CLI tools can reference it
    const imgPath = join(tmpdir(), `ghostqa-${nanoid(6)}.png`);
    await writeFile(imgPath, Buffer.from(imageBase64, "base64"));

    const prompt = this.buildPrompt(system, messages, imgPath);
    try {
      const text = await this.invoke(prompt);
      return { text, inputTokens: 0, outputTokens: 0 };
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

  private async invoke(prompt: string): Promise<string> {
    const cmd = this.resolveCommand();
    const args = this.buildArgs();

    consola.debug(`CLI AI: ${cmd} ${args.join(" ")} (${prompt.length} chars via stdin)`);

    const result = await execa(cmd, args, {
      input: prompt,
      timeout: 180_000,
      reject: false,
    });

    if (result.exitCode !== 0 && result.stderr) {
      consola.warn(`CLI tool stderr: ${result.stderr.slice(0, 300)}`);
    }

    const output = result.stdout.trim();
    consola.debug(`CLI AI response (${output.length} chars): ${output.slice(0, 200)}...`);
    return output;
  }

  private resolveCommand(): string {
    return this.command;
  }

  private buildArgs(): string[] {
    const cmd = this.command.split("/").pop() ?? this.command;

    switch (cmd) {
      case "claude":
        // claude -p reads prompt from stdin, --output-format text returns plain text
        return ["-p", "--output-format", "text", ...this.extraArgs];

      case "codex":
        // codex -q reads from stdin
        return ["-q", ...this.extraArgs];

      default:
        return [...this.extraArgs];
    }
  }
}
