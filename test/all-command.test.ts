import test from "node:test";
import assert from "node:assert/strict";
import { formatAllResults } from "../src/format.js";
import type { ProviderResult } from "../src/types.js";

test("all command output keeps all providers even with partial failure", () => {
  const results: ProviderResult[] = [
    { provider: "codex", ok: true, model: "gpt-5", elapsedMs: 11, text: "codex text" },
    {
      provider: "claude",
      ok: false,
      model: "claude-sonnet-4-5",
      elapsedMs: 12,
      text: "",
      error: "missing CLAUDE_CODE_OAUTH_TOKEN",
    },
    { provider: "gemini", ok: true, model: "gemini-2.5-pro", elapsedMs: 13, text: "gemini text" },
  ];

  const output = formatAllResults(results);
  assert.match(output, /=== CODEX ===/);
  assert.match(output, /=== CLAUDE ===/);
  assert.match(output, /=== GEMINI ===/);
  assert.match(output, /missing CLAUDE_CODE_OAUTH_TOKEN/);
  assert.match(output, /codex text/);
  assert.match(output, /gemini text/);
});
