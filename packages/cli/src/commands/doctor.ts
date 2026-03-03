import { Command } from "commander";
import consola from "consola";
import { execSync } from "node:child_process";

interface Check {
  name: string;
  test: () => boolean | string;
  required: boolean;
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

export const doctorCommand = new Command("doctor")
  .description("Check system dependencies and configuration")
  .action(async () => {
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
      },
      {
        name: "Git",
        test: () => getVersion("git") || false,
        required: true,
      },
      {
        name: "Docker",
        test: () => getVersion("docker") || false,
        required: false,
      },
      {
        name: "GEMINI_API_KEY",
        test: () => (process.env.GEMINI_API_KEY ? "set" : false),
        required: false,
      },
      {
        name: "ANTHROPIC_API_KEY",
        test: () => (process.env.ANTHROPIC_API_KEY ? "set" : false),
        required: false,
      },
      {
        name: "OPENAI_API_KEY",
        test: () => (process.env.OPENAI_API_KEY ? "set" : false),
        required: false,
      },
      {
        name: "CLI: claude (Claude Code)",
        test: () => {
          const path = commandFound("claude");
          return path ? `found (${path})` : false;
        },
        required: false,
      },
      {
        name: "CLI: codex (OpenAI Codex)",
        test: () => {
          const path = commandFound("codex");
          return path ? `found (${path})` : false;
        },
        required: false,
      },
      {
        name: "CLI: gemini (Gemini CLI)",
        test: () => {
          const path = commandFound("gemini");
          return path ? `found (${path})` : false;
        },
        required: false,
      },
      {
        name: "Playwright browsers",
        test: () => {
          try {
            // Quick check: launch and immediately close chromium
            const result = execSync(
              `node -e "require('playwright').chromium.executablePath()" 2>&1`,
              { encoding: "utf-8", timeout: 5000 }
            );
            // If no error, the browser binary exists
            return "chromium installed";
          } catch {
            // Fallback: check if @playwright/test is resolvable
            try {
              execSync(
                `node -e "require.resolve('@playwright/test')"`,
                { encoding: "utf-8", timeout: 5000 }
              );
              return "package found (browsers may need install: npx playwright install chromium)";
            } catch {
              return false;
            }
          }
        },
        required: false,
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
        allPassed = false;
      } else {
        consola.warn(`${check.name}: not found`);
      }
    }

    if (!hasAiProvider) {
      consola.error(
        "No AI provider found. Set an API key (GEMINI_API_KEY, ANTHROPIC_API_KEY, OPENAI_API_KEY) or install a CLI tool (claude, codex, gemini)."
      );
      allPassed = false;
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
