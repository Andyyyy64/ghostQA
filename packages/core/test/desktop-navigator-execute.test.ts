import { describe, it, expect, vi, beforeEach } from "vitest";
import type { DesktopAction, WebAction } from "../src/explorer/types";

// Mock execa module
vi.mock("execa", () => ({
  execa: vi.fn().mockResolvedValue({ stdout: "", stderr: "" }),
}));

// Import after mock setup
const { execa: mockExeca } = await import("execa");
const { DesktopNavigator } = await import("../src/explorer/desktop-navigator");

const mockedExeca = vi.mocked(mockExeca);

describe("DesktopNavigator.execute", () => {
  beforeEach(() => {
    mockedExeca.mockClear();
    mockedExeca.mockResolvedValue({ stdout: "", stderr: "" } as any);
  });

  it("executes left_click with xdotool mousemove + click", async () => {
    const nav = new DesktopNavigator(":99");
    const action: DesktopAction = {
      kind: "desktop",
      action: "left_click",
      coordinate: [500, 300],
    };

    await nav.execute(action);

    expect(mockedExeca).toHaveBeenCalledWith(
      "xdotool",
      ["mousemove", "--sync", "500", "300"],
      expect.objectContaining({ env: expect.objectContaining({ DISPLAY: ":99" }) })
    );
    expect(mockedExeca).toHaveBeenCalledWith(
      "xdotool",
      ["click", "1"],
      expect.objectContaining({ env: expect.objectContaining({ DISPLAY: ":99" }) })
    );
  });

  it("executes right_click with button 3", async () => {
    const nav = new DesktopNavigator(":99");
    await nav.execute({
      kind: "desktop",
      action: "right_click",
      coordinate: [100, 200],
    });

    expect(mockedExeca).toHaveBeenCalledWith(
      "xdotool",
      ["click", "3"],
      expect.anything()
    );
  });

  it("executes double_click with --repeat 2", async () => {
    const nav = new DesktopNavigator(":99");
    await nav.execute({
      kind: "desktop",
      action: "double_click",
      coordinate: [300, 400],
    });

    expect(mockedExeca).toHaveBeenCalledWith(
      "xdotool",
      ["click", "--repeat", "2", "--delay", "50", "1"],
      expect.anything()
    );
  });

  it("executes type with --clearmodifiers", async () => {
    const nav = new DesktopNavigator(":99");
    await nav.execute({
      kind: "desktop",
      action: "type",
      text: "hello world",
    });

    expect(mockedExeca).toHaveBeenCalledWith(
      "xdotool",
      ["type", "--clearmodifiers", "--delay", "12", "hello world"],
      expect.anything()
    );
  });

  it("executes key combo", async () => {
    const nav = new DesktopNavigator(":99");
    await nav.execute({
      kind: "desktop",
      action: "key",
      text: "ctrl+s",
    });

    expect(mockedExeca).toHaveBeenCalledWith(
      "xdotool",
      ["key", "--clearmodifiers", "ctrl+s"],
      expect.anything()
    );
  });

  it("executes scroll down at coordinate", async () => {
    const nav = new DesktopNavigator(":99");
    await nav.execute({
      kind: "desktop",
      action: "scroll",
      coordinate: [640, 360],
      direction: "down",
      amount: 300,
    });

    expect(mockedExeca).toHaveBeenCalledWith(
      "xdotool",
      ["mousemove", "--sync", "640", "360"],
      expect.anything()
    );
    expect(mockedExeca).toHaveBeenCalledWith(
      "xdotool",
      ["click", "--repeat", "3", "5"],
      expect.anything()
    );
  });

  it("executes scroll up with button4", async () => {
    const nav = new DesktopNavigator(":99");
    await nav.execute({
      kind: "desktop",
      action: "scroll",
      coordinate: [640, 360],
      direction: "up",
      amount: 500,
    });

    expect(mockedExeca).toHaveBeenCalledWith(
      "xdotool",
      ["click", "--repeat", "5", "4"],
      expect.anything()
    );
  });

  it("handles wait action without calling xdotool", async () => {
    const nav = new DesktopNavigator(":99");
    await nav.execute({
      kind: "desktop",
      action: "wait",
      duration: 10,
    });
    expect(mockedExeca).not.toHaveBeenCalled();
  });

  it("handles screenshot action as no-op", async () => {
    const nav = new DesktopNavigator(":99");
    await nav.execute({
      kind: "desktop",
      action: "screenshot",
    });
    expect(mockedExeca).not.toHaveBeenCalled();
  });

  it("rejects web actions", async () => {
    const nav = new DesktopNavigator(":99");
    const webAction: WebAction = {
      kind: "web",
      action: "click",
      selector: "#btn",
    };

    await expect(nav.execute(webAction)).rejects.toThrow(
      "DesktopNavigator cannot execute web actions"
    );
  });

  it("sets DISPLAY environment variable", async () => {
    const nav = new DesktopNavigator(":42");
    await nav.execute({
      kind: "desktop",
      action: "left_click",
      coordinate: [10, 20],
    });

    for (const call of mockedExeca.mock.calls) {
      expect((call[2] as any).env.DISPLAY).toBe(":42");
    }
  });
});

describe("DesktopNavigator.navigateToTarget", () => {
  beforeEach(() => {
    mockedExeca.mockClear();
    mockedExeca.mockResolvedValue({ stdout: "12345678", stderr: "" } as any);
  });

  it("searches for window by name and activates it", async () => {
    const nav = new DesktopNavigator(":99");
    await nav.navigateToTarget("My App");

    expect(mockedExeca).toHaveBeenCalledWith(
      "xdotool",
      ["search", "--name", "My App"],
      expect.anything()
    );
    expect(mockedExeca).toHaveBeenCalledWith(
      "xdotool",
      ["windowactivate", "12345678"],
      expect.anything()
    );
  });

  it("does not activate if no window found", async () => {
    mockedExeca.mockResolvedValue({ stdout: "", stderr: "" } as any);
    const nav = new DesktopNavigator(":99");
    await nav.navigateToTarget("Missing App");

    expect(mockedExeca).toHaveBeenCalledTimes(1);
  });
});
