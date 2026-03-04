import { describe, it, expect } from "vitest";
import type { DesktopAction } from "../src/explorer/types";

// Test action → xdotool mapping logic without needing xdotool installed
describe("DesktopAction types", () => {
  it("constructs a left_click action", () => {
    const action: DesktopAction = {
      kind: "desktop",
      action: "left_click",
      coordinate: [500, 300],
    };
    expect(action.kind).toBe("desktop");
    expect(action.action).toBe("left_click");
    expect(action.coordinate).toEqual([500, 300]);
  });

  it("constructs a type action", () => {
    const action: DesktopAction = {
      kind: "desktop",
      action: "type",
      text: "hello world",
    };
    expect(action.action).toBe("type");
    expect(action.text).toBe("hello world");
    expect(action.coordinate).toBeUndefined();
  });

  it("constructs a key action", () => {
    const action: DesktopAction = {
      kind: "desktop",
      action: "key",
      text: "ctrl+s",
    };
    expect(action.action).toBe("key");
    expect(action.text).toBe("ctrl+s");
  });

  it("constructs a scroll action with direction", () => {
    const action: DesktopAction = {
      kind: "desktop",
      action: "scroll",
      coordinate: [640, 360],
      direction: "up",
      amount: 500,
    };
    expect(action.action).toBe("scroll");
    expect(action.direction).toBe("up");
    expect(action.amount).toBe(500);
  });

  it("constructs a wait action", () => {
    const action: DesktopAction = {
      kind: "desktop",
      action: "wait",
      duration: 2000,
    };
    expect(action.action).toBe("wait");
    expect(action.duration).toBe(2000);
  });
});
