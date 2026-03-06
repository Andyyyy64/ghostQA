import { readFile, writeFile, access } from "node:fs/promises";
import { resolve } from "node:path";
import YAML from "yaml";
import { GhostQAConfigSchema, type GhostQAConfig } from "../types/config";

const CONFIG_FILENAME = ".ghostqa.yml";

const FRAMEWORK_DETECTORS = [
  { name: "Next.js", files: ["next.config.js", "next.config.mjs", "next.config.ts"], dep: "next" },
  { name: "Nuxt", files: ["nuxt.config.js", "nuxt.config.ts"], dep: "nuxt" },
  { name: "SvelteKit", files: ["svelte.config.js"], dep: "@sveltejs/kit" },
  { name: "Remix", files: ["remix.config.js", "remix.config.ts"], dep: "@remix-run/react" },
  { name: "Astro", files: ["astro.config.mjs", "astro.config.ts"], dep: "astro" },
  { name: "Angular", files: ["angular.json"], dep: "@angular/core" },
  { name: "Vite", files: ["vite.config.js", "vite.config.ts", "vite.config.mjs"], dep: "vite" },
  { name: "Gatsby", files: ["gatsby-config.js", "gatsby-config.ts"], dep: "gatsby" },
] as const;

interface DetectedProject {
  name: string;
  build: string;
  start: string;
  port: number;
  packageManager: "pnpm" | "yarn" | "npm";
  framework: string | null;
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function detectProject(cwd: string): Promise<DetectedProject> {
  const defaults: DetectedProject = {
    name: "my-app",
    build: "npm run build",
    start: "npm start",
    port: 3000,
    packageManager: "npm",
    framework: null,
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
      if (await fileExists(resolve(searchDir, file))) {
        defaults.packageManager = pm;
        break outer;
      }
    }
    const parent = resolve(searchDir, "..");
    if (parent === searchDir) break;
    searchDir = parent;
  }

  // Read package.json
  let deps: Record<string, string> = {};
  try {
    const raw = await readFile(resolve(cwd, "package.json"), "utf-8");
    const pkg = JSON.parse(raw);
    const pm = defaults.packageManager;

    if (pkg.name) defaults.name = pkg.name;
    deps = { ...pkg.dependencies, ...pkg.devDependencies };

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

  // Detect framework from config files and dependencies
  for (const fw of FRAMEWORK_DETECTORS) {
    for (const file of fw.files) {
      if (await fileExists(resolve(cwd, file))) {
        defaults.framework = fw.name;
        break;
      }
    }
    if (defaults.framework) break;
    if (fw.dep in deps) {
      defaults.framework = fw.name;
      break;
    }
  }

  return defaults;
}

export { type DetectedProject, detectProject };

export async function configExists(cwd: string): Promise<boolean> {
  return fileExists(resolve(cwd, CONFIG_FILENAME));
}

export async function generateConfig(cwd: string): Promise<{ path: string; project: DetectedProject }> {
  const project = await detectProject(cwd);
  const url = `http://localhost:${project.port}`;

  const frameworkComment = project.framework
    ? `# Framework: ${project.framework} (auto-detected)\n`
    : "";

  const yaml = `# ghostQA — auto-detected from package.json
# Docs: https://github.com/Andyyyy64/ghostQA/blob/main/docs/configuration.md
${frameworkComment}
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
  return { path: configPath, project };
}

export async function loadConfig(cwd: string, configFile?: string): Promise<GhostQAConfig> {
  const configPath = resolve(cwd, configFile ?? CONFIG_FILENAME);
  const raw = await readFile(configPath, "utf-8");
  const parsed = YAML.parse(raw);
  return GhostQAConfigSchema.parse(parsed);
}
