/**
 * Deterministic structural checks — run BEFORE AI exploration.
 *
 * Each check targets a common bug pattern and tests it programmatically.
 * Findings have confidence "high" since they're deterministic, not AI guesses.
 *
 * Checks:
 *  1. Broken images — img elements that failed to load
 *  2. Overflow clipping — interactive elements hidden by overflow:hidden parents
 *  3. Stuck loading — async UI enters loading state and never settles
 *  4. Dead buttons — buttons that produce no DOM change / download / navigation
 *  5. Accordion collapse — expandable sections that can't be collapsed
 *  6. Modal close — modals/dialogs that can't be dismissed
 *  7. Sort toggle — table sort that doesn't reverse direction
 *  8. Progress bounds — progress bars that exceed 100%
 *  9. Tooltip dismiss — tooltips that stay visible after mouse leaves
 */
import type { Page } from "playwright";
import consola from "consola";
import type { Discovery } from "../types/discovery";
import { nanoid } from "nanoid";

type ScreenshotFn = (page: Page, name: string) => Promise<string>;

function makeDiscovery(
  title: string,
  description: string,
  severity: "low" | "medium" | "high" | "critical",
  url: string,
  screenshotPath: string,
): Discovery {
  return {
    id: `struct-${nanoid(8)}`,
    source: "structural",
    severity,
    title,
    description,
    url,
    screenshot_path: screenshotPath,
    timestamp: Date.now(),
    confidence: "high",
  };
}

