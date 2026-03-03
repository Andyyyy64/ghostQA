# Layer A: Test Generation & Execution

## Overview

Layer A is the deterministic testing layer. It uses AI to generate Playwright E2E test code based on the git diff, then executes those tests automatically. Generated tests are saved to disk so users can commit them as permanent regression tests.

```
DiffAnalysis → AI generates Playwright code → Write test files → Execute via Playwright CLI → Collect results
```

## Test Generator

**File:** `packages/core/src/layer-a/test-generator.ts`

### Input

- `DiffAnalysis` with impact areas
- Application URL (for `BASE_URL` in generated tests)

### AI Prompt

The system prompt instructs the AI to generate working Playwright test code with these rules:

- Import from `@playwright/test` (`test`, `expect`)
- Use `test.describe` blocks
- Start every test with `page.goto(BASE_URL)`
- Use semantic locators in priority order: `data-testid` > `role` > `aria-label` > CSS selector
- Keep tests under 15 lines
- Include simple, observable assertions
- Output ONLY TypeScript code (no markdown fences, no explanations)

The user message includes:

- Diff summary from the analysis
- Impact areas with risk levels and descriptions
- The application URL

### Response Parsing

`parseTests(response)` applies multiple extraction strategies:

1. **Unescape literals** — converts `\n` to actual newlines (CLI tools return single-line strings)
2. **Code block extraction** — regex matches ` ```ts ``` ` / ` ```typescript ``` ` / ` ```js ``` ` fences
3. **Import-based fallback** — finds `import { test, expect }` and takes everything after it
4. **Validation** — must contain both `@playwright/test` import AND `test(` or `test.describe(` call

Returns `GeneratedTest[]` where each entry has a `name` and `code` string.

### Skip Conditions

If `impact_areas` is empty, returns `[]` immediately (no tests to generate).

## Test Runner

**File:** `packages/core/src/layer-a/test-runner.ts`

### Playwright Resolution

Uses `createRequire(import.meta.url)` to find ghostQA's own `@playwright/test` installation:

```typescript
const ptPath = require.resolve("@playwright/test/package.json");
const cliPath = join(dirname(ptPath), "cli.js");
const nodeModulesDir = resolve(dirname(ptPath), "..");
```

This avoids version conflicts with any Playwright the user might have installed.

### Test Execution Flow

For each generated test:

1. **Write** — saves `.spec.ts` file to a temp `.layer-a-tests/` directory
2. **Symlink** — creates a `node_modules` symlink from the test dir to ghostQA's own `node_modules` (so `@playwright/test` resolves)
3. **Execute** — runs `node <playwright/cli.js> test <file> --reporter=json --timeout <ms>`
4. **Retry** — if the test fails, executes once more; if retry passes, uses the retry result
5. **Collect** — parses results into `TestResult { name, passed, error? }`

### Error Extraction

On test failure, `extractPlaywrightError()` parses Playwright's JSON reporter output:

```
suites[] → specs[] → tests[] → results[] → errors[] → message
```

Multiple error messages are joined with `---` and truncated to 300 characters.

### Discovery Generation

Failed tests become `Discovery` objects:

```typescript
{
  id: "la-<nanoid(8)>",
  source: "layer-a",
  severity: "high",
  title: "Test failed: <test-name>",
  description: "<error-message>",
  url: config.app.url,
  timestamp: Date.now()
}
```

### Output Artifacts

After execution, test files are copied to `<run-dir>/generated-tests/` (excluding `node_modules`). The temp directory is cleaned up.

```
<run-dir>/
  generated-tests/
    generated-tests.spec.ts    # The AI-generated test code
```

## Orchestrator

**File:** `packages/core/src/layer-a/runner.ts`

`LayerARunner` coordinates the generator and runner:

```typescript
const tests = await generator.generate(analysis);
// logs: "Generated N test(s)"
const results = await runner.run(tests);
// logs: "Layer A: N generated, M passed, K failed"
```

Returns `LayerAResult`:

```typescript
{
  tests: TestResult[],        // individual test results
  discoveries: Discovery[]    // failed tests as discoveries
}
```
