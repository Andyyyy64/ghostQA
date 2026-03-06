# ghostQA + Astro

## Quick Config

```yaml
# .ghostqa.yml
app:
  name: my-astro-app
  build: "npm run build"
  start: "npx astro preview --port 3000"
  url: "http://localhost:3000"
  healthcheck:
    path: "/"
    timeout: 15000

ai:
  provider: gemini
  max_budget_usd: 1.0

constraints:
  no_external_links: true
  allowed_domains:
    - localhost
    - "127.0.0.1"
```

## Setup

```bash
# 1. Initialize
cd your-astro-project
ghostqa init          # auto-detects Astro

# 2. Make sure your app builds cleanly
npm run build

# 3. Run ghostQA
ghostqa run
```

## Common Pitfalls

### SSR vs Static mode

Astro supports two output modes. Your config depends on which one you use.

**Static (default — `output: 'static'`):**

```yaml
app:
  build: "npm run build"
  start: "npx astro preview --port 3000"
  url: "http://localhost:3000"
```

`astro preview` serves the pre-built static files from `dist/`.

**SSR (`output: 'server'` or `output: 'hybrid'`):**

```yaml
app:
  build: "npm run build"
  start: "node dist/server/entry.mjs"
  url: "http://localhost:4321"
  healthcheck:
    timeout: 30000
```

With SSR, the start command depends on your adapter (Node, Cloudflare, etc.). Check your adapter's docs for the correct entry point.

### Use `astro preview`, not `astro dev`

Same as other frameworks: always test the production build.

```yaml
# Good
app:
  build: "npm run build"
  start: "npx astro preview --port 3000"

# Bad
app:
  build: ""
  start: "npx astro dev --port 3000"
```

### Island architecture and client directives

Astro's island architecture means interactive components (`client:load`, `client:visible`, etc.) hydrate asynchronously. ghostQA handles this naturally through its observe-plan-act loop, but if your app has heavy client-side interactivity, consider increasing the exploration step count:

```yaml
explorer:
  max_steps: 60
```

### Default port

`astro preview` defaults to port 4321. Always specify `--port 3000` (or your preferred port) to match your `url` config.
