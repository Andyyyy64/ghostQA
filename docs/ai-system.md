# AI System

## Overview

The AI system is built on a provider abstraction that allows swapping backends without changing business logic. An `AiClient` facade adds task routing and cost tracking on top.

```
AiClient (facade)
  ├── AiProvider (interface)
  │     ├── GeminiProvider  (Google Gemini API)
  │     └── CliProvider     (claude/codex via stdin)
  ├── CostTracker (budget enforcement)
  └── Task Routing (per-task provider selection)
```

## Provider Interface

**File:** `packages/core/src/ai/provider.ts`

```typescript
interface AiProvider {
  chat(system: string, messages: ChatMessage[], options?: ChatOptions): Promise<ChatResponse>;
  chatWithImage(system: string, messages: ChatMessage[], imageBase64: string,
                mediaType?: string, options?: ChatOptions): Promise<ChatResponse>;
}

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

interface ChatResponse {
  text: string;
  inputTokens: number;
  outputTokens: number;
}
```

To add a new provider, implement this interface and register it in `AiClient.createProvider()`.

## GeminiProvider

**File:** `packages/core/src/ai/gemini-provider.ts`

Uses `@google/generative-ai` SDK.

- Reads API key from environment variable (default: `GEMINI_API_KEY`)
- Default model: `gemini-2.0-flash`
- Max output tokens: 4096
- Converts `ChatMessage[]` to Gemini's `Content[]` format (maps `"assistant"` role to `"model"`)
- For image inputs: prepends `inlineData` part to the last user message
- Returns token counts from `response.usageMetadata`

## CliProvider

**File:** `packages/core/src/ai/cli-provider.ts`

Pipes prompts to CLI tools via stdin using `execa`.

### Supported Commands

| Command | Invocation | Output Parsing |
|---------|-----------|----------------|
| `claude` | `claude -p --output-format json` | JSON: `{ result, total_cost_usd, usage }` |
| `codex` | `codex -q` | Plain text |
| Custom | `<command> <args>` | Plain text |

### Prompt Construction

`buildPrompt()` concatenates all messages with `---` separators:

```
[System] <system prompt>
---
[User] <message 1>
---
[Assistant] <message 2>
---
...
```

For image inputs, writes a temp PNG file and appends `[Screenshot attached: /tmp/ghostqa-<id>.png]`.

### Claude JSON Output

When using `claude` with `--output-format json`, the response contains:

```json
{
  "result": "actual LLM response text",
  "total_cost_usd": 0.0234,
  "usage": { "input_tokens": 1500, "output_tokens": 800 }
}
```

The provider extracts `result` as the response text and stores `total_cost_usd` as `reportedCostUsd` for accurate cost tracking.

### Token Estimation

For non-Claude CLI tools (or when JSON parsing fails), tokens are estimated from text length:

```
estimatedTokens = text.length / 4
```

### Configuration

- Timeout: 180 seconds per call
- `reject: false` — stderr warnings don't cause exceptions
- Temp image files are cleaned up after each call

## AiClient

**File:** `packages/core/src/ai/client.ts`

Facade that combines provider management, task routing, and cost tracking.

### Construction

```typescript
const ai = new AiClient(config, cwd);
// config.ai determines default provider
// config.ai.routing determines per-task overrides
```

### Task Routing

```typescript
ai.useTask("diff_analysis");  // Switch to task-specific provider
const response = await ai.chat(system, messages);
ai.resetTask();                // Revert to default provider
```

Available tasks: `"diff_analysis"`, `"test_generation"`, `"ui_control"`, `"triage"`

If no routing is configured for a task, the default provider is used.

### Cost Tracking

Every call automatically:

1. Calls the provider
2. Records token usage via `costTracker.track()`
3. For CLI providers, syncs `reportedCostUsd` via `costTracker.addReportedCost()`
4. Runs `costTracker.checkBudget()` (throws `BudgetExceededError` if exceeded)

### Provider Factory

`createProvider(providerConfig)`:

| `provider` value | Created class | Requires |
|-----------------|---------------|----------|
| `"gemini"` | `GeminiProvider` | `api_key_env` environment variable |
| `"cli"` | `CliProvider` | CLI tool installed (`claude`, `codex`, etc.) |

## Cost Tracker

**File:** `packages/core/src/ai/cost-tracker.ts`

### Pricing Table (per million tokens)

| Model | Input | Output |
|-------|-------|--------|
| `gemini-2.0-flash` | $0.10 | $0.40 |
| `gemini-2.5-flash-preview-05-20` | $0.15 | $0.60 |
| `gemini-2.5-pro-preview-05-06` | $1.25 | $10.00 |
| Default (unknown models) | $0.15 | $0.60 |

### Methods

| Method | Description |
|--------|-------------|
| `track(input, output)` | Accumulate token counts |
| `addReportedCost(usd)` | Add CLI-reported cost (takes priority over calculated) |
| `checkBudget()` | Throws `BudgetExceededError` if over budget |
| `totalCostUsd()` | Returns reported cost if available, else calculated |
| `summary()` | Returns `{ total_usd, input_tokens, output_tokens, is_rate_limited }` |

### CLI vs API Cost Display

- **API providers** (Gemini): show USD cost calculated from tokens
- **CLI providers** (claude/codex): set `isRateLimited = true`, display guidance text ("check claude -> /usage") instead of cost

## JSON Parsing

**File:** `packages/core/src/ai/parse-json.ts`

`extractJson<T>(text)` uses a 3-tier strategy to extract JSON from LLM responses:

### Tier 1: Direct Parse

```
Unescape literal \n, \t, \r sequences → JSON.parse()
```

CLI tools sometimes return single-line strings with literal backslash-n instead of actual newlines.

### Tier 2: Code Block Extraction

```
Regex match ```json ... ``` or ``` ... ``` → fixAndParse()
```

### Tier 3: Brace Scan

```
Find outermost { ... } with depth tracking → fixAndParse()
```

Handles nested braces, string content (including escaped quotes), and ignores braces inside strings.

### `fixAndParse(raw)`

Applies repairs before parsing:

1. Direct `JSON.parse()`
2. Strip trailing commas before `}` or `]`
3. Convert single-quoted keys to double-quoted (regex: `'key':` → `"key":`)
