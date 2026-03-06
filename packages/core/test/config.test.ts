import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadConfig, generateConfig, configExists, detectProject } from "../src/config/loader";

describe("config", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "ghostqa-test-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  describe("configExists", () => {
    it("returns false when no config", async () => {
      expect(await configExists(tmpDir)).toBe(false);
    });

    it("returns true after generating config", async () => {
      await generateConfig(tmpDir);
      expect(await configExists(tmpDir)).toBe(true);
    });
  });

  describe("generateConfig", () => {
    it("creates a valid .ghostqa.yml", async () => {
      const { path } = await generateConfig(tmpDir);
      expect(path).toContain(".ghostqa.yml");
      const content = await readFile(path, "utf-8");
      expect(content).toContain("app:");
      expect(content).toContain("ai:");
      expect(content).toContain("explorer:");
    });

    it("generated config is loadable", async () => {
      await generateConfig(tmpDir);
      const config = await loadConfig(tmpDir);
      expect(config.app.name).toBe("my-app");
      expect(config.ai.provider).toBe("cli");
      expect(config.explorer.enabled).toBe(true);
    });
  });

  describe("detectProject", () => {
    it("detects Next.js from config file", async () => {
      const { writeFile } = await import("node:fs/promises");
      await writeFile(join(tmpDir, "package.json"), JSON.stringify({ name: "test-app", scripts: { dev: "next dev", build: "next build" } }));
      await writeFile(join(tmpDir, "next.config.js"), "module.exports = {}");
      const project = await detectProject(tmpDir);
      expect(project.framework).toBe("Next.js");
      expect(project.name).toBe("test-app");
    });

    it("detects Vite from dependency", async () => {
      const { writeFile } = await import("node:fs/promises");
      await writeFile(join(tmpDir, "package.json"), JSON.stringify({ name: "vite-app", devDependencies: { vite: "^5.0.0" }, scripts: { dev: "vite dev --port 5173", build: "vite build" } }));
      const project = await detectProject(tmpDir);
      expect(project.framework).toBe("Vite");
      expect(project.port).toBe(5173);
    });

    it("returns null framework when unknown", async () => {
      const project = await detectProject(tmpDir);
      expect(project.framework).toBeNull();
    });
  });

  describe("loadConfig", () => {
    it("throws on missing config", async () => {
      await expect(loadConfig(tmpDir)).rejects.toThrow();
    });

    it("applies defaults for missing optional fields", async () => {
      const { writeFile } = await import("node:fs/promises");
      await writeFile(
        join(tmpDir, ".ghostqa.yml"),
        `app:\n  name: test\n  build: "echo build"\n  start: "echo start"\n`,
        "utf-8"
      );
      const config = await loadConfig(tmpDir);
      expect(config.app.name).toBe("test");
      expect(config.environment.mode).toBe("native");
      expect(config.ai.max_budget_usd).toBe(1.0);
      expect(config.explorer.max_steps).toBe(50);
      expect(config.reporter.output_dir).toBe(".ghostqa-runs");
    });
  });
});
