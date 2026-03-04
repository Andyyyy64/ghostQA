import { describe, it, expect } from "vitest";
import { DesktopEnvironment } from "../src/explorer/desktop-environment";

describe("DesktopEnvironment", () => {
  describe("buildXdotoolCommand", () => {
    it("builds left_click command", () => {
      const cmds = DesktopEnvironment.buildXdotoolCommand("left_click", [500, 300]);
      expect(cmds).toEqual([
        ["mousemove", "--sync", "500", "300"],
        ["click", "1"],
      ]);
    });

    it("builds right_click command", () => {
      const cmds = DesktopEnvironment.buildXdotoolCommand("right_click", [100, 200]);
      expect(cmds).toEqual([
        ["mousemove", "--sync", "100", "200"],
        ["click", "3"],
      ]);
    });

    it("builds double_click command", () => {
      const cmds = DesktopEnvironment.buildXdotoolCommand("double_click", [600, 400]);
      expect(cmds).toEqual([
        ["mousemove", "--sync", "600", "400"],
        ["click", "--repeat", "2", "--delay", "50", "1"],
      ]);
    });

    it("builds type command", () => {
      const cmds = DesktopEnvironment.buildXdotoolCommand("type", undefined, "hello world");
      expect(cmds).toEqual([
        ["type", "--clearmodifiers", "--delay", "12", "hello world"],
      ]);
    });

    it("builds key command", () => {
      const cmds = DesktopEnvironment.buildXdotoolCommand("key", undefined, "ctrl+s");
      expect(cmds).toEqual([
        ["key", "--clearmodifiers", "ctrl+s"],
      ]);
    });

    it("builds scroll command with coordinate", () => {
      const cmds = DesktopEnvironment.buildXdotoolCommand("scroll", [300, 400]);
      expect(cmds).toEqual([
        ["mousemove", "--sync", "300", "400"],
        ["click", "--repeat", "3", "5"],
      ]);
    });

    it("builds scroll command without coordinate", () => {
      const cmds = DesktopEnvironment.buildXdotoolCommand("scroll");
      expect(cmds).toEqual([
        ["click", "--repeat", "3", "5"],
      ]);
    });

    it("throws for left_click without coordinate", () => {
      expect(() => DesktopEnvironment.buildXdotoolCommand("left_click")).toThrow(
        "left_click requires coordinate"
      );
    });

    it("throws for type without text", () => {
      expect(() => DesktopEnvironment.buildXdotoolCommand("type")).toThrow(
        "type requires text"
      );
    });

    it("throws for key without text", () => {
      expect(() => DesktopEnvironment.buildXdotoolCommand("key")).toThrow(
        "key requires text"
      );
    });

    it("throws for unknown action", () => {
      expect(() => DesktopEnvironment.buildXdotoolCommand("magic")).toThrow(
        "Unknown desktop action: magic"
      );
    });
  });
});