export async function runStructuralChecks(
  page: Page,
  url: string,
  screenshotFn: ScreenshotFn,
): Promise<Discovery[]> {
  const discoveries: Discovery[] = [];
  const pageUrl = page.url();

  const checks: Array<{ name: string; fn: typeof checkBrokenImages }> = [
    { name: "broken images", fn: checkBrokenImages },
    { name: "overflow clipping", fn: checkOverflowClipping },
    { name: "stuck loading", fn: checkStuckLoading },
    { name: "accordion collapse", fn: checkAccordionCollapse },
    { name: "modal close", fn: checkModalClose },
    { name: "dead buttons", fn: checkDeadButtons },
    { name: "sort toggle", fn: checkSortToggle },
    { name: "progress bounds", fn: checkProgressBounds },
    { name: "tooltip dismiss", fn: checkTooltipDismiss },
  ];

  for (const check of checks) {
    try {
      const results = await check.fn(page, pageUrl, screenshotFn);
      if (results.length > 0) {
        consola.info(`  Structural check [${check.name}]: ${results.length} issue(s)`);
        discoveries.push(...results);
      }
    } catch (e) {
      consola.debug(`  Structural check [${check.name}] failed: ${e}`);
    }
    // Reset page state between checks
    try {
      await page.goto(pageUrl, { waitUntil: "domcontentloaded", timeout: 10000 });
      await page.waitForTimeout(300);
    } catch {}
  }

  consola.info(`Structural checks: ${discoveries.length} issue(s) found`);
  return discoveries;
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. Broken images
// ═══════════════════════════════════════════════════════════════════════════

async function checkBrokenImages(
  page: Page, url: string, screenshotFn: ScreenshotFn,
): Promise<Discovery[]> {
  const broken = await page.evaluate(() =>
    Array.from(document.querySelectorAll("img"))
      .filter(img => img.src && !img.src.startsWith("data:") && img.complete && img.naturalWidth === 0)
      .map(img => ({ src: img.src, alt: img.alt || "(no alt)" })),
  );
  if (broken.length === 0) return [];

  const screenshot = await screenshotFn(page, "broken-images");
  return broken.map(img =>
    makeDiscovery(
      `Broken image: "${img.alt}"`,
      `Image failed to load: src="${img.src}". The element exists but the resource is missing or returned an error.`,
      "medium", url, screenshot,
    ),
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// 2. Overflow clipping of interactive elements
// ═══════════════════════════════════════════════════════════════════════════

async function checkOverflowClipping(
  page: Page, url: string, screenshotFn: ScreenshotFn,
): Promise<Discovery[]> {
  const clipped = await page.evaluate(() => {
    const results: Array<{ text: string; parentTag: string }> = [];
    const els = document.querySelectorAll("button, a[href], input[type='submit'], [role='button']");
    for (const el of els) {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      let parent = el.parentElement;
      while (parent && parent !== document.body) {
        const style = getComputedStyle(parent);
        if (style.overflow === "hidden" || style.overflowY === "hidden" || style.overflowX === "hidden") {
          const pr = parent.getBoundingClientRect();
          if (rect.bottom > pr.bottom + 2 || rect.right > pr.right + 2 ||
              rect.top < pr.top - 2 || rect.left < pr.left - 2) {
            results.push({
              text: (el.textContent || "").trim().slice(0, 80),
              parentTag: parent.tagName.toLowerCase() + (parent.className ? `.${parent.className.split(" ")[0]}` : ""),
            });
            break;
          }
        }
        parent = parent.parentElement;
      }
    }
    return results;
  });
  if (clipped.length === 0) return [];

  const screenshot = await screenshotFn(page, "overflow-clipping");
  return clipped.map(item =>
    makeDiscovery(
      `Interactive element clipped by overflow: "${item.text}"`,
      `Button/link "${item.text}" extends beyond its parent (${item.parentTag}) which has overflow:hidden. The element may be partially or fully invisible and unclickable.`,
      "high", url, screenshot,
    ),
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// 3. Loading state that never resolves
// ═══════════════════════════════════════════════════════════════════════════

async function checkStuckLoading(
  page: Page, url: string, screenshotFn: ScreenshotFn,
): Promise<Discovery[]> {
  const discoveries: Discovery[] = [];

  const candidates = await page.evaluate(() => {
    const asyncHints = ["load", "fetch", "refresh", "retry", "sync", "update", "more"];
    const skip = ["delete", "remove", "pay", "purchase", "checkout", "submit", "send",
      "save", "cancel", "close", "login", "sign", "logout"];

    return Array.from(document.querySelectorAll("button:not([disabled]), [role='button']:not([disabled])"))
      .map((btn, index) => {
        const rect = btn.getBoundingClientRect();
        const text = (btn.textContent || "").trim();
        return { index, text, visible: rect.width > 0 && rect.height > 0 };
      })
      .filter((btn) => {
        if (!btn.visible || !btn.text || btn.text.length > 40) return false;
        const lower = btn.text.toLowerCase();
        if (skip.some((word) => lower.includes(word))) return false;
        return asyncHints.some((word) => lower.includes(word));
      })
      .slice(0, 5);
  });

  for (const candidate of candidates) {
    try {
      await page.evaluate((idx) => {
        const btn = document.querySelectorAll("button, [role='button']")[idx] as HTMLElement | null;
        btn?.click();
      }, candidate.index);
      await page.waitForTimeout(400);

      const started = await getLoadingState(page, candidate.index);
      if (!started.started) {
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 5000 });
        await page.waitForTimeout(300);
        continue;
      }

      let resolved = false;
      for (let i = 0; i < 8; i++) {
        await page.waitForTimeout(500);
        const state = await getLoadingState(page, candidate.index);
        if (!state.active) {
          resolved = true;
          break;
        }
      }

      if (!resolved) {
        const screenshot = await screenshotFn(page, "stuck-loading");
        discoveries.push(makeDiscovery(
          `Loading state triggered by "${candidate.text}" never resolves`,
          `After clicking "${candidate.text}", the UI enters a loading state and stays stuck for several seconds without completing. The control never recovers from loading, suggesting a missing resolve/retry/finally path.`,
          "high", url, screenshot,
        ));
      }

      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 5000 });
      await page.waitForTimeout(300);
    } catch {
      try { await page.goto(url, { waitUntil: "domcontentloaded", timeout: 5000 }); } catch {}
    }
  }

  return discoveries;
}

async function getLoadingState(page: Page, index: number): Promise<{ started: boolean; active: boolean }> {
  return page.evaluate((idx) => {
    const btn = document.querySelectorAll("button, [role='button']")[idx] as HTMLElement | null;
    if (!btn) return { started: false, active: false };

    const scope =
      btn.closest("section, article, form, dialog, [role='region']") as HTMLElement | null ||
      btn.parentElement;

    if (!scope) return { started: false, active: false };

    const visibleText = (scope.textContent || "").toLowerCase();
    const buttonText = (btn.textContent || "").toLowerCase();
    const buttonDisabled =
      btn.matches(":disabled") ||
      btn.getAttribute("aria-disabled") === "true";
    const ariaBusy =
      btn.getAttribute("aria-busy") === "true" ||
      scope.getAttribute("aria-busy") === "true";

    let spinnerVisible = false;
    for (const el of scope.querySelectorAll("*")) {
      const cs = getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden") continue;
      const tag = el.tagName.toLowerCase();
      const className = typeof (el as HTMLElement).className === "string" ? (el as HTMLElement).className.toLowerCase() : "";
      const id = ((el as HTMLElement).id || "").toLowerCase();
      const role = (el.getAttribute("role") || "").toLowerCase();
      if (
        role === "status" ||
        role === "progressbar" ||
        className.includes("spinner") ||
        className.includes("loading") ||
        id.includes("spinner") ||
        id.includes("loading") ||
        tag === "progress"
      ) {
        spinnerVisible = true;
        break;
      }
    }

    const loadingTextVisible =
      buttonText.includes("loading") ||
      visibleText.includes("loading") ||
      visibleText.includes("fetching") ||
      visibleText.includes("processing") ||
      visibleText.includes("please wait");

    const started = loadingTextVisible || spinnerVisible || ariaBusy;
    const active = started && (loadingTextVisible || spinnerVisible || ariaBusy || buttonDisabled);
    return { started, active };
  }, index);
}

// ═══════════════════════════════════════════════════════════════════════════
// 4. Dead buttons — click produces zero DOM change
// ═══════════════════════════════════════════════════════════════════════════

async function checkDeadButtons(
  page: Page, url: string, screenshotFn: ScreenshotFn,
): Promise<Discovery[]> {
  const discoveries: Discovery[] = [];

  // Find candidate buttons
  const buttons = await page.evaluate(() => {
    const skip = ["submit", "send", "login", "sign", "close", "cancel",
      "delete", "remove", "back", "load", "fetch", "place", "start", "edit"];
    return Array.from(document.querySelectorAll("button:not([disabled]), [role='button']:not([disabled])"))
      .map((btn, i) => {
        const rect = btn.getBoundingClientRect();
        const text = (btn.textContent || "").trim();
        return { index: i, text, visible: rect.width > 0 && rect.height > 0 };
      })
      .filter(b => {
        if (!b.visible || !b.text || b.text.length > 50) return false;
        const lower = b.text.toLowerCase();
        if (["+", "-", "−", "×", "▼", "▲"].includes(b.text)) return false;
        if (skip.some(k => lower.includes(k))) return false;
        if (b.text.match(/^[<>←→↕]$/)) return false;
        return true;
      });
  });

  for (const btn of buttons) {
    try {
      // Take DOM snapshot before click
      const before = await page.evaluate(() => document.body.innerHTML);

      // Click using evaluate to avoid Playwright navigation detection
      const clicked = await page.evaluate((btnText) => {
        const el = Array.from(document.querySelectorAll("button, [role='button']"))
          .find(b => (b.textContent || "").trim() === btnText) as HTMLElement | null;
        if (el) { el.click(); return true; }
        return false;
      }, btn.text);
      if (!clicked) continue;

      await page.waitForTimeout(800);

      // Check if anything changed
      const after = await page.evaluate(() => document.body.innerHTML);
      const urlChanged = page.url() !== url;

      if (!urlChanged && before === after) {
        const screenshot = await screenshotFn(page, "dead-button");
        discoveries.push(makeDiscovery(
          `Button "${btn.text}" has no visible effect when clicked`,
          `Clicking "${btn.text}" produced no DOM changes, no navigation, and no visible feedback. The event handler may be empty or missing.`,
          "medium", url, screenshot,
        ));
      }

      // Reset page
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 5000 });
      await page.waitForTimeout(300);
    } catch {
      try { await page.goto(url, { waitUntil: "domcontentloaded", timeout: 5000 }); } catch {}
    }
  }

  return discoveries;
}

