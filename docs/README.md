# ghostQA Documentation

## Table of Contents

| Document | Description |
|----------|-------------|
| [Architecture Overview](./architecture.md) | System design, monorepo structure, data flow, module responsibilities |
| [Pipeline](./pipeline.md) | Step-by-step execution flow for single runs and Before/After comparisons |
| [AI System](./ai-system.md) | Provider abstraction, Gemini/Anthropic/OpenAI/CLI backends, task routing, cost tracking, JSON parsing |
| [Explorer: AI Exploration](./explorer.md) | Observe-plan-act loop, browser navigation, discovery detection, guardrails |
| [Comparator](./comparator.md) | Before/After comparison — discovery diff, visual diff, behavioral diff |
| [Reporter](./reporter.md) | HTML/JSON report generation for single runs and comparisons |
| [Configuration](./configuration.md) | Full `.ghostqa.yml` schema reference with all fields, defaults, and examples |
| [CLI](./cli.md) | All 6 commands with options, exit codes, and behavior |
| [GitHub Action](./github-action.md) | Action inputs/outputs, PR comment format, workflow examples |
| [Type Definitions](./types.md) | All shared TypeScript types and Zod schemas |
| [Infrastructure](./infrastructure.md) | Docker image, environment manager, app runner, recorder |

## Quick Links

- **Want to understand the overall design?** Start with [Architecture Overview](./architecture.md)
- **Want to know what happens when you run `ghostqa run`?** Read [Pipeline](./pipeline.md)
- **Want to configure ghostQA?** See [Configuration](./configuration.md)
- **Want to understand the AI layer?** Read [AI System](./ai-system.md)
- **Want to add a new AI provider?** See the provider interface in [AI System](./ai-system.md#provider-interface)
- **Want to understand how bugs are found?** Read [Explorer](./explorer.md)
