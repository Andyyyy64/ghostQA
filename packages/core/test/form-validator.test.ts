import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("nanoid", () => ({ nanoid: () => "testid12" }));

import { testFormValidation } from "../src/explorer/form-validator";

function mockLocator(overrides: Record<string, any> = {}) {
  return {
    all: vi.fn().mockResolvedValue([]),
    count: vi.fn().mockResolvedValue(0),
    first: vi.fn().mockReturnThis(),
    isVisible: vi.fn().mockResolvedValue(true),
    click: vi.fn().mockResolvedValue(undefined),
    clear: vi.fn().mockResolvedValue(undefined),
    getAttribute: vi.fn().mockResolvedValue(null),
    evaluate: vi.fn().mockResolvedValue(""),
    elementHandle: vi.fn().mockResolvedValue({}),
    locator: vi.fn().mockReturnThis(),
    ...overrides,
  };
}

function mockPage(forms: any[] = []) {
  const page: any = {
    url: vi.fn().mockReturnValue("http://localhost:3000/"),
    locator: vi.fn().mockReturnValue({
      all: vi.fn().mockResolvedValue(forms),
    }),
    evaluate: vi.fn().mockResolvedValue(null),
    waitForTimeout: vi.fn().mockResolvedValue(undefined),
    goto: vi.fn().mockResolvedValue(undefined),
  };
  return page;
}

describe("testFormValidation", () => {
  const screenshotFn = vi.fn().mockResolvedValue("/tmp/screenshot.png");

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns empty when no forms on page", async () => {
    const page = mockPage([]);
    const result = await testFormValidation(page, "http://localhost:3000/", screenshotFn);
    expect(result).toEqual([]);
  });

  it("skips forms without required fields", async () => {
    const form = mockLocator({
      locator: vi.fn().mockImplementation((sel: string) => {
        if (sel === "[required]") return { count: vi.fn().mockResolvedValue(0) };
        return mockLocator();
      }),
    });
    const page = mockPage([form]);
    const result = await testFormValidation(page, "http://localhost:3000/", screenshotFn);
    expect(result).toEqual([]);
  });

  it("skips hidden forms", async () => {
    const form = mockLocator({ isVisible: vi.fn().mockResolvedValue(false) });
    const page = mockPage([form]);
    const result = await testFormValidation(page, "http://localhost:3000/", screenshotFn);
    expect(result).toEqual([]);
  });

  it("detects form that accepts empty required fields when success message appears", async () => {
    const inputs = [mockLocator()];
    const submitBtn = mockLocator({
      count: vi.fn().mockResolvedValue(1),
      isVisible: vi.fn().mockResolvedValue(true),
    });

    const form = mockLocator({
      getAttribute: vi.fn().mockImplementation((attr: string) => {
        if (attr === "id") return Promise.resolve("contactForm");
        return Promise.resolve(null);
      }),
      locator: vi.fn().mockImplementation((sel: string) => {
        if (sel === "[required]") return { count: vi.fn().mockResolvedValue(3) };
        if (sel.includes("submit") || sel.includes("button")) return submitBtn;
        if (sel.includes("input") || sel.includes("textarea")) return { all: vi.fn().mockResolvedValue(inputs) };
        return mockLocator();
      }),
      evaluate: vi.fn()
        .mockResolvedValueOnce("||") // before: empty values
        .mockResolvedValueOnce("||"), // after: still empty (but success detected)
    });

    const page = mockPage([form]);
    // Simulate success message appearing after submission
    page.evaluate
      .mockResolvedValueOnce(true) // submit event fired
      .mockResolvedValueOnce("Message sent successfully!"); // success message detected

    const result = await testFormValidation(page, "http://localhost:3000/", screenshotFn);

    expect(result.length).toBe(1);
    expect(result[0].title).toContain("accepts empty required fields");
    expect(result[0].severity).toBe("high");
    expect(result[0].confidence).toBe("high");
    expect(result[0].description).toContain("3 required field");
    expect(result[0].description).toContain("success");
  });

  it("does not report when form validation works correctly", async () => {
    const inputs = [mockLocator()];
    const submitBtn = mockLocator({
      count: vi.fn().mockResolvedValue(1),
      isVisible: vi.fn().mockResolvedValue(true),
    });

    const form = mockLocator({
      locator: vi.fn().mockImplementation((sel: string) => {
        if (sel === "[required]") return { count: vi.fn().mockResolvedValue(2) };
        if (sel.includes("submit") || sel.includes("button")) return submitBtn;
        if (sel.includes("input") || sel.includes("textarea")) return { all: vi.fn().mockResolvedValue(inputs) };
        return mockLocator();
      }),
      evaluate: vi.fn()
        .mockResolvedValueOnce("||") // before
        .mockResolvedValueOnce("||"), // after (same - no reset)
    });

    const page = mockPage([form]);
    // Submit blocked by browser validation (returned false)
    page.evaluate
      .mockResolvedValueOnce(false)  // submit event did NOT fire
      .mockResolvedValueOnce(null);  // no success message

    const result = await testFormValidation(page, "http://localhost:3000/", screenshotFn);
    expect(result).toEqual([]);
  });

  it("detects form reset as evidence of accepted submission", async () => {
    const inputs = [mockLocator()];
    const submitBtn = mockLocator({
      count: vi.fn().mockResolvedValue(1),
      isVisible: vi.fn().mockResolvedValue(true),
    });

    const form = mockLocator({
      getAttribute: vi.fn().mockResolvedValue("myForm"),
      locator: vi.fn().mockImplementation((sel: string) => {
        if (sel === "[required]") return { count: vi.fn().mockResolvedValue(1) };
        if (sel.includes("submit") || sel.includes("button")) return submitBtn;
        if (sel.includes("input") || sel.includes("textarea")) return { all: vi.fn().mockResolvedValue(inputs) };
        return mockLocator();
      }),
      evaluate: vi.fn()
        .mockResolvedValueOnce("hello|world") // before: had values
        .mockResolvedValueOnce("|"), // after: form was reset
    });

    const page = mockPage([form]);
    page.evaluate
      .mockResolvedValueOnce(true) // submit event fired
      .mockResolvedValueOnce(null); // no explicit success message

    const result = await testFormValidation(page, "http://localhost:3000/", screenshotFn);

    expect(result.length).toBe(1);
    expect(result[0].description).toContain("reset");
  });
});