// ═══════════════════════════════════════════════════════════════════════════
// 4. Accordion / collapsible elements that won't collapse
//    Detection: aria-expanded attributes + <details>/<summary> + behavioral
// ═══════════════════════════════════════════════════════════════════════════

async function checkAccordionCollapse(
  page: Page, url: string, screenshotFn: ScreenshotFn,
): Promise<Discovery[]> {
  const discoveries: Discovery[] = [];

  // Strategy 1: <details>/<summary> (HTML standard)
  const detailsEls = await page.locator("details").all();
  for (const details of detailsEls.slice(0, 3)) {
    try {
      const summary = details.locator("summary").first();
      if (!(await summary.isVisible())) continue;
      const text = ((await summary.textContent()) || "").trim().slice(0, 80);

      if (!(await details.getAttribute("open"))) {
        await summary.click({ timeout: 2000 });
        await page.waitForTimeout(300);
      }
      if (!(await details.getAttribute("open"))) continue;

      await summary.click({ timeout: 2000 });
      await page.waitForTimeout(300);

      if (await details.getAttribute("open") !== null) {
        const screenshot = await screenshotFn(page, "details-collapse");
        discoveries.push(makeDiscovery(
          `<details> element won't collapse: "${text}"`,
          `The <details> element with summary "${text}" can be expanded but cannot be collapsed.`,
          "medium", url, screenshot,
        ));
        break;
      }
    } catch {}
  }

  // Strategy 2: aria-expanded (ARIA standard — covers Bootstrap, MUI, Radix, etc.)
  const ariaToggles = await page.locator("[aria-expanded]").all();
  for (const toggle of ariaToggles.slice(0, 5)) {
    try {
      if (!(await toggle.isVisible())) continue;
      const text = ((await toggle.textContent()) || "").trim().slice(0, 80);

      // Expand if collapsed
      if ((await toggle.getAttribute("aria-expanded")) === "false") {
        await toggle.click({ timeout: 2000 });
        await page.waitForTimeout(500);
      }
      if ((await toggle.getAttribute("aria-expanded")) !== "true") continue;

      // Try to collapse
      await toggle.click({ timeout: 2000 });
      await page.waitForTimeout(500);

      if ((await toggle.getAttribute("aria-expanded")) === "true") {
        const screenshot = await screenshotFn(page, "aria-collapse");
        discoveries.push(makeDiscovery(
          `Expandable element won't collapse: "${text}"`,
          `An element with aria-expanded ("${text}") expands on click but does not collapse on the second click. The toggle behavior is broken.`,
          "medium", url, screenshot,
        ));
        break;
      }
    } catch {}
  }

  // Strategy 3: Behavioral — find clickable elements that show hidden siblings
  // Look for elements where click toggles visibility of the next sibling
  if (discoveries.length === 0) {
    const toggleCandidates = await page.evaluate(() => {
      const results: Array<{ text: string; index: number }> = [];
      // Find clickable elements followed by a hidden sibling
      const clickables = document.querySelectorAll("[onclick], [role='button'], button");
      for (let i = 0; i < clickables.length; i++) {
        const el = clickables[i] as HTMLElement;
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) continue;
        const next = el.nextElementSibling as HTMLElement | null;
        if (!next) continue;
        // Check if sibling is hidden (display: none)
        const style = getComputedStyle(next);
        if (style.display === "none" && next.textContent && next.textContent.trim().length > 0) {
          results.push({ text: (el.textContent || "").trim().slice(0, 80), index: i });
        }
      }
      return results.slice(0, 5);
    });

    for (const candidate of toggleCandidates) {
      try {
        // Click to expand
        await page.evaluate((idx) => {
          const els = document.querySelectorAll("[onclick], [role='button'], button");
          (els[idx] as HTMLElement).click();
        }, candidate.index);
        await page.waitForTimeout(500);

        // Check if next sibling is now visible
        const expanded = await page.evaluate((idx) => {
          const els = document.querySelectorAll("[onclick], [role='button'], button");
          const next = els[idx]?.nextElementSibling as HTMLElement | null;
          return next ? getComputedStyle(next).display !== "none" : false;
        }, candidate.index);
        if (!expanded) continue;

        // Click again to collapse
        await page.evaluate((idx) => {
          const els = document.querySelectorAll("[onclick], [role='button'], button");
          (els[idx] as HTMLElement).click();
        }, candidate.index);
        await page.waitForTimeout(500);

        // Check if still visible (collapse failed)
        const stillExpanded = await page.evaluate((idx) => {
          const els = document.querySelectorAll("[onclick], [role='button'], button");
          const next = els[idx]?.nextElementSibling as HTMLElement | null;
          return next ? getComputedStyle(next).display !== "none" : false;
        }, candidate.index);

        if (stillExpanded) {
          const screenshot = await screenshotFn(page, "toggle-collapse");
          discoveries.push(makeDiscovery(
            `Collapsible item won't collapse: "${candidate.text}"`,
            `Clicking "${candidate.text}" expands adjacent content, but clicking again does not collapse it. The toggle behavior is broken.`,
            "medium", url, screenshot,
          ));
          break;
        }
      } catch {}
    }
  }

  return discoveries;
}

