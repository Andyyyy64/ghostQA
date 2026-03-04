# Architecture Overview

## Monorepo Structure

ghostQA is a pnpm v9 workspace monorepo with 4 packages:

```
ghostqa/
├── package.json                 # Root: scripts, devDependencies
├── pnpm-workspace.yaml          # packages/*
├── tsconfig.json                # Base TS config (ES2022, ESM)
├── packages/
│   ├── core/                    # @ghostqa/core — all business logic
│   ├── cli/                     # ghostqa — CLI entry point (6 commands)
│   ├── action/                  # @ghostqa/action — GitHub Action wrapper
│   └── docker/                  # Dockerfile + entrypoint.sh
└── examples/
    └── demo-app/                # Todo app with intentional bugs
```

## Package Dependencies

```
cli ──depends──> core
action ──depends──> core
```

- **core** has zero internal package dependencies. It exports everything other packages need.
- **cli** imports from `@ghostqa/core` and adds commander.js CLI wrappers.
- **action** imports from `@ghostqa/core` and adds GitHub Actions integration via `@actions/core` and `@actions/github`.

## Build System

All packages use **tsup** (esbuild wrapper):

| Package | Format | Target | Notes |
|---------|--------|--------|-------|
| core | ESM | ES2022 | Generates `.d.ts` type declarations |
| cli | ESM | ES2022 | `#!/usr/bin/env node` banner, `playwright` externalized |
| action | CJS | Node20 | Bundles all deps except `playwright`/`playwright-core` |

No `.js` extensions in TypeScript imports — tsup handles resolution.

## Core Module Map

```
packages/core/src/
├── index.ts              # Re-exports everything
├── types/                # Shared type definitions (Zod schemas + TS interfaces)
│   ├── config.ts         # GhostQAConfigSchema and all sub-schemas
│   ├── impact.ts         # DiffFile, ImpactArea, DiffAnalysis
│   ├── discovery.ts      # Discovery, RunResult, Verdict
│   └── comparison.ts     # ComparisonResult, BehavioralDiff, VisualDiffEntry
├── config/               # YAML config loading + validation
│   └── loader.ts         # loadConfig(), generateConfig(), configExists()
├── ai/                       # AI provider abstraction
│   ├── provider.ts           # AiProvider interface
│   ├── gemini-provider.ts    # Google Gemini API implementation
│   ├── anthropic-provider.ts # Anthropic API implementation (@anthropic-ai/sdk)
│   ├── openai-provider.ts    # OpenAI API implementation (openai SDK)
│   ├── cli-provider.ts       # CLI tool (claude/codex/gemini) implementation
│   ├── client.ts             # AiClient facade with task routing
│   ├── cost-tracker.ts       # Token counting + budget enforcement
│   └── parse-json.ts         # 3-tier JSON extraction from LLM output
├── diff-analyzer/        # Git diff parsing + AI impact analysis
│   ├── parser.ts         # Pure diff text parser
│   └── analyzer.ts       # AI-powered impact estimation
├── environment/          # Execution environment setup
│   └── manager.ts        # Docker container or native no-op
├── app-runner/           # Application lifecycle
│   └── runner.ts         # Build, start, healthcheck, stop
├── explorer/             # AI browser exploration
│   ├── observer.ts       # Page state capture (AX tree + screenshot)
│   ├── navigator.ts      # Browser action execution + constraint checking
│   ├── planner.ts        # AI decides next action (with JSON recovery)
│   ├── discoverer.ts     # Bug detection from console + AI observations
│   ├── guardrails.ts     # Step/time/budget/loop limits
│   └── action-loop.ts    # Main explore loop orchestrator
├── recorder/             # Evidence capture
│   └── recorder.ts       # Screenshots, video, HAR trace
├── reporter/             # Report generation
│   └── reporter.ts       # HTML + JSON output
├── comparator/           # Before/After comparison
│   └── comparator.ts     # Discovery diff, visual diff, behavioral diff
└── orchestrator/         # Pipeline coordination
    ├── run-pipeline.ts   # Single-run 7-step pipeline
    └── compare-pipeline.ts # Dual-run comparison pipeline
```

## Data Flow

```
                    ┌──────────────┐
                    │  .ghostqa.yml │
                    └──────┬───────┘
                           │ loadConfig()
                           ▼
┌─────────┐    git diff   ┌──────────────┐
│   Git   │──────────────>│ DiffAnalyzer  │
└─────────┘               └──────┬───────┘
                                 │ DiffAnalysis
                                 ▼
                    ┌────────────────────────┐
                    │    Environment Setup    │
                    │   (Docker or Native)    │
                    └────────────┬───────────┘
                                 │
                    ┌────────────┴───────────┐
                    │      App Runner         │
                    │  build → start → health │
                    └────────────┬───────────┘
                                 │
                    ┌────────────┴───────────┐
                    │                        │
                    │                ┌───────▼──────┐
                    │                │   Explorer    │
                    │                │  AI Explore   │
                    │                │  observe →    │
                    │                │  plan → act   │
                    │                └───────┬──────┘
                    │                        │
                    │    Discovery[]          │
                    └────────────┬───────────┘
                                 │
                    ┌────────────▼───────────┐
                    │       Reporter          │
                    │  HTML + JSON output     │
                    └────────────────────────┘
```

## Key Design Decisions

### AI Exploration

The explorer does creative, autonomous testing. An AI agent navigates the running application in a real browser, observing page state, planning actions, and discovering bugs through direct interaction.

### Diff-Driven Exploration

There are no hardcoded "flows" or test scenarios. The AI reads the actual git diff, estimates which areas are impacted, and focuses exploration on those areas. This means ghostQA adapts to every change automatically.

### Provider Abstraction

The `AiProvider` interface allows swapping AI backends without changing business logic. Currently implemented: Google Gemini (API), Anthropic (API via `@anthropic-ai/sdk`), OpenAI (API via `openai` SDK), and CLI tools (claude/codex/gemini via stdin pipe). Task routing lets you use different providers for different pipeline stages.

### AX Tree over DOM

The explorer uses Playwright's accessibility tree snapshot (`ariaSnapshot()`) instead of raw DOM. This is 5-20x more compact than full DOM, provides semantic meaning (roles, names, states), and gives the AI enough information to navigate without wasting tokens.

### Budget as a First-Class Concept

Every AI call is tracked through `CostTracker`. When the budget is exceeded, a `BudgetExceededError` is thrown and caught by the pipeline — it generates a partial report with whatever results exist rather than crashing.

### Evidence-Based Discovery

Every bug report includes concrete evidence: screenshots, console logs, page URL, and reproduction context. The AI doesn't just say "something is wrong" — it provides proof.
