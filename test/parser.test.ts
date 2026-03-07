import test from "node:test";
import assert from "node:assert/strict";
import { parseCommand } from "../src/parser.js";

test("parses /codex prompt", () => {
  assert.deepEqual(parseCommand("/codex hello"), {
    kind: "provider",
    provider: "codex",
    prompt: "hello",
    raw: "/codex hello",
  });
});

test("parses /gemini prompt with spaces", () => {
  assert.deepEqual(parseCommand("/gemini hello world"), {
    kind: "provider",
    provider: "gemini",
    prompt: "hello world",
    raw: "/gemini hello world",
  });
});

test("trims prompt for /all", () => {
  assert.deepEqual(parseCommand("/all   trim check"), {
    kind: "provider",
    provider: "all",
    prompt: "trim check",
    raw: "/all   trim check",
  });
});

test("parses help", () => {
  assert.deepEqual(parseCommand("/help"), {
    kind: "help",
    raw: "/help",
  });
});

test("parses exit", () => {
  assert.deepEqual(parseCommand("/exit"), {
    kind: "exit",
    raw: "/exit",
  });
});

test("rejects empty input", () => {
  assert.deepEqual(parseCommand("   "), {
    kind: "invalid",
    raw: "   ",
    error: "command is required",
  });
});

test("rejects unknown commands", () => {
  assert.deepEqual(parseCommand("/unknown"), {
    kind: "invalid",
    raw: "/unknown",
    error: "unknown command",
  });
});

test("rejects provider command without prompt", () => {
  assert.deepEqual(parseCommand("/codex"), {
    kind: "invalid",
    raw: "/codex",
    error: "prompt is required",
  });
});