// ═══════════════════════════════════════════════════════════════════════════
// 5. Modal / dialog that can't be closed
//    Detection: behavioral — click buttons, detect new fixed overlays,
//    try to close, check if overlay persists.
//    Standards: <dialog>, [role="dialog"], [aria-modal]
// ═══════════════════════════════════════════════════════════════════════════

async function checkModalClose(
  page: Page, url: string, screenshotFn: ScreenshotFn,
): Promise<Discovery[]> {
  const discoveries: Discovery[] = [];

  // Get all visible buttons (skip known non-modal triggers)
  const buttons = await page.evaluate(() => {
    const skip = ["submit", "send", "+", "-", "−", "load", "fetch", "place", "start",
      "export", "sort", "delete", "remove", "save", "login", "sign", "upload"];
    return Array.from(document.querySelectorAll("button"))
      .filter(btn => {
        const rect = btn.getBoundingClientRect();
        const text = (btn.textContent || "").trim().toLowerCase();
        if (rect.width === 0 || !text || text.length > 30) return false;
        return !skip.some(s => text.includes(s));
      })
      .map(btn => (btn.textContent || "").trim());
  });

  for (const btnText of buttons) {
    try {
      // Snapshot: count fixed/absolute overlays currently visible
      const beforeOverlays = await countVisibleOverlays(page);

      // Click the button
      await page.evaluate((text) => {
        const btn = Array.from(document.querySelectorAll("button"))
          .find(b => (b.textContent || "").trim() === text) as HTMLElement | null;
        if (btn) btn.click();
      }, btnText);
      await page.waitForTimeout(500);

      // Check if a new overlay appeared (behavioral detection)
      const afterOverlays = await countVisibleOverlays(page);
      const hasDialog = await page.evaluate(() =>
        !!document.querySelector("dialog[open], [role='dialog']:not([hidden]), [aria-modal='true']"),
      );

      if (afterOverlays <= beforeOverlays && !hasDialog) continue; // No modal opened

      // Try to close via Escape, then close/cancel buttons
      const closed = await tryCloseModal(page);

      if (!closed) {
        const screenshot = await screenshotFn(page, "modal-close");
        discoveries.push(makeDiscovery(
          `Modal opened by "${btnText}" cannot be closed`,
          `Clicking "${btnText}" opens a modal/dialog overlay, but attempting to close it (via close/cancel buttons and Escape key) does not dismiss it. The close handler may be broken.`,
          "high", url, screenshot,
        ));
      }

      // Reset page
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 5000 });
      await page.waitForTimeout(300);
    } catch {
      try { await page.goto(url, { waitUntil: "domcontentloaded", timeout: 5000 }); } catch {}
    }
  }

  return discoveries;
}

