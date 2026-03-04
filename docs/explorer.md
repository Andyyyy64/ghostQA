# Explorer: AI Exploration

## Overview

The Explorer is the AI-powered exploratory testing component. An AI agent autonomously navigates the running application in a real browser, observing page state, planning actions, executing them, and reporting any anomalies it discovers.

```
                    ┌──────────┐
                    │ Observe  │ AX tree + screenshot + console logs
                    └────┬─────┘
                         │
                    ┌────▼─────┐
                    │   Plan   │ AI decides next action
                    └────┬─────┘
                         │
                    ┌────▼─────┐
                    │   Act    │ Execute browser action
                    └────┬─────┘
                         │
                    ┌────▼─────┐
                    │ Discover │ Check for bugs
                    └────┬─────┘
                         │
                    ┌────▼─────┐
                    │  Guard   │ Check limits
                    └──────────┘
                         │
                    (loop back to Observe)
```

## Components

### Observer

**File:** `packages/core/src/explorer/observer.ts`

Captures the current page state for the AI.

**`startListening(page)`** — attaches event listeners (called once):

- `page.on("console")` — captures all console messages
- `page.on("pageerror")` — captures uncaught exceptions

**`observe(page)`** — returns `PageState`:

| Field | Source | Description |
|-------|--------|-------------|
| `url` | `page.url()` | Current page URL |
| `title` | `page.title()` | Page title |
| `axTree` | `page.locator(":root").ariaSnapshot()` | Accessibility tree snapshot |
| `screenshotBase64` | `recorder.screenshotBase64(page)` | Full-page screenshot as base64 |
| `consoleLogs` | Internal buffer (drained) | Console messages since last observe |
| `timestamp` | `Date.now()` | Observation time |

**Why AX tree?** The accessibility tree is 5-20x more compact than raw DOM while providing semantic meaning (roles, names, states). This saves tokens and gives the AI more useful information.

### Navigator

**File:** `packages/core/src/explorer/navigator.ts`

Executes browser actions and enforces constraints.

**Available Actions:**

| Action | Parameters | Implementation |
|--------|-----------|----------------|
| `click` | `selector` | `page.locator(selector).first().click({ timeout: 5000 })` |
| `type` | `selector`, `text` | `page.locator(selector).first().fill(text)` |
| `scroll` | `direction`, `amount` | `page.mouse.wheel(0, amount)` (negative for up) |
| `wait` | `duration` | `page.waitForTimeout(duration)` |
| `back` | — | `page.goBack()` |
| `goto` | `url` | `page.goto(url, { waitUntil: "domcontentloaded" })` |
| `hover` | `selector` | `page.locator(selector).first().hover()` |
| `select` | `selector`, `text` | `page.locator(selector).first().selectOption(text)` |

After every action: waits for `domcontentloaded` + 300ms stabilization.

**Constraint Checking:**

| Constraint | Check | Applied To |
|-----------|-------|------------|
| `forbidden_selectors` | Substring match against selector | All selector-based actions |
| `no_payment` | Regex `/pay\|purchase\|buy\|checkout\|subscribe\|billing/i` | Selector-based actions |
| `no_delete` | Regex `/delete\|remove\|destroy\|drop/i` | Selector-based actions |
| `no_external_links` | Hostname comparison | `goto` actions |
| `allowed_domains` | Allowlist check | `goto` actions |

Constraint violations throw an error (caught by the action loop, not fatal).

### Planner

**File:** `packages/core/src/explorer/planner.ts`

The AI brain that decides what to do next.

**Conversation Management:**

- Maintains a `history: ChatMessage[]` array
- Trims to last 16 messages when length exceeds 20
- Each `plan()` call adds a user message (page state) and an assistant message (AI response)

**System Prompt:**

The system prompt includes:

- Role description (AI QA explorer)
- Available actions with JSON examples
- Selector preference (semantic selectors first)
- JSON-only response requirement
- Critical rules:
  - Set `done: true` only after testing ALL impact areas
  - EVERY bug must use the `discovery` field
  - Report ONE discovery per step
  - ALWAYS respond with JSON, never natural language

