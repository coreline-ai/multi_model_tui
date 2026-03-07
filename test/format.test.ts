import test from "node:test";
import assert from "node:assert/strict";
import { formatAllResults, formatSingleResult } from "../src/format.js";
import type { ProviderResult } from "../src/types.js";

test("formats single success result", () => {
  const result: ProviderResult = {
    provider: "codex",
    ok: true,
    model: "gpt-5",
    elapsedMs: 123,
    text: "hello",
  };

  assert.equal(formatSingleResult(result), "[codex] model=gpt-5 elapsed=123ms\nhello");
});

test("formats single error result", () => {
  const result: ProviderResult = {
    provider: "claude",
    ok: false,
    model: "claude-sonnet-4-5",
    elapsedMs: 22,
    text: "",
    error: "missing CLAUDE_CODE_OAUTH_TOKEN",
  };

  assert.equal(
    formatSingleResult(result),
    "[claude] model=claude-sonnet-4-5 elapsed=22ms\nERROR: missing CLAUDE_CODE_OAUTH_TOKEN"
  );
});

test("formats /all output in fixed order", () => {
  const results: ProviderResult[] = [
    { provider: "gemini", ok: true, model: "gemini-2.5-pro", elapsedMs: 30, text: "g" },
    { provider: "codex", ok: true, model: "gpt-5", elapsedMs: 10, text: "c" },
    { provider: "claude", ok: true, model: "claude-sonnet-4-5", elapsedMs: 20, text: "a" },
  ];

  const formatted = formatAllResults(results);
  assert.ok(formatted.indexOf("=== CODEX ===") < formatted.indexOf("=== CLAUDE ==="));
  assert.ok(formatted.indexOf("=== CLAUDE ===") < formatted.indexOf("=== GEMINI ==="));
});

test("formats multiline content", () => {
  const result: ProviderResult = {
    provider: "gemini",
    ok: true,
    model: "gemini-2.5-pro",
    elapsedMs: 44,
    text: "line1\nline2",
  };

  assert.match(formatAllResults([result]), /content:\nline1\nline2/);
});
