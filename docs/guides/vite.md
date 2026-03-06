# ghostQA + Vite (React / Vue / Svelte)

## Quick Config

```yaml
# .ghostqa.yml
app:
  name: my-vite-app
  build: "npm run build"
  start: "npx vite preview --port 3000"
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
cd your-vite-project
ghostqa init          # auto-detects Vite

# 2. Make sure your app builds cleanly
npm run build

# 3. Run ghostQA
ghostqa run
```

## Common Pitfalls

### Use `vite preview`, not `vite dev`

ghostQA should test your production build, not the dev server.

- `vite dev` — development server with HMR, no production optimizations
- `vite preview` — serves the built output from `dist/`, behaves like production

```yaml
# Good - serves production build
app:
  build: "npm run build"
  start: "npx vite preview --port 3000"

# Bad - dev server has different behavior
app:
  build: ""
  start: "npx vite --port 3000"
```

### `vite preview` serves from `dist/`

`vite preview` requires a prior build. If `dist/` does not exist, it will fail. Make sure your `build` command runs first (ghostQA handles this automatically).

### API proxy / backend

If your Vite app uses a dev server proxy (`server.proxy` in `vite.config.ts`), that proxy is **not** available in `vite preview`. You need to either:

- Run your backend separately and set the API base URL via environment variables
- Use a tool like `concurrently` to start both frontend and backend

```yaml
app:
  build: "npm run build"
  start: "concurrently 'node server.js' 'npx vite preview --port 3000'"
  url: "http://localhost:3000"
```

### Port conflicts

Vite preview defaults to port 4173. Always specify `--port 3000` (or your preferred port) explicitly to keep it consistent with your `url` config.
