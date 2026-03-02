/**
 * Extract and parse JSON from an LLM response that may contain
 * markdown code fences, explanation text, trailing commas,
 * or other common LLM formatting issues.
 */
export function extractJson<T = unknown>(text: string): T {
  // 0. Unescape literal \n sequences (CLI tools sometimes return single-line responses)
  let cleaned = text;
  if (cleaned.includes("\\n") && !cleaned.includes("\n")) {
    cleaned = cleaned
      .replace(/\\n/g, "\n")
      .replace(/\\t/g, "\t")
      .replace(/\\r/g, "\r");
  }

  // 1. Try direct parse (response is pure JSON)
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    // continue
  }

  // 2. Try extracting from markdown code block ```json ... ``` or ``` ... ```
  const codeBlockMatch = cleaned.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
  if (codeBlockMatch) {
    const attempt = fixAndParse<T>(codeBlockMatch[1].trim());
    if (attempt !== undefined) return attempt;
  }

  // 3. Try finding the outermost { ... } pair with brace matching
  const start = cleaned.indexOf("{");
  if (start !== -1) {
    let depth = 0;
    let inString = false;
    let escape = false;
    let end = -1;
    for (let i = start; i < cleaned.length; i++) {
      const ch = cleaned[i];
      if (escape) {
        escape = false;
        continue;
      }
      if (ch === "\\") {
        escape = true;
        continue;
      }
      if (ch === '"') {
        inString = !inString;
        continue;
      }
      if (inString) continue;
      if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    if (end !== -1) {
      const attempt = fixAndParse<T>(cleaned.slice(start, end + 1));
      if (attempt !== undefined) return attempt;
    }
  }

  throw new Error(
    `Failed to extract JSON from response (${text.length} chars): ${text.slice(0, 200)}...`
  );
}

/**
 * Try to parse JSON with common LLM mistake fixes:
 * - Trailing commas before } or ]
 * - Single-quoted strings
 * - Unquoted keys
 */
function fixAndParse<T>(raw: string): T | undefined {
  // Direct parse
  try {
    return JSON.parse(raw) as T;
  } catch {
    // continue
  }

  // Fix trailing commas: ,} or ,]
  let fixed = raw.replace(/,\s*([\]}])/g, "$1");

  try {
    return JSON.parse(fixed) as T;
  } catch {
    // continue
  }

  // Fix single quotes → double quotes (careful with apostrophes in values)
  // Only apply if the text uses single quotes as delimiters for keys
  if (fixed.match(/'[^']*'\s*:/)) {
    fixed = fixed
      .replace(/'([^']*?)'\s*:/g, '"$1":')
      .replace(/:\s*'([^']*?)'/g, ': "$1"');
    try {
      return JSON.parse(fixed) as T;
    } catch {
      // continue
    }
  }

  return undefined;
}
