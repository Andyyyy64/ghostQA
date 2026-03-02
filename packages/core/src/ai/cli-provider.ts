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
 *   claude  — Claude Code CLI (`claude -p "prompt"`)
 *   codex   — OpenAI Codex CLI (`codex -q "prompt"`)
 *
 * Any tool that accepts a prompt via stdin and outputs text to stdout works.
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
    // Save image to temp file so some CLI tools can reference it
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
    parts.push(`<system>\n${system}\n</system>`);

    for (const msg of messages) {
      parts.push(`<${msg.role}>\n${msg.content}\n</${msg.role}>`);
    }

    if (imagePath) {
      parts.push(`\n[Screenshot saved at: ${imagePath}]`);
    }

    return parts.join("\n\n");
  }

  private async invoke(prompt: string): Promise<string> {
    const args = this.buildArgs(prompt);
    consola.debug(`CLI AI: ${this.command} ${args.join(" ").slice(0, 80)}...`);

    const result = await execa(this.command, args, {
      input: this.needsStdin() ? prompt : undefined,
      timeout: 120_000,
      reject: false,
    });

    if (result.exitCode !== 0 && result.stderr) {
      consola.warn(`CLI tool stderr: ${result.stderr.slice(0, 200)}`);
    }

    return result.stdout;
  }

  private buildArgs(prompt: string): string[] {
    const cmd = this.command.split("/").pop() ?? this.command;

    switch (cmd) {
      case "claude":
        // Claude Code: claude -p "prompt" --output-format text
        return ["-p", prompt, "--output-format", "text", ...this.extraArgs];

      case "codex":
        // Codex CLI: codex -q "prompt"
        return ["-q", prompt, ...this.extraArgs];

      default:
        // Generic: pass prompt as first positional arg
        return [prompt, ...this.extraArgs];
    }
  }

  private needsStdin(): boolean {
    const cmd = this.command.split("/").pop() ?? this.command;
    // claude and codex take prompt as arg, no stdin needed
    return !["claude", "codex"].includes(cmd);
  }
}
