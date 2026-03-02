import { z } from "zod";

export const AppConfigSchema = z.object({
  name: z.string().describe("Application name"),
  root: z.string().default(".").describe("Project root directory"),
  build: z.string().describe("Build command (e.g. 'npm run build')"),
  start: z.string().describe("Start command (e.g. 'npm start')"),
  url: z
    .string()
    .url()
    .default("http://localhost:3000")
    .describe("Application URL after start"),
  healthcheck: z
    .object({
      path: z.string().default("/"),
      timeout: z.number().default(30000).describe("Timeout in ms"),
      interval: z.number().default(1000).describe("Poll interval in ms"),
    })
    .default({}),
});

export const EnvironmentConfigSchema = z.object({
  mode: z.enum(["docker", "native"]).default("native"),
  docker: z
    .object({
      image: z.string().default("ghostqa/runner:latest"),
      volumes: z.array(z.string()).default([]),
    })
    .default({}),
});

export const AiConfigSchema = z.object({
  provider: z
    .enum(["gemini", "cli"])
    .default("gemini")
    .describe("AI provider: 'gemini' for Google API, 'cli' for CLI LLM tools"),
  model: z.string().default("gemini-2.0-flash"),
  max_budget_usd: z.number().default(1.0).describe("Maximum budget in USD"),
  api_key_env: z.string().default("GEMINI_API_KEY"),
  cli: z
    .object({
      command: z
        .string()
        .default("claude")
        .describe("CLI tool command: 'claude', 'codex', or custom path"),
      args: z
        .array(z.string())
        .default([])
        .describe("Extra args passed to the CLI tool"),
    })
    .default({}),
});

export const LayerAConfigSchema = z.object({
  enabled: z.boolean().default(true),
  max_tests: z.number().default(10),
  timeout_per_test: z.number().default(30000).describe("Timeout per test in ms"),
});

export const LayerBConfigSchema = z.object({
  enabled: z.boolean().default(true),
  max_steps: z.number().default(50),
  max_duration: z.number().default(300000).describe("Max duration in ms"),
  viewport: z
    .object({
      width: z.number().default(1280),
      height: z.number().default(720),
    })
    .default({}),
});

export const ReporterConfigSchema = z.object({
  output_dir: z.string().default(".ghostqa-runs"),
  formats: z.array(z.enum(["html", "json"])).default(["html", "json"]),
  video: z.boolean().default(true),
  screenshots: z.boolean().default(true),
});

export const GhostQAConfigSchema = z.object({
  app: AppConfigSchema,
  environment: EnvironmentConfigSchema.default({}),
  ai: AiConfigSchema.default({}),
  layer_a: LayerAConfigSchema.default({}),
  layer_b: LayerBConfigSchema.default({}),
  reporter: ReporterConfigSchema.default({}),
});

export type GhostQAConfig = z.infer<typeof GhostQAConfigSchema>;
export type AppConfig = z.infer<typeof AppConfigSchema>;
export type EnvironmentConfig = z.infer<typeof EnvironmentConfigSchema>;
export type AiConfig = z.infer<typeof AiConfigSchema>;
export type LayerAConfig = z.infer<typeof LayerAConfigSchema>;
export type LayerBConfig = z.infer<typeof LayerBConfigSchema>;
export type ReporterConfig = z.infer<typeof ReporterConfigSchema>;
