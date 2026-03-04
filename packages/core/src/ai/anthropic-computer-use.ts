import Anthropic from "@anthropic-ai/sdk";
import consola from "consola";
import type { DesktopAction } from "../explorer/types";
import { calculateScale, scaleToDisplay, type ScaleInfo } from "../explorer/screenshot-scaler";

export interface ComputerUseStepResult {
  /** Desktop action to execute, or null if session is done */
  action: DesktopAction | null;
  /** Tool use ID to reference when sending result back */
  toolUseId: string | null;
  /** AI reasoning text (if any text blocks) */
  reasoning: string;
  /** Whether the session is complete */
  done: boolean;
  inputTokens: number;
  outputTokens: number;
}

/**
 * Anthropic Computer Use Provider — uses the native `computer_20251124` tool type.
 *
 * This drives a tool_use loop:
 * 1. Send screenshot → Claude returns tool_use with action
 * 2. Execute action, take new screenshot → send tool_result
 * 3. Repeat until stop_reason !== "tool_use"
 */
export class AnthropicComputerUseProvider {
  private client: Anthropic;
  private model: string;
  private scale: ScaleInfo;
  private messages: Anthropic.Beta.BetaMessageParam[] = [];
  private systemPrompt: string = "";

  constructor(
    apiKey: string,
    model: string,
    displaySize: { width: number; height: number }
  ) {
    this.client = new Anthropic({ apiKey });
    this.model = model;
    this.scale = calculateScale(displaySize.width, displaySize.height);
  }

  private get tools(): Anthropic.Beta.BetaToolUnion[] {
    return [
      {
        type: "computer_20251124" as const,
        name: "computer",
        display_width_px: this.scale.apiWidth,
        display_height_px: this.scale.apiHeight,
      } as unknown as Anthropic.Beta.BetaToolUnion,
    ];
  }

  /**
   * Start a new computer-use session.
   */
  async startSession(
    systemPrompt: string,
    userMessage: string,
    screenshotBase64: string
  ): Promise<ComputerUseStepResult> {
    this.systemPrompt = systemPrompt;
    this.messages = [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: {
              type: "base64",
              media_type: "image/png",
              data: screenshotBase64,
            },
          },
          {
            type: "text",
            text: userMessage,
          },
        ],
      },
    ];

    return this.sendRequest();
  }

  /**
   * Send tool result (post-action screenshot) and get next action.
   */
  async sendToolResult(
    toolUseId: string,
    screenshotBase64: string,
    isError = false,
    errorMessage?: string
  ): Promise<ComputerUseStepResult> {
    const content: Anthropic.Beta.BetaToolResultBlockParam["content"] = isError
      ? errorMessage ?? "Action failed"
      : [
          {
            type: "image",
            source: {
              type: "base64",
              media_type: "image/png",
              data: screenshotBase64,
            },
          },
        ];

    this.messages.push({
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: toolUseId,
          content,
          is_error: isError,
        },
      ],
    });

    return this.sendRequest();
  }

  private async sendRequest(): Promise<ComputerUseStepResult> {
    const response = await this.client.beta.messages.create({
      model: this.model,
      max_tokens: 4096,
      system: this.systemPrompt,
      messages: this.messages,
      tools: this.tools,
      betas: ["computer-use-2025-01-24"],
    });

    // Append assistant response to conversation
    this.messages.push({
      role: "assistant",
      content: response.content as Anthropic.Beta.BetaContentBlock[],
    });

    // Trim conversation if too long
    if (this.messages.length > 40) {
      // Keep first (system context) + last 30 messages
      this.messages = [this.messages[0], ...this.messages.slice(-30)];
    }

    return this.parseResponse(response);
  }

  private parseResponse(
    response: Anthropic.Beta.BetaMessage
  ): ComputerUseStepResult {
    const inputTokens = response.usage.input_tokens;
    const outputTokens = response.usage.output_tokens;

    // Collect text reasoning
    const textBlocks = response.content.filter(
      (b): b is Anthropic.Beta.BetaTextBlock => b.type === "text"
    );
    const reasoning = textBlocks.map((b) => b.text).join("\n");

    // Find tool_use block
    const toolUseBlock = response.content.find(
      (b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use"
    );

    if (!toolUseBlock || response.stop_reason !== "tool_use") {
      // Session is done — no more actions
      return {
        action: null,
        toolUseId: null,
        reasoning,
        done: true,
        inputTokens,
        outputTokens,
      };
    }

    // Parse the computer action
    const input = toolUseBlock.input as Record<string, unknown>;
    const action = this.parseComputerAction(input);

    return {
      action,
      toolUseId: toolUseBlock.id,
      reasoning,
      done: false,
      inputTokens,
      outputTokens,
    };
  }

  private parseComputerAction(input: Record<string, unknown>): DesktopAction {
    const actionType = input.action as string;
    const apiCoordinate = input.coordinate as [number, number] | undefined;
    const text = input.text as string | undefined;

    // Scale coordinates from API space back to display space
    let coordinate: [number, number] | undefined;
    if (apiCoordinate) {
      coordinate = scaleToDisplay(this.scale, apiCoordinate[0], apiCoordinate[1]);
    }

    switch (actionType) {
      case "left_click":
      case "right_click":
      case "double_click":
        return { kind: "desktop", action: actionType, coordinate };

      case "type":
        return { kind: "desktop", action: "type", text: text ?? "" };

      case "key":
        return { kind: "desktop", action: "key", text: text ?? "" };

      case "scroll":
        return {
          kind: "desktop",
          action: "scroll",
          coordinate,
          direction: (input.direction as "up" | "down") ?? "down",
          amount: (input.amount as number) ?? 300,
        };

      case "screenshot":
        return { kind: "desktop", action: "screenshot" };

      default:
        consola.warn(`Unknown computer-use action: ${actionType}, treating as wait`);
        return { kind: "desktop", action: "wait", duration: 500 };
    }
  }
}
