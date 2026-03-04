import { execa } from "execa";
import consola from "consola";
import type { INavigator, ExplorerAction, DesktopAction } from "./types";
import { DesktopEnvironment } from "./desktop-environment";

/**
 * DesktopNavigator — INavigator implementation for desktop applications.
 * Uses xdotool for coordinate-based mouse/keyboard interaction.
 */
export class DesktopNavigator implements INavigator {
  constructor(
    private display: string
  ) {}

  async execute(action: ExplorerAction): Promise<void> {
    if (action.kind !== "desktop") {
      throw new Error("DesktopNavigator cannot execute web actions");
    }

    const da = action as DesktopAction;
    consola.debug(`Desktop action: ${da.action} ${da.coordinate ? `[${da.coordinate.join(",")}]` : ""} ${da.text ?? ""}`);

    if (da.action === "wait") {
      await new Promise((r) => setTimeout(r, da.duration ?? 1000));
      return;
    }

    if (da.action === "screenshot") {
      // No-op — screenshots are handled by the observer
      return;
    }

    // Handle scroll direction
    if (da.action === "scroll") {
      await this.executeScroll(da);
      return;
    }

    const commands = DesktopEnvironment.buildXdotoolCommand(
      da.action,
      da.coordinate,
      da.text
    );

    const env = { ...process.env, DISPLAY: this.display };

    for (const args of commands) {
      await execa("xdotool", args, { env, timeout: 10000 });
    }

    // Brief pause after action for UI to settle
    await new Promise((r) => setTimeout(r, 300));
  }

  private async executeScroll(action: DesktopAction): Promise<void> {
    const env = { ...process.env, DISPLAY: this.display };
    const scrollClicks = Math.ceil((action.amount ?? 300) / 100);
    // button4 = scroll up, button5 = scroll down
    const button = action.direction === "up" ? "4" : "5";

    if (action.coordinate) {
      await execa("xdotool", [
        "mousemove", "--sync",
        String(action.coordinate[0]), String(action.coordinate[1]),
      ], { env });
    }

    await execa("xdotool", [
      "click", "--repeat", String(scrollClicks), button,
    ], { env });
  }

  async navigateToTarget(target: string): Promise<void> {
    // In desktop mode, "navigating" means focusing a window
    // The target could be a window name pattern
    const env = { ...process.env, DISPLAY: this.display };
    try {
      const result = await execa("xdotool", ["search", "--name", target], {
        env,
        reject: false,
      });
      const windowId = result.stdout.trim().split("\n")[0];
      if (windowId) {
        await execa("xdotool", ["windowactivate", windowId], { env });
      }
    } catch {
      consola.warn(`Could not focus window: ${target}`);
    }
  }

  async dispose(): Promise<void> {
    // Nothing to clean up
  }
}
