/**
 * Extract and parse JSON from an LLM response that may contain
 * markdown code fences, explanation text, or other wrapping.
 */
export function extractJson<T = unknown>(text: string): T {
  // 1. Try direct parse (response is pure JSON)
  try {
    return JSON.parse(text) as T;
  } catch {
    // continue
  }

  // 2. Try extracting from markdown code block ```json ... ``` or ``` ... ```
  const codeBlockMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
  if (codeBlockMatch) {
    try {
      return JSON.parse(codeBlockMatch[1].trim()) as T;
    } catch {
      // continue
    }
  }

  // 3. Try finding the outermost { ... } pair with brace matching
  const start = text.indexOf("{");
  if (start !== -1) {
    let depth = 0;
    let end = -1;
    for (let i = start; i < text.length; i++) {
      if (text[i] === "{") depth++;
      else if (text[i] === "}") {
        depth--;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    if (end !== -1) {
      try {
        return JSON.parse(text.slice(start, end + 1)) as T;
      } catch {
        // continue
      }
    }
  }

  throw new Error(
    `Failed to extract JSON from response (${text.length} chars): ${text.slice(0, 200)}...`
  );
}
