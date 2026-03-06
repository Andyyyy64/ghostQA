import type { Page } from "playwright";
import consola from "consola";
import type { Discovery } from "../types/discovery";
import { nanoid } from "nanoid";

/**
 * Deterministic form validation tester.
 * Finds forms with required fields and tries submitting them empty.
 * If the form accepts empty required fields → reports a discovery.
 *
 * Runs BEFORE AI exploration so it doesn't rely on the AI deciding to test this.
 */
export async function testFormValidation(
  page: Page,
  url: string,
  screenshotFn: (page: Page, name: string) => Promise<string>
): Promise<Discovery[]> {
  const discoveries: Discovery[] = [];

  const forms = await page.locator("form").all();
  if (forms.length === 0) return discoveries;

  consola.info(`Form validation: found ${forms.length} form(s), testing empty submission`);

  for (let i = 0; i < forms.length; i++) {
    try {
      const form = forms[i];
      if (!(await form.isVisible())) continue;

      // Check if this form has any required fields
      const requiredCount = await form.locator("[required]").count();
      if (requiredCount === 0) continue;

      // Get form identity for reporting
      const formId = await form.getAttribute("id") ?? `form-${i}`;
      const formAction = await form.getAttribute("action") ?? url;

      // Snapshot the current state before submitting
      const beforeUrl = page.url();
      const beforeContent = await getFormStateSignature(form);

      // Find and click the submit button
      const submitted = await trySubmitEmpty(page, form);
      if (!submitted) continue;

      // Wait for potential form processing
      await page.waitForTimeout(500);

      // Check for success indicators
      const afterUrl = page.url();
      const afterContent = await getFormStateSignature(form).catch(() => null);
      const successIndicator = await detectSuccessMessage(page);

      // Determine if the form accepted the empty submission
      const urlChanged = afterUrl !== beforeUrl;
      const formReset = afterContent !== null && afterContent !== beforeContent;
      const hasSuccessMsg = successIndicator !== null;

      if (urlChanged || formReset || hasSuccessMsg) {
        const screenshot = await screenshotFn(page, `form-validation-${formId}`);
        const evidence = hasSuccessMsg
          ? `Success message found: "${successIndicator}"`
          : urlChanged
            ? `Page navigated to ${afterUrl} after empty submission`
            : `Form fields were reset after empty submission`;

        discoveries.push({
          id: `form-${nanoid(8)}`,
          source: "explorer",
          severity: "high",
          title: `Form #${formId} accepts empty required fields — validation broken`,
          description: `The form has ${requiredCount} required field(s) but submitted successfully without any being filled. ${evidence}. Expected: form should show validation errors and prevent submission.`,
          url: beforeUrl,
          screenshot_path: screenshot,
          timestamp: Date.now(),
          confidence: "high",
        });

        consola.warn(`Discovery: Form #${formId} has broken validation (${requiredCount} required fields bypassed)`);

        // Navigate back if URL changed
        if (urlChanged) {
          await page.goto(beforeUrl, { waitUntil: "domcontentloaded", timeout: 5000 }).catch(() => {});
        }
      }
    } catch (err) {
      consola.debug(`Form validation test ${i} skipped: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return discoveries;
}

/** Try to submit a form by clicking its submit button or pressing Enter */
async function trySubmitEmpty(page: Page, form: import("playwright").Locator): Promise<boolean> {
  // Clear all input fields first to ensure they're empty
  const inputs = await form.locator("input:not([type=hidden]):not([type=submit]):not([type=button]), textarea").all();
  for (const input of inputs) {
    try {
      if (await input.isVisible()) {
        await input.clear({ timeout: 1000 });
      }
    } catch {
      // Some inputs may not be clearable
    }
  }

  // Try clicking submit button
  const submitBtn = form.locator('button[type="submit"], input[type="submit"], button:not([type])').first();
  if (await submitBtn.count() > 0 && await submitBtn.isVisible()) {
    // Listen for form submission to detect if browser validation blocked it
    const wasSubmitted = await page.evaluate((formEl) => {
      return new Promise<boolean>((resolve) => {
        const f = formEl as HTMLFormElement;
        let submitted = false;
        const handler = () => { submitted = true; };
        f.addEventListener("submit", handler, { once: true });
        // If browser validation blocks, submit event never fires
        setTimeout(() => {
          f.removeEventListener("submit", handler);
          resolve(submitted);
        }, 1000);
      });
    }, await form.elementHandle()).catch(() => null);

    await submitBtn.click({ timeout: 2000 }).catch(() => {});

    // Give the submit event time to fire
    await page.waitForTimeout(300);

    // If we got a result from the evaluate, use it
    // If wasSubmitted is true, form was submitted (validation didn't block)
    // If null or false, browser validation likely blocked the submission
    return wasSubmitted !== false;
  }

  return false;
}

/** Get a signature of current form field values to detect form reset */
async function getFormStateSignature(form: import("playwright").Locator): Promise<string> {
  return form.evaluate((el) => {
    const inputs = el.querySelectorAll("input, textarea, select");
    return Array.from(inputs)
      .map((inp) => (inp as HTMLInputElement).value || "")
      .join("|");
  });
}

/** Look for success/confirmation messages on the page */
async function detectSuccessMessage(page: Page): Promise<string | null> {
  const successPatterns = [
    "success", "thank you", "thanks", "sent", "submitted",
    "received", "confirmed", "saved", "completed",
  ];

  // Check for newly visible elements that contain success text
  const result = await page.evaluate((patterns) => {
    const allText = document.body.innerText.toLowerCase();
    for (const p of patterns) {
      if (allText.includes(p)) {
        // Find the element containing this text
        const elements = document.querySelectorAll("*");
        for (const el of elements) {
          const text = (el.textContent || "").trim().toLowerCase();
          if (
            text.includes(p) &&
            text.length < 200 &&
            el.children.length === 0 &&
            (el as HTMLElement).offsetParent !== null
          ) {
            return (el.textContent || "").trim();
          }
        }
      }
    }
    return null;
  }, successPatterns);

  return result;
}
