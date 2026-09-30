// lib/llmJson.js (CommonJS)
//
// Helpers to safely extract and parse JSON produced by an LLM.
// We intentionally accept fenced code blocks and "extra text" before/after JSON.

function extractFirstJsonObject(text) {
  if (!text) return null;

  // Remove common code fences
  let t = String(text)
    .replace(/```json/gi, "```")
    .replace(/```/g, "")
    .trim();

  // Find a JSON object by matching braces.
  // We scan and track nesting depth to find the first complete object.
  let start = -1;
  let depth = 0;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (ch === "{") {
      if (start === -1) start = i;
      depth += 1;
    } else if (ch === "}") {
      if (start !== -1) depth -= 1;
      if (start !== -1 && depth === 0) {
        return t.slice(start, i + 1).trim();
      }
    }
  }

  return null;
}

function safeJsonParse(text) {
  const jsonStr = extractFirstJsonObject(text);
  if (!jsonStr) return { ok: false, error: "No JSON object found in model output", value: null };

  try {
    return { ok: true, error: null, value: JSON.parse(jsonStr) };
  } catch (e) {
    return { ok: false, error: `Failed to parse JSON: ${e.message}`, value: null, raw: jsonStr };
  }
}

module.exports = { extractFirstJsonObject, safeJsonParse };