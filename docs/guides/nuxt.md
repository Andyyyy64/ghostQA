# ghostQA + Nuxt

## Quick Config

```yaml
# .ghostqa.yml
app:
  name: my-nuxt-app
  build: "npx nuxt build"
  start: "npx nuxt preview --port 3000"
  url: "http://localhost:3000"
  healthcheck:
    path: "/"
    timeout: 30000

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
cd your-nuxt-project
ghostqa init          # auto-detects Nuxt

# 2. Make sure your app builds cleanly
npx nuxt build

# 3. Run ghostQA
ghostqa run
```

## Common Pitfalls

### Use `nuxt preview`, not `nuxt dev`

`nuxt preview` serves the production build from `.output/`. `nuxt dev` runs the development server with HMR and different SSR behavior.

```yaml
# Good - production build
app:
  build: "npx nuxt build"
  start: "npx nuxt preview --port 3000"

# Bad - dev server
app:
  build: ""
  start: "npx nuxt dev --port 3000"
```

### SSR mode differences

Nuxt supports multiple rendering modes (`ssr: true`, `ssr: false`, hybrid). ghostQA works with all of them, but be aware:

- **SSR (`ssr: true`)** — default mode. Server renders the initial page, then hydrates. ghostQA sees the fully rendered page.
- **SPA (`ssr: false`)** — client-only. The initial HTML is empty; content appears after JS loads. ghostQA waits for hydration, but increase the healthcheck timeout if your app takes time to load.
- **Hybrid** — per-route rendering rules. Works fine with ghostQA; just make sure the pages you care about are reachable.

### The `.nuxt` and `.output` directories

`nuxt build` writes to `.output/`. If you see build errors, try deleting `.nuxt/` (the dev cache) first:

```yaml
app:
  build: "rm -rf .nuxt && npx nuxt build"
  start: "npx nuxt preview --port 3000"
```

### Static generation (`nuxt generate`)

If you use `nuxt generate` for a fully static site, serve it with a static file server:

```yaml
app:
  build: "npx nuxt generate"
  start: "npx serve .output/public -l 3000"
  url: "http://localhost:3000"
```