/** Count elements that look like overlays: position fixed/absolute, covering large area */
async function countVisibleOverlays(page: Page): Promise<number> {
  return page.evaluate(() => {
    let count = 0;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    for (const el of document.querySelectorAll("*")) {
      const style = getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden") continue;
      if (style.position !== "fixed" && style.position !== "absolute") continue;
      const rect = (el as HTMLElement).getBoundingClientRect();
      // Large overlay: covers >50% of viewport
      if (rect.width > vw * 0.5 && rect.height > vh * 0.5) count++;
    }
    return count;
  });
}

async function tryCloseModal(page: Page): Promise<boolean> {
  // Try Escape key first (standard way to close dialogs)
  try {
    await page.keyboard.press("Escape");
    await page.waitForTimeout(500);
    if ((await countVisibleOverlays(page)) === 0 &&
        !(await page.evaluate(() => !!document.querySelector("dialog[open]")))) {
      return true;
    }
  } catch {}

  // Try clicking close/cancel/dismiss buttons
  const closeTexts = ["close", "cancel", "×", "✕", "dismiss"];
  for (const text of closeTexts) {
    try {
      await page.evaluate((closeText) => {
        for (const btn of document.querySelectorAll("button, [role='button'], a")) {
          const t = (btn.textContent || "").trim().toLowerCase();
          if (t === closeText || t.includes(closeText)) {
            (btn as HTMLElement).click();
            return;
          }
        }
      }, text);
      await page.waitForTimeout(500);

      if ((await countVisibleOverlays(page)) === 0) return true;
    } catch {}
  }

  return false;
}

