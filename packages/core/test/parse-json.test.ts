import { describe, it, expect } from "vitest";
import { extractJson } from "../src/ai/parse-json";

describe("extractJson", () => {
  it("parses clean JSON directly", () => {
    const result = extractJson<{ a: number }>('{"a": 1}');
    expect(result).toEqual({ a: 1 });
  });

  it("extracts JSON from markdown code block", () => {
    const text = 'Here is the result:\n```json\n{"action": "click"}\n```';
    expect(extractJson(text)).toEqual({ action: "click" });
  });

  it("extracts JSON from code block without language tag", () => {
    const text = '```\n{"key": "value"}\n```';
    expect(extractJson(text)).toEqual({ key: "value" });
  });

  it("handles escaped newlines from CLI tools", () => {
    // Simulate CLI single-line output where \n separates JSON fields
    const text = String.raw`{"action": "click",\n"target": "button"}`;
    const result = extractJson<{ action: string; target: string }>(text);
    expect(result.action).toBe("click");
    expect(result.target).toBe("button");
  });

  it("fixes trailing commas", () => {
    const text = '{"a": 1, "b": 2,}';
    expect(extractJson(text)).toEqual({ a: 1, b: 2 });
  });

  it("fixes single-quoted keys", () => {
    const text = "{'action': 'click', 'target': 'button'}";
    expect(extractJson(text)).toEqual({ action: "click", target: "button" });
  });

  it("extracts JSON from surrounding text", () => {
    const text = 'Thinking about it...\n{"action": "done"}\nThat is my answer.';
    expect(extractJson(text)).toEqual({ action: "done" });
  });

  it("handles nested braces correctly", () => {
    const text = 'Result: {"outer": {"inner": 1}, "b": 2}';
    expect(extractJson(text)).toEqual({ outer: { inner: 1 }, b: 2 });
  });

  it("handles braces inside string values", () => {
    const text = '{"msg": "use {x} syntax", "ok": true}';
    const result = extractJson<{ msg: string; ok: boolean }>(text);
    expect(result.msg).toBe("use {x} syntax");
    expect(result.ok).toBe(true);
  });

  it("throws on completely invalid input", () => {
    expect(() => extractJson("no json here at all")).toThrow();
  });
});
