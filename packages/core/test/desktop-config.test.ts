import { describe, it, expect } from "vitest";
import { GhostQAConfigSchema } from "../src/types/config";

describe("desktop config", () => {
  it("defaults explorer.mode to web", () => {
    const config = GhostQAConfigSchema.parse({
      app: { name: "test", build: "echo", start: "echo" },
    });
    expect(config.explorer.mode).toBe("web");
  });

  it("accepts explorer.mode desktop", () => {
    const config = GhostQAConfigSchema.parse({
      app: { name: "test", build: "echo", start: "echo" },
      explorer: { mode: "desktop" },
    });
    expect(config.explorer.mode).toBe("desktop");
  });

  it("applies desktop defaults", () => {
    const config = GhostQAConfigSchema.parse({
      app: { name: "test", build: "echo", start: "echo" },
      explorer: { mode: "desktop" },
    });
    expect(config.explorer.desktop.display).toBe(":99");
    expect(config.explorer.desktop.window_timeout).toBe(30000);
    expect(config.explorer.desktop.app_command).toBe("");
  });

  it("accepts custom desktop config", () => {
    const config = GhostQAConfigSchema.parse({
      app: { name: "test", build: "echo", start: "echo" },
      explorer: {
        mode: "desktop",
        desktop: {
          display: ":1",
          app_command: "electron .",
          window_name: "My App",
          window_timeout: 60000,
        },
      },
    });
    expect(config.explorer.desktop.display).toBe(":1");
    expect(config.explorer.desktop.app_command).toBe("electron .");
    expect(config.explorer.desktop.window_name).toBe("My App");
    expect(config.explorer.desktop.window_timeout).toBe(60000);
  });

  it("accepts explorer.mode auto", () => {
    const config = GhostQAConfigSchema.parse({
      app: { name: "test", build: "echo", start: "echo" },
      explorer: { mode: "auto" },
    });
    expect(config.explorer.mode).toBe("auto");
  });
});
