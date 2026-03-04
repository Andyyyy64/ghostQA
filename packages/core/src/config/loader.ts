import { readFile, writeFile, access } from "node:fs/promises";
import { resolve } from "node:path";
import YAML from "yaml";
import { GhostQAConfigSchema, type GhostQAConfig } from "../types/config";

const CONFIG_FILENAME = ".ghostqa.yml";

interface DetectedProject {
  name: string;
  build: string;
  start: string;
  port: number;
  packageManager: "pnpm" | "yarn" | "npm";
}

async function detectProject(cwd: string): Promise<DetectedProject> {
  const defaults: DetectedProject = {
    name: "my-app",
    build: "npm run build",
    start: "npm start",
    port: 3000,
    packageManager: "npm",
  };

  // Detect package manager from lockfile (check cwd and parent dirs)
  const lockfiles = [
    { file: "pnpm-lock.yaml", pm: "pnpm" as const },
    { file: "yarn.lock", pm: "yarn" as const },
    { file: "package-lock.json", pm: "npm" as const },
  ];
  let searchDir = cwd;
  outer: while (true) {
    for (const { file, pm } of lockfiles) {
      try {
        await access(resolve(searchDir, file));
        defaults.packageManager = pm;
        break outer;
      } catch {}
    }
    const parent = resolve(searchDir, "..");
    if (parent === searchDir) break;
    searchDir = parent;
  }

  // Read package.json
  try {
    const raw = await readFile(resolve(cwd, "package.json"), "utf-8");
    const pkg = JSON.parse(raw);
    const pm = defaults.packageManager;

    if (pkg.name) defaults.name = pkg.name;

    const scripts = pkg.scripts ?? {};
    if (scripts.build) defaults.build = `${pm} run build`;
    else defaults.build = `echo 'no build step'`;

    if (scripts.dev) defaults.start = `${pm} run dev`;
    else if (scripts.start) defaults.start = `${pm} start`;

    // Extract port from start/dev script
    const startScript = scripts.dev ?? scripts.start ?? "";
    const portMatch = startScript.match(/(?:--port|PORT=|-p)\s*(\d+)/);
    if (portMatch) defaults.port = parseInt(portMatch[1], 10);
  } catch {}

  return defaults;
}

export async function configExists(cwd: string): Promise<boolean> {
  try {
    await access(resolve(cwd, CONFIG_FILENAME));
    return true;
  } catch {
    return false;
  }
}

export async function generateConfig(cwd: string): Promise<string> {
  const project = await detectProject(cwd);
  const url = `http://localhost:${project.port}`;

  const yaml = `# ghostQA — auto-detected from package.json
# Docs: https://github.com/ghostqa/ghostqa/blob/main/docs/configuration.md

app:
  name: ${project.name}
  build: "${project.build}"
  start: "${project.start}"
  url: "${url}"

ai:
  provider: cli               # cli (Claude Code) | gemini | anthropic | openai
  cli:
    command: claude            # claude | codex | gemini

explorer:
  max_steps: 50
  max_duration: 300000        # 5 minutes

constraints:
  no_payment: true
  allowed_domains:
    - localhost
    - "127.0.0.1"
`;

  const configPath = resolve(cwd, CONFIG_FILENAME);
  await writeFile(configPath, yaml, "utf-8");
  return configPath;
}

export async function loadConfig(cwd: string): Promise<GhostQAConfig> {
  const configPath = resolve(cwd, CONFIG_FILENAME);
  const raw = await readFile(configPath, "utf-8");
  const parsed = YAML.parse(raw);
  return GhostQAConfigSchema.parse(parsed);
}