// ═══════════════════════════════════════════════════════════════════════════
// 6. Sort toggle — table header click doesn't reverse sort direction
// ═══════════════════════════════════════════════════════════════════════════

async function checkSortToggle(
  page: Page, url: string, screenshotFn: ScreenshotFn,
): Promise<Discovery[]> {
  const discoveries: Discovery[] = [];

  // Find tables with clickable th elements
  const sortableHeaders = await page.evaluate(() => {
    const results: Array<{ text: string; colIndex: number; tableIndex: number }> = [];
    const tables = document.querySelectorAll("table");
    tables.forEach((table, ti) => {
      const ths = table.querySelectorAll("th");
      ths.forEach((th, ci) => {
        const style = getComputedStyle(th);
        const text = (th.textContent || "").trim();
        const hasClick = th.onclick !== null || style.cursor === "pointer" ||
          th.getAttribute("onclick") || th.hasAttribute("data-sort");
        if (hasClick && text.length > 0) {
          results.push({ text, colIndex: ci, tableIndex: ti });
        }
      });
    });
    return results.slice(0, 3);
  });

  for (const header of sortableHeaders) {
    try {
      // Get column data before sort
      const beforeData = await getColumnData(page, header.tableIndex, header.colIndex);
      if (beforeData.length < 2) continue;

      // Click to sort (first click)
      await page.evaluate((headerText) => {
        const th = Array.from(document.querySelectorAll("th"))
          .find(t => (t.textContent || "").trim() === headerText) as HTMLElement | null;
        if (th) th.click();
      }, header.text);
      await page.waitForTimeout(300);

      const afterFirstClick = await getColumnData(page, header.tableIndex, header.colIndex);

      // Click again to reverse sort
      await page.evaluate((headerText) => {
        const th = Array.from(document.querySelectorAll("th"))
          .find(t => (t.textContent || "").trim() === headerText) as HTMLElement | null;
        if (th) th.click();
      }, header.text);
      await page.waitForTimeout(300);

      const afterSecondClick = await getColumnData(page, header.tableIndex, header.colIndex);

      // Check: if first click sorted but second click produced the same order,
      // the descending toggle is broken
      const firstSorted = afterFirstClick.join(",") !== beforeData.join(",");
      const secondSameAsFirst = afterSecondClick.join(",") === afterFirstClick.join(",");

      if (firstSorted && secondSameAsFirst) {
        const screenshot = await screenshotFn(page, "sort-toggle");
        discoveries.push(makeDiscovery(
          `Table sort on "${header.text}" doesn't toggle direction`,
          `Clicking the "${header.text}" column header sorts the data, but clicking again does not reverse the sort direction. The table always sorts in the same order regardless of repeated clicks.`,
          "medium", url, screenshot,
        ));
        break;
      }
    } catch {}
  }

  return discoveries;
}

async function getColumnData(page: Page, tableIndex: number, colIndex: number): Promise<string[]> {
  return page.evaluate(({ ti, ci }) => {
    const tables = document.querySelectorAll("table");
    if (ti >= tables.length) return [];
    const rows = tables[ti].querySelectorAll("tbody tr");
    return Array.from(rows).map(row => {
      const cells = row.querySelectorAll("td");
      return ci < cells.length ? (cells[ci].textContent || "").trim() : "";
    });
  }, { ti: tableIndex, ci: colIndex });
}

// ═══════════════════════════════════════════════════════════════════════════
// 7. Progress bar exceeds 100%
//    Detection: <progress>, [role="progressbar"], aria-valuenow,
//    or behavioral — scan page for "N%" text patterns after clicking buttons
// ═══════════════════════════════════════════════════════════════════════════

