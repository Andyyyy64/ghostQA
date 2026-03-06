# ghostQA + Next.js

## Quick Config

```yaml
# .ghostqa.yml
app:
  name: my-nextjs-app
  build: "npm run build"
  start: "npm start -- --port 3000"
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
cd your-nextjs-project
ghostqa init          # auto-detects Next.js

# 2. Make sure your app builds cleanly
npm run build

# 3. Run ghostQA
ghostqa run
```

## Common Pitfalls

### Use production build, not dev server

ghostQA runs `build` then `start`. Do **not** set `start` to `npm run dev`.

The dev server has different behavior (HMR, unoptimized bundles, no static optimization). Always test against the production build to get realistic results.

```yaml
# Good
app:
  build: "npm run build"
  start: "npm start"

# Bad - dev server behaves differently from production
app:
  build: ""
  start: "npm run dev"
```

### API routes need a running backend

If your Next.js app calls external API services (a separate backend, database, etc.), those must be available during the ghostQA run. Options:

- **Self-contained API routes**: If you use Next.js API routes (`app/api/`), they run as part of `next start` automatically.
- **External backend**: Add a `build` step that starts your backend, or mock it.
- **Environment variables**: Set API URLs via env vars in your CI or shell before running ghostQA.

### Default port

`next start` defaults to port 3000. If your app uses a different port, specify it explicitly:

```yaml
app:
  start: "npm start -- --port 4000"
  url: "http://localhost:4000"
```

### Static export (`output: 'export'`)

If your `next.config.js` uses `output: 'export'`, you need a static file server instead of `next start`:

```yaml
app:
  build: "npm run build"
  start: "npx serve out -l 3000"
  url: "http://localhost:3000"
```
