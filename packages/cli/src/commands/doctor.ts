import { Command } from "commander";
import consola from "consola";
import { execSync } from "node:child_process";
import { createConnection } from "node:net";
import { configExists, loadConfig } from "@ghostqa/core";

interface Check {
  name: string;
  test: () => boolean | string;
  required: boolean;
  hint?: string;
}

function getVersion(cmd: string): string | false {
  try {
    return execSync(`${cmd} --version 2>/dev/null`, {
      encoding: "utf-8",
    })
      .trim()
      .split("\n")[0];
  } catch {
    return false;
  }
}

function commandFound(cmd: string): string | false {
  try {
    const result = execSync(`which ${cmd} 2>/dev/null`, {
      encoding: "utf-8",
    }).trim();
    return result || false;
  } catch {
    return false;
  }
}

function checkPort(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const conn = createConnection({ port, host: "127.0.0.1" });
    conn.on("connect", () => {
      conn.destroy();
      resolve(true); // port is in use
    });
    conn.on("error", () => {
      resolve(false); // port is free
    });
    conn.setTimeout(1000, () => {
      conn.destroy();
      resolve(false);
    });
  });
}

export const doctorCommand = new Command("doctor")
  .description("Check system dependencies and configuration")
  .option("-c, --config <path>", "Config file path")
  .action(async (opts) => {
    consola.info("Checking ghostQA dependencies...\n");

    const checks: Check[] = [
      {
        name: "Node.js (>= 22)",
        test: () => {
          const v = getVersion("node");
          if (!v) return false;
          const major = parseInt(v.match(/v?(\d+)/)?.[1] ?? "0");
          return major >= 22 ? v : false;
        },
        required: true,
        hint: "Install Node.js 22+: https://nodejs.org/",
      },
      {
        name: "Git",
        test: () => getVersion("git") || false,
        required: true,
        hint: "Install git: https://git-scm.com/",
      },
      {
        name: "Docker",
        test: () => getVersion("docker") || false,
        required: false,
        hint: "Optional: needed for engine.mode: docker",
      },
      {
        name: "GEMINI_API_KEY",
        test: () => (process.env.GEMINI_API_KEY ? "set" : false),
        required: false,
        hint: "export GEMINI_API_KEY=your-key",
      },
      {
        name: "ANTHROPIC_API_KEY",
        test: () => (process.env.ANTHROPIC_API_KEY ? "set" : false),
        required: false,
        hint: "export ANTHROPIC_API_KEY=your-key",
      },
      {
        name: "OPENAI_API_KEY",
        test: () => (process.env.OPENAI_API_KEY ? "set" : false),
        required: false,
        hint: "export OPENAI_API_KEY=your-key",
      },
      {
        name: "CLI: claude (Claude Code)",
        test: () => {
          const path = commandFound("claude");
          return path ? `found (${path})` : false;
        },
        required: false,
        hint: "npm install -g @anthropic-ai/claude-code",
      },
      {
        name: "CLI: codex (OpenAI Codex)",
        test: () => {
          const path = commandFound("codex");
          return path ? `found (${path})` : false;
        },
        required: false,
        hint: "npm install -g @openai/codex",
      },
      {
        name: "CLI: gemini (Gemini CLI)",
        test: () => {
          const path = commandFound("gemini");
          return path ? `found (${path})` : false;
        },
        required: false,
        hint: "npm install -g @google/gemini-cli",
      },
      {
        name: "Desktop: xdotool",
        test: () => {
          const path = commandFound("xdotool");
          return path ? `found (${path})` : false;
        },
        required: false,
      },
      {
        name: "Desktop: scrot",
        test: () => {
          const path = commandFound("scrot");
          return path ? `found (${path})` : false;
        },
        required: false,
      },
      {
        name: "Desktop: Xvfb",
        test: () => {
          const path = commandFound("Xvfb");
          return path ? `found (${path})` : false;
        },
        required: false,
      },
      {
        name: "Desktop: ffmpeg",
        test: () => {
          const v = getVersion("ffmpeg");
          return v || false;
        },
        required: false,
      },
      {
        name: "Playwright browsers",
        test: () => {
          try {
            execSync(
              `node -e "require('playwright').chromium.executablePath()" 2>&1`,
              { encoding: "utf-8", timeout: 5000 }
            );
            return "chromium installed";
          } catch {
            try {
              execSync(
                `node -e "require.resolve('playwright')"`,
                { encoding: "utf-8", timeout: 5000 }
              );
              return "package found (browsers may need install: npx playwright install chromium)";
            } catch {
              return false;
            }
          }
        },
        required: false,
        hint: "npx playwright install chromium",
      },
    ];

    let allPassed = true;
    let hasAiProvider = false;

    for (const check of checks) {
      const result = check.test();
      if (result) {
        consola.success(
          `${check.name}: ${typeof result === "string" ? result : "OK"}`
        );
        if (
          check.name.startsWith("GEMINI_API_KEY") ||
          check.name.startsWith("ANTHROPIC_API_KEY") ||
          check.name.startsWith("OPENAI_API_KEY") ||
          check.name.startsWith("CLI: claude") ||
          check.name.startsWith("CLI: codex") ||
          check.name.startsWith("CLI: gemini")
        ) {
          hasAiProvider = true;
        }
      } else if (check.required) {
        consola.error(`${check.name}: NOT FOUND (required)`);
        if (check.hint) consola.info(`  -> ${check.hint}`);
        allPassed = false;
      } else {
        consola.warn(`${check.name}: not found`);
        if (check.hint) consola.info(`  -> ${check.hint}`);
      }
    }

    if (!hasAiProvider) {
      consola.error(
        "No AI provider found. Set an API key (GEMINI_API_KEY, ANTHROPIC_API_KEY, OPENAI_API_KEY) or install a CLI tool (claude, codex, gemini)."
      );
      allPassed = false;
    }

    // Config file validation
    consola.log("");
    consola.info("Checking project configuration...\n");
    const cwd = process.cwd();

    if (await configExists(cwd)) {
      consola.success(".ghostqa.yml: found");
      try {
        const config = await loadConfig(cwd, opts.config);
        consola.success(`.ghostqa.yml: valid (provider: ${config.ai.provider}, mode: ${config.explorer.mode})`);

        // Config-aware provider check
        const provider = config.ai.provider;
        if (provider === "cli") {
          const cmd = config.ai.cli.command;
          if (!commandFound(cmd)) {
            consola.error(`Configured CLI tool "${cmd}" not found in PATH`);
            consola.info(`  -> Install it, or change ai.provider in .ghostqa.yml`);
            allPassed = false;
          } else {
            consola.success(`Configured CLI tool "${cmd}": available`);
          }
        } else {
          const keyEnv = config.ai.api_key_env;
          if (!process.env[keyEnv]) {
            consola.error(`Configured API key env "${keyEnv}" is not set`);
            consola.info(`  -> export ${keyEnv}=your-key`);
            allPassed = false;
          } else {
            consola.success(`Configured API key "${keyEnv}": set`);
          }
        }

        // Docker mode check
        if (config.environment.mode === "docker") {
          const dockerOk = getVersion("docker");
          if (!dockerOk) {
            consola.error("environment.mode is 'docker' but Docker is not installed");
            consola.info("  -> Install Docker, or set environment.mode: native in .ghostqa.yml");
            allPassed = false;
          } else {
            // Check if the configured image exists locally
            const img = config.environment.docker.image;
            try {
              execSync(`docker image inspect ${img} >/dev/null 2>&1`, { encoding: "utf-8" });
              consola.success(`Docker image "${img}": available locally`);
            } catch {
              consola.warn(`Docker image "${img}" not found locally`);
              consola.info(`  -> Build it: cd packages/docker && docker build -t ${img} .`);
              consola.info(`  -> Or switch to native mode: environment.mode: native`);
            }
          }
        }

        // Port conflict check
        const url = new URL(config.app.url);
        const port = parseInt(url.port || "80");
        const portInUse = await checkPort(port);
        if (portInUse) {
          consola.warn(`Port ${port} is already in use — ghostqa needs it free to start your app`);
          consola.info(`  -> Kill the process using port ${port}, or change app.url in .ghostqa.yml`);
        } else {
          consola.success(`Port ${port}: available`);
        }
      } catch (err) {
        consola.error(`.ghostqa.yml: invalid — ${err instanceof Error ? err.message : String(err)}`);
        consola.info("  -> Run: ghostqa validate  (for detailed errors)");
        allPassed = false;
      }
    } else {
      consola.warn(".ghostqa.yml: not found");
      consola.info("  -> Run: ghostqa init  (to generate config)");
    }

    consola.log("");
    if (allPassed) {
      consola.success("All checks passed!");
    } else {
      consola.error(
        "Some checks failed. See above for details."
      );
      process.exit(1);
    }
  });
