/** Abstract interfaces for observer/navigator — shared by Web (Playwright) and Desktop (xdotool) modes */

export interface DisplayState {
  /** URL (web) or window title (desktop) */
  identifier: string;
  title: string;
  /** AX tree (web) or empty string (desktop) */
  axTree: string;
  screenshotBase64: string;
  /** Console logs (web) or process stdout/stderr (desktop) */
  logs: string[];
  timestamp: number;
  displaySize: { width: number; height: number };
}

export interface IObserver {
  startListening(): void;
  observe(): Promise<DisplayState>;
  screenshot(label?: string): Promise<string>;
  screenshotBase64(): Promise<string>;
}

export interface INavigator {
  execute(action: ExplorerAction): Promise<void>;
  navigateToTarget(target: string): Promise<void>;
  dispose(): Promise<void>;
}

// --- Web actions (selector-based) ---

export type WebActionType =
  | "click"
  | "type"
  | "scroll"
  | "wait"
  | "back"
  | "goto"
  | "select"
  | "hover";

export interface WebAction {
  kind: "web";
  action: WebActionType;
  selector?: string;
  text?: string;
  url?: string;
  direction?: "up" | "down";
  amount?: number;
  duration?: number;
}

// --- Desktop actions (coordinate-based) ---

export type DesktopActionType =
  | "left_click"
  | "right_click"
  | "double_click"
  | "type"
  | "key"
  | "scroll"
  | "wait"
  | "screenshot";

export interface DesktopAction {
  kind: "desktop";
  action: DesktopActionType;
  coordinate?: [number, number];
  text?: string;
  direction?: "up" | "down";
  amount?: number;
  duration?: number;
}

export type ExplorerAction = WebAction | DesktopAction;

/** Convert legacy BrowserAction to WebAction */
export function toWebAction(browser: {
  action: string;
  selector?: string;
  text?: string;
  url?: string;
  direction?: "up" | "down";
  amount?: number;
  duration?: number;
}): WebAction {
  return {
    kind: "web",
    action: browser.action as WebActionType,
    selector: browser.selector,
    text: browser.text,
    url: browser.url,
    direction: browser.direction,
    amount: browser.amount,
    duration: browser.duration,
  };
}