async function checkProgressBounds(
  page: Page, url: string, screenshotFn: ScreenshotFn,
): Promise<Discovery[]> {
  const discoveries: Discovery[] = [];

  // Find progress elements via standards: <progress>, [role="progressbar"],
  // or behavioral: elements showing "N% complete" pattern
  const progressSections = await page.evaluate(() => {
    const results: Array<{ triggerText: string; sectionIndex: number }> = [];
    const sections = document.querySelectorAll("section, article, div[class], fieldset");

    sections.forEach((section, si) => {
      const hasProgress =
        section.querySelector("progress") !== null ||
        section.querySelector("[role='progressbar']") !== null ||
        (section.textContent || "").match(/\d+\s*%/);
      if (!hasProgress) return;

      const btn = section.querySelector("button:not([disabled])") as HTMLElement | null;
      if (btn) {
        results.push({
          triggerText: (btn.textContent || "").trim(),
          sectionIndex: si,
        });
      }
    });
    return results.slice(0, 3);
  });

  for (const info of progressSections) {
    if (!info.triggerText) continue;
    try {
      // Click the trigger button
      await page.evaluate((text) => {
        const btn = Array.from(document.querySelectorAll("button"))
          .find(b => (b.textContent || "").trim() === text) as HTMLElement | null;
        if (btn) btn.click();
      }, info.triggerText);

      // Poll for progress value exceeding 100%
      for (let i = 0; i < 10; i++) {
        await page.waitForTimeout(500);
        const value = await page.evaluate(() => {
          // Standard: <progress> element
          const prog = document.querySelector("progress") as HTMLProgressElement | null;
          if (prog && prog.max > 0) {
            const pct = Math.round((prog.value / prog.max) * 100);
            if (pct > 100) return pct;
          }
          // Standard: [role="progressbar"] with aria-valuenow
          const bars = document.querySelectorAll("[role='progressbar']");
          for (const bar of bars) {
            const now = parseFloat(bar.getAttribute("aria-valuenow") || "0");
            const max = parseFloat(bar.getAttribute("aria-valuemax") || "100");
            if (max > 0 && (now / max) * 100 > 100) return Math.round((now / max) * 100);
          }
          // Behavioral: scan for "N%" text on the page
          const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
          let node: Text | null;
          while ((node = walker.nextNode() as Text | null)) {
            const match = node.textContent?.match(/(\d+)\s*%/);
            if (match) {
              const val = parseInt(match[1], 10);
              if (val > 100 && val < 1000) return val;
            }
          }
          // Behavioral: element with inline width > 100%
          for (const el of document.querySelectorAll("[style*='width']")) {
            const w = parseInt((el as HTMLElement).style.width, 10);
            if (w > 100) return w;
          }
          return 0;
        });

        if (value > 100) {
          const screenshot = await screenshotFn(page, "progress-bounds");
          discoveries.push(makeDiscovery(
            `Progress bar exceeds 100% (reached ${value}%)`,
            `After clicking "${info.triggerText}", the progress indicator reached ${value}%, exceeding the maximum of 100%. There is no upper bound check on the progress value.`,
            "medium", url, screenshot,
          ));
          break;
        }
      }

      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 5000 });
      await page.waitForTimeout(300);
    } catch {
      try { await page.goto(url, { waitUntil: "domcontentloaded", timeout: 5000 }); } catch {}
    }
  }

  return discoveries;
}

// ═══════════════════════════════════════════════════════════════════════════
// 8. Tooltip that never dismisses after mouse leaves
//    Detection: behavioral — hover elements, detect new popups that appear,
//    move mouse away, check if popup persists.
//    Standards: [role="tooltip"], [aria-describedby], [data-tooltip]
// ═══════════════════════════════════════════════════════════════════════════

