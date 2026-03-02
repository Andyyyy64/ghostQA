import { readFile, writeFile, access } from "node:fs/promises";
import { resolve } from "node:path";
import YAML from "yaml";
import { GhostQAConfigSchema, type GhostQAConfig } from "../types/config";

const CONFIG_FILENAME = ".ghostqa.yml";

const DEFAULT_CONFIG_YAML = `# ghostQA Configuration
# See https://github.com/ghostqa/ghostqa for documentation

app:
  name: my-app
  root: "."
  build: "npm run build"
  start: "npm start"
  url: "http://localhost:3000"
  healthcheck:
    path: "/"
    timeout: 30000
    interval: 1000

environment:
  mode: native
  # mode: docker
  # docker:
  #   image: ghostqa/runner:latest

ai:
  # provider: gemini (default) or cli (use Claude Code / Codex CLI)
  provider: gemini
  model: gemini-2.0-flash
  max_budget_usd: 1.0
  api_key_env: GEMINI_API_KEY
  # CLI tool settings (only used when provider: cli)
  # cli:
  #   command: claude    # or: codex, or any CLI tool path
  #   args: []

layer_a:
  enabled: true
  max_tests: 10
  timeout_per_test: 30000

layer_b:
  enabled: true
  max_steps: 50
  max_duration: 300000
  viewport:
    width: 1280
    height: 720

reporter:
  output_dir: .ghostqa-runs
  formats:
    - html
    - json
  video: true
  screenshots: true
`;

export async function configExists(cwd: string): Promise<boolean> {
  try {
    await access(resolve(cwd, CONFIG_FILENAME));
    return true;
  } catch {
    return false;
  }
}

export async function generateConfig(cwd: string): Promise<string> {
  const configPath = resolve(cwd, CONFIG_FILENAME);
  await writeFile(configPath, DEFAULT_CONFIG_YAML, "utf-8");
  return configPath;
}

export async function loadConfig(cwd: string): Promise<GhostQAConfig> {
  const configPath = resolve(cwd, CONFIG_FILENAME);
  const raw = await readFile(configPath, "utf-8");
  const parsed = YAML.parse(raw);
  return GhostQAConfigSchema.parse(parsed);
}