**Context injection:**

- Diff analysis summary
- Impact areas with risk levels
- Current page state (URL, title, AX tree, console logs)
- Screenshot (via `chatWithImage`)

**Expected Response:**

```json
{
  "reasoning": "Brief explanation of what I'm testing and why",
  "action": { "action": "click", "selector": "text=Submit" },
  "observation": "What I notice about the current page state",
  "discovery": null,
  "done": false
}
```

When a bug is found:

```json
{
  "discovery": {
    "title": "Short description of the bug",
    "description": "Detailed description with context",
    "severity": "high"
  }
}
```

**JSON Parse Recovery:**

The planner has a 3-level recovery system for malformed AI responses:

1. **`extractJson()`** — standard 3-tier JSON extraction
2. **`extractFallbackAction()`** — natural language parsing:
   - Detects "done" phrases: "all tests complete", "finished testing", etc.
   - Detects click intent: `click on the Submit button` → `{ action: "click", selector: "text=Submit" }`
   - Detects type intent: `type "hello" into the search field` → `{ action: "type", ... }`
3. **Failure escalation:**
   - 1-2 failures: scroll down and continue
   - 3+ consecutive failures: set `done: true` and stop

After any parse failure, a JSON reminder is injected into the conversation history.

### Discoverer

**File:** `packages/core/src/explorer/discoverer.ts`

Detects bugs from two sources:

**1. Console Error Detection** (`detectFromConsole`):

Filters console messages for `[error]` and `[pageerror]` prefixes, then matches against patterns:

| Pattern | Severity |
|---------|----------|
| `[pageerror]` (uncaught exception) | `high` |
| `UncaughtTypeError`, `ReferenceError`, `SyntaxError`, `RangeError` | `medium` |
| `cannot read propert*` | `medium` |
| `is not a function` | `medium` |
| `is not defined` | `medium` |
| `failed to fetch`, `network error` | `medium` |
| `500 internal server`, `404 not found` | `medium` |
| `chunk load error` | `medium` |

**2. AI-Reported Discoveries** (`createFromPlan`):

Creates a `Discovery` from the planner's `discovery` field, with screenshot evidence.

### Guardrails

**File:** `packages/core/src/explorer/guardrails.ts`

Enforces exploration limits:

| Limit | Default | Behavior |
|-------|---------|----------|
| `max_steps` | 50 | Stop after N browser actions |
| `max_duration` | 300,000 ms (5 min) | Stop after elapsed time |
| Budget | `max_budget_usd` | `BudgetExceededError` thrown |
| Loop detection | — | Stop if last 3 actions repeat previous 3 |

**Loop Detection:**

Maintains a `recentActions` buffer (max 10). When `length >= 6`, checks if `actions[n-3..n]` equals `actions[n-6..n-3]`. This catches the AI clicking the same button repeatedly.

**Stats:**

```typescript
{
  steps_taken: number,
  pages_visited: number,  // unique URLs
  elapsed_ms: number
}
```

## Action Loop

**File:** `packages/core/src/explorer/action-loop.ts`

`ExplorerRunner` orchestrates all explorer components:

```typescript
constructor(ai: AiClient, config: GhostQAConfig, recorder: Recorder)

async run(page: Page, analysis: DiffAnalysis, onProgress?): Promise<ExplorerResult>
```

### Loop Flow

```
1. Navigate to app URL
2. Start console listener
3. LOOP:
   a. Check guardrails → break if should stop
   b. Observe page state (AX tree + screenshot + console)
   c. Check console for error patterns → create discoveries
   d. Take step screenshot (step-N)
   e. Ask planner for next action
   f. If discovery in plan → screenshot + create discovery
   g. If plan.done → break
   h. Execute action via navigator (failures caught, not fatal)
   i. Record step in guardrails
4. Return { steps_taken, pages_visited, discoveries }
```

### Error Handling

- **Navigator failures** (element not found, timeout): caught and logged as debug, not fatal
- **Budget exceeded**: propagates up to pipeline level for partial report
- **Parse failures**: handled by planner's recovery system