async function checkTooltipDismiss(
  page: Page, url: string, screenshotFn: ScreenshotFn,
): Promise<Discovery[]> {
  const discoveries: Discovery[] = [];

  // Find elements that might have tooltips:
  // 1. [aria-describedby] — ARIA standard
  // 2. [data-tooltip], [data-tip] — common data attributes
  // 3. [title] — native HTML tooltip (browsers handle these, skip)
  // 4. Behavioral: elements with mouseenter/mouseover listeners + hidden children
  // Build selectors for tooltip triggers (no coordinates — we'll scroll into view)
  // NOTE: avoid named functions inside page.evaluate — esbuild injects __name helper that breaks in browser
  const tooltipSelectors = await page.evaluate(() => {
    const results: Array<{ selector: string; text: string }> = [];
    const seen = new WeakSet<Element>();

    // ARIA-based
    for (const el of document.querySelectorAll("[aria-describedby]")) {
      if (seen.has(el)) continue;
      seen.add(el);
      const rect = (el as HTMLElement).getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        results.push({ selector: "[aria-describedby]", text: (el.textContent || "").trim().slice(0, 40) });
      }
    }

    // Data-attribute based
    for (const el of document.querySelectorAll("[data-tooltip], [data-tip], [data-tippy-content]")) {
      if (seen.has(el)) continue;
      seen.add(el);
      const rect = (el as HTMLElement).getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        results.push({ selector: "[data-tooltip]", text: (el.textContent || "").trim().slice(0, 40) });
      }
    }

    // Behavioral: inline onmouseenter/onmouseover + hidden positioned children
    for (const el of document.querySelectorAll("[onmouseenter], [onmouseover]")) {
      if (seen.has(el)) continue;
      const rect = (el as HTMLElement).getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) continue;
      for (const child of el.querySelectorAll("*")) {
        const cs = getComputedStyle(child);
        if (cs.display === "none" && (cs.position === "absolute" || cs.position === "fixed")) {
          seen.add(el);
          const attr = el.hasAttribute("onmouseenter") ? "onmouseenter" : "onmouseover";
          results.push({ selector: `[${attr}]`, text: (el.textContent || "").trim().slice(0, 40) });
          break;
        }
      }
    }

    return results.slice(0, 5);
  });

  for (const trigger of tooltipSelectors) {
    try {
      // Scroll into view using Playwright's built-in scrolling
      const el = page.locator(trigger.selector).first();
      if (!(await el.isVisible())) continue;
      await el.scrollIntoViewIfNeeded({ timeout: 2000 });
      await page.waitForTimeout(200);

      // Get coordinates AFTER scrolling
      const box = await el.boundingBox();
      if (!box) continue;

      // Count hidden positioned elements before hover
      const beforePopups = await countSmallPopups(page);

      // Hover over the trigger
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.waitForTimeout(600);

      // Count popups after hover
      const afterPopups = await countSmallPopups(page);
      if (afterPopups <= beforePopups) continue; // No tooltip appeared

      // Move mouse far away
      await page.mouse.move(0, 0);
      await page.waitForTimeout(600);

      // Check if popup is still visible
      const afterLeave = await countSmallPopups(page);
      if (afterLeave > beforePopups) {
        // Tooltip is still showing after mouse left
        const tooltipText = await page.evaluate(() => {
          for (const el of document.querySelectorAll("[role='tooltip'], [class*='tooltip'], [class*='popover']")) {
            const cs = getComputedStyle(el);
            if (cs.display !== "none" && cs.visibility !== "hidden") {
              return (el.textContent || "").trim();
            }
          }
          // Fallback: find any small visible absolutely-positioned element
          for (const el of document.querySelectorAll("*")) {
            const cs = getComputedStyle(el);
            if ((cs.position === "absolute" || cs.position === "fixed") &&
                cs.display !== "none" && cs.visibility !== "hidden") {
              const rect = (el as HTMLElement).getBoundingClientRect();
              if (rect.width > 0 && rect.width < 400 && rect.height > 0 && rect.height < 200) {
                const text = (el.textContent || "").trim();
                if (text.length > 0 && text.length < 200) return text;
              }
            }
          }
          return null;
        });

        if (tooltipText) {
          const screenshot = await screenshotFn(page, "tooltip-dismiss");
          discoveries.push(makeDiscovery(
            `Tooltip never disappears after mouse leaves`,
            `Hovering over "${trigger.text}" shows a tooltip ("${tooltipText}"), but moving the mouse away does not hide it. The tooltip remains visible indefinitely.`,
            "medium", url, screenshot,
          ));
          break;
        }
      }
    } catch {}
  }

  return discoveries;
}

/** Count small absolutely/fixed positioned visible elements (potential popups/tooltips) */
async function countSmallPopups(page: Page): Promise<number> {
  return page.evaluate(() => {
    let count = 0;
    for (const el of document.querySelectorAll("*")) {
      const cs = getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden") continue;
      if (cs.position !== "absolute" && cs.position !== "fixed") continue;
      const rect = (el as HTMLElement).getBoundingClientRect();
      // Small popup: not huge overlay, but visible
      if (rect.width > 10 && rect.width < 500 && rect.height > 10 && rect.height < 300) {
        count++;
      }
    }
    return count;
  });
}
